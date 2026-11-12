import { sql } from 'drizzle-orm'
import { resolve } from 'node:path'
import { hashPassword, verifyPassword } from 'better-auth/crypto'
import { writeActions, type User } from '../shared/contract'
import { openDatabase, type Database, type Reader } from './db'
import { adminAction, demoAction, readAction } from './service-actions'
import {
  allowedSystem,
  digest,
  fail,
  object,
  requireUser,
  secret,
  string,
  username,
  validUser,
  type Context,
  type Input,
} from './service-helpers'
import { availableTargets, exampleId, initializeExamples, type Realm } from './service-examples'

type RequestContext = Context
const globalDb = globalThis as typeof globalThis & {
  classroomDb?: Promise<Database>
  classroomExamples?: Promise<Database>
}
const examplePrefix = 'demo.'
function tokenRealm(value?: string): Realm {
  return value?.startsWith(examplePrefix) ? 'example' : 'classroom'
}
function credential(realm: Realm) {
  return (realm === 'example' ? examplePrefix : '') + secret()
}
function loginAction(action: string) {
  return action === 'login' || action === 'demoLogin'
}
function actionRealm(ctx: Context, action: string): Realm {
  if (action === 'demoLogin') return 'example'
  return action === 'login' ? 'classroom' : tokenRealm(ctx.token)
}
export function getStore(realm: Realm = 'classroom') {
  const key = realm === 'example' ? 'classroomExamples' : 'classroomDb'
  return (globalDb[key] ??= (async () => {
    let directory = process.env.DATA_DIR
    if (realm === 'example' && directory !== 'memory://')
      directory = resolve(directory || '.data/classroom') + '-examples'
    const db = await openDatabase({ url: process.env.DATABASE_URL, directory, example: realm === 'example' })
    if (realm === 'example') {
      try {
        await initializeExamples(db)
      } catch (error) {
        await db.close()
        throw error
      }
    }
    return db
  })().catch((error) => {
    delete globalDb[key]
    throw error
  }))
}
export async function closeStore() {
  for (const key of ['classroomDb', 'classroomExamples'] as const) {
    if (globalDb[key]) await (await globalDb[key]).close()
    delete globalDb[key]
  }
}

function scope(ctx: Context, action: string) {
  const credential = loginAction(action) ? ctx.anon : ctx.token
  if (!credential || credential.length > 512) fail(401, '请刷新页面后重新登录。')
  return digest(JSON.stringify([ctx.host, loginAction(action) ? 'anonymous' : 'session', credential]))
}

export async function inspect(token: string | undefined, host: string): Promise<User | null> {
  if (!token) return null
  const realm = tokenRealm(token)
  if (realm === 'example' && !['portal', 'admin', 'lab', 'library'].includes(host)) return null
  const user = await validUser(await getStore(realm), token, host)
  return realm === 'example' && user ? { ...user, demo: true } : user
}
export const authorize = inspect

async function prune(db: Reader) {
  await db.rows(sql`DELETE FROM nonces WHERE expires_at<=now()`)
  await db.rows(sql`DELETE FROM tickets WHERE expires_at<=now()`)
  await db.rows(sql`DELETE FROM sessions WHERE expires_at<=now()`)
  await db.rows(sql`DELETE FROM login_limits WHERE until_at<=now()`)
}
const pruneAt: Record<Realm, number> = { classroom: 0, example: 0 }
export async function issueNonce(ctx: RequestContext, action: string): Promise<string> {
  if (!(writeActions as readonly string[]).includes(action)) fail(400, '未知操作。')
  const bound = scope(ctx, action)
  const realm = actionRealm(ctx, action)
  const db = await getStore(realm)
  if (loginAction(action)) {
    if (!['admin', 'portal'].includes(ctx.host)) fail(403, '请从该账号的登录页面进入。')
  } else await requireUser(db, ctx)
  if (Date.now() > pruneAt[realm]) {
    pruneAt[realm] = Date.now() + 60_000
    await db.transaction(prune)
  }
  const requestId = secret()
  await db.rows(sql`INSERT INTO nonces(digest,scope,action,expires_at)
    VALUES(${digest(requestId)},${bound},${action},now()+interval '5 minutes')`)
  return requestId
}

