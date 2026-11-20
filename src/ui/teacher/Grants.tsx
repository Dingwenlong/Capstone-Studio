import { useCallback, useRef, useState, type FormEvent } from 'react'
import { Button, Checkbox, UnstyledButton } from '@mantine/core'
import type { Student, SystemInfo } from '../../shared/contract'
import { read, write } from '../client'
import { useLanguage } from '../i18n'
import {
  Loading,
  matches,
  message,
  Notice,
  SearchBox,
  useRemote,
  studentName,
  systemName,
  type Feedback,
} from './common'
import s from './Teacher.module.css'

async function loadGrantCatalog() {
  const [students, systems] = await Promise.all([read<Student[]>('students'), read<SystemInfo[]>('catalog')])
  return { students, systems }
}

type EditorProps = {
  demo: boolean
  student: Student
  systems: SystemInfo[]
  markDirty: (value: boolean) => void
  setSaving: (value: boolean) => void
}

function GrantForm({
  student,
  systems,
  initial,
  markDirty,
  setSaving,
  demo,
}: EditorProps & { initial: string[] }) {
  const { t, lang } = useLanguage()
  const [keys, setKeys] = useState(() => new Set(initial))
  const [savedKeys, setSavedKeys] = useState(() => new Set(initial))
  const [pending, setPending] = useState(false)
  const [feedback, setFeedback] = useState<Feedback>(null)
  const lock = useRef(false)
  function change(key: string, checked: boolean) {
    const next = new Set(keys)
    if (checked) next.add(key)
    else next.delete(key)
    setKeys(next)
    setFeedback(null)
    markDirty(next.size !== savedKeys.size || [...next].some((value) => !savedKeys.has(value)))
  }
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (lock.current) return
    lock.current = true
    setPending(true)
    setSaving(true)
    setFeedback(null)
    try {
      await write('setGrants', { studentId: student.id, keys: [...keys] })
      setSavedKeys(new Set(keys))
      markDirty(false)
      setFeedback({
        text: `已保存「${student.name}」的系统授权。`,
        en: `Saved system access for ${studentName(student, 'en', demo)}.`,
      })
    } catch (cause) {
      setFeedback({ text: message(cause), error: true })
    } finally {
      lock.current = false
      setPending(false)
      setSaving(false)
    }
  }
  return (
    <form onSubmit={submit}>
      <div className={s.choices}>
        {systems.map((item) => (
          <div className={s.choice} key={item.key}>
            <Checkbox
              label={systemName(item, lang)}
              aria-label={systemName(item, lang)}
              className={s.accessCheckbox}
              checked={keys.has(item.key)}
              disabled={pending}
              onChange={(e) => change(item.key, e.target.checked)}
            />
            {!item.enabled && <span className={s.inactive}>{t('已下架', 'Unpublished')}</span>}
          </div>
        ))}
        {!systems.length && (
          <p className={s.empty}>{t('请先登记演示系统。', 'Register a demo system first.')}</p>
        )}
      </div>
      <div className={s.grantFooter}>
        <Button type="submit" loading={pending} disabled={pending || !systems.length}>
          {pending ? t('保存中…', 'Saving…') : t('保存授权', 'Save access')}
        </Button>
      </div>
      {feedback && (
        <div className={s.grantFeedback}>
          <Notice feedback={feedback} />
        </div>
      )}
    </form>
  )
}

function StudentGrants(props: EditorProps) {
  const { t, lang } = useLanguage()
  const { student, demo } = props
  const load = useCallback(() => read<string[]>('grants', { studentId: student.id }), [student.id])
  const { data, error, reload } = useRemote(load, 'grants')
  return (
    <div className={s.grantDetail}>
      <h2 className={s.grantTitle}>
        {studentName(student, lang, demo)}{' '}
        {!student.active && <span className={s.inactive}>{t('已停用', 'Disabled')}</span>}
      </h2>
      {error || !data ? (
        <Loading error={error} retry={reload} />
      ) : (
        <GrantForm key={JSON.stringify(data)} {...props} initial={data} />
      )}
    </div>
  )
}

export default function Grants({ demo }: { demo: boolean }) {
  const { t, lang } = useLanguage()
  const { data, error, reload } = useRemote(loadGrantCatalog)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState('')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const current = data?.students.find((student) => student.id === selected) ?? data?.students[0]
  const visible = (data?.students ?? []).filter((student) =>
    matches(query, studentName(student, lang, demo), student.name, student.username),
  )
  function choose(student: Student) {
    if (student.id === current?.id) return
    if (
      dirty &&
      !window.confirm(
        t(
          '当前授权尚未保存，放弃更改并切换学生？',
          'Discard your unsaved access changes and switch students?',
        ),
      )
    )
      return
    setDirty(false)
    setSelected(student.id)
  }
  return (
    <>
      <div className={s.heading}>
        <h1>{t('系统授权', 'System access')}</h1>
      </div>
      {error || !data ? (
        <Loading error={error} retry={reload} />
      ) : (
        <div className={s.grants}>
          <div className={s.roster}>
            <div className={s.rosterSearch}>
              <SearchBox label={t('搜索学生', 'Search students')} value={query} set={setQuery} />
            </div>
            <div className={s.people}>
              {visible.map((student) => (
                <UnstyledButton
                  key={student.id}
                  className={s.person}
                  disabled={saving}
                  aria-pressed={student.id === current?.id}
                  onClick={() => choose(student)}
                  title={student.username}
                >
                  {studentName(student, lang, demo)}
                  {data.students.some((other) => other.id !== student.id && other.name === student.name) && (
                    <span className={s.accountHint}>{student.username}</span>
                  )}
                </UnstyledButton>
              ))}
              {!visible.length && (
                <p className={s.empty}>
                  {data.students.length
                    ? t('没有匹配的学生。', 'No matching students.')
                    : t('还没有学生账号。', 'No student accounts yet.')}
                </p>
              )}
            </div>
          </div>
          {current ? (
            <StudentGrants
              demo={demo}
              key={current.id}
              student={current}
              systems={data.systems}
              markDirty={setDirty}
              setSaving={setSaving}
            />
          ) : (
            <p className={s.empty}>
              {t('创建学生账号后，即可分配演示系统。', 'Create a student account to assign demo systems.')}
            </p>
          )}
        </div>
      )}
    </>
  )
}
