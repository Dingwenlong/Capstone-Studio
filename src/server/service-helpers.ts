import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import type { Reader } from './db'
import type { User } from '../shared/contract'

export type Context = { host: string; token?: string; anon?: string }
export type Input = Record<string, unknown>
export const secret = () => randomBytes(32).toString('base64url')
export const digest = (value: string) => createHash('sha256').update(value).digest('hex')

export function fail(status: number, message: string): never {
  throw Object.assign(new Error(message), { status })
}
export function object(value: unknown): Input {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, '请求内容无效。')
  return value as Input
}
export function string(value: unknown, max = 120) {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > max)
    fail(400, '请检查输入的文字。')
  return value.trim()
}
export function username(value: unknown) {
  const name = string(value, 80).toLowerCase()
  if (!/^[a-z0-9][a-z0-9_.@-]{1,79}$/.test(name)) fail(400, '账号应为 2 至 80 个英文、数字或常用账号符号。')
  return name
}
export function password(value: unknown) {
  if (typeof value !== 'string' || value.length < 8 || value.length > 128)
    fail(400, '密码长度需在 8 到 128 个字符之间。')
  return value
}
export function bool(value: unknown) {
  if (typeof value !== 'boolean') fail(400, '状态值无效。')
  return value
}
export async function record(db: Reader, user: User, action: string, detail: string) {
  await db.rows(
    sql`INSERT INTO audit (id,actor,action,detail) VALUES (${randomUUID()},${user.username},${action},${detail})`,
  )
}

export async function validUser(
  db: Reader,
  token: string | undefined,
  host: string,
  lock = false,
): Promise<User | null> {
  if (!token || token.length > 256) return null
  const [user] = await db.rows<User>(sql`
    SELECT p.id,p.username,p.name,p.role FROM people p JOIN sessions s ON s.person_id=p.id
    WHERE s.digest=${digest(token)} AND s.host=${host} AND p.active AND s.expires_at > now()
      AND ((s.parent IS NULL AND ((p.role='teacher' AND s.host='admin') OR (p.role='student' AND s.host='portal')))
        OR (s.parent IS NOT NULL AND EXISTS (
          SELECT 1 FROM sessions root JOIN grants g ON g.student_id=root.person_id JOIN systems t ON t.key=g.system_key
          WHERE root.digest=s.parent AND root.person_id=p.id AND root.host='portal' AND root.expires_at>now()
          AND t.enabled AND t.key=s.host)))
    ${lock ? sql`FOR SHARE OF p,s` : sql``}`)
  return user || null
}
export async function requireUser(db: Reader, ctx: Context, lock = false) {
  const user = await validUser(db, ctx.token, ctx.host, lock)
  if (!user) fail(401, '登录已失效或缺少该系统的访问权限。')
  return user
}
export async function allowedSystem(db: Reader, userId: string, key: string) {
  const [system] = await db.rows(sql`
    SELECT s.key FROM systems s JOIN grants g ON g.system_key=s.key
    WHERE g.student_id=${userId} AND s.key=${key} AND s.enabled FOR SHARE OF s,g`)
  if (!system) fail(403, '此账号当前无权访问该系统。')
}
export async function requireStudent(db: Reader, id: unknown) {
  const [student] = await db.rows<User>(
    sql`SELECT id,username,name,role FROM people WHERE id=${string(id)} AND role='student' FOR UPDATE`,
  )
  if (!student) fail(404, '找不到该学生账号。')
  return student
}
