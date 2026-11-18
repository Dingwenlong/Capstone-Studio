import { createHash, randomUUID } from 'node:crypto'
import { sql, type SQL } from 'drizzle-orm'
import sharp from 'sharp'
import { z } from 'zod'
import type { Gallery, Screenshot, SystemInfo, User } from '../shared/contract'
import type { Reader } from './db'
import type { Realm } from './service-examples'
import { fail, object, record, string, type Input } from './service-helpers'

export const galleryProfile = z
  .object({
    key: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/),
    name: z.string().trim().min(1).max(80),
    nameEn: z.string().trim().max(120).optional(),
    summary: z.string().trim().max(2000).optional(),
    summaryEn: z.string().trim().max(4000).optional(),
    repository: z
      .string()
      .trim()
      .max(500)
      .refine((value) => {
        if (!value) return true
        try {
          const url = new URL(value)
          return url.protocol === 'https:' && !url.username && !url.password
        } catch {
          return false
        }
      }, '仓库地址应为 HTTPS 链接。')
      .optional(),
    platforms: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
  })
  .strict()

const editableProfile = galleryProfile.partial().required({ key: true })
const exampleByteLimit = 20 * 1024 * 1024
const screenshotColumns = sql`i.id,i.system_key AS "systemKey",i.title,i.group_name AS "group",
  i.position,i.width,i.height,i.bytes`
const profileColumns = sql`s.key,s.name,s.enabled,coalesce(p.name_en,'') AS "nameEn",
  coalesce(p.summary,'') AS summary,coalesce(p.summary_en,'') AS "summaryEn",
  coalesce(p.repository,'') AS repository,coalesce(p.platforms,'[]'::jsonb) AS platforms,
  (SELECT count(*)::int FROM screenshots count_images WHERE count_images.system_key=s.key) AS "imageCount",
  (SELECT coalesce(sum(bytes),0)::double precision FROM screenshots storage WHERE storage.system_key=s.key) AS "storageBytes"`

function permission(host: string, user: User): SQL {
  if (host === 'admin' && user.role === 'teacher')
    return sql`EXISTS(SELECT 1 FROM people person WHERE person.id=${user.id} AND person.active AND person.role='teacher')`
  if (host === 'portal' && user.role === 'student')
    return sql`s.enabled AND EXISTS(SELECT 1 FROM grants g JOIN people person ON person.id=g.student_id
      WHERE g.system_key=s.key AND person.id=${user.id} AND person.active AND person.role='student')`
  fail(403, '此账号无权查看系统截图。')
}

export async function galleryProfiles(db: Reader, systems: SystemInfo[]): Promise<SystemInfo[]> {
  if (!systems.length) return []
  const rows = await db.rows<SystemInfo>(sql`SELECT ${profileColumns} FROM systems s
    LEFT JOIN system_profiles p ON p.system_key=s.key
    WHERE s.key IN (${sql.join(
      systems.map((system) => sql`${system.key}`),
      sql`, `,
    )})`)
  const byKey = new Map(rows.map((row) => [row.key, row]))
  return systems.map((system) => byKey.get(system.key) ?? system)
}

export async function gallery(
  db: Reader,
  host: string,
  user: User,
  systemKey: string,
  _realm: Realm,
): Promise<Gallery> {
  const key = string(systemKey, 32)
  const allowed = permission(host, user)
  const [system] = await db.rows<SystemInfo>(sql`SELECT ${profileColumns} FROM systems s
    LEFT JOIN system_profiles p ON p.system_key=s.key WHERE s.key=${key} AND ${allowed}`)
  if (!system) fail(403, '此系统当前不可访问。')
  if (host === 'portal') system.repository = ''
  const images = await db.rows<Screenshot>(sql`SELECT ${screenshotColumns} FROM screenshots i
    JOIN systems s ON s.key=i.system_key WHERE s.key=${key} AND ${allowed} ORDER BY i.position,i.id`)
  return { system, images }
}

