import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { sql } from 'drizzle-orm'
import { openDatabase, type Database } from '../src/server/db'
import { exportData, importData, initialize } from '../src/server/service-data'
import {
  gallery,
  galleryMutation,
  importGalleryProfiles,
  readScreenshot,
} from '../src/server/service-gallery'
import type { User } from '../src/shared/contract'
import { cleanStoreTestDirectory } from './store-temp'

async function accounts(db: Database) {
  await initialize(db)
  const users = await db.rows<User>(sql`SELECT id,username,name,role FROM people ORDER BY username`)
  return {
    teacher: users.find((user) => user.role === 'teacher')!,
    student: users.find((user) => user.username === 'student-a')!,
  }
}
const png = (color: string, width = 60, height = 40) =>
  sharp({ create: { width, height, channels: 3, background: color } })
    .png()
    .toBuffer()

test('截图读写逐请求检查授权，真实解码、排序、并发防重及新增式资料导入保持一致', async () => {
  const db = await openDatabase({ url: process.env.CLASSROOM_GALLERY_TEST_DATABASE_URL, directory: 'memory://' })
  try {
    const { teacher, student } = await accounts(db)
    const change = (action: string, input: Record<string, unknown>) =>
      db.transaction((tx) => galleryMutation(tx, teacher, action, input, 'classroom'))
    await change('createGallery', {
      key: 'images',
      name: '影像系统',
      summary: '老师维护',
      platforms: ['学生端', '教师端'],
      repository: 'https://github.com/example/private',
    })
    await assert.rejects(change('createGallery', { key: 'images', name: '重复' }), { status: 409 })
    await db.transaction((tx) =>
      importGalleryProfiles(tx, {
        projects: [
          { key: 'images', name: '导入名称', summary: '不能覆盖教师修改' },
          { key: 'ordering', name: '点餐系统', platforms: ['小程序', '管理端'] },
        ],
      }),
    )
    assert.equal((await gallery(db, 'admin', teacher, 'images', 'classroom')).system.name, '影像系统')
    assert.equal(
      (await db.rows(sql`SELECT 1 FROM grants WHERE system_key IN ('images','ordering')`)).length,
      0,
    )
    await change('updateGallery', { key: 'images', nameEn: 'Photo gallery' })
    assert.deepEqual((await gallery(db, 'admin', teacher, 'images', 'classroom')).system.platforms, [
      '学生端',
      '教师端',
    ])
    await assert.rejects(gallery(db, 'portal', student, 'images', 'classroom'), { status: 403 })
    await assert.rejects(gallery(db, 'portal', teacher, 'images', 'classroom'), { status: 403 })
    const source = await sharp(await png('#aa7744', 4000, 200))
      .withMetadata({
        exif: { IFD0: { Artist: 'private test identity' } },
      })
      .png()
      .toBuffer()
    const added = await change('addScreenshot', {
      systemKey: 'images',
      title: '首页',
      group: '学生端',
      data: source,
    })
    const id = added.id as string
    await assert.rejects(readScreenshot(db, 'portal', student, id, false, 'classroom'), { status: 404 })
    await db.rows(sql`INSERT INTO grants(student_id,system_key) VALUES(${student.id},'images')`)
    const image = await readScreenshot(db, 'portal', student, id, false, 'classroom')
    assert.equal((await gallery(db, 'portal', student, 'images', 'classroom')).system.repository, '')
    assert.equal(
      (await gallery(db, 'admin', teacher, 'images', 'classroom')).system.repository,
      'https://github.com/example/private',
    )
    const metadata = await sharp(image.body).metadata()
    assert.equal(image.mime, 'image/webp')
    assert.equal(metadata.width, 3840)
    assert.equal(metadata.exif, undefined)
    assert.equal(metadata.icc, undefined)
    assert.equal(metadata.xmp, undefined)
    assert.equal(
      (await sharp((await readScreenshot(db, 'portal', student, id, true, 'classroom')).body).metadata())
        .width,
      480,
    )
    const long = await change('addScreenshot', {
      systemKey: 'ordering',
      title: '手机长页',
      group: '小程序',
      data: await png('#12aabb', 200, 5000),
    })
    assert.equal(
      (
        await sharp(
          (await readScreenshot(db, 'admin', teacher, long.id as string, false, 'classroom')).body,
        ).metadata()
      ).height,
      5000,
    )
    const concurrent = await Promise.allSettled([
      change('addScreenshot', {
        systemKey: 'images',
        title: '表单',
        group: '教师端',
        data: await png('#118833'),
      }),
      change('addScreenshot', {
        systemKey: 'images',
        title: '重复表单',
        group: '教师端',
        data: await png('#118833'),
      }),
    ])
    assert.equal(concurrent.filter((result) => result.status === 'fulfilled').length, 1)
    assert.equal(
      (concurrent.find((result) => result.status === 'rejected') as PromiseRejectedResult).reason.status,
      409,
    )
    const third = await change('addScreenshot', {
      systemKey: 'images',
      title: '详情',
      group: '学生端',
      data: await sharp(await png('#3344cc'))
        .jpeg()
        .toBuffer(),
    })
    await change('moveScreenshot', { id: third.id, direction: 'up' })
    const sorted = await gallery(db, 'admin', teacher, 'images', 'classroom')
    assert.equal(sorted.images[0].id, third.id)
    await change('updateScreenshot', { id: third.id, title: '详情修改', group: '用户端' })
    await change('removeScreenshot', { id })
    const remaining = await gallery(db, 'admin', teacher, 'images', 'classroom')
    assert.deepEqual(
      remaining.images.map((row) => row.position),
      [0, 1],
    )
    assert.equal(remaining.images[0].title, '详情修改')
    assert.equal(
      remaining.system.storageBytes,
      remaining.images.reduce((total, row) => total + row.bytes, 0),
    )
    await assert.rejects(readScreenshot(db, 'admin', teacher, id, false, 'classroom'), { status: 404 })
    await assert.rejects(
      change('addScreenshot', {
        systemKey: 'images',
        title: '假图',
        group: '用户端',
        data: Buffer.from('<svg></svg>'),
      }),
      { status: 400 },
    )
    await assert.rejects(
      change('addScreenshot', {
        systemKey: 'images',
        title: '超限',
        group: '用户端',
        data: Buffer.alloc(8 * 1024 * 1024 + 1),
      }),
      { status: 400 },
    )
    await db.rows(sql`DELETE FROM grants WHERE student_id=${student.id} AND system_key='images'`)
    await assert.rejects(readScreenshot(db, 'portal', student, third.id as string, false, 'classroom'), {
      status: 404,
    })
    await db.rows(sql`INSERT INTO grants(student_id,system_key) VALUES(${student.id},'images')`)
    await db.rows(sql`UPDATE systems SET enabled=false WHERE key='images'`)
    await assert.rejects(readScreenshot(db, 'portal', student, third.id as string, false, 'classroom'), {
      status: 404,
    })
    assert((await readScreenshot(db, 'admin', teacher, third.id as string, false, 'classroom')).body.length)
    const backup = await exportData(db)
    const restored = await openDatabase({ directory: 'memory://' })
    try {
      await importData(restored, backup)
      assert.deepEqual(await exportData(restored), backup)
      assert.deepEqual(
        (await readScreenshot(restored, 'admin', teacher, third.id as string, false, 'classroom')).body,
        (await readScreenshot(db, 'admin', teacher, third.id as string, false, 'classroom')).body,
      )
    } finally {
      await restored.close()
    }
  } finally {
    await db.close()
  }
})

