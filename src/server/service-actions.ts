import { randomUUID } from 'node:crypto'
import { hashPassword } from 'better-auth/crypto'
import { sql } from 'drizzle-orm'
import type { Reader } from './db'
import type { User, Student, SystemInfo, Book, Slot, Audit } from '../shared/contract'
import { availableTargets, protectedExampleStudent, type Realm } from './service-examples'
import { bool, fail, password, record, requireStudent, string, username, type Input } from './service-helpers'
import { gallery, galleryProfiles } from './service-gallery'

export async function readAction(
  db: Reader,
  host: string,
  user: User,
  action: string,
  input: Input,
  realm: Realm,
) {
  if (action === 'gallery') return gallery(db, host, user, string(input.systemKey), realm)
  if (host === 'portal' && action === 'systems') {
    const systems =
      await db.rows<SystemInfo>(sql`SELECT s.key,s.name,s.enabled FROM systems s JOIN grants g ON g.system_key=s.key
      WHERE g.student_id=${user.id} AND s.enabled ORDER BY s.name,s.key`)
    return (await galleryProfiles(db, systems)).map(({repository: _repository, ...system}) => system)
  }
  if (host === 'library' && action === 'books') {
    return db.rows<Book>(sql`SELECT b.id,b.title,b.location,(b.copies-coalesce(sum(l.quantity),0))::int AS available,
      coalesce(sum(l.quantity) FILTER (WHERE l.person_id=${user.id}),0)::int AS "myLoans"
      FROM books b LEFT JOIN loans l ON l.book_id=b.id GROUP BY b.id ORDER BY b.id`)
  }
  if (host === 'lab' && action === 'slots') {
    return db.rows<Slot>(sql`SELECT s.id,s.room,s.label AS time,
      CASE WHEN r.person_id=${user.id} THEN ${user.name}::text WHEN r.person_id IS NOT NULL THEN '已预约' END AS "bookedBy",
      coalesce(r.person_id=${user.id},false) AS mine FROM slots s LEFT JOIN reservations r ON r.slot_id=s.id ORDER BY s.id`)
  }
  if (host !== 'admin' || user.role !== 'teacher') fail(403, '此账号无权执行该操作。')
  switch (action) {
    case 'students': {
      const students = await db.rows<Student>(
        sql`SELECT id,username,name,role,active FROM people WHERE role='student' ORDER BY username`,
      )
      if (realm === 'classroom') return students
      return students.map((person) =>
        protectedExampleStudent(person.id) ? { ...person, fixedDemo: true } : person,
      )
    }
    case 'catalog':
      return galleryProfiles(db, await db.rows<SystemInfo>(sql`SELECT key,name,enabled FROM systems ORDER BY name,key`))
    case 'targets':
      return availableTargets(realm).map(({ key, name }) => ({ key, name }))
    case 'grants': {
      const id = string(input.studentId)
      const [student] = await db.rows(sql`SELECT 1 FROM people WHERE id=${id} AND role='student'`)
      if (!student) fail(404, '找不到该学生账号。')
      return (
        await db.rows<{ key: string }>(
          sql`SELECT system_key AS key FROM grants WHERE student_id=${id} ORDER BY system_key`,
        )
      ).map((row) => row.key)
    }
    case 'audit':
      return db.rows<Audit>(
        sql`SELECT id,at,actor,action,detail FROM audit ORDER BY at DESC,id DESC LIMIT 150`,
      )
    default:
      fail(400, '未知查询。')
  }
}

