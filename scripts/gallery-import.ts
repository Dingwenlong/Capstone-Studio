import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { openDatabase } from '../src/server/db'
import { importGalleryProfiles } from '../src/server/service-gallery'

async function main() {
  const [filename, ...extra] = process.argv.slice(2)
  if (!filename || extra.length)
    throw new Error('用法：node --import tsx scripts/gallery-import.ts <本地项目清单.json>')
  const input: unknown = JSON.parse(await readFile(resolve(filename), 'utf8'))
  const database = await openDatabase({ url: process.env.DATABASE_URL, directory: process.env.DATA_DIR })
  try {
    const result = await database.transaction((tx) => importGalleryProfiles(tx, input))
    console.log(JSON.stringify(result))
  } finally {
    await database.close()
  }
}

main().catch((error: Error & { cause?: unknown }) => {
  console.error(
    error.cause || error.message.includes('query:')
      ? '项目导入失败，请检查清单和数据库连接。'
      : error.message,
  )
  process.exitCode = 1
})
