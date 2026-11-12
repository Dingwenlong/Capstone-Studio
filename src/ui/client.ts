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
      const current = await read(
        refreshAfter[action],
        action === 'setGrants' ? { studentId: input.studentId } : {},
      ).catch(() => undefined)
      window.dispatchEvent(
        new CustomEvent('classroom:refresh', { detail: { action: refreshAfter[action], current } }),
      )
      throw new Error(localizeMessage('未收到提交结果。请核对当前记录后再操作。', languageFromCookie(document.cookie)))
    }
  })().finally(() => pending.delete(key))
  pending.set(key, job)
  return job
}
