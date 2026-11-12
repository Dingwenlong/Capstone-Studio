import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { User } from '../shared/contract'
import { origin } from './hosts'
import { languageFromCookie, localizeMessage } from '../shared/i18n'

export async function bodyBytes(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const bytes = Buffer.from(chunk)
    size += bytes.length
    if (size > limit) throw Object.assign(new Error('请求内容过大。'), { status: 413 })
    chunks.push(bytes)
  }
  return Buffer.concat(chunks)
}
export function message(res: ServerResponse, status: number, text: string) {
  res.statusCode = status
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  const lang = res.getHeader('Content-Language') === 'zh-CN' ? 'zh-CN' : 'en'
  const safeText = localizeMessage(text, lang).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )
  res.end(
    '<!doctype html><html lang="' +
      lang +
      '"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>' +
      (lang === 'en' ? 'Demo system' : '演示系统') +
      '</title><body style="font:17px/1.8 system-ui,sans-serif;color:#303238;padding:6vw"><p>' +
      safeText +
      '</p></body></html>',
  )
}
export function redirect(res: ServerResponse, url: string) {
  res.writeHead(303, { Location: url, 'Cache-Control': 'no-store' }).end()
}

export async function forward(
  req: IncomingMessage,
  res: ServerResponse,
  host: string,
  user: User,
  target: { upstream: string; secret?: string },
) {
  const method = req.method || 'GET'
  if (!['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method))
    return message(res, 405, '该操作不可用。')
  if (!['GET', 'HEAD'].includes(method) && req.headers.origin !== origin(host))
    return message(res, 403, '请求来源不符。')
  // Assign path components separately: a client path must never change the operator-selected origin.
  const upstream = new URL(target.upstream)
  const requested = new URL(req.url!, origin(host))
  upstream.pathname = requested.pathname
  upstream.search = requested.search
  const headers = new Headers()
  for (const name of ['accept', 'content-type', 'if-match', 'x-request-id']) {
    const value = req.headers[name]
    if (typeof value === 'string') headers.set(name, value)
  }
  headers.set('accept-language', languageFromCookie(req.headers.cookie))
  headers.set('x-classroom-user-id', user.id)
  if (target.secret) headers.set('x-classroom-internal', target.secret)
  const body = ['GET', 'HEAD'].includes(method)
    ? undefined
    : new Uint8Array(await bodyBytes(req, 2 * 1024 * 1024))
  let reply: Response
  try {
    reply = await fetch(upstream, {
      method,
      body,
      headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(15000),
    })
  } catch {
    return message(res, 503, '该演示系统暂时离线。其他系统仍可使用，请稍后重新打开此页签。')
  }
  if (reply.status >= 300 && reply.status < 400 && reply.headers.has('location')) {
    const location = new URL(reply.headers.get('location')!, upstream)
    if (location.origin !== upstream.origin) return message(res, 502, '系统返回的跳转地址不在接入范围内。')
    res.setHeader('Location', origin(host) + location.pathname + location.search + location.hash)
  }
  for (const name of [
    'content-type',
    'content-disposition',
    'content-language',
    'etag',
    'content-security-policy',
    'x-frame-options',
  ]) {
    const value = reply.headers.get(name)
    if (value) {
      if (name === 'content-security-policy') res.appendHeader(name, value)
      else res.setHeader(name, value)
    }
  }
  res.statusCode = reply.status
  if (reply.body && method !== 'HEAD')
    await pipeline(Readable.fromWeb(reply.body as Parameters<typeof Readable.fromWeb>[0]), res)
  else res.end()
}
