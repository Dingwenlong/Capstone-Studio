'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Launch, SystemInfo, User } from '../../shared/contract'
import { displayLabel, localizeMessage, type Language } from '../../shared/i18n'
import { read, write } from '../client'
import { LanguageSwitch, useLanguage } from '../i18n'
import { Brand, errorText, Icon } from './Chrome'
import s from './student.module.css'
export { Demo } from './Demo'

function systemName(system: SystemInfo, lang: Language) {
  return system.key === 'library' || system.key === 'lab' ? displayLabel(system.name, lang) : system.name
}

export function Landing() {
  const { t } = useLanguage()
  const [signedIn, setSignedIn] = useState(false)
  useEffect(() => {
    let active = true
    read<User | null>('session')
      .then((user) => {
        if (active) setSignedIn(user?.role === 'student')
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [])
  const href = signedIn ? '/workspace' : '/login'
  return (
    <main className={s.landing}>
      <header className={s.topbar}>
        <Brand />
        <div className={s.headerLinks}>
          <LanguageSwitch />
          <a className={s.topLink} href={href}>
            {signedIn ? t('工作台', 'Workspace') : t('登录', 'Sign in')}
          </a>
        </div>
      </header>
      <div className={s.heroCopy}>
        <h1>{t('毕业设计演示空间', 'Capstone Demo Studio')}</h1>
        <p>{t('登录后，打开老师为你分配的参考系统。', 'Sign in to explore the systems your teacher has shared with you.')}</p>
        <a className={s.primaryLink} href={href}>
          {t('进入工作台', 'Open workspace')}
          <Icon name="arrow" size={23} />
        </a>
      </div>
    </main>
  )
}

function LaunchFrame({ info, visible }: { info: SystemInfo; visible: boolean }) {
  const { t, lang } = useLanguage()
  const name = systemName(info, lang)
  const frame = useRef<HTMLIFrameElement>(null)
  // The browser assigns the browsing context's name when it creates the iframe.
  const [frameName] = useState(() => 'classroom-' + crypto.randomUUID())
  const [attempt, setAttempt] = useState(0)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const iframe = frame.current
    if (!iframe) return
    let live = true
    let submitted = false
    let origin = ''
    setLoading(true)
    setError('')
    function loaded() {
      if (!submitted) return
      window.clearTimeout(timer)
      setLoading(false)
    }
    function message(event: MessageEvent) {
      if (
        event.source === iframe?.contentWindow &&
        event.origin === origin &&
        event.data?.type === 'classroom:unavailable'
      ) {
        setError('系统暂时无法访问，请刷新授权后重试。')
      }
    }
    const timer = window.setTimeout(() => {
      setError('系统响应超时，请稍后重试。')
      setLoading(false)
    }, 20000)
    iframe.addEventListener('load', loaded)
    window.addEventListener('message', message)
    write<Launch>('launch', { systemKey: info.key })
      .then(({ url, ticket }) => {
        if (!live) return
        origin = new URL(url, window.location.href).origin
        const form = document.createElement('form')
        const field = document.createElement('input')
        form.method = 'post'
        form.action = url
        form.target = frameName
        field.type = 'hidden'
        field.name = 'ticket'
        field.value = ticket
        form.append(field)
        document.body.append(form)
        submitted = true
        try {
          form.submit()
        } finally {
          form.remove()
        }
      })
      .catch((reason) => {
        if (!live) return
        window.clearTimeout(timer)
        setLoading(false)
        setError(errorText(reason))
      })
    return () => {
      live = false
      window.clearTimeout(timer)
      iframe.removeEventListener('load', loaded)
      window.removeEventListener('message', message)
    }
  }, [info.key, attempt, frameName])

  return (
    <section style={{ height: '100%', position: 'relative' }} hidden={!visible} aria-label={name}>
      {error ? (
        <div className={s.blank} role="status">
          <h2>{t('系统暂不可用', 'System unavailable')}</h2>
          <p>{localizeMessage(error, lang)}</p>
          <button
            className={s.darkButton}
            onClick={() => {
              setError('')
              setAttempt((count) => count + 1)
            }}
          >
            {t('重新打开', 'Reopen system')}
          </button>
        </div>
      ) : null}
      {loading && !error && (
        <div
          role="status"
          className={s.blank}
          style={{ position: 'absolute', inset: 0, background: '#f9fafb' }}
        >
          {t('正在打开' + name + '…', 'Opening ' + name + '…')}
        </div>
      )}
      <iframe
        title={name}
        name={frameName}
        className={s.frame}
        hidden={!!error}
        ref={frame}
        referrerPolicy="no-referrer"
        sandbox="allow-scripts allow-forms allow-same-origin"
        allow="fullscreen"
      />
    </section>
  )
}

type Tabs = { open: string[]; active: string; visited: string[] }
const emptyTabs: Tabs = { open: [], active: '', visited: [] }

export function Workspace() {
  const { t, lang } = useLanguage()
  const [user, setUser] = useState<User | null>(null)
  const [systems, setSystems] = useState<SystemInfo[]>([])
  const [tabs, setTabs] = useState<Tabs>(emptyTabs)
  const [collapsed, setCollapsed] = useState(false)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const [full, setFull] = useState(false)
  const [exiting, setExiting] = useState(false)
  const desk = useRef<HTMLDivElement>(null)
  const previousUser = useRef<string | null>(null)
  const refreshSeq = useRef(0)
  const activeRead = useRef(0)

  const refresh = useCallback(async () => {
    if (activeRead.current && activeRead.current === refreshSeq.current) return
    const seq = ++refreshSeq.current
    activeRead.current = seq
    try {
      const session = await read<User | null>('session')
      if (seq !== refreshSeq.current) return
      if (!session || session.role !== 'student') {
        setTabs(emptyTabs)
        setUser(null)
        window.location.replace('/login')
        return
      }
      const changedAccount = previousUser.current !== session.id
      if (changedAccount) {
        setTabs(emptyTabs)
        setSystems([])
        setReady(false)
      }
      const list = (await read<SystemInfo[]>('systems')).filter((system) => system.enabled)
      if (seq !== refreshSeq.current) return
      const allowed = new Set(list.map((system) => system.key))
      setTabs((old) => {
        const open = changedAccount
          ? list.slice(0, 2).map((item) => item.key)
          : old.open.filter((key) => allowed.has(key))
        const active = open.includes(old.active) ? old.active : (open[0] ?? '')
        const visited = changedAccount ? [] : old.visited.filter((key) => open.includes(key))
        if (active && !visited.includes(active)) visited.push(active)
        return { open, active, visited }
      })
      previousUser.current = session.id
      setUser(session)
      setSystems(list)
      setError('')
      setReady(true)
    } catch (reason) {
      if (seq === refreshSeq.current) setError(errorText(reason))
    } finally {
      if (activeRead.current === seq) activeRead.current = 0
    }
  }, [])

  useEffect(() => {
    const media = window.matchMedia('(max-width:650px)')
    const resize = () => setCollapsed(media.matches)
    resize()
    media.addEventListener('change', resize)
    const wake = () => {
      if (!document.hidden) void refresh()
    }
    const syncFull = () => setFull(!!document.fullscreenElement)
    const escaped = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.fullscreenElement) setFull(false)
    }
    window.addEventListener('focus', wake)
    window.addEventListener('classroom:refresh', wake)
    window.addEventListener('keydown', escaped)
    document.addEventListener('visibilitychange', wake)
    document.addEventListener('fullscreenchange', syncFull)
    const timer = window.setInterval(wake, 15000)
    void refresh()
    return () => {
      ++refreshSeq.current
      media.removeEventListener('change', resize)
      window.clearInterval(timer)
      window.removeEventListener('focus', wake)
      window.removeEventListener('classroom:refresh', wake)
      window.removeEventListener('keydown', escaped)
      document.removeEventListener('visibilitychange', wake)
      document.removeEventListener('fullscreenchange', syncFull)
    }
  }, [refresh])

  function select(key: string) {
    setTabs((old) => ({
      open: old.open.includes(key) ? old.open : [...old.open, key],
      visited: old.visited.includes(key) ? old.visited : [...old.visited, key],
      active: key,
    }))
    if (window.matchMedia('(max-width:650px)').matches) setCollapsed(true)
  }

  function close(key: string) {
    setTabs((old) => {
      const index = old.open.indexOf(key)
      const open = old.open.filter((item) => item !== key)
      const active = old.active === key ? (open[Math.min(index, open.length - 1)] ?? '') : old.active
      const visited = old.visited.filter((item) => item !== key)
      if (active && !visited.includes(active)) visited.push(active)
      return { open, active, visited }
    })
  }

  async function fullscreen() {
    if (document.fullscreenElement) await document.exitFullscreen()
    else if (full) setFull(false)
    else {
      try {
        if (!desk.current?.requestFullscreen) {
          setFull(true)
          return
        }
        await desk.current.requestFullscreen()
      } catch {
        setFull(true)
      }
    }
  }
  async function logout() {
    if (exiting) return
    setExiting(true)
    try {
      await write('logout', {})
      setTabs(emptyTabs)
      window.location.replace('/login')
    } catch (reason) {
      setError(errorText(reason))
      setExiting(false)
    }
  }

  const nameOf = (key: string) => {
    const system = systems.find((item) => item.key === key)
    return system ? systemName(system, lang) : key
  }
  const accountName = user && ['student-a', 'student-b', 'demo-student-a', 'demo-student-b'].includes(user.username)
    ? displayLabel(user.name, lang) : user?.name
  return (
    <main className={s.work}>
      <header className={s.workHeader}>
        <Brand />
        <div className={s.account}>
          <span className={s.accountName}>{accountName}</span>
          <LanguageSwitch />
          <button onClick={logout} disabled={exiting}>
            {exiting ? t('退出中…', 'Signing out…') : t('退出', 'Sign out')}
          </button>
        </div>
      </header>
      <div className={s.workBody} data-collapsed={collapsed}>
        <aside className={s.side} aria-label={t('我的系统', 'My systems')}>
          <button
            className={s.sideHeading}
            onClick={() => setCollapsed(!collapsed)}
            aria-expanded={!collapsed}
            aria-label={collapsed ? t('展开系统列表', 'Expand system list') : t('收起系统列表', 'Collapse system list')}
            title={collapsed ? t('展开系统列表', 'Expand system list') : t('收起系统列表', 'Collapse system list')}
          >
            {!collapsed && <span>{t('我的系统', 'My systems')}</span>}
            <Icon name={collapsed ? 'panel' : 'chevron'} size={19} />
          </button>
          <nav>
            {systems.map((system) => (
              <button
                key={system.key}
                className={s.sideItem}
                title={systemName(system, lang)}
                aria-label={systemName(system, lang)}
                aria-current={tabs.active === system.key}
                onClick={() => select(system.key)}
              >
                <Icon
                  name={system.key === 'library' ? 'book' : system.key === 'lab' ? 'calendar' : 'grid'}
                  size={22}
                />
                {!collapsed && <span>{systemName(system, lang)}</span>}
              </button>
            ))}
          </nav>
        </aside>
        <div
          className={s.desk}
          ref={desk}
          style={full ? { position: 'fixed', inset: 0, zIndex: 5, background: '#f9fafb' } : undefined}
        >
          <div className={s.tabsLine}>
            <button
              className={s.iconBtn + ' ' + s.mobileMenu}
              onClick={() => setCollapsed(!collapsed)}
              aria-expanded={!collapsed}
              aria-label={t('系统列表', 'System list')}
            >
              <Icon name="panel" />
            </button>
            <div className={s.tabStrip} aria-label={t('已打开的系统', 'Open systems')}>
              {tabs.open.map((key) => (
                <div className={s.tabUnit} key={key} data-active={tabs.active === key}>
                  <button className={s.tabBtn} aria-pressed={tabs.active === key} onClick={() => select(key)}>
                    {nameOf(key)}
                  </button>
                  <button className={s.tabClose} aria-label={t('关闭', 'Close ') + nameOf(key)} onClick={() => close(key)}>
                    <Icon name="close" size={15} />
                  </button>
                </div>
              ))}
            </div>
            <button
              className={s.iconBtn}
              onClick={fullscreen}
              aria-label={full ? t('退出全屏', 'Exit full screen') : t('全屏显示', 'Full screen')}
              title={full ? t('退出全屏', 'Exit full screen') : t('全屏显示', 'Full screen')}
            >
              <Icon name={full ? 'shrink' : 'expand'} size={22} />
            </button>
          </div>
          <div className={s.frameStage}>
            {error ? (
              <div className={s.blank}>
                <h2>{t('工作台连接异常', 'Workspace connection lost')}</h2>
                <p role="alert">{localizeMessage(error, lang)}</p>
                <button className={s.darkButton} onClick={refresh}>
                  {t('重新连接', 'Reconnect')}
                </button>
              </div>
            ) : !ready ? (
              <div className={s.blank} role="status">
                {t('正在载入工作台…', 'Loading workspace…')}
              </div>
            ) : !tabs.active ? (
              <div className={s.blank}>
                <h2>{systems.length ? t('选择要查看的系统', 'Choose a system') : t('暂无已分配的系统', 'No systems assigned yet')}</h2>
                <p>{systems.length ? t('从我的系统中打开一个演示。', 'Open a demo from My systems.') : t('老师完成分配后，系统会显示在这里。', 'Systems will appear here when your teacher assigns them.')}</p>
              </div>
            ) : (
              systems
                .filter((system) => tabs.visited.includes(system.key))
                .map((system) => (
                  <LaunchFrame
                    key={user?.id + ':' + system.key}
                    info={system}
                    visible={system.key === tabs.active}
                  />
                ))
            )}
          </div>
        </div>
      </div>
    </main>
  )
}
