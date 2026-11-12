import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import { cleanStoreTestDirectory } from './store-temp'

test('离线命令可迁移到独立目录并验证数据一致', { timeout: 120_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'classroom-migration-'))
  const from = join(root, 'source')
  const to = join(root, 'target')
  const dump = join(root, 'snapshot.json')
  const roundTrip = join(root, 'restored.json')
  const run = async (directory: string, ...args: string[]) => {
    const result = await promisify(execFile)(
      process.execPath,
      ['--import', 'tsx', 'scripts/data.ts', ...args],
      {
        env: { ...process.env, DATABASE_URL: '', DATA_DIR: directory },
        windowsHide: true,
      },
    )
    return JSON.parse(result.stdout)
  }
  try {
    const initialized = await run(from, 'init')
    assert.deepEqual(
      initialized.credentials.map((row: { username: string }) => row.username),
      ['teacher', 'student-a', 'student-b'],
    )
    const exported = await run(from, 'export', dump)
    const contents = await readFile(dump, 'utf8')
    assert(initialized.credentials.every((row: { password: string }) => !contents.includes(row.password)))
    assert.equal((await run(to, 'import', dump)).sha256, exported.sha256)
    assert.equal((await run(to, 'export', roundTrip)).sha256, exported.sha256)
    assert.equal(await readFile(roundTrip, 'utf8'), contents)
  } finally {
    await cleanStoreTestDirectory(root)
  }
})
