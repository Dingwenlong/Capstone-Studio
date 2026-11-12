import { readFileSync } from 'node:fs'
import { z } from 'zod'

const registered = z.array(
  z
    .object({
      key: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/),
      name: z.string().trim().min(1).max(80),
      upstream: z.url().refine((raw) => {
        const u = new URL(raw)
        return (
          ['http:', 'https:'].includes(u.protocol) &&
          !u.username &&
          !u.password &&
          u.pathname === '/' &&
          !u.search &&
          !u.hash
        )
      }, 'upstream must be an internal HTTP(S) origin'),
    })
    .strict(),
)

export interface ServiceTarget {
  key: string
  name: string
  upstream?: string
}
let catalog: ServiceTarget[] | undefined
export function targets(): ServiceTarget[] {
  if (catalog) return catalog
  const extras = process.env.TARGETS_FILE
    ? registered.parse(JSON.parse(readFileSync(process.env.TARGETS_FILE, 'utf8')))
    : []
  const list: ServiceTarget[] = [
    { key: 'library', name: '图书借阅' },
    { key: 'lab', name: '实验室预约' },
    ...extras,
  ]
  const used = new Set(['portal', 'admin', 'localhost'])
  for (const item of list) {
    if (used.has(item.key)) throw new Error('服务清单中有重复或保留的标识')
    used.add(item.key)
  }
  catalog = list
  return catalog
}