export async function readScreenshot(
  db: Reader,
  host: string,
  user: User,
  id: string,
  thumbnail: boolean,
  _realm: Realm,
) {
  const [image] = await db.rows<{
    body: Uint8Array
  }>(sql`SELECT ${thumbnail ? sql`i.thumbnail` : sql`i.body`} AS body
    FROM screenshots i JOIN systems s ON s.key=i.system_key
    WHERE i.id=${string(id)} AND ${permission(host, user)}`)
  if (!image) fail(404, '图片不存在或无权查看。')
  return { body: new Uint8Array(image.body), mime: 'image/webp' }
}

async function lockSystem(db: Reader, key: string) {
  const [system] = await db.rows<SystemInfo>(
    sql`SELECT key,name,enabled FROM systems WHERE key=${key} FOR UPDATE`,
  )
  if (!system) fail(404, '找不到该系统。')
  return system
}

async function saveProfile(db: Reader, profile: z.infer<typeof galleryProfile>) {
  await db.rows(sql`INSERT INTO system_profiles(system_key,name_en,summary,summary_en,repository,platforms)
    VALUES(${profile.key},${profile.nameEn ?? ''},${profile.summary ?? ''},${profile.summaryEn ?? ''},
      ${profile.repository ?? ''},${JSON.stringify([...new Set(profile.platforms ?? [])])}::jsonb)
    ON CONFLICT(system_key) DO UPDATE SET name_en=excluded.name_en,summary=excluded.summary,
      summary_en=excluded.summary_en,repository=excluded.repository,platforms=excluded.platforms`)
}

function profileInput(input: Input, update = false) {
  const parsed = (update ? editableProfile : galleryProfile).safeParse(input)
  if (!parsed.success) fail(400, '系统名称、说明、仓库地址或分组格式不正确。')
  return parsed.data
}

export async function importGalleryProfiles(db: Reader, value: unknown) {
  const parsed = z
    .object({ projects: z.array(galleryProfile).max(500) })
    .strict()
    .safeParse(value)
  if (!parsed.success) fail(400, '项目清单格式不正确。')
  const keys = parsed.data.projects.map((project) => project.key)
  if (new Set(keys).size !== keys.length) fail(400, '项目清单包含重复标识。')
  const added: string[] = []
  for (const profile of parsed.data.projects) {
    const created = await db.rows(sql`INSERT INTO systems(key,name) VALUES(${profile.key},${profile.name})
      ON CONFLICT(key) DO NOTHING RETURNING key`)
    if (!created.length) continue
    await saveProfile(db, profile)
    added.push(profile.key)
  }
  return { added, skipped: keys.filter((key) => !added.includes(key)) }
}

async function normalizeImage(value: unknown) {
  if (!Buffer.isBuffer(value) || !value.length || value.length > 8 * 1024 * 1024)
    fail(400, '请选择 8 MiB 以内的 PNG、JPEG 或 WebP 图片。')
  try {
    const image = sharp(value, { limitInputPixels: 40_000_000, failOn: 'warning' })
    const metadata = await image.metadata()
    if (!['png', 'jpeg', 'webp'].includes(metadata.format ?? '') || (metadata.pages ?? 1) > 1)
      fail(400, '请上传静态 PNG、JPEG 或 WebP 图片。')
    const { data: body, info } = await image
      .rotate()
      .resize({
        width: 3840,
        height: 16383,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: 90 })
      .toBuffer({ resolveWithObject: true })
    const thumbnail = await sharp(body)
      .resize({ width: 480, height: 480, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 90 })
      .toBuffer()
    return {
      body,
      thumbnail,
      width: info.width,
      height: info.height,
      bytes: body.length + thumbnail.length,
      hash: createHash('sha256').update(body).digest('hex'),
    }
  } catch (error) {
    if ((error as { status?: number }).status) throw error
    fail(400, '图片无法解码，或超过 4000 万像素。')
  }
}

