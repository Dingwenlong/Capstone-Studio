import { fork, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { access } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

type Endpoint = { upstream: string; secret: string }
type Worker = { key: string; child?: ChildProcess; endpoint?: Endpoint; restart?: NodeJS.Timeout }

const workers = new Map<string, Worker>()
const script = fileURLToPath(new URL('../../scripts/demo-worker.mjs', import.meta.url))
let transition = Promise.resolve()

function schedule(worker: Worker) {
  if (workers.get(worker.key) !== worker || worker.restart) return
  worker.restart = setTimeout(() => {
    worker.restart = undefined
    void launch(worker)
  }, 3000)
  worker.restart.unref()
}

function launch(worker: Worker): Promise<void> {
  const secret = randomBytes(32).toString('base64url')
  const env: NodeJS.ProcessEnv = { DEMO_SECRET: secret, NODE_ENV: 'production' }
  if (process.platform === 'win32' && process.env.SystemRoot) env.SystemRoot = process.env.SystemRoot
  let child: ChildProcess
  try {
    child = fork(script, [worker.key], {
      execPath: process.execPath,
      execArgv: [],
      env,
      silent: true,
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    })
  } catch {
    schedule(worker)
    return Promise.resolve()
  }
  worker.child = child
  return new Promise((resolve) => {
    const bootTimeout = setTimeout(() => child.kill(), 8000)
    const lost = () => {
      clearTimeout(bootTimeout)
      if (worker.child === child) {
        worker.child = undefined
        worker.endpoint = undefined
        schedule(worker)
      }
      resolve()
    }
    child.once('exit', lost)
    child.on('error', lost)
    child.once('message', (value) => {
      const port = typeof value === 'object' && value && 'port' in value ? value.port : 0
      if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) {
        child.kill()
        return
      }
      clearTimeout(bootTimeout)
      if (workers.get(worker.key) === worker && worker.child === child)
        worker.endpoint = { upstream: 'http://127.0.0.1:' + port, secret }
      resolve()
    })
  })
}

function queue(task: () => Promise<void>) {
  const next = transition.then(task)
  transition = next.catch(() => {})
  return next
}

export function startDemos(): Promise<void> {
  return queue(async () => {
    if (workers.size) return
    try {
      await Promise.all(
        ['demo.js', 'demo.css', 'mark.svg'].map((name) =>
          access(new URL('../../.demo-build/' + name, import.meta.url)),
        ),
      )
      await access(script)
    } catch {
      throw new Error('缺少演示服务或编译产物，请先构建演示页。')
    }
    await Promise.all(
      ['library', 'lab'].map((key) => {
        const worker: Worker = { key }
        workers.set(key, worker)
        return launch(worker)
      }),
    )
  })
}

export function demoEndpoint(key: string): Endpoint | undefined {
  return workers.get(key)?.endpoint
}

async function stopWorker(worker: Worker) {
  if (worker.restart) clearTimeout(worker.restart)
  worker.endpoint = undefined
  const child = worker.child
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return
  await new Promise<void>((resolve) => {
    const killTimeout = setTimeout(() => child.kill('SIGKILL'), 1600)
    const done = () => {
      clearTimeout(killTimeout)
      child.off('exit', done)
      child.off('close', done)
      resolve()
    }
    child.once('exit', done)
    child.once('close', done)
    if (child.connected) child.disconnect()
    else child.kill()
  })
}

export function stopDemos(): Promise<void> {
  return queue(async () => {
    const active = [...workers.values()]
    workers.clear()
    await Promise.all(active.map(stopWorker))
  })
}
