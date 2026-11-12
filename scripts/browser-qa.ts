import { fork, spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { sql } from 'drizzle-orm'
import { openDatabase } from '../src/server/db'
import { initialize } from '../src/server/service-data'

async function runBrowserTests(environment: NodeJS.ProcessEnv, credentials: Record<string, string>) {
  const server = fork(resolve('server.ts'), [], {
    execArgv: ['--import', 'tsx'],
    env: environment,
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  })
  const stopped = once(server, 'exit')
  try {
    await new Promise<void>((done, fail) => {
      const timeout = setTimeout(() => fail(new Error('隔离验收服务未启动。')), 30000)
      server.once('exit', () => {
        clearTimeout(timeout)
        fail(new Error('隔离验收服务已退出。'))
      })
      server.once('message', (event) => {
        clearTimeout(timeout)
        if ((event as { type?: string })?.type === 'ready') done()
        else fail(new Error('验收服务状态异常。'))
      })
    })
    const runner = spawn(
      process.execPath,
      ['node_modules/@playwright/test/cli.js', 'test', ...process.argv.slice(2)],
      {
        stdio: 'inherit',
        env: {
          ...environment,
          CLASSROOM_TEST_PORT: environment.PORT,
          TEST_A_PASSWORD: credentials['student-a'],
          TEST_B_PASSWORD: credentials['student-b'],
          TEST_TEACHER_PASSWORD: credentials.teacher,
        },
      },
    )
    const [code] = await once(runner, 'exit')
    process.exitCode = code === 0 ? 0 : 1
  } finally {
    if (server.connected) server.send('shutdown')
    const timer = setTimeout(() => server.kill(), 8000)
    try {
      await stopped
    } finally {
      clearTimeout(timer)
    }
  }
}

const root = await mkdtemp(join(tmpdir(), 'demo-classroom-test-'))
const directory = join(root, 'db')
const port = process.env.CLASSROOM_TEST_PORT || '3459'
let expectedStudent = ''
const fixture = createServer((req, res) => {
  if (req.method !== 'GET' || req.url !== '/') {
    res.writeHead(404).end()
    return
  }
  if (
    !expectedStudent ||
    req.headers['x-classroom-user-id'] !== expectedStudent ||
    req.headers.cookie ||
    req.headers.authorization
  ) {
    res.writeHead(403).end()
    return
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
  res.end(
    '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>课程资料库</title><main><h1>课程资料库</h1><p>当前学生：学生 B</p></main></html>',
  )
})
try {
  const db = await openDatabase({ directory })
  let accounts: Awaited<ReturnType<typeof initialize>>
  try {
    accounts = await initialize(db)
    const [student] = await db.rows<{ id: string }>(sql`SELECT id FROM people WHERE username = 'student-b'`)
    if (!student) throw new Error('找不到测试学生。')
    expectedStudent = student.id
  } finally {
    await db.close()
  }
  const listening = once(fixture, 'listening')
  fixture.listen(0, '127.0.0.1')
  await listening
  const address = fixture.address()
  if (!address || typeof address === 'string') throw new Error('临时演示系统未分配回环端口。')
  const targetsFile = join(root, 'targets.json')
  await writeFile(
    targetsFile,
    JSON.stringify([
      {
        key: 'course-materials',
        name: '课程资料目标',
        upstream: 'http://127.0.0.1:' + address.port,
      },
    ]),
    { flag: 'wx' },
  )
  await runBrowserTests(
    {
      ...process.env,
      PORT: port,
      PUBLIC_PORT: port,
      BASE_DOMAIN: 'classroom.localhost',
      BIND_ADDRESS: '127.0.0.1',
      DATA_DIR: directory,
      DATABASE_URL: '',
      TARGETS_FILE: targetsFile,
      NEXT_TELEMETRY_DISABLED: '1',
    },
    Object.fromEntries(accounts.map((entry) => [entry.username, entry.password])),
  )
} finally {
  if (fixture.listening) {
    const closed = once(fixture, 'close')
    fixture.close()
    fixture.closeAllConnections()
    await closed
  }
  if (dirname(resolve(root)) === resolve(tmpdir()))
    await rm(root, { recursive: true, force: true, maxRetries: 3 })
}
