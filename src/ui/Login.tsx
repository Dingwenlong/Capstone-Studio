'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { User } from '../shared/contract'
import { localizeMessage } from '../shared/i18n'
import { read, write } from './client'
import { LanguageSwitch, useLanguage } from './i18n'
import { Brand, errorText } from './student/Chrome'
import s from './student/student.module.css'

export default function Login({ teacher }: { teacher: boolean }) {
  const { t, lang } = useLanguage()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState<'password' | 1 | 2 | null>(null)
  const [error, setError] = useState('')
  const submitting = useRef(false)
  const destination = teacher ? '/admin/students' : '/workspace'

  useEffect(() => {
    let current = true
    const check = () =>
      read<User | null>('session')
        .then((user) => {
          if (current && user?.role === (teacher ? 'teacher' : 'student'))
            window.location.replace(destination)
        })
        .catch(() => {})
    void check()
    window.addEventListener('classroom:refresh', check)
    return () => {
      current = false
      window.removeEventListener('classroom:refresh', check)
    }
  }, [destination, teacher])

  async function signIn(method: 'password' | 1 | 2) {
    if (submitting.current) return
    submitting.current = true
    setPending(method)
    setError('')
    try {
      if (method === 'password') await write('login', { username: username.trim(), password })
      else await write('demoLogin', { slot: method })
      window.location.replace(destination)
    } catch (reason) {
      setError(errorText(reason))
      submitting.current = false
      setPending(null)
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void signIn('password')
  }

  return (
    <main className={s.login}>
      <header className={s.topbar}>
        <Brand teacher={teacher} />
        <div className={s.headerLinks}>
          <LanguageSwitch />
          {!teacher && <a className={s.topLink} href="/">{t('返回首页', 'Home')}</a>}
        </div>
      </header>
      <form onSubmit={submit} className={s.loginForm}>
        <h1>{teacher ? t('教师登录', 'Teacher sign-in') : t('学生登录', 'Student sign-in')}</h1>
        <label className={s.field}>
          {t('账号', 'Username')}
          <input
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            name="username"
            value={username}
            required
            onInvalid={(e) => e.currentTarget.setCustomValidity(t('请输入账号。', 'Enter your username.'))}
            onChange={(e) => { e.currentTarget.setCustomValidity(''); setUsername(e.target.value) }}
          />
        </label>
        <label className={s.field}>
          {t('密码', 'Password')}
          <input
            type="password"
            autoComplete="current-password"
            name="password"
            value={password}
            required
            onInvalid={(e) => e.currentTarget.setCustomValidity(t('请输入密码。', 'Enter your password.'))}
            onChange={(e) => { e.currentTarget.setCustomValidity(''); setPassword(e.target.value) }}
          />
        </label>
        {error && (
          <p className={s.failure} role="alert">
            {localizeMessage(error, lang)}
          </p>
        )}
        <button type="submit" className={s.primary} disabled={pending !== null}>
          {pending === 'password' ? t('登录中…', 'Signing in…') : t('登录', 'Sign in')}
        </button>
        <fieldset className={s.exampleAccounts} disabled={pending !== null}>
          <legend>{t('使用示例账号', 'Try a demo account')}</legend>
          <div className={s.exampleChoices}>
            {([1, 2] as const).map((slot) => {
              const letter = slot === 1 ? 'A' : 'B'
              const label = teacher ? t('示例教师 ', 'Demo teacher ') : t('示例学生 ', 'Demo student ')
              return <button key={slot} type="button" onClick={() => void signIn(slot)}>
                {pending === slot ? t('登录中…', 'Signing in…') : label + letter}
              </button>
            })}
          </div>
        </fieldset>
      </form>
    </main>
  )
}
