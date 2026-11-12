import { sql } from 'drizzle-orm'
import type { Database, Reader } from './db'
import { seedMaterials } from './service-data'
import { fail } from './service-helpers'
import { targets } from './targets'

export type Realm = 'classroom' | 'example'
const examples = [
  { id: 'example-student-1', role: 'student', name: '示例学生 A', username: 'demo-student-a' },
  { id: 'example-student-2', role: 'student', name: '示例学生 B', username: 'demo-student-b' },
  { id: 'example-teacher-1', role: 'teacher', name: '示例教师 A', username: 'demo-teacher-a' },
  { id: 'example-teacher-2', role: 'teacher', name: '示例教师 B', username: 'demo-teacher-b' },
] as const

export function exampleId(host: string, slot: unknown) {
  if (host !== 'portal' && host !== 'admin') fail(403, '请从学生或教师登录页使用示例账号。')
  if (slot !== 1 && slot !== 2) fail(400, '请选择有效的示例账号。')
  return examples[(host === 'admin' ? 2 : 0) + slot - 1].id
}

export function protectedExampleStudent(id: string) {
  return examples.some((person) => person.role === 'student' && person.id === id)
}

export function availableTargets(realm: Realm) {
  return targets().filter(
    (target) => realm === 'classroom' || target.key === 'library' || target.key === 'lab',
  )
}

export async function initializeExamples(db: Database) {
  await db.transaction(async (tx: Reader) => {
    // A single schema row serializes initialization across PostgreSQL replicas.
    await tx.rows(sql`SELECT id FROM classroom_schema WHERE id=1 FOR UPDATE`)
    const existing = await tx.rows(sql`SELECT 1 FROM people LIMIT 1`)
    if (existing.length) return
    for (const person of examples) {
      // Public profiles authenticate only by slot inside this isolated store. They have no usable password.
      await tx.rows(sql`INSERT INTO people(id,username,name,role,password_hash)
        VALUES(${person.id},${person.username},${person.name},${person.role},'!password-disabled')`)
    }
    await seedMaterials(tx, examples[0].id, examples[1].id)
  })
}
