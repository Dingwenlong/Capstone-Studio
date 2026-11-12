import { timingSafeEqual } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'

const key = process.argv[2]
const titles = new Map([
  ['library', '图书借阅'],
  ['lab', '实验室预约'],
])
const title = titles.get(key)
const secret = Buffer.from(process.env.DEMO_SECRET ?? '')
delete process.env.DEMO_SECRET
if (!title || secret.length < 32 || !process.send) throw new Error('演示进程配置无效。')

const assets = new Map()
await Promise.all(
  [
    ['demo.js', 'application/javascript; charset=utf-8'],
    ['demo.css', 'text/css; charset=utf-8'],
    ['mark.svg', 'image/svg+xml'],
  ].map(async ([name, type]) => {
    assets.set('/' + name, { type, body: await readFile(new URL('../.demo-build/' + name, import.meta.url)) })
  }),
)
for (const lang of ['zh-CN', 'en'])
  assets.set('/:' + lang, {
    type: 'text/html; charset=utf-8',
    body: Buffer.from(
      `<!doctype html><html lang="${lang}" data-system="${key}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${lang === 'en' ? (key === 'library' ? 'Library' : 'Lab reservations') : title}</title><link rel="icon" href="/mark.svg"><link rel="stylesheet" href="/demo.css"><script defer src="/demo.js"></script></head><body><div id="demo"></div></body></html>`,
    ),
  })

const server = createServer({ requestTimeout: 12000, headersTimeout: 8000 }, (req, res) => {
  res.setHeader('cache-control', 'no-store')
  res.setHeader('x-content-type-options', 'nosniff')
  const input = req.headers['x-classroom-internal']
  const provided = Buffer.from(typeof input === 'string' ? input : '')
  if (provided.length !== secret.length || !timingSafeEqual(provided, secret)) {
    res.writeHead(403).end()
    return
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD' }).end()
    return
  }
  const path = (req.url ?? '').split('?')[0]
  const asset = assets.get(
    path === '/' ? '/:' + (req.headers['accept-language'] === 'zh-CN' ? 'zh-CN' : 'en') : path,
  )
  if (!asset) {
    res.writeHead(404).end()
    return
  }
  res.writeHead(200, { 'content-type': asset.type, 'content-length': asset.body.byteLength })
  res.end(req.method === 'HEAD' ? undefined : asset.body)
})
function shutdown() {
  server.close(() => process.exit(0))
  server.closeAllConnections()
}
process.once('disconnect', shutdown)
process.once('SIGTERM', shutdown)
process.once('SIGINT', shutdown)
if (!process.connected) process.exit(0)
server.listen(0, '127.0.0.1', () => {
  if (process.connected)
    process.send({ port: server.address().port }, (error) => {
      if (error) shutdown()
    })
  else shutdown()
})