export async function adminAction(db: Reader, user: User, action: string, input: Input, realm: Realm) {
  let detail = ''
  switch (action) {
    case 'createStudent': {
      const login = username(input.username)
      const name = string(input.name, 80)
      const hash = await hashPassword(password(input.password))
      const result = await db.rows(sql`INSERT INTO people(id,username,name,role,password_hash)
        VALUES(${randomUUID()},${login},${name},'student',${hash}) ON CONFLICT(username) DO NOTHING RETURNING id`)
      if (!result.length) fail(409, '该账号已存在。')
      detail = login
      break
    }
    case 'setStudentActive':
    case 'resetPassword': {
      const student = await requireStudent(db, input.studentId)
      if (
        realm === 'example' &&
        protectedExampleStudent(student.id) &&
        (action === 'resetPassword' || input.active === false)
      )
        fail(409, '内置示例学生使用按钮登录。可对新建的演示学生停用或重置密码。')
      if (action === 'resetPassword') {
        const hash = await hashPassword(password(input.password))
        await db.rows(sql`UPDATE people SET password_hash=${hash} WHERE id=${student.id}`)
      } else {
        const active = bool(input.active)
        await db.rows(sql`UPDATE people SET active=${active} WHERE id=${student.id}`)
        detail = active ? '启用 ' : '停用 '
      }
      if (action === 'resetPassword' || !input.active)
        await db.rows(sql`DELETE FROM sessions WHERE person_id=${student.id} AND parent IS NULL`)
      detail += student.username
      break
    }
    case 'registerSystem': {
      const key = string(input.key, 63)
      if (!availableTargets(realm).some((t) => t.key === key)) fail(400, '请选择部署清单内的系统。')
      const name = string(input.name, 80)
      const rows = await db.rows(
        sql`INSERT INTO systems(key,name) VALUES(${key},${name}) ON CONFLICT DO NOTHING RETURNING key`,
      )
      if (!rows.length) fail(409, '该系统已登记。')
      detail = name
      break
    }
    case 'setSystemEnabled': {
      const key = string(input.key)
      const enabled = bool(input.enabled)
      const rows = await db.rows(sql`UPDATE systems SET enabled=${enabled} WHERE key=${key} RETURNING key`)
      if (!rows.length) fail(404, '找不到该系统。')
      if (!enabled) {
        await db.rows(sql`DELETE FROM tickets WHERE system_key=${key}`)
        await db.rows(sql`DELETE FROM sessions WHERE host=${key} AND parent IS NOT NULL`)
      }
      detail = (enabled ? '上架 ' : '下架 ') + key
      break
    }
    case 'setGrants': {
      const student = await requireStudent(db, input.studentId)
      if (!Array.isArray(input.keys) || input.keys.length > 250) fail(400, '系统清单无效。')
      const keys = [...new Set(input.keys.map((value) => string(value, 63)))]
      const known = await db.rows<{ key: string }>(sql`SELECT key FROM systems ORDER BY key FOR SHARE`)
      const knownKeys = new Set(known.map((row) => row.key))
      if (keys.some((key) => !knownKeys.has(key))) fail(400, '授权包含未登记的系统。')
      const existing = await db.rows<{ key: string }>(
        sql`SELECT system_key AS key FROM grants WHERE student_id=${student.id}`,
      )
      for (const { key } of existing.filter((row) => !keys.includes(row.key))) {
        await db.rows(sql`DELETE FROM grants WHERE student_id=${student.id} AND system_key=${key}`)
        await db.rows(
          sql`DELETE FROM tickets WHERE system_key=${key} AND parent IN (SELECT digest FROM sessions WHERE person_id=${student.id})`,
        )
        await db.rows(
          sql`DELETE FROM sessions WHERE person_id=${student.id} AND host=${key} AND parent IS NOT NULL`,
        )
      }
      for (const key of keys.filter((key) => !existing.some((row) => row.key === key))) {
        await db.rows(sql`INSERT INTO grants(student_id,system_key) VALUES(${student.id},${key})`)
      }
      detail = student.username + ' → ' + (keys.join('、') || '无')
      break
    }
    default:
      fail(403, '教师端不支持此操作。')
  }
  await record(db, user, action, detail)
  return { ok: true }
}

export async function demoAction(db: Reader, host: string, user: User, action: string, input: Input) {
  const id = string(input.id)
  if (host === 'library' && (action === 'borrow' || action === 'returnBook')) {
    const [book] = await db.rows<{ copies: number }>(sql`SELECT copies FROM books WHERE id=${id} FOR UPDATE`)
    if (!book) fail(404, '找不到该书。')
    if (action === 'borrow') {
      const [stock] = await db.rows<{ used: number }>(
        sql`SELECT coalesce(sum(quantity),0)::int AS used FROM loans WHERE book_id=${id}`,
      )
      if (stock.used >= book.copies) fail(409, '该书已无可借库存。')
      await db.rows(sql`INSERT INTO loans(person_id,book_id,quantity) VALUES(${user.id},${id},1)
        ON CONFLICT(person_id,book_id) DO UPDATE SET quantity=loans.quantity+1`)
    } else {
      const changed = await db.rows(
        sql`UPDATE loans SET quantity=quantity-1 WHERE person_id=${user.id} AND book_id=${id} AND quantity>0 RETURNING quantity`,
      )
      if (!changed.length) fail(409, '你没有这本书的待还记录。')
    }
  } else if (host === 'lab' && (action === 'reserve' || action === 'cancelReservation')) {
    const [slot] = await db.rows(sql`SELECT id FROM slots WHERE id=${id} FOR SHARE`)
    if (!slot) fail(404, '找不到该时段。')
    if (action === 'reserve') {
      const changed = await db.rows(
        sql`INSERT INTO reservations(person_id,slot_id) VALUES(${user.id},${id}) ON CONFLICT DO NOTHING RETURNING slot_id`,
      )
      if (!changed.length) fail(409, '该时段已被预约。')
    } else {
      const changed = await db.rows(
        sql`DELETE FROM reservations WHERE person_id=${user.id} AND slot_id=${id} RETURNING slot_id`,
      )
      if (!changed.length) fail(409, '你没有此时段的预约。')
    }
  } else fail(403, '此系统无权执行该操作。')
  await record(db, user, action, id)
  return { ok: true }
}
