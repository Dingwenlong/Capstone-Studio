import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { promisify } from 'node:util'

test('公网学生与教师域名映射保持角色、来源校验、Secure Cookie 和一次性请求一致', async () => {
  process.env.BASE_DOMAIN = 'education.sc.cn'
  process.env.PUBLIC_PORT = ''
  process.env.DATA_DIR = 'memory://'
  delete process.env.DATABASE_URL
  delete process.env.TARGETS_FILE
  const { hostKey, origin, isTls } = await import('../src/server/hosts')
  const { makeContext, router } = await import('../src/server/rpc')
  const { closeStore, redeem, inspect } = await import('../src/server/store')
  assert.equal(isTls, true)
  for (const [key, name] of [
    ['portal', 'student'],
    ['admin', 'teacher'],
    ['library', 'library'],
    ['lab', 'lab'],
  ]) {
    assert.equal(origin(key), 'https://' + name + '.education.sc.cn')
    assert.equal(hostKey(name + '.education.sc.cn'), key)
  }
  for (const authority of [
    'portal.education.sc.cn',
    'admin.education.sc.cn',
    'education.sc.cn',
    'student.education.sc.cn.evil.test',
    'teacher.education.sc.cn:3410',
  ])
    assert.equal(hostKey(authority), null)

  function caller(authority: string, requestOrigin = 'https://' + authority) {
    const cookies: string[] = []
    const req = { headers: { host: authority, origin: requestOrigin } } as IncomingMessage
    const res = {
      appendHeader: (_name: string, value: string) => cookies.push(value),
    } as unknown as ServerResponse
    const ctx = makeContext(hostKey(authority)!, req, res)
    return { rpc: router.createCaller(ctx), cookies, req, ctx }
  }
  async function write(
    client: ReturnType<typeof caller>,
    action: 'demoLogin' | 'launch',
    input: Record<string, unknown>,
  ) {
    client.req.headers['x-request-id'] = (await client.rpc.challenge({ action })).id
    return client.rpc.write({ action, input })
  }
  try {
    const student = caller('student.education.sc.cn')
    const teacher = caller('teacher.education.sc.cn')
    for (const [client, role] of [
      [student, 'student'],
      [teacher, 'teacher'],
    ] as const) {
      await write(client, 'demoLogin', { slot: 1 })
      const cookie = client.cookies.find((value) => value.startsWith('__Host-classroom_session='))!
      assert(cookie)
      assert(cookie.includes('; Path=/; HttpOnly; SameSite=Lax;'))
      assert(cookie.endsWith('; Secure'))
      assert(!cookie.includes('Domain='))
      client.ctx.token = cookie.split(';')[0].slice('__Host-classroom_session='.length)
      assert.equal((await client.rpc.read({ action: 'session' })).role, role)
      await assert.rejects(client.rpc.write({ action: 'demoLogin', input: { slot: 1 } }), {
        code: 'CONFLICT',
      })
    }
    const denied = caller('teacher.education.sc.cn', 'https://student.education.sc.cn')
    await assert.rejects(denied.rpc.challenge({ action: 'demoLogin' }), { code: 'FORBIDDEN' })
    const launched = await write(student, 'launch', { systemKey: 'library' })
    assert.equal(launched.url, 'https://library.education.sc.cn/launch')
    const frame = await redeem('library', launched.ticket)
    assert.equal((await inspect(frame.token, 'library'))?.role, 'student')

    // A new process proves the preserved localhost defaults despite this test's public-host imports.
    const local = await promisify(execFile)(
      process.execPath,
      [
        '--import',
        'tsx',
        '--input-type=module',
        '-e',
        "const m = await import('./src/server/hosts.ts'); console.log(JSON.stringify([m.origin('portal'),m.origin('admin'),m.hostKey('admin.classroom.localhost:3410')]))",
      ],
      {
        env: { ...process.env, BASE_DOMAIN: 'classroom.localhost', PORT: '3410', PUBLIC_PORT: '3410' },
        windowsHide: true,
      },
    )
    assert.deepEqual(JSON.parse(local.stdout), [
      'http://portal.classroom.localhost:3410',
      'http://admin.classroom.localhost:3410',
      'admin',
    ])
  } finally {
    await closeStore()
  }
})
