import { useEffect, useState } from 'react'
import Head from 'next/head'
import { List, LogOut, PanelsTopLeft, ShieldCheck, UserRound } from 'lucide-react'
import type { User } from '../../shared/contract'
import { displayLabel } from '../../shared/i18n'
import { read, write } from '../client'
import { LanguageSwitch, useLanguage } from '../i18n'
import Audit from './Audit'
import Grants from './Grants'
import Students from './Students'
import Systems from './Systems'
import { message, Notice, type Feedback } from './common'
import s from './Teacher.module.css'

const sections = [
  { id: 'students', label: '学生账号', en: 'Student accounts', Icon: UserRound, Page: Students },
  { id: 'systems', label: '演示系统', en: 'Demo systems', Icon: PanelsTopLeft, Page: Systems },
  { id: 'grants', label: '系统授权', en: 'System access', Icon: ShieldCheck, Page: Grants },
  { id: 'audit', label: '操作记录', en: 'Activity log', Icon: List, Page: Audit },
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
    <div className={s.shell} lang={lang}>
      <Head>
        <title>
          {t(entry.label, entry.en)} · {t('教学管理', 'Teacher admin')}
        </title>
      </Head>
      <aside className={s.rail}>
        <div className={s.brand}>
          <span className={s.mark} aria-hidden />
          {t('教学管理', 'Teacher admin')}
        </div>
        <nav className={s.nav} aria-label={t('教师管理', 'Teacher navigation')}>
          {sections.map(({ id, label, en, Icon }) => (
            <a
              key={id}
              className={s.navLink}
              href={`/admin/${id}`}
              aria-current={entry.id === id ? 'page' : undefined}
            >
              <Icon className={s.navIcon} strokeWidth={1.7} aria-hidden />
              {t(label, en)}
            </a>
          ))}
        </nav>
        <div className={s.accountTools}>
          <LanguageSwitch className={s.languageSwitch} />
          <button className={s.logout} type="button" onClick={logout} disabled={leaving}>
            <LogOut className={s.navIcon} strokeWidth={1.7} aria-hidden />
            {leaving ? t('退出中…', 'Signing out…') : t('退出', 'Sign out')}
          </button>
        </div>
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
          <button className={s.secondary} onClick={() => window.location.reload()}>
            {t('重试', 'Try again')}
          </button>
        ) : (
          <p role="status" className={s.empty}>
            {t('正在加载…', 'Loading…')}
          </p>
        )}
      </main>
    </div>
  )
}
