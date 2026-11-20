export const studioThemeIds = ['paper-pine', 'ink-blue', 'graphite-lime', 'charcoal-indigo'] as const
export type StudioThemeId = (typeof studioThemeIds)[number]
export const defaultStudioTheme: StudioThemeId = 'paper-pine'
export const studioThemeCookie = 'classroom_theme'

export function studioThemeId(value: string | undefined): StudioThemeId {
  return studioThemeIds.find(theme => theme === value) ?? defaultStudioTheme
}

export function studioThemeFromCookie(cookies: string | undefined): StudioThemeId {
  const name = studioThemeCookie + '='
  const entry = cookies?.split(';').map(part => part.trim()).find(part => part.startsWith(name))
  return studioThemeId(entry?.slice(name.length))
}
