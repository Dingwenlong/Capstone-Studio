import assert from 'node:assert/strict'
import { channel } from 'node:diagnostics_channel'
import type { ChildProcess } from 'node:child_process'
import { setTimeout as wait } from 'node:timers/promises'
import test from 'node:test'
import { startDemos, stopDemos, demoEndpoint } from '../src/server/demos'

test(
  'one demonstration service can stop and recover while its sibling stays available',
  { timeout: 30000 },
  async () => {
    await import('../scripts/build-demos')
    const spawned: ChildProcess[] = []
    const event = channel('child_process')
    const onChild = (info: unknown) => spawned.push((info as { process: ChildProcess }).process)
    event.subscribe(onChild)
    try {
      await startDemos()
      const library = demoEndpoint('library')
      const lab = demoEndpoint('lab')
      assert.ok(library && lab)
      assert.notEqual(library.upstream, lab.upstream)
      assert.ok(library.secret !== lab.secret)
      const get = (upstream: string, secret = '', path = '/') =>
        fetch(upstream + path, {
          headers: secret ? { 'x-classroom-internal': secret } : {},
          signal: AbortSignal.timeout(3000),
        })
      assert.equal((await get(library.upstream)).status, 403)
      assert.equal((await get(library.upstream, lab.secret)).status, 403)
      assert.match(await (await get(lab.upstream, lab.secret)).text(), /data-system="lab"/)
      for (const path of ['/demo.js', '/demo.css', '/mark.svg']) {
        const asset = await get(library.upstream, library.secret, path)
        assert.equal(asset.status, 200)
        assert.ok((await asset.arrayBuffer()).byteLength > 0)
      }
      const libraryChild = spawned.find((child) => child.spawnargs.at(-1) === 'library')
      assert.ok(libraryChild?.pid)
      libraryChild.kill()
      for (let i = 0; i < 20 && demoEndpoint('library'); i++) await wait(50)
      assert.equal(demoEndpoint('library'), undefined)
      assert.equal((await get(lab.upstream, lab.secret)).status, 200)
      for (let i = 0; i < 100 && !demoEndpoint('library'); i++) await wait(85)
      const restored = demoEndpoint('library')
      assert.ok(restored && restored.secret !== library.secret)
      assert.match(await (await get(restored.upstream, restored.secret)).text(), /data-system="library"/)
      assert.equal(demoEndpoint('lab'), lab)
    } finally {
      event.unsubscribe(onChild)
      await stopDemos()
    }
    assert.equal(demoEndpoint('library'), undefined)
    assert.equal(demoEndpoint('lab'), undefined)
  },
)
