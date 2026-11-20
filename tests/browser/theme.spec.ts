import { expect, test, type Page } from '@playwright/test'

const port = process.env.CLASSROOM_TEST_PORT || '3459'
const site = (host: string) => 'http://' + host + '.classroom.localhost:' + port
const themes = [
  { id: 'paper-pine', en: 'Paper & Pine', zh: '纸白与松绿' },
  { id: 'ink-blue', en: 'Ink & Blue', zh: '墨蓝' },
  { id: 'graphite-lime', en: 'Graphite & Lime', zh: '石墨青柠' },
  { id: 'charcoal-indigo', en: 'Charcoal & Indigo', zh: '炭灰靛紫' },
] as const
type Theme = (typeof themes)[number]

test.use({ storageState: { cookies: [], origins: [] }, viewport: { width: 1366, height: 768 } })

async function chooseTheme(page: Page, theme: Theme, chinese = false) {
  await page.getByRole('button', { name: chinese ? '主题' : 'Theme', exact: true }).click()
  const menu = page.getByRole('menu')
  await expect(menu.getByRole('menuitemradio')).toHaveCount(4)
  await menu.getByRole('menuitemradio', { name: chinese ? theme.zh : theme.en, exact: true }).click()
  await expect(menu).toBeHidden()
  await expect(page.locator('html')).toHaveAttribute('data-studio-theme', theme.id)
  await expect(page.locator('html')).toHaveAttribute('lang', chinese ? 'zh-CN' : 'en')
}

async function workspaceColors(page: Page) {
  return page.evaluate(() => {
    function background(element: Element): string {
      const color = getComputedStyle(element).backgroundColor
      return color === 'transparent' || color === 'rgba(0, 0, 0, 0)'
        ? element.parentElement ? background(element.parentElement) : color
        : color
    }
    const workspace = document.querySelector('main')!
    const header = workspace.querySelector('header')!
    const rail = workspace.querySelector('aside')!
    const activeGroup = workspace.querySelector('section[aria-label="Library"]:not([hidden]) button[aria-pressed="true"]')!
    return {
      background: background(workspace),
      header: background(header),
      rail: background(rail),
      accent: getComputedStyle(activeGroup).backgroundColor,
    }
  })
}

test('四套主题实际改变配色，跨入口保留选择且不重置学生页签、图片查看和语言', async ({ page, context }, info) => {
  await page.goto(site('portal') + '/login')
  await expect(page.locator('html')).toHaveAttribute('data-studio-theme', 'paper-pine')
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await page.getByRole('button', { name: 'Demo student A', exact: true }).click()
  await expect(page).toHaveURL(/\/workspace$/)
  const rail = page.getByRole('complementary', { name: 'My systems' })
  const library = page.getByRole('region', { name: 'Library', exact: true })
  await expect(library.getByRole('img', { name: 'Overview', exact: true })).toBeVisible()
  await library.getByRole('group', { name: 'Screenshot groups' }).getByRole('button', { name: 'Android', exact: true }).click()
  await rail.getByRole('button', { name: 'Lab reservations', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Lab reservations', exact: true })).toBeVisible()
  await rail.getByRole('button', { name: 'Library', exact: true }).click()

  const palettes: { theme: string; background: string; header: string; rail: string; accent: string }[] = []
  for (const theme of themes) {
    await chooseTheme(page, theme)
    await expect(rail.getByRole('button', { name: 'Library', exact: true })).toHaveAttribute('aria-current', 'true')
    await expect(page.getByRole('button', { name: 'Close Lab reservations', exact: true })).toBeVisible()
    await expect(library.getByRole('button', { name: 'Android', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(library.getByRole('img', { name: 'Details', exact: true })).toBeVisible()
    await page.screenshot({ path: info.outputPath(theme.id + '.png'), animations: 'disabled' })
    palettes.push({ theme: theme.id, ...await workspaceColors(page) })
  }
  for (const field of ['background', 'header', 'rail', 'accent'] as const)
    expect(new Set(palettes.map(palette => palette[field])).size, field + ' must differ across all four themes').toBe(4)
  await info.attach('computed-theme-colors', { body: JSON.stringify(palettes, null, 2), contentType: 'application/json' })

  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-studio-theme', 'charcoal-indigo')
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await expect(library.getByRole('img', { name: 'Overview', exact: true })).toBeVisible()
  await library.getByRole('button', { name: 'View screenshot Overview', exact: true }).click()
  const viewer = page.getByRole('dialog', { name: 'Overview', exact: true })
  await expect(viewer).toBeVisible()
  await viewer.getByRole('button', { name: 'Original size', exact: true }).click()
  const imageSource = await viewer.getByRole('img', { name: 'Overview', exact: true }).getAttribute('src')

  const teacher = await context.newPage()
  try {
    await teacher.goto(site('admin') + '/login')
    await expect(teacher.locator('html')).toHaveAttribute('data-studio-theme', 'charcoal-indigo')
    await expect(teacher.locator('html')).toHaveAttribute('lang', 'en')
    await teacher.getByRole('button', { name: 'Demo teacher A', exact: true }).click()
    await expect(teacher.getByRole('heading', { name: 'Student accounts', exact: true })).toBeVisible()
    await chooseTheme(teacher, themes[1])
    await page.bringToFront()
    await expect(page.locator('html')).toHaveAttribute('data-studio-theme', 'ink-blue')
    await expect(viewer).toBeVisible()
    await expect(viewer.getByRole('img', { name: 'Overview', exact: true })).toHaveAttribute('src', imageSource!)
    await expect(viewer.getByRole('button', { name: 'Fit to window', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await page.keyboard.press('Escape')
    await expect(viewer).toHaveCount(0)

    await teacher.bringToFront()
    await teacher.getByRole('button', { name: '简体中文', exact: true }).click()
    await chooseTheme(teacher, themes[2], true)
    await teacher.reload()
    await expect(teacher.locator('html')).toHaveAttribute('data-studio-theme', 'graphite-lime')
    await expect(teacher.locator('html')).toHaveAttribute('lang', 'zh-CN')
    await teacher.getByRole('button', { name: '主题', exact: true }).click()
    const menu = teacher.getByRole('menu')
    for (const theme of themes) await expect(menu.getByRole('menuitemradio', { name: theme.zh, exact: true })).toBeVisible()
    await expect(menu.getByRole('menuitemradio', { name: '石墨青柠', exact: true })).toHaveAttribute('aria-checked', 'true')
  } finally { await teacher.close() }
})
