import { expect, test, type Page } from '@playwright/test'

const port = process.env.CLASSROOM_TEST_PORT || '3459'
const origin = (key: string) => 'http://' + key + '.classroom.localhost:' + port
const systemName = '课程资料库'
const systemKey = 'course-materials'

async function signIn(page: Page, teacher: boolean) {
  const password = teacher ? process.env.TEST_TEACHER_PASSWORD : process.env.TEST_B_PASSWORD
  if (!password) throw new Error('请通过独立数据库的浏览器验收入口运行。')
  await page.goto(origin(teacher ? 'admin' : 'portal') + '/login')
  await page.getByRole('button', { name: '简体中文', exact: true }).click()
  await page.getByLabel('账号', { exact: true }).fill(teacher ? 'teacher' : 'student-b')
  await page.getByLabel('密码', { exact: true }).fill(password)
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page).toHaveURL(teacher ? /\/admin\/students$/ : /\/workspace$/)
}

async function grantsForB(admin: Page) {
  await admin.getByRole('link', { name: '系统授权' }).click()
  const student = admin.getByRole('button', { name: '学生 B', exact: true })
  await student.click()
  await expect(student).toHaveAttribute('aria-pressed', 'true')
  await expect(admin.getByRole('checkbox', { name: '实验室预约', exact: true })).toBeChecked()
}

async function saveGrants(admin: Page) {
  await admin.getByRole('button', { name: '保存授权' }).click()
  await expect(admin.getByRole('status')).toContainText('已保存')
}

async function setPublished(admin: Page, enabled: boolean) {
  await admin.getByRole('link', { name: '演示系统' }).click()
  const row = admin.getByRole('row').filter({ hasText: systemKey })
  const action = enabled ? '上架' : '下架'
  await row.getByRole('button', { name: action, exact: true }).click()
  await admin.getByRole('dialog').getByRole('button', { name: action + '系统' }).click()
  await expect(row).toContainText('已' + action)
}

async function openFixture(page: Page) {
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await page.getByRole('complementary').getByRole('button', { name: systemName }).click()
  const frame = page.frameLocator('iframe[title="' + systemName + '"]')
  await expect(frame.getByRole('heading', { name: systemName })).toBeVisible()
  // The upstream only responds with this page for B's exact server-assigned ID.
  await expect(frame.getByText('当前学生：学生 B', { exact: true })).toBeVisible()
}

async function expectAbsent(page: Page) {
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.getByRole('complementary').getByRole('button', { name: systemName })).toHaveCount(0)
  await expect(page.locator('iframe[title="' + systemName + '"]')).toHaveCount(0)
  const direct = await page.context().newPage()
  try {
    expect((await direct.goto(origin(systemKey) + '/'))?.status()).toBe(403)
  } finally {
    await direct.close()
  }
  await expect(page.getByRole('complementary').getByRole('button', { name: '实验室预约' })).toBeVisible()
}

test('教师登记部署清单目标，学生通过受保护页签使用、下架及撤权', async ({ browser }) => {
  const teacher = await browser.newContext()
  const student = await browser.newContext()
  const admin = await teacher.newPage()
  const page = await student.newPage()
  let granted = false
  try {
    await Promise.all([signIn(admin, true), signIn(page, false)])
    await expectAbsent(page)
    await admin.getByRole('link', { name: '演示系统' }).click()
    await admin.getByRole('button', { name: '登记系统' }).click()
    const dialog = admin.getByRole('dialog')
    await dialog.getByLabel('部署目标').selectOption(systemKey)
    await dialog.getByLabel('显示名称').fill(systemName)
    await dialog.getByRole('button', { name: '登记系统' }).click()
    await expect(admin.getByRole('row').filter({ hasText: systemKey })).toContainText('已上架')
    await grantsForB(admin)
    const access = admin.getByRole('checkbox', { name: systemName, exact: true })
    await expect(access).not.toBeChecked()
    await expect(admin.getByRole('checkbox', { name: '图书借阅' })).not.toBeChecked()
    await access.check()
    granted = true
    await saveGrants(admin)
    await openFixture(page)
    await setPublished(admin, false)
    await expectAbsent(page)
    await setPublished(admin, true)
    await openFixture(page)
    await grantsForB(admin)
    await access.uncheck()
    await saveGrants(admin)
    granted = false
    await expectAbsent(page)
    await grantsForB(admin)
    await expect(access).not.toBeChecked()
    await expect(admin.getByRole('checkbox', { name: '图书借阅' })).not.toBeChecked()
    await setPublished(admin, false)
  } finally {
    try {
      if (granted) {
        await grantsForB(admin)
        await admin.getByRole('checkbox', { name: new RegExp(systemName) }).uncheck()
        await saveGrants(admin)
      }
    } finally {
      await Promise.all([student.close(), teacher.close()])
    }
  }
})
