import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Check, CircleAlert, Search, X } from 'lucide-react'
import type { Student } from '../../shared/contract'
import { displayLabel, localizeMessage } from '../../shared/i18n'
import { useLanguage } from '../i18n'
import s from './Teacher.module.css'

export type Feedback = { text: string; en?: string; error?: boolean } | null
type Lang = 'zh-CN' | 'en'

export function systemName(item: { key: string; name: string }, lang: Lang) {
  return ['library', 'lab'].includes(item.key) ? displayLabel(item.name, lang) : item.name
}

export function studentName(student: Student, lang: Lang, demo: boolean) {
  const seeded =
    (student.username === 'student-a' && student.name === '学生 A') ||
    (student.username === 'student-b' && student.name === '学生 B')
  return student.fixedDemo || (!demo && seeded) ? displayLabel(student.name, lang) : student.name
}

export function message(error: unknown) {
  if (error instanceof Error && 'status' in error && error.status === 401 && typeof window !== 'undefined') {
    window.location.replace('/login')
    return '登录已失效或缺少该系统的访问权限。'
  }
  return error instanceof Error && error.message ? error.message : '服务暂时不可用，请稍后刷新。'
}

export function useRemote<T>(load: () => Promise<T>, refreshAction?: string) {
  const [data, setData] = useState<T | undefined>()
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const reload = useCallback(() => setRevision((value) => value + 1), [])
  useEffect(() => {
    if (!refreshAction) return
    const reconcile = (event: Event) => {
      if ((event as CustomEvent<{ action: string }>).detail?.action === refreshAction) reload()
    }
    window.addEventListener('classroom:refresh', reconcile)
    return () => window.removeEventListener('classroom:refresh', reconcile)
  }, [refreshAction, reload])
  useEffect(() => {
    let current = true
    setError('')
    load()
      .then((value) => {
        if (current) setData(value)
      })
      .catch((cause) => {
        if (current) setError(message(cause))
      })
    return () => {
      current = false
    }
  }, [load, revision])
  return { data, error, reload }
}

export function Notice({ feedback }: { feedback: Feedback }) {
  const { lang, t } = useLanguage()
  if (!feedback) return null
  const text = feedback.en ? t(feedback.text, feedback.en) : localizeMessage(feedback.text, lang)
  return (
    <p className={feedback.error ? s.error : s.notice} role={feedback.error ? 'alert' : 'status'}>
      {feedback.error ? <CircleAlert size={17} aria-hidden /> : <Check size={17} aria-hidden />}
      {text}
    </p>
  )
}

export function Loading({ error, retry }: { error: string; retry: () => void }) {
  const { t } = useLanguage()
  if (!error)
    return (
      <p className={s.empty} role="status">
        {t('正在加载…', 'Loading…')}
      </p>
    )
  return (
    <div>
      <Notice feedback={{ text: error, error: true }} />
      <button className={s.secondary} onClick={retry}>
        {t('重试', 'Try again')}
      </button>
    </div>
  )
}

export function SearchBox({ value, set, label }: { value: string; set: (v: string) => void; label: string }) {
  return (
    <label className={s.search}>
      <Search size={18} strokeWidth={1.7} aria-hidden />
      <input
        aria-label={label}
        type="search"
        value={value}
        onChange={(e) => set(e.target.value)}
        placeholder={label}
      />
    </label>
  )
}

export function matches(query: string, ...values: string[]) {
  const term = query.trim().toLocaleLowerCase()
  return values.some((value) => value.toLocaleLowerCase().includes(term))
}

export function Dialog({
  title,
  close,
  submit,
  submitLabel,
  canSubmit = true,
  children,
}: {
  title: string
  close: () => void
  submit: (values: FormData) => Promise<void>
  submitLabel: string
  canSubmit?: boolean
  children: ReactNode
}) {
  const { t } = useLanguage()
  const dialog = useRef<HTMLDialogElement>(null)
  const lock = useRef(false)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    const el = dialog.current
    el?.showModal()
    return () => el?.close()
  }, [])
  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (lock.current || !canSubmit) return
    const values = new FormData(e.currentTarget)
    lock.current = true
    setWorking(true)
    setError('')
    try {
      await submit(values)
      close()
    } catch (cause) {
      setError(message(cause))
    } finally {
      lock.current = false
      setWorking(false)
    }
  }
  return (
    <dialog
      ref={dialog}
      className={s.dialog}
      aria-labelledby="teacher-dialog-title"
      onCancel={(e) => {
        e.preventDefault()
        if (!working) close()
      }}
    >
      <div className={s.dialogHead}>
        <h2 id="teacher-dialog-title">{title}</h2>
        <button
          className={s.close}
          type="button"
          onClick={close}
          disabled={working}
          aria-label={t('关闭', 'Close')}
        >
          <X size={20} />
        </button>
      </div>
      <form onSubmit={onSubmit}>
        <div className={s.fields}>{children}</div>
        {error && <Notice feedback={{ text: error, error: true }} />}
        <div className={s.dialogActions}>
          <button type="button" className={s.secondary} disabled={working} onClick={close}>
            {t('取消', 'Cancel')}
          </button>
          <button className={s.primary} type="submit" disabled={working || !canSubmit}>
            {working ? t('提交中…', 'Submitting…') : submitLabel}
          </button>
        </div>
      </form>
    </dialog>
  )
}

export function textValue(values: FormData, key: string) {
  return String(values.get(key) ?? '').trim()
}
