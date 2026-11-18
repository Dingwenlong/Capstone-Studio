import type { IncomingMessage, ServerResponse } from 'node:http'
import { origin } from './hosts'
import { bodyBytes } from './gateway'
import { makeContext } from './rpc'
import { authorize, mutate, screenshot } from './store'
import { languageFromCookie, localizeMessage } from '../shared/i18n'

let activeUploads = 0
const maxImageBytes = 8 * 1024 * 1024

export async function galleryHttp(host: string, req: IncomingMessage, res: ServerResponse, url: URL) {
  const isUpload = url.pathname === '/api/gallery/upload'
  const image = /^\/media\/([a-f0-9-]{36})(\/thumb)?$/.exec(url.pathname)
  if (!isUpload && !url.pathname.startsWith('/media/')) return false
  res.setHeader('Cache-Control', 'private, no-store')
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin')
  let uploading = false
  try {
    if (host !== 'portal' && host !== 'admin') throw Object.assign(new Error('此账号无权执行该操作。'), {status:403})
    const ctx = makeContext(host, req, res)
    if (isUpload) {
      if (req.method !== 'POST') throw Object.assign(new Error('该操作不可用。'), {status:405})
      if (host !== 'admin' || req.headers.origin !== origin(host))
        throw Object.assign(new Error('请求来源不符。'), {status:403})
      const user = await authorize(ctx.token, host)
      if (!user || user.role !== 'teacher') throw Object.assign(new Error('请刷新页面后重新登录。'), {status:401})
      const requestId = req.headers['x-request-id']
      if (typeof requestId !== 'string' || requestId.length > 256)
        throw Object.assign(new Error('缺少有效的请求标识。'), {status:400})
      if (Number(req.headers['content-length']) > maxImageBytes)
        throw Object.assign(new Error('图片文件不得超过 8 MiB。'), {status:413})
      if (activeUploads >= 2) throw Object.assign(new Error('图片正在处理中，请稍后重试。'), {status:429})
      activeUploads++
      uploading = true
      const data = await bodyBytes(req, maxImageBytes)
      const result = await mutate(ctx, 'addScreenshot', {
        systemKey:url.searchParams.get('systemKey'),
        group:url.searchParams.get('group'),
        title:url.searchParams.get('title'),
        data,
      }, requestId)
      res.setHeader('Content-Type','application/json; charset=utf-8')
      res.end(JSON.stringify(result))
    } else {
      if (!image) throw Object.assign(new Error('找不到此图片。'), {status:404})
      if (req.method !== 'GET' && req.method !== 'HEAD') throw Object.assign(new Error('该操作不可用。'), {status:405})
      const asset = await screenshot(ctx, image[1], Boolean(image[2]))
      res.setHeader('Content-Type',asset.mime)
      res.setHeader('Content-Disposition','inline; filename="screenshot.webp"')
      res.setHeader('Content-Length',asset.body.byteLength)
      res.end(req.method === 'HEAD' ? undefined : Buffer.from(asset.body))
    }
  } catch(error) {
    if (res.headersSent) { res.destroy(); return true }
    const status = Number((error as {status?:number})?.status) || 503
    res.statusCode = status
    res.setHeader('Content-Type','application/json; charset=utf-8')
    const message = status < 500 && error instanceof Error ? error.message : '服务暂时不可用，请稍后再试。'
    res.end(JSON.stringify({message:localizeMessage(message,languageFromCookie(req.headers.cookie))}))
  } finally {
    if (uploading) activeUploads--
  }
  return true
}
