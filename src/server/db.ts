import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { sql, type SQL } from 'drizzle-orm'
import { drizzle as embeddedDrizzle } from 'drizzle-orm/pglite'
import { drizzle as networkDrizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { PGlite } from '@electric-sql/pglite'
import lockfile from 'proper-lockfile'
import { schemaV1, schemaV2 } from './schema'
const exampleSchema = 'classroom_public_examples'

export type Row = Record<string, unknown>
export interface Reader {
  rows<T = Row>(statement: SQL): Promise<T[]>
}
export interface Database extends Reader {
  transaction<T>(fn: (connection: Reader) => Promise<T>): Promise<T>
  close(): Promise<void>
}

function reader(execute: (statement: SQL) => PromiseLike<unknown>): Reader {
  return {
    async rows<T>(statement: SQL): Promise<T[]> {
      const result = await execute(statement)
      return (Array.isArray(result) ? result : (result as { rows: T[] }).rows) as T[]
    },
  }
}

export async function openDatabase(
  options: { url?: string; directory?: string; example?: boolean } = {},
): Promise<Database> {
  const url = options.url
  let database: Database
  if (url) {
    const client = postgres(url, { max: 8, connect_timeout: 10, idle_timeout: 30 })
    const orm = networkDrizzle(client)
    database = {
      ...reader((statement) => orm.execute(statement)),
      transaction: (fn) => orm.transaction((tx) => fn(reader((statement) => tx.execute(statement)))),
      close: () => client.end({ timeout: 5 }),
    }
  } else {
    const directory =
      options.directory === 'memory://' ? 'memory://' : resolve(options.directory || '.data/classroom')
    let release: (() => Promise<void>) | undefined
    if (directory !== 'memory://') {
      await mkdir(directory, { recursive: true })
      try {
        release = await lockfile.lock(directory, { stale: 60_000, update: 10_000, retries: 0 })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ELOCKED')
          throw new Error('本地数据库正在使用。请先停止持有该库的服务或数据命令。')
        throw error
      }
    }
    const client = await PGlite.create(directory).catch(async (error: unknown) => {
      await release?.()
      throw error
    })
    const orm = embeddedDrizzle(client)
    database = {
      ...reader((statement) => orm.execute(statement)),
      transaction: (fn) => orm.transaction((tx) => fn(reader((statement) => tx.execute(statement)))),
      close: async () => {
        await client.close()
        await release?.()
      },
    }
  }
  try {
    let activeSchema = ''
    await database.transaction(async (tx) => {
      if (url) await tx.rows(sql`SELECT pg_advisory_xact_lock(768419235)`)
      const [schema] = await tx.rows<{ name: string }>(sql`SELECT current_schema() AS name`)
      if (schema.name === exampleSchema) throw new Error('正式数据库连接不能以示例空间作为默认 schema。')
      activeSchema = options.example ? exampleSchema : schema.name
      if (!activeSchema) throw new Error('数据库连接缺少有效的默认 schema。')
      if (options.example) {
        const exists = await tx.rows(sql`SELECT 1 FROM pg_namespace WHERE nspname=${exampleSchema}`)
        if (exists.length) {
          const [marker] = await tx.rows<{ owned: boolean }>(
            sql`SELECT to_regclass(${exampleSchema + '.example_workspace_marker'}) IS NOT NULL AS owned`,
          )
          if (!marker.owned) throw new Error('示例 schema 已被其他数据使用，请核对数据库配置。')
        } else {
          await tx.rows(sql`CREATE SCHEMA ${sql.identifier(exampleSchema)}`)
          await tx.rows(
            sql`CREATE TABLE ${sql.identifier(exampleSchema)}.example_workspace_marker(id integer PRIMARY KEY)`,
          )
        }
        await tx.rows(sql`SET LOCAL search_path TO ${sql.identifier(exampleSchema)}`)
      }
      await tx.rows(
        sql`CREATE TABLE IF NOT EXISTS classroom_schema (id integer PRIMARY KEY CHECK (id = 1), version integer NOT NULL)`,
      )
      const [version] = await tx.rows<{ version: number }>(
        sql`SELECT version FROM classroom_schema WHERE id = 1`,
      )
      if (version && ![1, 2].includes(version.version)) throw new Error('数据库版本与当前程序不兼容。')
      if (!version) {
        for (const statement of schemaV1) await tx.rows(sql.raw(statement))
        await tx.rows(sql`INSERT INTO classroom_schema VALUES (1, 1)`)
      }
      if (!version || version.version === 1) {
        for (const statement of schemaV2) await tx.rows(sql.raw(statement))
        await tx.rows(sql`UPDATE classroom_schema SET version=2 WHERE id=1`)
      }
    })
    if (!options.example && !url) return database
    const transaction = <T>(fn: (connection: Reader) => Promise<T>) =>
      database.transaction(async (tx) => {
        // Transaction-local scope is enforced on every pooled connection, including single reads.
        await tx.rows(sql`SET LOCAL search_path TO ${sql.identifier(activeSchema)}`)
        return fn(tx)
      })
    return {
      transaction,
      rows: <T>(statement: SQL) => transaction((tx) => tx.rows<T>(statement)),
      close: () => database.close(),
    }
  } catch (error) {
    await database.close()
    throw error
  }
}
