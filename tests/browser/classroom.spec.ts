import { randomBytes } from 'node:crypto'
import { expect, test, type BrowserContext, type Page } from '@playwright/test'

const port = process.env.CLASSROOM_TEST_PORT || '3459'
const site = (host: string) => 'http://' + host + '.classroom.localhost:' + port

function testPassword(name: 'TEST_A_PASSWORD' | 'TEST_B_PASSWORD' | 'TEST_TEACHER_PASSWORD') {
  const password = process.env[name]
  if (!password) throw new Error('请使用隔离数据库的浏览器测试入口运行。')
  return password
}

async function login(page: Page, username: string, password: string, teacher = false) {
  await page.goto(site(teacher ? 'admin' : 'portal') + '/login')
  await page.getByRole('button', { name: '简体中文', exact: true }).click()
  await page.getByLabel('账号', { exact: true }).fill(username)
  await page.getByLabel('密码', { exact: true }).fill(password)
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(teacher ? '/admin/students$' : '/workspace$'))
}

function gallery(page: Page, title: string) {
  return page.getByRole('region', { name: title, exact: true })
}

async function expectMediaDenied(context: BrowserContext, path: string, status = 404) {
  const direct = await context.newPage()
  try {
    expect((await direct.goto(site('portal') + path))?.status()).toBe(status)
  } finally { await direct.close() }
}

async function refreshAccess(page: Page) {
  // Becoming active is also how a real workspace rechecks permissions between polls.
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
}

test('公开首页、学生登录与手机布局', async ({ page }, info) => {
  await page.setViewportSize({ width: 1200, height: 650 })
  await page.goto(site('portal'))
  await page.getByRole('button', { name: '简体中文', exact: true }).click()
  await expect(page.getByRole('heading', { name: '毕业设计演示空间' })).toBeVisible()
  await expect(page.getByRole('link', { name: '登录', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: '进入工作台' })).toHaveAttribute('href', '/login')
  await page.screenshot({ path: info.outputPath('landing.png') })
  await page.getByRole('link', { name: '进入工作台' }).click()
  await expect(page.getByRole('heading', { name: '学生登录' })).toBeVisible()
  await page.screenshot({ path: info.outputPath('login.png') })
  await page.getByRole('link', { name: '返回首页' }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole('heading', { name: '毕业设计演示空间' })).toBeInViewport()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath('mobile.png') })
})

