import assert from 'node:assert/strict'
import { realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname } from 'node:path'

export async function cleanStoreTestDirectory(directory: string) {
  const target = await realpath(directory)
  assert.equal(dirname(target), await realpath(tmpdir()))
  assert.match(basename(target), /^classroom-(database|migration)-[a-z\d]{6}$/i)
  await rm(target, { recursive: true, force: true })
}
