import { randomUUID } from 'node:crypto'
import { link, readFile, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { openDatabase } from '../src/server/db'
import { exportData, importData, initialize } from '../src/server/service-data'

async function main() {
  const [action, filename, ...extra] = process.argv.slice(2)
  if (
    !['init', 'export', 'import'].includes(action) ||
    extra.length ||
    (action === 'init' ? !!filename : !filename)
  )
    throw new Error('用法：npm run data -- init | export <新文件> | import <已有文件>')
  const db = await openDatabase({ url: process.env.DATABASE_URL, directory: process.env.DATA_DIR })
  try {
    if (action === 'init') {
      const credentials = await initialize(db)
      console.log(JSON.stringify({ credentials }, null, 2))
      return
    }
    const path = resolve(filename)
    if (action === 'export') {
      const doc = await exportData(db)
      const temporary = join(dirname(path), '.' + randomUUID() + '.partial')
      try {
        await writeFile(temporary, JSON.stringify(doc), { flag: 'wx', mode: 0o600 })
        // Hard linking a completed file prevents partial output or replacing an existing backup.
        await link(temporary, path)
      } finally {
        await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'ENOENT') throw error
        })
      }
      console.log(JSON.stringify({ exported: true, sha256: doc.sha256 }))
    } else {
      const result = await importData(db, JSON.parse(await readFile(path, 'utf8')))
      console.log(JSON.stringify({ imported: true, ...result }))
    }
  } finally {
    await db.close()
  }
}

main().catch((error: Error & { code?: string }) => {
  if (error.code === 'EEXIST') console.error('文件已存在，请指定新的导出文件。')
  else if (error.cause || error.message.includes('query:') || error.message.includes('Failed query'))
    console.error('数据库操作失败，数据命令未完成。请检查连接配置与资料完整性。')
  else console.error(error.message)
  process.exitCode = 1
})
