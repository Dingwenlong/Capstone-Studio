import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { createServer } from 'node:http'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import { closeStore, getStore, inspect, issueNonce, mutate, query, redeem } from '../src/server/store'
import { openDatabase } from '../src/server/db'
import { exportData, importData, initialize } from '../src/server/service-data'
import { digest, secret, type Context } from '../src/server/service-helpers'
import type { Audit, Book, Slot, Student, SystemInfo } from '../src/shared/contract'
import { createHTTPHandler } from '@trpc/server/adapters/standalone'
import { makeContext, router } from '../src/server/rpc'
import { origin, isTls } from '../src/server/hosts'
import { cleanStoreTestDirectory } from './store-temp'

const write = async (ctx: Context, action: string, input: unknown = {}) =>
  mutate(ctx, action, input, await issueNonce(ctx, action))
const launch = async (ctx: Context, key: string) => {
  const result = await write(ctx, 'launch', { systemKey: key })
  return { host: key, ...(await redeem(key, result.ticket)) }
}
const status = (expected: number) => (error: unknown) => (error as { status?: number })?.status === expected

test('账号隔离、共享库存与时段、一次性票据及授权生命周期', async () => {
  // A test-only URL may point at an independent empty PostgreSQL database.
  if (process.env.CLASSROOM_TEST_DATABASE_URL)
    process.env.DATABASE_URL = process.env.CLASSROOM_TEST_DATABASE_URL
  else {
    delete process.env.DATABASE_URL
    process.env.DATA_DIR = 'memory://'
  }
  const db = await getStore()
  const duplicate = async (ctx: Context, op: string, id: string, nonce: string) => {
    const results = await Promise.allSettled([mutate(ctx, op, { id }, nonce), mutate(ctx, op, { id }, nonce)])
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
    const failure = results.find((result) => result.status === 'rejected')
    assert.equal((failure as PromiseRejectedResult).reason.status, 409)
  }
  try {
    const credentials = await initialize(db)
    const login = async (username: string, host: string) => {
      const payload = credentials.find((row) => row.username === username)!
      const result = await write({ host, anon: username }, 'login', payload)
      return { host, token: result.token as string }
    }
    const admin = await login('teacher', 'admin')
    const a = await login('student-a', 'portal')
    const b = await login('student-b', 'portal')
    const students: Student[] = await query(admin, 'students')
    const aId = students.find((s) => s.username === 'student-a')!.id
    const bId = students.find((s) => s.username === 'student-b')!.id
    assert.deepEqual(((await query(a, 'systems')) as SystemInfo[]).map((s) => s.key).sort(), [
      'lab',
      'library',
    ])
    assert.deepEqual(
      ((await query(b, 'systems')) as SystemInfo[]).map((s) => s.key),
      ['lab'],
    )
    assert.equal(await inspect(a.token, 'admin'), null)
    await assert.rejects(write(b, 'launch', { systemKey: 'library' }), status(403))
    const expired = await issueNonce(a, 'launch')
    await db.rows(sql`UPDATE nonces SET expires_at=now()-interval '1 minute' WHERE digest=${digest(expired)}`)
    await assert.rejects(mutate(a, 'launch', { systemKey: 'library' }, expired), status(409))
    const pending = await write(a, 'launch', { systemKey: 'library' })
    await assert.rejects(redeem('lab', pending.ticket), status(403))
    const library = { host: 'library', ...(await redeem('library', pending.ticket)) }
    await assert.rejects(redeem('library', pending.ticket), status(403))
    await write(admin, 'setGrants', { studentId: bId, keys: ['library', 'lab'] })
    await write(admin, 'setGrants', { studentId: aId, keys: ['library', 'lab'] })
    const bLibrary = await launch(b, 'library')
    const books = (await query(library, 'books')) as Book[]
    const last = books.find((book) => book.available === 1)!
    const id = last.id
    const nonce = await issueNonce(library, 'borrow')
    await assert.rejects(mutate(bLibrary, 'borrow', { id }, nonce), status(409))
    await assert.rejects(mutate(library, 'returnBook', { id }, nonce), status(409))
    await duplicate(library, 'borrow', id, nonce)
    const bView = ((await query(bLibrary, 'books')) as Book[]).find((book) => book.id === id)!
    assert.equal(bView.available, 0)
    assert.equal(bView.myLoans, 0)
    await assert.rejects(write(bLibrary, 'returnBook', { id }), status(409))
    const retry = await issueNonce(bLibrary, 'borrow')
    await assert.rejects(mutate(bLibrary, 'borrow', { id }, retry), status(409))
    await write(library, 'returnBook', { id })
    await mutate(bLibrary, 'borrow', { id }, retry) // Business failure rolled back both stock and nonce.
    const labA = await launch(a, 'lab')
    const labB = await launch(b, 'lab')
    const [slot] = (await query(labA, 'slots')) as Slot[]
    const reservations = await Promise.allSettled([
      write(labA, 'reserve', { id: slot.id }),
      write(labB, 'reserve', { id: slot.id }),
    ])
    assert.equal(reservations.filter((result) => result.status === 'fulfilled').length, 1)
    const loser = reservations[0].status === 'fulfilled' ? labB : labA
    await assert.rejects(write(loser, 'cancelReservation', { id: slot.id }), status(409))
    const winner = reservations[0].status === 'fulfilled' ? labA : labB
    const winningActor = winner === labA ? 'student-a' : 'student-b'
    await write(winner, 'cancelReservation', { id: slot.id })
    const businessAudit = (await query(admin, 'audit')) as Audit[]
    for (const [action, actor, detail] of [
      ['borrow', 'student-a', id],
      ['returnBook', 'student-a', id],
      ['borrow', 'student-b', id],
      ['reserve', winningActor, slot.id],
      ['cancelReservation', winningActor, slot.id],
    ]) {
      assert.equal(
        businessAudit.filter(
          (entry) => entry.action === action && entry.actor === actor && entry.detail === detail,
        ).length,
        1,
      )
    }
    assert.equal(
      businessAudit.filter((entry) =>
        ['borrow', 'returnBook', 'reserve', 'cancelReservation'].includes(entry.action),
      ).length,
      5,
    )
    const before = await write(a, 'launch', { systemKey: 'library' })
    await write(admin, 'setGrants', { studentId: aId, keys: ['lab'] })
    await write(admin, 'setGrants', { studentId: aId, keys: ['library', 'lab'] })
    assert.equal(await inspect(library.token, 'library'), null)
    await assert.rejects(redeem('library', before.ticket), status(403))
    await write(admin, 'setSystemEnabled', { key: 'lab', enabled: false })
    await write(admin, 'setSystemEnabled', { key: 'lab', enabled: true })
    assert.equal(await inspect(labA.token, 'lab'), null)
    await write(admin, 'resetPassword', { studentId: bId, password: secret() })
    assert.equal(await inspect(b.token, 'portal'), null)
    assert.equal(await inspect(bLibrary.token, 'library'), null)
    const newPassword = secret()
    await write(admin, 'createStudent', { username: 'new-learner', name: '新同学', password: newPassword })
    const created = ((await query(admin, 'students')) as Student[]).find(
      (student) => student.username === 'new-learner',
    )!
    const fresh = {
      host: 'portal',
      ...(await write({ host: 'portal', anon: 'new' }, 'login', {
        username: 'new-learner',
        password: newPassword,
      })),
    }
    assert.deepEqual(await query(fresh, 'systems'), [])
    await write(admin, 'setStudentActive', { studentId: created.id, active: false })
    assert.equal(await inspect(fresh.token, 'portal'), null)
    const logged = (await query(admin, 'audit')) as { detail: string }[]
    assert(logged.some((event) => event.detail.includes('new-learner')))
    assert(!JSON.stringify(logged).includes(newPassword))
    const child = await launch(a, 'library')
    await write(a, 'logout')
    assert.equal(await inspect(child.token, 'library'), null)
    const destination = await openDatabase({ directory: 'memory://' })
    try {
      const backup = await exportData(db)
      assert(!('sessions' in backup.tables) && !('nonces' in backup.tables) && !('tickets' in backup.tables))
      await assert.rejects(importData(destination, { ...backup, tables: { ...backup.tables, sessions: [] } }))
      await assert.rejects(importData(destination, { ...backup, sha256: '0'.repeat(64) }))
      await importData(destination, backup)
      assert.deepEqual(await exportData(destination), backup)
      await assert.rejects(importData(destination, backup), /已有数据/)
      assert.equal((await destination.rows(sql`SELECT 1 FROM sessions`)).length, 0)
    } finally {
      await destination.close()
    }
  } finally {
    await closeStore()
  }
})

