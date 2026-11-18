import { createServer } from 'node:http'
import { sql } from 'drizzle-orm'
import next from 'next'
import { createHTTPHandler } from '@trpc/server/adapters/standalone'
import { hostKey, origin, port, isTls } from './src/server/hosts'
import { makeContext, router, sessionCookie, setSession } from './src/server/rpc'
import { authorize, closeStore, getStore, redeem } from './src/server/store'
import { targets } from './src/server/targets'
import { startDemos, stopDemos, demoEndpoint } from './src/server/demos'
import { bodyBytes, forward, message, redirect } from './src/server/gateway'
import { localControl } from './src/server/local-control'
import { languageFromCookie } from './src/shared/i18n'
import { galleryHttp } from './src/server/gallery-http'

const dev = process.argv.includes('--dev')
const bind = process.env.BIND_ADDRESS || '127.0.0.1'
if (isTls && !process.env.DATABASE_URL) throw new Error('公网模式需要配置 DATABASE_URL。')
const app = next({ dev, hostname: bind, port, webpack: true })
const serveNext = app.getRequestHandler()
await getStore()
await app.prepare()
const rpc = createHTTPHandler({
  router,
  basePath: '/api/rpc/',
  maxBodySize: 32 * 1024,
  allowBatching: false,
  createContext: ({ req, res }) => makeContext(hostKey(req.headers.host)!, req, res),
})
const server = createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.setHeader('Content-Language', languageFromCookie(req.headers.cookie))
  try {
    const host = hostKey(req.headers.host)
    // Container health probe never publishes database details or demo credentials.
    if (req.url === '/healthz' && req.method === 'GET') {
      await (await getStore()).rows(sql`SELECT 1`)
      res.setHeader('Content-Type', 'application/json')
      res.end('{"ready":true}')
      return
    }
    if (!host) {
      if (
        !isTls &&
        ['localhost:' + port, '127.0.0.1:' + port].includes(req.headers.host || '') &&
        req.url === '/'
      )
        return redirect(res, origin('portal') + '/')
      return message(res, 404, '找不到此入口。')
    }
    const demo = host !== 'portal' && host !== 'admin'
    res.setHeader(
      'Content-Security-Policy',
      "object-src 'none'; base-uri 'self'; frame-ancestors " +
        (demo ? origin('portal') : "'none'") +
        (demo ? "; worker-src 'none'" : ''),
    )
    if (!demo) res.setHeader('X-Frame-Options', 'DENY')
    const requestedUrl = new URL(req.url || '/', origin(host))
    const path = requestedUrl.pathname
    if (await galleryHttp(host, req, res, requestedUrl)) return
    if (demo && path === '/launch') {
      if (
        req.method !== 'POST' ||
        req.headers.origin !== origin('portal') ||
        !req.headers['content-type']?.startsWith('application/x-www-form-urlencoded')
      )
        return message(res, 403, '请从学生工作台打开系统。')
      const form = new URLSearchParams((await bodyBytes(req, 1024)).toString())
      const { token } = await redeem(host, form.get('ticket') || '')
      if ((host === 'library' || host === 'lab') && !demoEndpoint(host)) await startDemos()
      setSession(res, token)
      return redirect(res, '/')
    }
    const token = sessionCookie(req)
    if (demo) {
      const user = await authorize(token, host)
      if (!user) return message(res, 403, '你的账号当前无权访问该系统。请返回工作台查看授权。')
      const target = targets().find((t) => t.key === host)!
      const endpoint = target.upstream ? { upstream: target.upstream } : demoEndpoint(host)
      if (!endpoint) return message(res, 503, '该演示系统暂时离线。请稍后重新打开此页签。')
      if (!target.upstream && path.startsWith('/api/rpc/')) return rpc(req, res)
      return await forward(req, res, host, user, endpoint)
    }
    if (path.startsWith('/api/rpc/')) return rpc(req, res)
    if (req.method !== 'GET' && req.method !== 'HEAD') return message(res, 405, '该操作不可用。')
    if (
      path.startsWith('/_next/static/') ||
      path === '/mark.svg' ||
      (host === 'portal' && path === '/hero.webp')
    )
      return await serveNext(req, res)
    if (host === 'admin' && path === '/') return redirect(res, '/admin/students')
    const known =
      host === 'admin' ? /^\/admin\/(students|systems|grants|audit)$/.test(path) : path === '/workspace'
    if (!known && path !== '/login' && !(host === 'portal' && path === '/'))
      return message(res, 404, '找不到此页面。')
    if (known && !(await authorize(token, host))) return redirect(res, '/login')
    return await serveNext(req, res)
  } catch (error) {
    if (res.headersSent) {
      if (!res.writableEnded) res.destroy()
      return
    }
    const status = Number((error as { status?: number })?.status) || 503
    return message(
      res,
      status,
      status < 500 && error instanceof Error ? error.message : '服务暂时不可用，请稍后再试。',
    )
  }
})
server.headersTimeout = 15000
server.requestTimeout = 120000
if (dev)
  server.on('upgrade', (req, socket, head) => {
    const host = hostKey(req.headers.host)
    if (host === 'portal' || host === 'admin') void app.getUpgradeHandler()(req, socket, head)
    else socket.destroy()
  })
const releaseControl = await localControl(() => {
  void close().then(() => process.exit(0))
})
server.listen(port, bind, () => {
  console.info('学生 ' + origin('portal') + '/\n教师 ' + origin('admin') + '/login')
  if (process.send) process.send({ type: 'ready' })
})
let closing = false
async function close() {
  if (closing) return
  closing = true
  await new Promise<void>((done) => {
    server.close(() => done())
    server.closeAllConnections()
  })
  await releaseControl()
  await stopDemos()
  await closeStore()
  await app.close()
}
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    void close().then(() => process.exit(0))
  })
process.on('message', (message) => {
  if (message === 'shutdown') void close().then(() => process.exit(0))
})
