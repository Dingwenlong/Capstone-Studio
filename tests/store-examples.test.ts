import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { sql } from 'drizzle-orm'
import { closeStore, getStore, inspect, issueNonce, mutate, query, redeem } from '../src/server/store'
import { digest, secret, type Context } from '../src/server/service-helpers'
import { initialize, exportData } from '../src/server/service-data'
import { cleanStoreTestDirectory } from './store-temp'
import type { Student, SystemInfo, Target } from '../src/shared/contract'

test('四个示例身份共用独立数据，教师操作与跨库会话切换在磁盘重开后保持隔离', async () => {
  const root = await mkdtemp(join(tmpdir(), 'classroom-database-'))
  if (process.env.CLASSROOM_TEST_EXAMPLE_DATABASE_URL)
    process.env.DATABASE_URL = process.env.CLASSROOM_TEST_EXAMPLE_DATABASE_URL
  else delete process.env.DATABASE_URL
  process.env.DATA_DIR = join(root, 'official')
  process.env.TARGETS_FILE = join(root, 'targets.json')
  await writeFile(
    process.env.TARGETS_FILE,
    JSON.stringify([{ key: 'partner', name: '外部教务', upstream: 'http://partner:8080' }]),
  )
  const request = async (ctx: Context, action: string, input: unknown) =>
    mutate(ctx, action, input, await issueNonce(ctx, action))
  const signIn = async (host: string, action: string, details: unknown, token?: string): Promise<Context> => {
    const result = await request({ host, anon: secret(), token }, action, details)
    return { host, token: result.token }
  }
  const launch = async (ctx: Context) => {
    const { ticket } = await request(ctx, 'launch', { systemKey: 'library' })
    return { host: 'library', ...(await redeem('library', ticket)) }
  }
  try {
    const formal = await getStore()
    const credentials = await initialize(formal)
    const account = (name: string) => credentials.find((row) => row.username === name)!
    const official = await signIn('portal', 'login', account('student-a'))
    const realTeacher = await signIn('admin', 'login', account('teacher'))
    const namesake = { username: 'demo-student-a', password: secret() }
    await request(realTeacher, 'createStudent', { ...namesake, name: '正式同名学生' })
    const realNamesake = await signIn('portal', 'login', namesake)
    assert.equal((await query(realNamesake, 'session')).demo, undefined)
    const realFrame = await launch(official)
    const before = await exportData(formal)
    const [a, b, teacher1, teacher2] = await Promise.all([
      signIn('portal', 'demoLogin', { slot: 1 }, official.token),
      signIn('portal', 'demoLogin', { slot: 2 }),
      signIn('admin', 'demoLogin', { slot: 1 }),
      signIn('admin', 'demoLogin', { slot: 2 }),
    ])
    assert.equal(await inspect(official.token, 'portal'), null)
    assert.equal(await inspect(realFrame.token, 'library'), null)
    assert.equal((await inspect(teacher1.token, 'admin'))?.role, 'teacher')
    assert.equal((await inspect(a.token, 'portal'))?.role, 'student')
    assert.equal((await query(teacher1, 'session')).demo, true)
    assert.equal((await query(realTeacher, 'session')).demo, undefined)
    assert.notEqual(
      (await inspect(teacher1.token, 'admin'))?.id,
      (await inspect(teacher2.token, 'admin'))?.id,
    )
    assert.equal(await inspect(a.token, 'admin'), null)
    await assert.rejects(signIn('admin', 'demoLogin', { slot: 3 }), { status: 400 })
    await assert.rejects(signIn('portal', 'demoLogin', { slot: 'teacher-a' }), { status: 400 })
    assert.deepEqual(((await query(a, 'systems')) as SystemInfo[]).map((s) => s.key).sort(), [
      'lab',
      'library',
    ])
    assert.deepEqual(
      ((await query(b, 'systems')) as SystemInfo[]).map((s) => s.key),
      ['lab'],
    )
    assert.deepEqual(((await query(teacher1, 'targets')) as Target[]).map((t) => t.key).sort(), [
      'lab',
      'library',
    ])
    await assert.rejects(request(teacher1, 'registerSystem', { key: 'partner', name: '外部教务' }), {
      status: 400,
    })
    await assert.rejects(request(a, 'launch', { systemKey: 'partner' }), { status: 403 })
    assert.equal(await inspect(teacher1.token!.slice('demo.'.length), 'admin'), null)
    assert.equal(await inspect('demo.' + realTeacher.token, 'admin'), null)
    const realStudents = (await query(realTeacher, 'students')) as Student[]
    const samples = (await query(teacher1, 'students')) as Student[]
    assert.equal(samples.length, 2)
    assert(samples.every((person) => person.fixedDemo))
    assert(realStudents.every((person) => !person.fixedDemo))
    assert(samples.every((row) => !realStudents.some((person) => person.id === row.id)))
    await assert.rejects(
      request(teacher1, 'setStudentActive', { studentId: realStudents[0].id, active: false }),
      { status: 404 },
    )
    await assert.rejects(request(teacher1, 'setStudentActive', { studentId: samples[0].id, active: false }), {
      status: 409,
    })
    const createdName = 'trial-learner'
    await request(teacher1, 'createStudent', { username: createdName, name: '演示学生', password: secret() })
    assert(
      ((await query(teacher2, 'students')) as Student[]).some(
        (row) => row.username === createdName && !row.fixedDemo,
      ),
    )
    assert(!((await query(realTeacher, 'students')) as Student[]).some((row) => row.username === createdName))
    const frame = await launch(a)
    await request(frame, 'borrow', { id: 'BK-001' })
    const isolated = await getStore('example')
    assert.equal(
      (await isolated.rows<{ name: string }>(sql`SELECT current_schema() AS name`))[0].name,
      'classroom_public_examples',
    )
    assert.equal(
      (await formal.rows(sql`SELECT digest FROM sessions WHERE digest=${digest(frame.token)}`)).length,
      0,
    )
    assert.deepEqual(await exportData(formal), before)
    await closeStore()
    assert.equal((await inspect(frame.token, 'library'))?.username, 'demo-student-a')
    assert.equal((await inspect(realTeacher.token, 'admin'))?.username, 'teacher')
    const switchedBack = await signIn('portal', 'login', account('student-a'), a.token)
    assert.equal(await inspect(a.token, 'portal'), null)
    assert.equal(await inspect(frame.token, 'library'), null)
    assert.equal((await inspect(switchedBack.token, 'portal'))?.username, 'student-a')
    const realBook = (await query(await launch(switchedBack), 'books'))[0]
    assert.equal(realBook.myLoans, 0)
    assert.deepEqual(await exportData(await getStore()), before)
  } finally {
    await closeStore()
    delete process.env.TARGETS_FILE
    await cleanStoreTestDirectory(root)
  }
})