test('磁盘库重开后拒绝已使用的 X-Request-ID，备份恢复后原账号能登录并读取业务记录', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'classroom-database-'))
  const source = join(directory, 'source')
  delete process.env.DATABASE_URL
  process.env.DATA_DIR = source
  const handler = createHTTPHandler({
    router,
    basePath: '/api/rpc/',
    createContext: ({ req, res }) => makeContext('library', req, res),
  })
  const server = createServer(handler)
  try {
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const url = 'http://127.0.0.1:' + (server.address() as AddressInfo).port + '/api/rpc/write'
    const original = await getStore()
    const credentials = await initialize(original)
    await assert.rejects(openDatabase({ directory: source }), /正在使用/)
    const signIn = async (host: string, username: string) => {
      const account = credentials.find((row) => row.username === username)!
      const result = await write({ host, anon: secret() }, 'login', account)
      return { host, token: result.token as string }
    }
    const a = await signIn('portal', 'student-a')
    const library = await launch(a, 'library')
    const lab = await launch(a, 'lab')
    const [book] = (await query(library, 'books')) as Book[]
    const [slot] = (await query(lab, 'slots')) as Slot[]
    await write(lab, 'reserve', { id: slot.id })
    const requestId = await issueNonce(library, 'borrow')
    const sendBorrow = async () => {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: origin('library'),
          cookie: (isTls ? '__Host-' : '') + 'classroom_session=' + library.token,
          'X-Request-ID': requestId,
        },
        body: JSON.stringify({ action: 'borrow', input: { id: book.id } }),
      })
      await response.arrayBuffer()
      return response.status
    }
    assert.equal(await sendBorrow(), 200)
    await closeStore()
    const reopened = await getStore()
    await assert.rejects(initialize(reopened), /已有数据/)
    assert.equal(await sendBorrow(), 409)
    const active = ((await query(library, 'books')) as Book[]).find((row) => row.id === book.id)!
    assert.equal(active.myLoans, 1)
    assert.equal(active.available, book.available - 1)
    const snapshot = await exportData(reopened)
    await closeStore()

    process.env.DATA_DIR = join(directory, 'recovery')
    await importData(await getStore(), snapshot)
    assert.equal(await inspect(a.token, 'portal'), null)
    const restoredStudent = await signIn('portal', 'student-a')
    const restoredTeacher = await signIn('admin', 'teacher')
    const restoredBooks = (await query(await launch(restoredStudent, 'library'), 'books')) as Book[]
    const restoredSlots = (await query(await launch(restoredStudent, 'lab'), 'slots')) as Slot[]
    assert.deepEqual(
      restoredBooks.find((row) => row.id === book.id),
      active,
    )
    assert.equal(restoredSlots.find((row) => row.id === slot.id)?.mine, true)
    const restoredAudit = (await query(restoredTeacher, 'audit')) as Audit[]
    for (const [action, id] of [
      ['borrow', book.id],
      ['reserve', slot.id],
    ]) {
      assert.equal(
        restoredAudit.filter((row) => row.actor === 'student-a' && row.action === action && row.detail === id)
          .length,
        1,
      )
    }
  } finally {
    if (server.listening) {
      const stopped = once(server, 'close')
      server.close()
      server.closeAllConnections()
      await stopped
    }
    await closeStore()
    await cleanStoreTestDirectory(directory)
  }
})
