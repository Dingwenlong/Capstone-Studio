import { expect, test } from '@playwright/test'

test('另一页退出后，旧教师页下次读取返回教师登录', async ({ context, page }) => {
  const origin = 'http://admin.classroom.localhost:' + (process.env.CLASSROOM_TEST_PORT || '3459')
  const password = process.env.TEST_TEACHER_PASSWORD
  if (!password) throw new Error('请使用隔离数据库的浏览器测试入口运行。')
  await page.goto(origin + '/login')
  await page.getByRole('button', { name: '简体中文', exact: true }).click()
  await page.getByLabel('账号', { exact: true }).fill('teacher')
  await page.getByLabel('密码', { exact: true }).fill(password)
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page).toHaveURL(/\/admin\/students$/)
  await page.getByRole('link', { name: '操作记录' }).click()
  await expect(page.getByRole('table')).toBeVisible()
  const other = await context.newPage()
  await other.goto(origin + '/admin/students')
  await other.getByRole('button', { name: '退出', exact: true }).click()
  await expect(other.getByRole('heading', { name: '教师登录' })).toBeVisible()
  // Invoke the existing control without switching tabs; this specifically exercises 401 handling.
  await page.getByRole('button', { name: '刷新' }).evaluate(button => (button as HTMLButtonElement).click())
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('heading', { name: '教师登录' })).toBeVisible()
})