test('旧数据库和 v1 备份可升级，旧账号、授权、系统及摘要保留', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'classroom-migration-'))
  let db = await openDatabase({ directory })
  try {
    await initialize(db)
    const current = await exportData(db)
    const { system_profiles: _profiles, screenshots: _screenshots, ...tables } = current.tables
    const legacy = {
      format: 'demo-classroom-v1',
      tables,
      sha256: createHash('sha256').update(JSON.stringify(tables)).digest('hex'),
    }
    await db.rows(sql`DROP TABLE screenshots,system_profiles`)
    await db.rows(sql`UPDATE classroom_schema SET version=1`)
    await db.close()
    db = await openDatabase({ directory })
    assert.equal(
      (await db.rows<{ version: number }>(sql`SELECT version FROM classroom_schema`))[0].version,
      2,
    )
    assert.deepEqual(await exportData(db), current)
    const restored = await openDatabase({ directory: 'memory://' })
    try {
      await importData(restored, legacy)
      assert.deepEqual(await exportData(restored), current)
    } finally {
      await restored.close()
    }
  } finally {
    await db.close()
    await cleanStoreTestDirectory(directory)
  }
})

test('示例共享空间按实际图片字节容量拒绝超额上传，并保持已保存数据', async () => {
  const db = await openDatabase({ directory: 'memory://' })
  try {
    const { teacher } = await accounts(db)
    await db.transaction((tx) =>
      galleryMutation(tx, teacher, 'createGallery', { key: 'sample', name: '示例图片' }, 'example'),
    )
    const noise = randomBytes(1024 * 1024 * 3)
    let saved = 0
    let blocked = false
    for (let index = 0; index < 50; index++) {
      noise.set(randomBytes(4096), 0)
      const source = await sharp(noise, { raw: { width: 1024, height: 1024, channels: 3 } })
        .png()
        .toBuffer()
      try {
        await db.transaction((tx) =>
          galleryMutation(
            tx,
            teacher,
            'addScreenshot',
            {
              systemKey: 'sample',
              title: '截图 ' + index,
              group: '用户端',
              data: source,
            },
            'example',
          ),
        )
        saved++
      } catch (error) {
        assert.equal((error as { status: number }).status, 409)
        assert.match((error as Error).message, /20 MiB/)
        blocked = true
        break
      }
    }
    assert(blocked)
    const result = await gallery(db, 'admin', teacher, 'sample', 'example')
    assert.equal(result.images.length, saved)
    assert(result.system.storageBytes! <= 20 * 1024 * 1024)
  } finally {
    await db.close()
  }
})

