import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Alert, Button, Group, Loader, Modal, Stack, Text, TextInput } from '@mantine/core'
import { Check, CircleAlert, Search } from 'lucide-react'
import type { Student } from '../../shared/contract'
import { displayLabel, localizeMessage } from '../../shared/i18n'
import { useLanguage } from '../i18n'
import s from './Teacher.module.css'

export type Feedback = { text: string; en?: string; error?: boolean } | null
type Lang = 'zh-CN' | 'en'

export function systemName(item: { key: string; name: string; nameEn?: string }, lang: Lang) {
  if (lang === 'en' && item.nameEn) return item.nameEn
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
    <Alert
      color={feedback.error ? 'red' : 'pine'}
      variant="light"
      role={feedback.error ? 'alert' : 'status'}
      icon={feedback.error ? <CircleAlert size={18} /> : <Check size={18} />}
      className={s.notice}
    >
      {text}
    </Alert>
  )
}

export function Loading({ error, retry }: { error: string; retry: () => void }) {
  const { t } = useLanguage()
  if (!error) return (
    <Group className={s.empty} role="status" gap="sm">
      <Loader size="sm" /><Text size="sm">{t('正在加载…', 'Loading…')}</Text>
    </Group>
  )
  return (
    <Stack gap="sm" align="flex-start">
      <Notice feedback={{ text: error, error: true }} />
      <Button variant="outline" onClick={retry}>{t('重试', 'Try again')}</Button>
    </Stack>
  )
}

export function SearchBox({ value, set, label }: { value: string; set: (v: string) => void; label: string }) {
  return (
    <TextInput
      className={s.search}
      type="search"
      aria-label={label}
      placeholder={label}
      value={value}
      onChange={event => set(event.currentTarget.value)}
      leftSection={<Search size={18} strokeWidth={1.7} aria-hidden />}
    />
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
  const lock = useRef(false)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const [focusOrigin] = useState(() => ({
    element: typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
      ? document.activeElement : null,
    url: typeof window !== 'undefined' ? window.location.href : '',
  }))
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      // These dialogs unmount on close, so Mantine never receives opened=false.
      queueMicrotask(() => {
        const target = focusOrigin.element
        if (mounted.current || !target?.isConnected || window.location.href !== focusOrigin.url ||
          target.matches(':disabled, [aria-disabled="true"]') ||
          target.closest('[inert]') || target.getClientRects().length === 0) return
        const active = document.activeElement
        if (active && active !== document.body && active !== document.documentElement &&
          active !== target && active.isConnected) return
        target.focus({ preventScroll: true })
      })
    }
  }, [focusOrigin])
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
    <Modal
      opened
      centered
      returnFocus={false}
      title={title}
      onClose={() => { if (!working) close() }}
      closeOnClickOutside={false}
      closeOnEscape={!working}
      closeButtonProps={{ disabled: working, 'aria-label': t('关闭', 'Close') }}
      classNames={{ content: s.modalContent, header: s.modalHeader, title: s.modalTitle }}
      size="md"
    >
      <form onSubmit={onSubmit}>
        <Stack gap="md">{children}</Stack>
        {error && <Notice feedback={{ text: error, error: true }} />}
        <Group justify="flex-end" mt="lg" gap="sm">
          <Button variant="default" type="button" onClick={close} disabled={working}>
            {t('取消', 'Cancel')}
          </Button>
          <Button type="submit" loading={working} disabled={working || !canSubmit}>
            {working ? t('提交中…', 'Submitting…') : submitLabel}
          </Button>
        </Group>
      </form>
    </Modal>
  )
}

export function textValue(values: FormData, key: string) {
  return String(values.get(key) ?? '').trim()
}