test('学生截图按授权隔离，切换页签保留分组并可放大查看', async ({ browser }, info) => {
  const a = await browser.newContext({ viewport: { width: 1122, height: 731 } })
  const b = await browser.newContext()
  try {
    const [pageA, pageB] = await Promise.all([a.newPage(), b.newPage()])
    await Promise.all([
      login(pageA, 'student-a', testPassword('TEST_A_PASSWORD')),
      login(pageB, 'student-b', testPassword('TEST_B_PASSWORD')),
    ])
    const library = gallery(pageA, '图书借阅')
    const labB = gallery(pageB, '实验室预约')
    await expect(library.getByRole('img', { name: 'Overview' })).toBeVisible()
    await expect(labB.getByRole('img', { name: 'Overview' })).toBeVisible()
    const imagePath = await library.getByRole('img', { name: 'Overview' }).getAttribute('src')
    expect(imagePath).toMatch(/^\/media\/[a-f0-9-]+\/thumb$/)
    await expectMediaDenied(b, imagePath!)
    await expectMediaDenied(b, imagePath!.replace('/thumb', ''))
    const railA = pageA.getByRole('complementary')
    await expect(railA.getByRole('button', { name: '实验室预约' })).toBeVisible()
    await expect(pageB.getByRole('complementary').getByRole('button', { name: '图书借阅' })).toHaveCount(0)
    await pageA.screenshot({ path: info.outputPath('workspace.png') })

    await library.getByRole('group', { name: '截图分组' }).getByRole('button', { name: /Android/ }).click()
    await library.getByRole('button', { name: '查看截图 Details' }).click()
    const viewer = pageA.getByRole('dialog')
    await expect(viewer.getByRole('img', { name: 'Details' })).toBeVisible()
    await expect.poll(() => viewer.getByRole('img').evaluate(element => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
    await viewer.getByRole('button', { name: '原图', exact: true }).click()
    await expect(viewer.getByRole('button', { name: '适应窗口', exact: true })).toBeVisible()
    await pageA.keyboard.press('Escape')
    await expect(viewer).toHaveCount(0)
    await railA.getByRole('button', { name: '实验室预约' }).click()
    await expect(gallery(pageA, '实验室预约').getByRole('img', { name: 'Overview' })).toBeVisible()
    await railA.getByRole('button', { name: '图书借阅' }).click()
    await expect(library.getByRole('group').getByRole('button', { name: /Android/ })).toHaveAttribute('aria-pressed', 'true')
    await expect(library.getByRole('img', { name: 'Details' })).toBeVisible()
    await pageA.getByRole('button', { name: '退出', exact: true }).click()
    await expect(pageA).toHaveURL(/\/login$/)
    await expectMediaDenied(a, imagePath!, 401)
  } finally {
    await Promise.all([a.close(), b.close()])
  }
})

test('教师新增账号、分配和撤回授权，学生已打开的页签随权限失效', async ({ browser }, info) => {
  const teacher = await browser.newContext()
  const student = await browser.newContext()
  try {
    const admin = await teacher.newPage()
    const page = await student.newPage()
    await login(admin, 'teacher', testPassword('TEST_TEACHER_PASSWORD'), true)
    const suffix = randomBytes(4).toString('hex')
    const username = 'qa-' + suffix
    const display = '课堂验证 ' + suffix
    const password = randomBytes(15).toString('base64url')
    await admin.getByRole('button', { name: '新建账号' }).click()
    const dialog = admin.getByRole('dialog')
    await dialog.getByLabel('姓名').fill(display)
    await dialog.getByLabel('登录账号').fill(username)
    await dialog.getByLabel('初始密码').fill(password)
    await dialog.getByRole('button', { name: '创建账号' }).click()
    await expect(admin.getByRole('status')).toContainText('已创建')
    await login(page, username, password)
    await expect(page.getByRole('heading', { name: '暂无已分配的系统' })).toBeVisible()

    await admin.getByRole('link', { name: '系统授权' }).click()
    await admin.getByRole('button', { name: display }).click()
    const save = admin.getByRole('button', { name: '保存授权' })
    await admin.getByLabel('图书借阅', { exact: true }).check()
    await admin.getByLabel('实验室预约', { exact: true }).check()
    await save.click()
    await expect(admin.getByRole('status')).toContainText('已保存')
    await admin.screenshot({ path: info.outputPath('grants.png') })
    await refreshAccess(page)
    const rail = page.getByRole('complementary')
    await rail.getByRole('button', { name: '图书借阅' }).click()
    await expect(gallery(page, '图书借阅').getByRole('img', { name: 'Overview' })).toBeVisible()
    await rail.getByRole('button', { name: '实验室预约' }).click()
    await expect(gallery(page, '实验室预约').getByRole('img', { name: 'Overview' })).toBeVisible()
    await page.getByRole('button', { name: '关闭实验室预约' }).click()
    await expect(gallery(page, '图书借阅').getByRole('img', { name: 'Overview' })).toBeVisible()
    await page.getByRole('button', { name: '收起系统列表' }).click()
    await expect(page.getByRole('button', { name: '展开系统列表' })).toBeVisible()
    await page.getByRole('button', { name: '展开系统列表' }).click()
    await page.getByRole('button', { name: '全屏显示' }).click()
    await expect(page.getByRole('button', { name: '退出全屏' })).toBeVisible()
    await page.getByRole('button', { name: '退出全屏' }).click()

    const oldImage = await gallery(page, '图书借阅').getByRole('img', { name: 'Overview' }).getAttribute('src')
    await admin.getByLabel('图书借阅', { exact: true }).uncheck()
    await save.click()
    await expect(admin.getByRole('status')).toContainText('已保存')
    await expectMediaDenied(student, oldImage!)
    await refreshAccess(page)
    await expect(gallery(page, '图书借阅')).toHaveCount(0)
    await expect(rail.getByRole('button', { name: '图书借阅' })).toHaveCount(0)
    await rail.getByRole('button', { name: '实验室预约' }).click()
    await expect(gallery(page, '实验室预约').getByRole('img', { name: 'Overview' })).toBeVisible()

    const labImage = await gallery(page, '实验室预约').getByRole('img', { name: 'Overview' }).getAttribute('src')
    await admin.getByRole('link', { name: '学生账号' }).click()
    await admin.getByRole('row').filter({ hasText: username }).getByRole('button', { name: '停用' }).click()
    await admin.getByRole('dialog').getByRole('button', { name: '停用账号' }).click()
    await expect(admin.getByRole('status')).toContainText('已停用')
    await refreshAccess(page)
    await expect(page).toHaveURL(/\/login$/)
    await expectMediaDenied(student, labImage!, 401)
    await admin.getByRole('link', { name: '操作记录' }).click()
    await expect(admin.getByRole('row').filter({ hasText: username }).first()).toBeVisible()
  } finally {
    await Promise.all([teacher.close(), student.close()])
  }
})

test('连接中断后能从工作台重新载入系统', async ({ page, context }) => {
  await login(page, 'student-a', testPassword('TEST_A_PASSWORD'))
  const table = gallery(page, '图书借阅').getByRole('img', { name: 'Overview' })
  await expect(table).toBeVisible()
  await context.setOffline(true)
  try {
    await refreshAccess(page)
    await expect(page.getByRole('heading', { name: '工作台连接异常' })).toBeVisible()
  } finally { await context.setOffline(false) }
  await page.getByRole('button', { name: '重新连接' }).click()
  await expect(table).toBeVisible()
})