export async function query(ctx: RequestContext, action: string, input: unknown = {}): Promise<any> {
  if (action === 'session') return inspect(ctx.token, ctx.host)
  const realm = tokenRealm(ctx.token)
  const db = await getStore(realm)
  const user = await requireUser(db, ctx)
  return readAction(db, ctx.host, user, action, object(input), realm)
}

let dummyHash: Promise<string> | undefined
async function rootSession(tx: Reader, ctx: Context, personId: string, realm: Realm) {
  const token = credential(realm)
  if (ctx.token && tokenRealm(ctx.token) === realm)
    await tx.rows(sql`DELETE FROM sessions WHERE digest=${digest(ctx.token)} AND host=${ctx.host}`)
  await tx.rows(sql`INSERT INTO sessions(digest,person_id,host,expires_at)
    VALUES(${digest(token)},${personId},${ctx.host},now()+interval '8 hours')`)
  return { token }
}

async function revokePreviousRealm(
  ctx: Context,
  realm: Realm,
  current: Database,
  session: { token: string },
) {
  if (!ctx.token || tokenRealm(ctx.token) === realm) return session
  try {
    const previous = await getStore(tokenRealm(ctx.token))
    await previous.rows(sql`DELETE FROM sessions WHERE digest=${digest(ctx.token)} AND host=${ctx.host}`)
    return session
  } catch (error) {
    // Do not deliver a replacement identity until its predecessor and its children have been revoked.
    await current.rows(sql`DELETE FROM sessions WHERE digest=${digest(session.token)}`)
    throw error
  }
}

async function login(db: Database, ctx: Context, input: Input) {
  const name = username(input.username)
  if (typeof input.password !== 'string' || input.password.length > 128) fail(401, '账号或密码错误。')
  const role = ctx.host === 'admin' ? 'teacher' : 'student'
  if (ctx.host !== 'admin' && ctx.host !== 'portal') fail(403, '请从该账号的登录页面进入。')
  const limit = digest(JSON.stringify([ctx.host, name]))
  const [counter] = await db.rows<{ attempts: number }>(sql`
    INSERT INTO login_limits(scope,attempts,until_at) VALUES(${limit},1,now()+interval '5 minutes')
    ON CONFLICT (scope) DO UPDATE SET attempts=CASE WHEN login_limits.until_at<=now() THEN 1 ELSE login_limits.attempts+1 END,
    until_at=CASE WHEN login_limits.until_at<=now() THEN excluded.until_at ELSE login_limits.until_at END RETURNING attempts`)
  if (counter.attempts > 12) fail(429, '尝试次数过多，请稍后再试。')
  const [person] = await db.rows<{ id: string; password_hash: string }>(sql`
    SELECT id,password_hash FROM people WHERE username=${name} AND active AND role=${role}`)
  const hash = person?.password_hash ?? (await (dummyHash ??= hashPassword(secret())))
  if (!(await verifyPassword({ password: input.password, hash })) || !person) fail(401, '账号或密码错误。')
  return db.transaction(async (tx) => {
    const [current] = await tx.rows(
      sql`SELECT id FROM people WHERE id=${person.id} AND active AND password_hash=${hash} FOR SHARE`,
    )
    if (!current) fail(401, '账号或密码错误。')
    await tx.rows(sql`DELETE FROM login_limits WHERE scope=${limit}`)
    return rootSession(tx, ctx, person.id, 'classroom')
  })
}