test('截图数量上限按示例空间合计和正式单系统分别计算', async () => {
  const db = await openDatabase({ directory: 'memory://' })
  try {
    const { teacher } = await accounts(db)
    const source = await png('#ffcc33')
    await db.transaction(async (tx) => {
      await galleryMutation(tx, teacher, 'createGallery', { key: 'first', name: '系统一' }, 'classroom')
      await galleryMutation(tx, teacher, 'createGallery', { key: 'second', name: '系统二' }, 'classroom')
      for (let position = 0; position < 200; position++) {
        const image = await sharp(randomBytes(16 * 16 * 3), { raw: { width: 16, height: 16, channels: 3 } })
          .webp({ quality: 90 })
          .toBuffer()
        const hash = createHash('sha256').update(image).digest('hex')
        await tx.rows(sql`INSERT INTO screenshots(id,system_key,title,group_name,position,width,height,bytes,content_hash,body,thumbnail)
          VALUES(${'fixture-' + position},'first','示例图','用户端',${position},16,16,${image.length * 2},${hash},${image},${image})`)
      }
    })
    await assert.rejects(
      db.transaction((tx) =>
        galleryMutation(
          tx,
          teacher,
          'addScreenshot',
          {
            systemKey: 'first',
            title: '超额',
            group: '用户端',
            data: source,
          },
          'classroom',
        ),
      ),
      { status: 409 },
    )
    await db.rows(sql`DELETE FROM screenshots WHERE system_key='first' AND position>=100`)
    await assert.rejects(
      db.transaction((tx) =>
        galleryMutation(
          tx,
          teacher,
          'addScreenshot',
          {
            systemKey: 'second',
            title: '共享空间超额',
            group: '用户端',
            data: source,
          },
          'example',
        ),
      ),
      { status: 409 },
    )
    await db.transaction((tx) =>
      galleryMutation(
        tx,
        teacher,
        'addScreenshot',
        {
          systemKey: 'second',
          title: '单系统仍有容量',
          group: '用户端',
          data: source,
        },
        'classroom',
      ),
    )
    assert.equal((await gallery(db, 'admin', teacher, 'first', 'classroom')).images.length, 100)
    assert.equal((await gallery(db, 'admin', teacher, 'second', 'classroom')).images.length, 1)
  } finally {
    await db.close()
  }
})
