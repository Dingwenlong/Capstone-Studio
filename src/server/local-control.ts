import { createServer, connect } from 'node:net'
import { randomBytes } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises'

function controlFile() {
  return join(resolve(process.env.DATA_DIR || '.data/classroom'), '.local-service.json')
}
export async function localControl(shutdown: () => void) {
  if (process.platform !== 'win32' || process.env.DATABASE_URL || process.env.DATA_DIR === 'memory://')
    return async () => {}
  const key = randomBytes(32).toString('hex')
  const pipe = '\\\\.\\pipe\\demo-classroom-' + randomBytes(12).toString('hex')
  const server = createServer((socket) => {
    socket.setTimeout(1500, () => socket.destroy())
    socket.on('error', () => {})
    socket.once('data', (data) => {
      if (data.toString() !== key) {
        socket.destroy()
        return
      }
      socket.end('ok')
      shutdown()
    })
  })
  await new Promise<void>((done, fail) => {
    server.once('error', fail)
    server.listen(pipe, done)
  })
  try {
    await mkdir(dirname(controlFile()), { recursive: true })
    await writeFile(controlFile(), JSON.stringify({ pipe, key }), { mode: 0o600 })
  } catch (error) {
    server.close()
    throw error
  }
  return async () => {
    await unlink(controlFile()).catch(() => {})
    server.close()
  }
}
export async function requestStop() {
  const { pipe, key } = JSON.parse(await readFile(controlFile(), 'utf8'))
  if (
    typeof pipe !== 'string' ||
    !pipe.startsWith('\\\\.\\pipe\\demo-classroom-') ||
    !/^[0-9a-f]{64}$/.test(key)
  )
    throw new Error('本机服务记录无效。')
  await new Promise<void>((done, fail) => {
    const sock = connect(pipe, () => sock.write(key))
    sock.on('error', fail)
    sock.setTimeout(4000, () => sock.destroy(new Error('本机服务未响应。')))
    sock.on('data', (reply) => {
      if (reply.toString() !== 'ok') fail(new Error('本机服务身份不符。'))
    })
    sock.on('end', done)
  })
}
