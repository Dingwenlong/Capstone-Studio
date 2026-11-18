import { createTRPCClient, httpLink, TRPCClientError } from '@trpc/client'
import type { AppRouter } from '../server/rpc'
import type { readActions, writeActions } from '../shared/contract'
import { languageFromCookie, localizeMessage } from '../shared/i18n'

type Input = Record<string, unknown>
type Get = (typeof readActions)[number]
type SetAction = (typeof writeActions)[number]
function transport(id?: string) {
  return createTRPCClient<AppRouter>({
    links: [
      httpLink({
        url: '/api/rpc',
        headers: id ? { 'X-Request-ID': id } : {},
        fetch: (url, options) =>
          fetch(url, {
            ...options,
            cache: 'no-store',
            credentials: 'same-origin',
            signal: AbortSignal.any([
              AbortSignal.timeout(18000),
              ...(options?.signal ? [options.signal] : []),
            ]),
          }),
      }),
    ],
  })
}
const api = transport()
function clientError(error: unknown) {
  const status = error instanceof TRPCClientError ? error.data?.httpStatus : undefined
  const message = status && error instanceof Error ? error.message : '连接中断，请检查网络后刷新。'
  return Object.assign(new Error(localizeMessage(message, languageFromCookie(document.cookie))), { status })
}
export async function read<T>(action: Get, input: Input = {}): Promise<T> {
  try {
    return (await api.read.query({ action, input })) as T
  } catch (error) {
    throw clientError(error)
  }
}
const pending = new Map<string, Promise<unknown>>()
const refreshAfter: Record<SetAction, Get> = {
  createGallery: 'catalog',
  updateGallery: 'catalog',
  addScreenshot: 'gallery',
  updateScreenshot: 'gallery',
  moveScreenshot: 'gallery',
  removeScreenshot: 'gallery',
  login: 'session',
  demoLogin: 'session',
  logout: 'session',
  launch: 'systems',
  createStudent: 'students',
  resetPassword: 'students',
  setStudentActive: 'students',
  setGrants: 'grants',
  registerSystem: 'catalog',
  setSystemEnabled: 'catalog',
  borrow: 'books',
  returnBook: 'books',
  reserve: 'slots',
  cancelReservation: 'slots',
}

async function unconfirmedResult(action: Get, input: Input = {}): Promise<never> {
  // Screenshot edit commands identify an image. Their mounted gallery owns the system key.
  const current = action === 'gallery' && typeof input.systemKey !== 'string'
    ? undefined
    : await read(action, input).catch(() => undefined)
  window.dispatchEvent(new CustomEvent('classroom:refresh', { detail: { action, current, input } }))
  throw new Error(localizeMessage(
    '未收到提交结果。请核对当前记录后再操作。',
    languageFromCookie(document.cookie),
  ))
}

export async function uploadScreenshot(file: File, details: {systemKey:string;title:string;group:string}) {
  if (file.size > 8 * 1024 * 1024) throw new Error(localizeMessage('图片文件不得超过 8 MiB。',languageFromCookie(document.cookie)))
  const {id} = await api.challenge.mutate({action:'addScreenshot'}).catch(error=>{throw clientError(error)})
  let response: Response
  try {
    response = await fetch('/api/gallery/upload?' + new URLSearchParams(details), {
      method:'POST', credentials:'same-origin', cache:'no-store', body:file,
      headers:{'Content-Type':'application/octet-stream','X-Request-ID':id},
      signal:AbortSignal.timeout(120000),
    })
  } catch {
    return unconfirmedResult('gallery', { systemKey: details.systemKey })
  }
  const result: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const message = result && typeof result === 'object' && 'message' in result && typeof result.message === 'string'
      ? result.message : '服务暂时不可用，请稍后刷新。'
    throw Object.assign(new Error(localizeMessage(message, languageFromCookie(document.cookie))), { status: response.status })
  }
  if (!result || typeof result !== 'object' || !('ok' in result) || result.ok !== true ||
    !('id' in result) || typeof result.id !== 'string' || !result.id) {
    return unconfirmedResult('gallery', { systemKey: details.systemKey })
  }
  return result
}
export function write<T = unknown>(action: SetAction, input: Input = {}): Promise<T> {
  const key = JSON.stringify([action, input])
  const existing = pending.get(key)
  if (existing) return existing as Promise<T>
  const job = (async () => {
    let id: string
    try {
      ;({ id } = await api.challenge.mutate({ action }))
    } catch (error) {
      throw clientError(error)
    }
    try {
      return (await transport(id).write.mutate({ action, input })) as T
    } catch (error) {
      const failure = clientError(error)
      if (failure.status) throw failure
      const refreshInput = action === 'setGrants' ? { studentId: input.studentId }
        : refreshAfter[action] === 'gallery' && typeof input.systemKey === 'string'
          ? { systemKey: input.systemKey } : {}
      return unconfirmedResult(refreshAfter[action], refreshInput)
    }
  })().finally(() => pending.delete(key))
  pending.set(key, job)
  return job
}
