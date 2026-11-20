import { useEffect, useState } from 'react'
import Head from 'next/head'
import { Box, Button, Group, NavLink } from '@mantine/core'
import { ClipboardList, GraduationCap, KeyRound, LogOut, Monitor, Users } from 'lucide-react'
import type { User } from '../../shared/contract'
import { displayLabel } from '../../shared/i18n'
import { read, write } from '../client'
import { LanguageSwitch, useLanguage } from '../i18n'
import { ThemeSwitch } from '../StudioAppearance'
import Audit from './Audit'
import Grants from './Grants'
import Students from './Students'
import Systems from './Systems'
import { message, Notice, type Feedback } from './common'
import s from './Teacher.module.css'

const sections = [
  { id: 'students', label: '学生账号', en: 'Student accounts', Icon: Users, Page: Students },
  { id: 'systems', label: '演示系统', en: 'Demo systems', Icon: Monitor, Page: Systems },
  { id: 'grants', label: '系统授权', en: 'System access', Icon: KeyRound, Page: Grants },
  { id: 'audit', label: '操作记录', en: 'Activity log', Icon: ClipboardList, Page: Audit },
]

export default function Admin({ section }: { section: string }) {
  const { t, lang } = useLanguage()
  const entry = sections.find((item) => item.id === section) ?? sections[0]
  const [leaving, setLeaving] = useState(false)
  const [teacher, setTeacher] = useState<User | null>(null)
  const [feedback, setFeedback] = useState<Feedback>(null)
  useEffect(() => {
    let current = true
    let checking = false
    const validate = async () => {
      if (checking) return
      checking = true
      try {
        const user = await read<User | null>('session')
        if (!current) return
        if (user?.role === 'teacher') {
          setTeacher(user)
          setFeedback(null)
        } else window.location.replace('/login')
      } catch (cause) {
        if (current) setFeedback({ text: message(cause), error: true })
      } finally {
        checking = false
      }
    }
    // Returning to an old tab or a restored document must re-check its teacher session.
    const restore = (event: PageTransitionEvent) => {
      if (event.persisted) void validate()
    }
    const foreground = () => {
      if (!document.hidden) void validate()
    }
    window.addEventListener('pageshow', restore)
    document.addEventListener('visibilitychange', foreground)
    window.addEventListener('focus', validate)
    void validate()
    return () => {
      current = false
      window.removeEventListener('pageshow', restore)
      document.removeEventListener('visibilitychange', foreground)
      window.removeEventListener('focus', validate)
    }
  }, [])
  async function logout() {
    setLeaving(true)
    setFeedback(null)
    try {
      await write('logout', {})
      window.location.assign('/login')
    } catch (cause) {
      setFeedback({ text: message(cause), error: true })
      setLeaving(false)
    }
  }
  return (
    <Box className={s.shell} lang={lang}>
      <Head>
        <title>
          {t(entry.label, entry.en)} · {t('教学管理', 'Teacher admin')}
        </title>
      </Head>
      <header className={s.header}>
        <div className={s.brand}>
          <GraduationCap size={34} strokeWidth={1.7} aria-hidden />
          {t('教学管理', 'Teacher admin')}
        </div>
        <Group gap="lg" className={s.headerTools}>
          <LanguageSwitch className={s.languageSwitch} />
          <ThemeSwitch />
          <Button
            className={s.logout}
            variant="subtle"
            type="button"
            onClick={logout}
            disabled={leaving}
            leftSection={<LogOut size={20} strokeWidth={1.7} aria-hidden />}
          >
            {leaving ? t('退出中…', 'Signing out…') : t('退出', 'Sign out')}
          </Button>
        </Group>
      </header>
      <aside className={s.rail}>
        <nav className={s.nav} aria-label={t('教师管理', 'Teacher navigation')}>
          {sections.map(({ id, label, en, Icon }) => (
            <NavLink
              key={id}
              component="a"
              className={s.navLink}
              href={`/admin/${id}`}
              active={entry.id === id}
              aria-current={entry.id === id ? 'page' : undefined}
              label={t(label, en)}
              leftSection={<Icon size={21} strokeWidth={1.7} aria-hidden />}
              variant="light"
            />
          ))}
        </nav>
      </aside>
      <main className={s.main}>
        {teacher?.demo && (
          <div className={s.demoContext} role="note">
            <strong>{displayLabel(teacher.name, lang)}</strong>
            <span>
              {t('示例账号共用这里的演示数据。', 'Demo accounts share the data in this workspace.')}
            </span>
          </div>
        )}
        <Notice feedback={feedback} />
        {teacher ? (
          <entry.Page
            key={entry.id + ':' + teacher.id + ':' + Boolean(teacher.demo)}
            demo={teacher.demo === true}
          />
        ) : feedback ? (
          <Button variant="outline" onClick={() => window.location.reload()}>
            {t('重试', 'Try again')}
          </Button>
        ) : (
          <p role="status" className={s.empty}>
            {t('正在加载…', 'Loading…')}
          </p>
        )}
      </main>
    </Box>
  )
}
