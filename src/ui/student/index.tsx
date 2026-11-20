'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ActionIcon, Box, Button, Group, Loader, NavLink, Text, UnstyledButton } from '@mantine/core'
import { BookOpen, CalendarDays, LayoutGrid, LogOut, Maximize, Minimize, PanelLeftClose, PanelLeftOpen, X } from 'lucide-react'
import type { SystemInfo, User } from '../../shared/contract'
import { displayLabel, localizeMessage } from '../../shared/i18n'
import { read, write } from '../client'
import { LanguageSwitch, useLanguage } from '../i18n'
import { ThemeSwitch } from '../StudioAppearance'
import { Brand, errorText, Icon } from './Chrome'
import Gallery, { galleryName } from '../gallery/Gallery'
import s from './student.module.css'
import w from './Workspace.module.css'
export { Demo } from './Demo'

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
          <ThemeSwitch />
          <Button component="a" variant="subtle" className={w.landingLogin} href={href}>
            {signedIn ? t('工作台', 'Workspace') : t('登录', 'Sign in')}
          </Button>
        </div>
      </header>
      <div className={s.heroCopy}>
        <h1>{t('毕业设计演示空间', 'Capstone Demo Studio')}</h1>
        <p>{t('登录后，浏览老师为你分配的项目截图。', 'Sign in to explore the project screenshots your teacher has shared with you.')}</p>
        <Button component="a" className={w.landingButton} href={href} rightSection={<Icon name="arrow" size={23} />}>
          {t('进入工作台', 'Open workspace')}
        </Button>
      </div>
    </main>
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
    return system ? galleryName(system, lang) : key
  }
  const accountName = user && ['student-a', 'student-b', 'demo-student-a', 'demo-student-b'].includes(user.username)
    ? displayLabel(user.name, lang) : user?.name
  return (
    <Box component="main" className={w.workspace}>
      <header className={w.header}>
        <Brand />
        <Group className={w.headerActions} gap="md" wrap="nowrap">
          <LanguageSwitch />
          <ThemeSwitch />
          <Button variant="subtle" className={w.signOut} leftSection={<LogOut size={20} strokeWidth={1.7} aria-hidden />}
            onClick={logout} disabled={exiting}>
            {exiting ? t('退出中…', 'Signing out…') : t('退出', 'Sign out')}
          </Button>
        </Group>
      </header>
      <div className={w.body} data-collapsed={collapsed}>
        <aside className={w.sidebar} aria-label={t('我的系统', 'My systems')}>
          <div className={w.sideHeading}>
            {!collapsed && <Text className={w.sideTitle}>{t('我的系统', 'Your systems')}</Text>}
            <ActionIcon variant="subtle" className={w.iconButton} onClick={() => setCollapsed(!collapsed)}
              aria-expanded={!collapsed}
              aria-label={collapsed ? t('展开系统列表', 'Expand system list') : t('收起系统列表', 'Collapse system list')}
              title={collapsed ? t('展开系统列表', 'Expand system list') : t('收起系统列表', 'Collapse system list')}>
              {collapsed ? <PanelLeftOpen size={18} aria-hidden /> : <PanelLeftClose size={18} aria-hidden />}
            </ActionIcon>
          </div>
          <nav className={w.navigation}>
            {systems.map((system) => {
              const SystemIcon = system.key === 'library' ? BookOpen : system.key === 'lab' ? CalendarDays : LayoutGrid
              return (
                <NavLink component="button" type="button" key={system.key}
                  label={collapsed ? undefined : galleryName(system, lang)}
                  leftSection={<SystemIcon size={22} strokeWidth={1.65} aria-hidden />}
                  classNames={{ root: w.navLink, label: w.navLabel, section: w.navSection, body: w.navBody }}
                  title={galleryName(system, lang)} aria-label={galleryName(system, lang)}
                  active={tabs.active === system.key} aria-current={tabs.active === system.key}
                  onClick={() => select(system.key)} />
              )
            })}
          </nav>
          {!collapsed && accountName && <Text className={w.accountName}>{accountName}</Text>}
        </aside>
        <div className={w.desk} ref={desk} data-fullscreen={full}>
          <div className={w.tabLine}>
            <ActionIcon variant="subtle" className={w.iconButton + ' ' + w.mobileMenu}
              onClick={() => setCollapsed(!collapsed)} aria-expanded={!collapsed}
              aria-label={t('系统列表', 'System list')}>
              <PanelLeftOpen size={21} aria-hidden />
            </ActionIcon>
            <div className={w.tabs} aria-label={t('已打开的系统', 'Open systems')}>
              {tabs.open.map((key) => (
                <div className={w.tab} key={key} data-active={tabs.active === key}>
                  <UnstyledButton className={w.tabLabel} aria-pressed={tabs.active === key} onClick={() => select(key)}>
                    {nameOf(key)}
                  </UnstyledButton>
                  <ActionIcon variant="subtle" size={25} className={w.closeTab}
                    aria-label={t('关闭', 'Close ') + nameOf(key)} onClick={() => close(key)}>
                    <X size={14} aria-hidden />
                  </ActionIcon>
                </div>
              ))}
            </div>
            <ActionIcon variant="subtle" className={w.iconButton} onClick={fullscreen}
              aria-label={full ? t('退出全屏', 'Exit full screen') : t('全屏显示', 'Full screen')}
              title={full ? t('退出全屏', 'Exit full screen') : t('全屏显示', 'Full screen')}>
              {full ? <Minimize size={22} strokeWidth={1.7} aria-hidden /> : <Maximize size={22} strokeWidth={1.7} aria-hidden />}
            </ActionIcon>
          </div>
          <div className={w.galleryStage}>
            {error ? (
              <div className={w.empty}>
                <h2>{t('工作台连接异常', 'Workspace connection lost')}</h2>
                <Text role="alert">{localizeMessage(error, lang)}</Text>
                <Button onClick={refresh}>{t('重新连接', 'Reconnect')}</Button>
              </div>
            ) : !ready ? (
              <div className={w.empty} role="status">
                <Loader size="sm" />
                <Text>{t('正在载入工作台…', 'Loading workspace…')}</Text>
              </div>
            ) : !tabs.active ? (
              <div className={w.empty}>
                <h2>{systems.length ? t('选择要查看的系统', 'Choose a system') : t('暂无已分配的系统', 'No systems assigned yet')}</h2>
                <Text>{systems.length ? t('从我的系统中打开一个项目相册。', 'Open a project gallery from Your systems.') : t('老师完成分配后，系统会显示在这里。', 'Systems will appear here when your teacher assigns them.')}</Text>
              </div>
            ) : (
              systems
                .filter((system) => tabs.visited.includes(system.key))
                .map((system) => (
                  <Gallery key={user?.id + ':' + system.key} system={system} visible={system.key === tabs.active} />
                ))
            )}
          </div>
        </div>
      </div>
    </Box>
  )
}
