import { targets } from './targets'

export const baseDomain = (process.env.BASE_DOMAIN || 'classroom.localhost').toLowerCase()
export const port = Number(process.env.PORT || 3410)
const localDomain = baseDomain === 'classroom.localhost' || baseDomain.endsWith('.localhost')
export const isTls = !localDomain
const publicPort = process.env.PUBLIC_PORT ?? (localDomain ? String(port) : '')
const publicHosts = new Map([
  ['portal', 'student'],
  ['admin', 'teacher'],
])
if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9-]+$/.test(baseDomain))
  throw new Error('BASE_DOMAIN 无效')
if (
  !Number.isInteger(port) ||
  port < 1 ||
  port > 65535 ||
  (publicPort && (!/^\d{1,5}$/.test(publicPort) || Number(publicPort) < 1 || Number(publicPort) > 65535))
)
  throw new Error('端口配置无效')
export function origin(host: string) {
  const subdomain = isTls ? (publicHosts.get(host) ?? host) : host
  return new URL(
    (isTls ? 'https://' : 'http://') + subdomain + '.' + baseDomain + (publicPort ? ':' + publicPort : ''),
  ).origin
}
export function hostKey(authority: string | undefined): string | null {
  if (!authority || !/^[a-z0-9.-]+(?::\d{1,5})?$/i.test(authority)) return null
  return (
    ['portal', 'admin', ...targets().map((target) => target.key)].find(
      (key) => authority.toLowerCase() === new URL(origin(key)).host,
    ) ?? null
  )
}
