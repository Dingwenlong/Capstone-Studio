import { randomBytes, randomUUID, createHash } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { hashPassword } from 'better-auth/crypto'
import { z } from 'zod'
import sharp from 'sharp'
import type { Database, Reader, Row } from './db'

const id = z.string().min(1).max(120)
const dataTables = z
  .object({
    people: z.array(
      z
        .object({
          id,
          username: z.string().regex(/^[a-z0-9][a-z0-9_.@-]{1,79}$/),
          name: z.string().min(1).max(80),
          role: z.enum(['teacher', 'student']),
          active: z.boolean(),
          password_hash: z.string().regex(/^[0-9a-f]{32}:[0-9a-f]{128}$/),
        })
        .strict(),
    ),
    systems: z.array(
      z
        .object({
          key: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/),
          name: z.string().min(1).max(80),
          enabled: z.boolean(),
        })
        .strict(),
    ),
    grants: z.array(z.object({ student_id: id, system_key: id }).strict()),
    books: z.array(
      z
        .object({ id, title: z.string().min(1), location: z.string(), copies: z.number().int().positive() })
        .strict(),
    ),
    loans: z.array(
      z.object({ person_id: id, book_id: id, quantity: z.number().int().nonnegative() }).strict(),
    ),
    slots: z.array(z.object({ id, room: z.string().min(1), label: z.string().min(1) }).strict()),
    reservations: z.array(z.object({ person_id: id, slot_id: id }).strict()),
    audit: z.array(
      z
        .object({
          id,
          at: z.iso.datetime({ offset: true }),
          actor: z.string(),
          action: z.string(),
          detail: z.string(),
        })
        .strict(),
    ),
  })
  .strict()
const profileRow = z
  .object({
    system_key: id,
    name_en: z.string().max(120),
    summary: z.string().max(2000),
    summary_en: z.string().max(4000),
    repository: z.string().max(500),
    platforms: z.array(z.string().min(1).max(80)).max(20),
  })
  .strict()
const base64 = z
  .string()
  .min(4)
  .refine((value) => Buffer.from(value, 'base64').toString('base64') === value)
const screenshotRow = z
  .object({
    id,
    system_key: id,
    title: z.string().min(1).max(120),
    group_name: z.string().min(1).max(80),
    position: z.number().int().nonnegative(),
    width: z.number().int().min(1).max(3840),
    height: z.number().int().min(1).max(16383),
    bytes: z.number().int().positive(),
    content_hash: z.string().regex(/^[a-f0-9]{64}$/),
    body: base64,
    thumbnail: base64,
  })
  .strict()
const currentTables = dataTables
  .extend({
    system_profiles: z.array(profileRow),
    screenshots: z.array(screenshotRow),
  })
  .strict()
type Table = keyof z.infer<typeof currentTables>
const sortBy: Record<Table, string[]> = {
  people: ['id'],
  systems: ['key'],
  grants: ['student_id', 'system_key'],
  books: ['id'],
  loans: ['person_id', 'book_id'],
  slots: ['id'],
  reservations: ['slot_id'],
  audit: ['id'],
  system_profiles: ['system_key'],
  screenshots: ['system_key', 'position'],
}
const tableNames = Object.keys(sortBy) as Table[]
const legacyManifest = z
  .object({
    format: z.literal('demo-classroom-v1'),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    tables: dataTables,
  })
  .strict()
const manifest = z.discriminatedUnion('format', [
  legacyManifest,
  z
    .object({
      format: z.literal('demo-classroom-v2'),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
      tables: currentTables,
    })
    .strict(),
])

async function lockEmpty(db: Reader) {
  const tables = tableNames.map(sql.identifier)
  await db.rows(sql`LOCK TABLE ${sql.join(tables, sql`, `)} IN EXCLUSIVE MODE`)
  for (const table of tableNames) {
    const rows = await db.rows(sql`SELECT 1 FROM ${sql.identifier(table)} LIMIT 1`)
    if (rows.length) throw new Error('目标数据库已有数据。请选用独立的空库。')
  }
}

export async function initialize(db: Database) {
  return db.transaction(async (tx) => {
    await lockEmpty(tx)
    const users = [
      { username: 'teacher', name: '演示教师', role: 'teacher' },
      { username: 'student-a', name: '学生 A', role: 'student' },
      { username: 'student-b', name: '学生 B', role: 'student' },
    ]
    const credentials: { username: string; password: string }[] = []
    const ids: string[] = []
    for (const user of users) {
      const userId = randomUUID()
      const password = randomBytes(15).toString('base64url')
      await tx.rows(sql`INSERT INTO people(id,username,name,role,password_hash)
        VALUES(${userId},${user.username},${user.name},${user.role},${await hashPassword(password)})`)
      credentials.push({ username: user.username, password })
      ids.push(userId)
    }
    await seedMaterials(tx, ids[1], ids[2])
    return credentials
  })
}

export async function seedMaterials(tx: Reader, firstStudent: string, secondStudent: string) {
  await tx.rows(sql`INSERT INTO systems(key,name) VALUES('library','图书借阅'),('lab','实验室预约')`)
  await tx.rows(
    sql`INSERT INTO grants(student_id,system_key) VALUES(${firstStudent},'library'),(${firstStudent},'lab'),(${secondStudent},'lab')`,
  )
  await tx.rows(sql`INSERT INTO books(id,title,location,copies) VALUES
      ('BK-001','软件工程导论','计算机 · A-02',3),('BK-002','数据库系统概论','计算机 · A-03',2),
      ('BK-003','交互设计精髓','设计 · B-01',4),('BK-004','数据可视化实践','计算机 · A-05',2),
      ('BK-005','人机交互基础','设计 · B-02',3),('BK-006','计算机网络','计算机 · A-01',1)`)
  await tx.rows(sql`INSERT INTO slots(id,room,label) VALUES
      ('LAB-001','软件工程实验室','周一 09:00–10:30'),('LAB-002','网络实验室','周一 14:00–15:30'),
      ('LAB-003','交互设计实验室','周二 09:00–10:30'),('LAB-004','软件工程实验室','周二 14:00–15:30'),
      ('LAB-005','网络实验室','周三 09:00–10:30'),('LAB-006','交互设计实验室','周三 14:00–15:30')`)
}

