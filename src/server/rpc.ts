import { initTRPC, TRPCError } from '@trpc/server'
import { z } from 'zod'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { randomBytes } from 'node:crypto'
import { readActions, writeActions } from '../shared/contract'
import { languageFromCookie, localizeMessage } from '../shared/i18n'
import { isTls, origin } from './hosts'
import { issueNonce, query, mutate } from './store'

const prefix = isTls ? '__Host-' : ''
const sessionName = prefix + 'classroom_session'
const anonName = prefix + 'classroom_visitor'
function cookie(req: IncomingMessage, name: string) {
  return req.headers.cookie
    ?.split(';')
    .map((x) => x.trim())
    .find((x) => x.startsWith(name + '='))
    ?.slice(name.length + 1)
}
export function sessionCookie(req: IncomingMessage) {
  return cookie(req, sessionName)
}
export function putCookie(res: ServerResponse, name: string, value: string, seconds: number) {
  const entry =
    name + '=' + value + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + seconds + (isTls ? '; Secure' : '')
  res.appendHeader('Set-Cookie', entry)
}
export function setSession(res: ServerResponse, token?: string) {
  putCookie(res, sessionName, token || '', token ? 86400 : 0)
}

export function makeContext(host: string, req: IncomingMessage, res: ServerResponse) {
  return { host, req, res, token: sessionCookie(req), anon: cookie(req, anonName) }
}
type Ctx = ReturnType<typeof makeContext>
const t = initTRPC.context<Ctx>().create({
  isDev: false,
  errorFormatter({ shape, ctx }) {
    return { ...shape, message: localizeMessage(shape.message, languageFromCookie(ctx?.req.headers.cookie)) }
  },
})
const safe = t.procedure.use(async ({ next, ctx, type }) => {
  if (type === 'mutation' && ctx.req.headers.origin !== origin(ctx.host))
    throw new TRPCError({ code: 'FORBIDDEN', message: '请求来源不符，请刷新页面。' })
  return next()
})
async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (e) {
    const status = (e as { status?: number })?.status
    const codes = {
      400: 'BAD_REQUEST',
      401: 'UNAUTHORIZED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      409: 'CONFLICT',
      410: 'BAD_REQUEST',
      422: 'BAD_REQUEST',
      429: 'TOO_MANY_REQUESTS',
      503: 'SERVICE_UNAVAILABLE',
    } as const
    const code =
      status !== undefined && Object.hasOwn(codes, status)
        ? codes[status as keyof typeof codes]
        : 'INTERNAL_SERVER_ERROR'
    throw new TRPCError({
      code,
      message: code === 'INTERNAL_SERVER_ERROR' ? '服务暂时不可用，请稍后刷新。' : (e as Error).message,
    })
  }
}
const args = z.record(z.string(), z.unknown()).optional()
export const router = t.router({
  read: safe
    .input(z.object({ action: z.enum(readActions), input: args }))
    .query(({ ctx, input }) => guarded(() => query(ctx, input.action, input.input ?? {}))),
  challenge: safe.input(z.object({ action: z.enum(writeActions) })).mutation(({ ctx, input }) =>
    guarded(async () => {
      if (!ctx.anon) {
        ctx.anon = randomBytes(32).toString('hex')
        putCookie(ctx.res, anonName, ctx.anon, 86400)
      }
      return { id: await issueNonce(ctx, input.action) }
    }),
  ),
  write: safe.input(z.object({ action: z.enum(writeActions), input: args })).mutation(({ ctx, input }) =>
    guarded(async () => {
      const nonce = ctx.req.headers['x-request-id']
      if (typeof nonce !== 'string' || nonce.length > 256)
        throw Object.assign(new Error('缺少有效的请求编号，请重新操作。'), { status: 400 })
      const result = await mutate(ctx, input.action, input.input ?? {}, nonce)
      if (input.action === 'login' || input.action === 'demoLogin') {
        setSession(ctx.res, result.token)
        return { ok: true }
      }
      if (input.action === 'logout') {
        setSession(ctx.res)
        return { ok: true }
      }
      if (input.action === 'launch')
        return { url: origin(result.systemKey) + '/launch', ticket: result.ticket }
      return result
    }),
  ),
})
export type AppRouter = typeof router