export async function mutate(
  ctx: RequestContext,
  action: string,
  input: unknown,
  requestId?: string,
): Promise<any> {
  if (!requestId || typeof requestId !== 'string' || requestId.length > 256) fail(400, '缺少有效的请求标识。')
  const realm = actionRealm(ctx, action)
  const db = await getStore(realm)
  const consume = async (tx: Reader) => {
    const consumed =
      await tx.rows(sql`DELETE FROM nonces WHERE digest=${digest(requestId)} AND action=${action}
      AND scope=${scope(ctx, action)} AND expires_at>now() RETURNING digest`)
    if (!consumed.length) fail(409, '请求标识已使用、已过期或与本次操作不符。')
  }
  const body = object(input)
  if (action === 'login') {
    await consume(db)
    return revokePreviousRealm(ctx, realm, db, await login(db, ctx, body))
  }
  if (action === 'demoLogin') {
    const id = exampleId(ctx.host, body.slot)
    const session = await db.transaction(async (tx) => {
      await consume(tx)
      const [person] = await tx.rows(
        sql`SELECT id FROM people WHERE id=${id} AND active AND role=${ctx.host === 'admin' ? 'teacher' : 'student'} FOR SHARE`,
      )
      if (!person) fail(503, '示例账号暂时不可用。')
      return rootSession(tx, ctx, id, 'example')
    })
    return revokePreviousRealm(ctx, realm, db, session)
  }
  return db.transaction(async (tx) => {
    await consume(tx)
    const user = await requireUser(tx, ctx, true)
    if (action === 'logout') {
      await tx.rows(sql`DELETE FROM sessions WHERE digest=${digest(ctx.token!)}`)
      return { ok: true }
    }
    if (ctx.host === 'portal' && action === 'launch') {
      const key = string(body.systemKey, 63)
      if (!availableTargets(realm).some((t) => t.key === key)) fail(403, '此系统当前不可访问。')
      await allowedSystem(tx, user.id, key)
      const ticket = credential(realm)
      await tx.rows(sql`INSERT INTO tickets(digest,parent,system_key,expires_at)
        VALUES(${digest(ticket)},${digest(ctx.token!)},${key},now()+interval '30 seconds')`)
      return { ticket, systemKey: key }
    }
    if (ctx.host === 'admin' && user.role === 'teacher') return adminAction(tx, user, action, body, realm)
    return demoAction(tx, ctx.host, user, action, body)
  })
}

export async function redeem(host: string, ticket: string): Promise<{ token: string }> {
  if (typeof ticket !== 'string' || !ticket || ticket.length > 256) fail(403, '启动凭据无效。')
  const realm = tokenRealm(ticket)
  if (!availableTargets(realm).some((t) => t.key === host)) fail(403, '启动凭据无效。')
  return (await getStore(realm)).transaction(async (tx) => {
    // Lock the owning account/system before consuming the ticket so revocation and exchange agree.
    const [root] = await tx.rows<{ person_id: string; digest: string }>(sql`
      SELECT s.person_id,s.digest FROM sessions s JOIN people p ON p.id=s.person_id
      JOIN tickets t ON t.parent=s.digest JOIN grants g ON g.student_id=p.id AND g.system_key=t.system_key
      JOIN systems system ON system.key=g.system_key
      WHERE t.digest=${digest(ticket)} AND t.system_key=${host} AND s.host='portal' AND p.active AND p.role='student'
        AND system.enabled AND s.expires_at>now() AND t.expires_at>now() FOR SHARE OF p,s,system,g`)
    if (!root) fail(403, '启动凭据已失效，请从工作台重新打开。')
    const removed = await tx.rows(
      sql`DELETE FROM tickets WHERE digest=${digest(ticket)} AND system_key=${host} AND expires_at>now() RETURNING digest`,
    )
    if (!removed.length) fail(403, '启动凭据已使用。')
    const token = credential(realm)
    await tx.rows(sql`INSERT INTO sessions(digest,person_id,host,parent,expires_at)
      SELECT ${digest(token)},person_id,${host},digest,expires_at FROM sessions WHERE digest=${root.digest}`)
    return { token }
  })
}