export async function galleryMutation(db: Reader, user: User, action: string, input: Input, realm: Realm) {
  if (user.role !== 'teacher') fail(403, '只有教师可管理系统截图。')
  const body = object(input)
  let detail: string
  let result: Record<string, unknown> = { ok: true }
  if (action === 'createGallery') {
    const profile = profileInput(body) as z.infer<typeof galleryProfile>
    const created = await db.rows(sql`INSERT INTO systems(key,name) VALUES(${profile.key},${profile.name})
      ON CONFLICT DO NOTHING RETURNING key`)
    if (!created.length) fail(409, '该系统标识已存在。')
    await saveProfile(db, profile)
    detail = profile.key
  } else if (action === 'updateGallery') {
    const update = profileInput(body, true)
    const system = await lockSystem(db, update.key)
    const [existing] = await galleryProfiles(db, [system])
    const profile = { ...existing, ...update }
    await db.rows(sql`UPDATE systems SET name=${profile.name} WHERE key=${profile.key}`)
    await saveProfile(db, profile)
    detail = profile.key
  } else if (action === 'addScreenshot') {
    const key = string(body.systemKey, 32)
    const title = string(body.title, 120)
    const group = string(body.group, 80)
    const image = await normalizeImage(body.data)
    if (realm === 'example') await db.rows(sql`SELECT id FROM classroom_schema WHERE id=1 FOR UPDATE`)
    await lockSystem(db, key)
    const duplicates = await db.rows(
      sql`SELECT id FROM screenshots WHERE system_key=${key} AND content_hash=${image.hash}`,
    )
    if (duplicates.length) fail(409, '该系统已包含相同图片。')
    const [capacity] = await db.rows<{ count: number; position: number }>(sql`
      SELECT count(*)::int AS count,coalesce(max(position),-1)::int AS position
      FROM screenshots WHERE system_key=${key}`)
    if (capacity.count >= 200) fail(409, '每个系统最多保存 200 张截图，请先删除旧图。')
    if (realm === 'example') {
      const [shared] = await db.rows<{ count: number; bytes: number }>(
        sql`SELECT count(*)::int AS count,coalesce(sum(bytes),0)::double precision AS bytes FROM screenshots`,
      )
      if (shared.count >= 100 || shared.bytes + image.bytes > exampleByteLimit)
        fail(409, '示例空间最多保存 100 张截图和 20 MiB 图片，请先删除旧图。')
    }
    const id = randomUUID()
    await db.rows(sql`INSERT INTO screenshots(id,system_key,title,group_name,position,width,height,bytes,content_hash,body,thumbnail)
      VALUES(${id},${key},${title},${group},${capacity.position + 1},${image.width},${image.height},${image.bytes},
        ${image.hash},${image.body},${image.thumbnail})`)
    result = { ok: true, id }
    detail = key + ' / ' + id
  } else {
    if (!['updateScreenshot', 'moveScreenshot', 'removeScreenshot'].includes(action))
      fail(400, '未知截图操作。')
    const id = string(body.id)
    const [owner] = await db.rows<{ system_key: string }>(
      sql`SELECT system_key FROM screenshots WHERE id=${id}`,
    )
    if (!owner) fail(404, '找不到该图片。')
    await lockSystem(db, owner.system_key)
    const [image] = await db.rows<{ position: number; group_name: string }>(
      sql`SELECT position,group_name FROM screenshots WHERE id=${id}`,
    )
    if (!image) fail(404, '找不到该图片。')
    if (action === 'updateScreenshot') {
      await db.rows(
        sql`UPDATE screenshots SET title=${string(body.title, 120)},group_name=${string(body.group, 80)} WHERE id=${id}`,
      )
    } else if (action === 'removeScreenshot') {
      await db.rows(sql`DELETE FROM screenshots WHERE id=${id}`)
      await db.rows(
        sql`UPDATE screenshots SET position=position-1 WHERE system_key=${owner.system_key} AND position>${image.position}`,
      )
    } else {
      if (body.direction !== 'up' && body.direction !== 'down') fail(400, '排序方向无效。')
      const previous = body.direction === 'up'
      const [other] = await db.rows<{ id: string; position: number }>(sql`SELECT id,position FROM screenshots
        WHERE system_key=${owner.system_key} AND group_name=${image.group_name}
          AND ${previous ? sql`position<${image.position}` : sql`position>${image.position}`}
        ORDER BY ${previous ? sql`position DESC` : sql`position ASC`} LIMIT 1`)
      if (other) {
        await db.rows(sql`UPDATE screenshots SET position=${image.position} WHERE id=${other.id}`)
        await db.rows(sql`UPDATE screenshots SET position=${other.position} WHERE id=${id}`)
      }
    }
    detail = owner.system_key + ' / ' + id
  }
  await record(db, user, action, detail)
  return result
}
