import { ActionIcon, MantineProvider, Menu } from '@mantine/core'
import { Palette } from 'lucide-react'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  defaultStudioTheme,
  studioThemeCookie,
  studioThemeFromCookie,
  studioThemeId,
  studioThemeIds,
  type StudioThemeId,
} from '../shared/studio-theme'
import { useLanguage } from './i18n'
import { studioThemes } from './theme'
import s from './StudioAppearance.module.css'

const AppearanceContext = createContext<{
  current: StudioThemeId
  choose: (value: string) => void
} | null>(null)

export function StudioAppearance({ initial = defaultStudioTheme, children }: {
  initial?: StudioThemeId
  children: ReactNode
}) {
  const [current, setCurrent] = useState(initial)
  const { theme, variables } = studioThemes[current]

  const choose = useCallback((value: string) => {
    const next = studioThemeId(value)
    const domain = window.location.hostname.split('.').slice(1).join('.')
    const secure = window.location.protocol === 'https:' ? '; Secure' : ''
    document.cookie = studioThemeCookie + '=' + next + '; Path=/; Max-Age=31536000; SameSite=Lax' +
      (domain ? '; Domain=' + domain : '') + secure
    setCurrent(next)
  }, [])

  useEffect(() => {
    const sync = () => setCurrent(studioThemeFromCookie(document.cookie))
    const cookieChanges = window.cookieStore
    window.addEventListener('focus', sync)
    document.addEventListener('visibilitychange', sync)
    window.addEventListener('pageshow', sync)
    cookieChanges?.addEventListener('change', sync)
    return () => {
      window.removeEventListener('focus', sync)
      document.removeEventListener('visibilitychange', sync)
      window.removeEventListener('pageshow', sync)
      cookieChanges?.removeEventListener('change', sync)
    }
  }, [])
  useEffect(() => {
    document.documentElement.dataset.studioTheme = current
  }, [current])

  const value = useMemo(() => ({ current, choose }), [current, choose])
  return (
    <MantineProvider theme={theme} cssVariablesResolver={variables} forceColorScheme="light">
      <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>
    </MantineProvider>
  )
}

export function ThemeSwitch() {
  const { t } = useLanguage()
  const appearance = useContext(AppearanceContext)
  if (!appearance) throw new Error('Missing appearance provider')
  const label = t('主题', 'Theme')
  return (
    <Menu position="bottom-end" shadow="md" width={230} closeOnItemClick>
      <Menu.Target>
        <ActionIcon className={s.trigger} size={32} variant="subtle" aria-label={label}
          title={label + ' · ' + t(...studioThemes[appearance.current].name)}>
          <Palette size={18} strokeWidth={1.7} aria-hidden />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown className={s.menu} aria-label={label}>
        <Menu.RadioGroup value={appearance.current} onChange={appearance.choose}>
          {studioThemeIds.map(id => {
            const { name, preview } = studioThemes[id]
            return (
              <Menu.RadioItem key={id} value={id} className={s.option} closeMenuOnClick
                rightSection={
                  <span className={s.preview} style={{ backgroundColor: preview.surface, color: preview.accent }} aria-hidden>
                    <span className={s.previewHeader} style={{ backgroundColor: preview.header }} />
                    <span className={s.previewRail} style={{ backgroundColor: preview.rail }} />
                    <span className={s.previewAccent} />
                  </span>
                }>
                {t(...name)}
              </Menu.RadioItem>
            )
          })}
        </Menu.RadioGroup>
      </Menu.Dropdown>
    </Menu>
  )
}
