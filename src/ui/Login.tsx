'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Alert, Button, Paper, PasswordInput, Stack, TextInput, Title } from '@mantine/core'
import { ArrowLeft } from 'lucide-react'
import type { User } from '../shared/contract'
import { localizeMessage } from '../shared/i18n'
import { read, write } from './client'
import { LanguageSwitch, useLanguage } from './i18n'
import { ThemeSwitch } from './StudioAppearance'
import { Brand, errorText } from './student/Chrome'
import s from './Login.module.css'

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
        <Brand teacher={teacher} href={teacher ? '/login' : '/'} className={s.brand} />
        <div className={s.headerLinks}>
          <LanguageSwitch />
          <ThemeSwitch />
          {!teacher && (
            <Button component="a" href="/" variant="subtle" size="compact-sm" leftSection={<ArrowLeft size={15} aria-hidden />}>
              {t('返回首页', 'Home')}
            </Button>
          )}
        </div>
      </header>
      <div className={s.center}>
        <Paper className={s.loginForm} withBorder>
          <Title order={1} className={s.title}>{teacher ? t('教师登录', 'Teacher sign-in') : t('学生登录', 'Student sign-in')}</Title>
          <form onSubmit={submit}>
            <Stack gap="md">
              <TextInput
                label={t('账号', 'Username')}
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                name="username"
                value={username}
                required
                withAsterisk={false}
                size="md"
                onInvalid={(event) => event.currentTarget.setCustomValidity(t('请输入账号。', 'Enter your username.'))}
                onChange={(event) => {
                  event.currentTarget.setCustomValidity('')
                  setUsername(event.target.value)
                }}
              />
              <PasswordInput
                label={t('密码', 'Password')}
                visibilityToggleButtonProps={{ 'aria-label': t('切换密码可见性', 'Toggle password visibility') }}
                autoComplete="current-password"
                name="password"
                value={password}
                required
                withAsterisk={false}
                size="md"
                onInvalid={(event) => event.currentTarget.setCustomValidity(t('请输入密码。', 'Enter your password.'))}
                onChange={(event) => {
                  event.currentTarget.setCustomValidity('')
                  setPassword(event.target.value)
                }}
              />
              {error && <Alert color="red" role="alert">{localizeMessage(error, lang)}</Alert>}
              <Button type="submit" size="md" disabled={pending !== null} loading={pending === 'password'}>
                {pending === 'password' ? t('登录中…', 'Signing in…') : t('登录', 'Sign in')}
              </Button>
            </Stack>
            <fieldset className={s.exampleAccounts} disabled={pending !== null}>
              <legend>{t('使用示例账号', 'Try a demo account')}</legend>
              <div className={s.exampleChoices}>
                {([1, 2] as const).map((slot) => {
                  const letter = slot === 1 ? 'A' : 'B'
                  const label = teacher ? t('示例教师 ', 'Demo teacher ') : t('示例学生 ', 'Demo student ')
                  return (
                    <Button key={slot} type="button" variant="outline" size="sm" loading={pending === slot}
                      disabled={pending !== null} onClick={() => void signIn(slot)}>
                      {pending === slot ? t('登录中…', 'Signing in…') : label + letter}
                    </Button>
                  )
                })}
              </div>
            </fieldset>
          </form>
        </Paper>
      </div>
    </main>
  )
}
