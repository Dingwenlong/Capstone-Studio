import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { defaultLanguage, languageCookie, languageFromCookie, type Language } from '../shared/i18n'
import styles from './language.module.css'

const LanguageContext = createContext<{
  lang: Language
  setLanguage: (language: Language) => void
  t: (chinese: string, english: string) => string
} | null>(null)

export function LanguageProvider({
  initialLanguage = defaultLanguage,
  children,
}: {
  initialLanguage?: Language
  children: ReactNode
}) {
  const [lang, update] = useState(initialLanguage)
  const setLanguage = useCallback((next: Language) => {
    const domain = window.location.hostname.split('.').slice(1).join('.')
    const secure = window.location.protocol === 'https:' ? '; Secure' : ''
    document.cookie =
      languageCookie +
      '=' +
      next +
      '; Path=/; Max-Age=31536000; SameSite=Lax' +
      (domain ? '; Domain=' + domain : '') +
      secure
    update(next)
  }, [])
  useEffect(() => {
    const sync = () => update(languageFromCookie(document.cookie))
    sync()
    window.addEventListener('focus', sync)
    document.addEventListener('visibilitychange', sync)
    const cookieChanges = window.cookieStore
    cookieChanges?.addEventListener('change', sync)
    // Older browsers do not notify another origin when a domain cookie changes.
    const timer = !cookieChanges ? window.setInterval(sync, 900) : undefined
    return () => {
      window.removeEventListener('focus', sync)
      document.removeEventListener('visibilitychange', sync)
      cookieChanges?.removeEventListener('change', sync)
      window.clearInterval(timer)
    }
  }, [])
  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])
  const value = useMemo(
    () => ({ lang, setLanguage, t: (zh: string, en: string) => (lang === 'en' ? en : zh) }),
    [lang, setLanguage],
  )
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}
export function useLanguage() {
  const context = useContext(LanguageContext)
  if (!context) throw new Error('Missing language provider')
  return context
}
export function LanguageSwitch({ className }: { className?: string }) {
  const { lang, setLanguage, t } = useLanguage()
  return (
    <div
      role="group"
      aria-label={t('界面语言', 'Interface language')}
      className={[styles.switcher, className].filter(Boolean).join(' ')}
    >
      <button type="button" lang="zh-CN" aria-pressed={lang === 'zh-CN'} onClick={() => setLanguage('zh-CN')}>
        简体中文
      </button>
      <span aria-hidden="true">/</span>
      <button type="button" lang="en" aria-pressed={lang === 'en'} onClick={() => setLanguage('en')}>
        English
      </button>
    </div>
  )
}