const checksum = (tables: unknown) => createHash('sha256').update(JSON.stringify(tables)).digest('hex')
export async function exportData(db: Database) {
  return db.transaction(async (tx) => {
    await tx.rows(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`)
    const tableData = {} as Record<Table, Row[]>
    for (const name of tableNames) {
      const order = sql.join(sortBy[name].map(sql.identifier), sql`, `)
      tableData[name] = await tx.rows(sql`SELECT * FROM ${sql.identifier(name)} ORDER BY ${order}`)
    }
    // Normalize timestamps identically for both PostgreSQL drivers and the portable JSON file.
    for (const entry of tableData.audit) entry.at = new Date(entry.at as string).toISOString()
    for (const entry of tableData.screenshots) {
      entry.body = Buffer.from(entry.body as Uint8Array).toString('base64')
      entry.thumbnail = Buffer.from(entry.thumbnail as Uint8Array).toString('base64')
    }
    const tables = currentTables.parse(tableData)
    return { format: 'demo-classroom-v2' as const, sha256: checksum(tables), tables }
  })
}

export async function importData(db: Database, value: unknown) {
  const document = manifest.safeParse(value)
  if (!document.success) throw new Error('迁移文件格式不正确或包含未支持的数据。')
  const { sha256 } = document.data
  if (checksum(document.data.tables) !== sha256) throw new Error('迁移文件校验失败。')
  const tables =
    document.data.format === 'demo-classroom-v1'
      ? { ...document.data.tables, system_profiles: [], screenshots: [] }
      : document.data.tables
  if (!tables.people.some((row) => row.active && row.role === 'teacher'))
    throw new Error('迁移文件缺少启用的教师账号。')
  const students = new Set(tables.people.filter((row) => row.role === 'student').map((row) => row.id))
  if (
    tables.grants.some((row) => !students.has(row.student_id)) ||
    [...tables.loans, ...tables.reservations].some((row) => !students.has(row.person_id))
  )
    throw new Error('迁移数据含无效的学生引用。')
  for (const profile of tables.system_profiles) {
    if (profile.repository) {
      const repository = new URL(profile.repository)
      if (repository.protocol !== 'https:' || repository.username || repository.password)
        throw new Error('迁移数据含无效的仓库地址。')
    }
  }
  for (const image of tables.screenshots) {
    const body = Buffer.from(image.body, 'base64')
    const thumb = Buffer.from(image.thumbnail, 'base64')
    if (
      body.length + thumb.length !== image.bytes ||
      createHash('sha256').update(body).digest('hex') !== image.content_hash
    )
      throw new Error('迁移文件的图片摘要或字节数不一致。')
    const decoded = sharp(body, { limitInputPixels: 40_000_000, failOn: 'warning' })
    const thumbnail = sharp(thumb, { limitInputPixels: 480 * 480, failOn: 'warning' })
    const originalInfo = await decoded.metadata()
    const thumbnailInfo = await thumbnail.metadata()
    if (
      originalInfo.format !== 'webp' ||
      thumbnailInfo.format !== 'webp' ||
      originalInfo.width !== image.width ||
      originalInfo.height !== image.height ||
      (originalInfo.pages ?? 1) > 1 ||
      (thumbnailInfo.pages ?? 1) > 1 ||
      (thumbnailInfo.width ?? 481) > 480 ||
      (thumbnailInfo.height ?? 481) > 480
    )
      throw new Error('迁移文件包含无效图片。')
    await decoded.stats()
    await thumbnail.stats()
  }
  return db.transaction(async (tx) => {
    await lockEmpty(tx)
    for (const table of tableNames) {
      for (const row of tables[table]) {
        const entries = Object.entries(row)
        const columns = entries.map(([key]) => sql.identifier(key))
        const values = entries.map(([key, val]) => {
          if (table === 'screenshots' && (key === 'body' || key === 'thumbnail'))
            return sql`${Buffer.from(val as string, 'base64')}`
          if (table === 'system_profiles' && key === 'platforms') return sql`${JSON.stringify(val)}::jsonb`
          return sql`${val}`
        })
        await tx.rows(
          sql`INSERT INTO ${sql.identifier(table)} (${sql.join(columns, sql`, `)}) VALUES (${sql.join(values, sql`, `)})`,
        )
      }
    }
    const excess = await tx.rows(
      sql`SELECT b.id FROM books b JOIN loans l ON l.book_id=b.id GROUP BY b.id HAVING sum(l.quantity)>b.copies LIMIT 1`,
    )
    if (excess.length) throw new Error('迁移数据的借阅量超出图书库存。')
    const invalidOrder = await tx.rows(sql`SELECT system_key FROM screenshots GROUP BY system_key
      HAVING count(*)>200 OR min(position)<>0 OR max(position)<>count(*)-1 LIMIT 1`)
    if (invalidOrder.length) throw new Error('迁移截图数量或排序无效。')
    return { sha256, counts: Object.fromEntries(tableNames.map((key) => [key, tables[key].length])) }
  })
}
