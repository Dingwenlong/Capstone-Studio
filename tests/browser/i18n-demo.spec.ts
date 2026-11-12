import { randomBytes } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'

const port = process.env.CLASSROOM_TEST_PORT || '3459'
const site = (host: string) => 'http://' + host + '.classroom.localhost:' + port
test.use({ storageState: { cookies: [], origins: [] }, locale: 'zh-CN' })

async function useLanguage(page: Page, english: boolean) {
  await page.getByRole('button', { name: english ? 'English' : '简体中文', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('lang', english ? 'en' : 'zh-CN')
}

async function passwordLogin(page: Page, username: string, secret: string | undefined) {
  if (!secret) throw new Error('Run this test through the isolated browser QA entry point.')
  await page.getByLabel('Username', { exact: true }).fill(username)
  await page.getByLabel('Password', { exact: true }).fill(secret)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
}

test('匿名首次进入门户和教师登录页均返回英文 HTML', async ({ browser }) => {
  for (const [url, heading] of [
    [site('portal'), 'Capstone Demo Studio'],
    [site('admin') + '/login', 'Teacher sign-in'],
  ]) {
    const fresh = await browser.newContext({ locale: 'zh-CN' })
    try {
      const firstPage = await fresh.newPage()
      const response = await firstPage.goto(url)
      expect(response?.status()).toBe(200)
      expect(await response!.text()).toMatch(/<html\b[^>]*\blang="en"/i)
      await expect(firstPage.locator('html')).toHaveAttribute('lang', 'en')
      await expect(firstPage.getByRole('heading', { name: heading, exact: true })).toBeVisible()
      await expect(firstPage.getByRole('button', { name: 'English', exact: true })).toHaveAttribute('aria-pressed', 'true')
    } finally { await fresh.close() }
  }
})

test('明确选择简体中文后，刷新、两个登录入口和内嵌页签沿用中文', async ({ page, context }) => {
  await page.goto(site('portal'))
  await useLanguage(page, false)
  await expect(page.getByRole('heading', { name: '毕业设计演示空间' })).toBeVisible()
  const refreshed = await page.reload()
  expect(await refreshed!.text()).toMatch(/<html\b[^>]*\blang="zh-CN"/i)
  await page.getByRole('link', { name: '进入工作台' }).click()
  await expect(page.getByRole('heading', { name: '学生登录' })).toBeVisible()
  const admin = await context.newPage()
  try {
    await admin.goto(site('admin') + '/login')
    await expect(admin.locator('html')).toHaveAttribute('lang', 'zh-CN')
    await expect(admin.getByRole('heading', { name: '教师登录' })).toBeVisible()
    await admin.getByRole('button', { name: '示例教师 A' }).click()
    await expect(admin.getByRole('heading', { name: '学生账号' })).toBeVisible()
  } finally { await admin.close() }
  await page.getByRole('button', { name: '示例学生 A' }).click()
  await expect(page).toHaveURL(/\/workspace$/)
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN')
  const library = page.frameLocator('iframe[title="图书借阅"]')
  await expect(library.locator('html')).toHaveAttribute('lang', 'zh-CN')
  await expect(library.getByRole('table', { name: '馆藏图书' })).toBeVisible()
  await page.getByRole('complementary', { name: '我的系统' }).getByRole('button', { name: '实验室预约' }).click()
  const lab = page.frameLocator('iframe[title="实验室预约"]')
  await expect(lab.locator('html')).toHaveAttribute('lang', 'zh-CN')
  await expect(lab.getByRole('table', { name: '实验室时段' })).toBeVisible()
  await page.reload()
  await expect(library.getByRole('table', { name: '馆藏图书' })).toBeVisible()
})

test('语言偏好跨入口、刷新和已打开的演示同步，借阅搜索保持不变', async ({ page, context }, info) => {
  await page.goto(site('portal'))
  await expect(page.getByRole('heading', { name: 'Capstone Demo Studio' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('link', { name: 'Open workspace' })).toBeVisible()
  const admin = await context.newPage()
  await admin.goto(site('admin') + '/login')
  await expect(admin.getByRole('heading', { name: 'Teacher sign-in' })).toBeVisible()
  await admin.close()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('link', { name: 'Open workspace' }).click()
  await expect(page.getByRole('heading', { name: 'Student sign-in' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Demo student B' })).toBeInViewport()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath('mobile-english-login.png') })
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.getByRole('button', { name: 'Demo student A' }).click()
  await expect(page).toHaveURL(/\/workspace$/)
  await expect(page.getByText('Demo student A', { exact: true })).toBeVisible()
  const rail = page.getByRole('complementary', { name: 'My systems' })
  await expect(rail.getByRole('button', { name: 'Library' })).toBeVisible()
  await expect(rail.getByRole('button', { name: 'Lab reservations' })).toBeVisible()
  const library = page.frameLocator('iframe[title="Library"]')
  await expect(library.getByRole('table', { name: 'Library catalog' })).toBeVisible()
  await library.getByRole('searchbox').fill('Database')
  await library.getByRole('button', { name: 'Search' }).click()
  await expect(library.getByRole('cell', { name: 'Database Systems', exact: true })).toBeVisible()

  await useLanguage(page, false)
  const chinese = page.frameLocator('iframe[title="图书借阅"]')
  await expect(chinese.getByRole('searchbox', { name: '搜索书名' })).toHaveValue('Database')
  await expect(chinese.getByRole('cell', { name: '数据库系统概论' })).toBeVisible()
  await expect(chinese.getByRole('table', { name: '馆藏图书' }).locator('tbody tr')).toHaveCount(1)
  await useLanguage(page, true)
  await rail.getByRole('button', { name: 'Lab reservations' }).click()
  const lab = page.frameLocator('iframe[title="Lab reservations"]')
  await expect(lab.getByRole('cell', { name: 'Networking Lab' }).first()).toBeVisible()
  await rail.getByRole('button', { name: 'Library' }).click()
  await expect(library.getByRole('searchbox')).toHaveValue('Database')
  await expect(library.getByRole('cell', { name: 'Database Systems', exact: true })).toBeVisible()
  await page.screenshot({ path: info.outputPath('english-workspace.png') })
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page.getByRole('heading', { name: 'Student sign-in' })).toBeVisible()
  await page.getByRole('button', { name: 'Demo student B' }).click()
  await expect(page.getByText('Demo student B', { exact: true })).toBeVisible()
  await expect(lab.getByRole('table', { name: 'Lab time slots' })).toBeVisible()
  await expect(rail.getByRole('button', { name: 'Library' })).toHaveCount(0)
  const direct = await context.newPage()
  expect((await direct.goto(site('library') + '/'))?.status()).toBe(403)
  await expect(direct.getByText(/You do not have access/)).toBeVisible()
})

test('两个示例教师各自署名，示例账号与正式教学记录隔离', async ({ page, browser }) => {
  const created: string[] = []
  for (const letter of ['A', 'B']) {
    await page.goto(site('admin') + '/login')
    await useLanguage(page, true)
    await page.getByRole('button', { name: 'Demo teacher ' + letter }).click()
    await expect(page.getByRole('heading', { name: 'Student accounts' })).toBeVisible()
    const table = page.getByRole('table')
    await expect(table.getByRole('cell', { name: 'Demo student A', exact: true })).toBeVisible()
    await expect(table.getByRole('cell', { name: 'student-a', exact: true })).toHaveCount(0)
    const username = 'sample-' + randomBytes(5).toString('hex')
    created.push(username)
    await page.getByRole('button', { name: 'New account' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Name', { exact: true }).fill('Example ' + letter)
    await dialog.getByLabel('Username', { exact: true }).fill(username)
    await dialog.getByLabel('Initial password').fill(randomBytes(15).toString('base64url'))
    await dialog.getByRole('button', { name: 'Create account' }).click()
    await expect(table.getByRole('cell', { name: username, exact: true })).toBeVisible()
    await page.getByRole('link', { name: 'Activity log' }).click()
    const record = page.getByRole('row').filter({ hasText: username })
    await expect(record.getByRole('cell', { name: 'demo-teacher-' + letter.toLowerCase(), exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Sign out' }).click()
    await expect(page.getByRole('heading', { name: 'Teacher sign-in' })).toBeVisible()
  }
  const live = await browser.newContext()
  try {
    const teacher = await live.newPage()
    await teacher.goto(site('admin') + '/login')
    await useLanguage(teacher, true)
    await passwordLogin(teacher, 'teacher', process.env.TEST_TEACHER_PASSWORD)
    const roster = teacher.getByRole('table')
    await expect(roster.getByRole('cell', { name: 'Student A', exact: true })).toBeVisible()
    await expect(roster.getByRole('cell', { name: 'demo-student-a', exact: true })).toHaveCount(0)
    for (const id of created) await expect(roster.getByRole('cell', { name: id, exact: true })).toHaveCount(0)
  } finally { await live.close() }
})

test('英文学生密码登录保留错误反馈及成功路径', async ({ page }) => {
  await page.goto(site('portal') + '/login')
  await useLanguage(page, true)
  await passwordLogin(page, 'student-a', randomBytes(15).toString('base64url'))
  const loginError = page.getByRole('main').getByRole('alert')
  await expect(loginError).toHaveText('Incorrect username or password.')
  await useLanguage(page, false)
  await expect(loginError).toHaveText('账号或密码错误。')
  await useLanguage(page, true)
  await passwordLogin(page, 'student-a', process.env.TEST_A_PASSWORD)
  await expect(page).toHaveURL(/\/workspace$/)
  await expect(page.getByText('Student A', { exact: true })).toBeVisible()
  await expect(page.frameLocator('iframe[title="Library"]').getByRole('table', { name: 'Library catalog' })).toBeVisible()
})
