import { randomBytes } from 'node:crypto'
import sharp from 'sharp'
import { expect, test, type Page } from '@playwright/test'

const port = process.env.CLASSROOM_TEST_PORT || '3459'
const origin = (host: string) => 'http://' + host + '.classroom.localhost:' + port

async function signIn(page: Page, account: 'teacher' | 'student-a' | 'student-b') {
  const passwords = {
    teacher: process.env.TEST_TEACHER_PASSWORD,
    'student-a': process.env.TEST_A_PASSWORD,
    'student-b': process.env.TEST_B_PASSWORD,
  }
  const password = passwords[account]
  if (!password) throw new Error('Run through the isolated browser QA entry point.')
  await page.goto(origin(account === 'teacher' ? 'admin' : 'portal') + '/login')
  await page.getByRole('button', { name: 'English', exact: true }).click()
  await page.getByLabel('Username', { exact: true }).fill(account)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(account === 'teacher' ? /\/admin\/students$/ : /\/workspace$/)
}

async function setAccess(admin: Page, system: string, enabled: boolean) {
  await admin.getByRole('link', { name: 'System access', exact: true }).click()
  await admin.getByRole('button', { name: 'Student A', exact: true }).click()
  await admin.getByRole('checkbox', { name: system, exact: true }).setChecked(enabled)
  await admin.getByRole('button', { name: 'Save access', exact: true }).click()
  await expect(admin.getByRole('status')).toContainText('Saved')
}

async function mediaStatus(page: Page, path: string) {
  return page.evaluate(async mediaPath => {
    const response = await fetch(mediaPath, { cache: 'no-store', credentials: 'same-origin' })
    return response.status
  }, path)
}

test('教师新增相册、上传分组排序删除，学生授权控制原图及缩略图', async ({ browser }, info) => {
  const [teacher, contextA, contextB] = await Promise.all([
    browser.newContext(), browser.newContext(), browser.newContext(),
  ])
  const [admin, studentA, studentB] = await Promise.all([
    teacher.newPage(), contextA.newPage(), contextB.newPage(),
  ])
  const suffix = randomBytes(4).toString('hex')
  const key = 'gallery-' + suffix
  const name = 'Research gallery ' + suffix
  let granted = false
  try {
    await Promise.all([
      signIn(admin, 'teacher'), signIn(studentA, 'student-a'), signIn(studentB, 'student-b'),
    ])
    await admin.getByRole('link', { name: 'Demo systems', exact: true }).click()
    await admin.getByRole('button', { name: 'Add system', exact: true }).click()
    const create = admin.getByRole('dialog')
    await create.getByLabel('System key', { exact: true }).fill(key)
    await create.getByLabel('System name', { exact: true }).fill('课程截图 ' + suffix)
    await create.getByLabel('English name', { exact: true }).fill(name)
    await create.getByLabel('Platforms', { exact: true }).fill('Client, Admin')
    await create.getByRole('button', { name: 'Create system', exact: true }).click()
    await expect(admin.getByRole('heading', { name, exact: true })).toBeVisible()
    await expect(admin.getByRole('heading', { name: 'Screenshots to be added' })).toBeVisible()

    const buffers = await Promise.all(['#eeeeee', '#d7edbc'].map(background =>
      sharp({ create: { width: 840, height: 520, channels: 3, background } }).png().toBuffer()))
    await admin.getByLabel('Upload to group', { exact: true }).fill('Client')
    await admin.locator('input[type="file"]').setInputFiles([
      { name: 'Overview.png', mimeType: 'image/png', buffer: buffers[0] },
      { name: 'Details.png', mimeType: 'image/png', buffer: buffers[1] },
    ])
    await admin.getByRole('button', { name: 'Upload selected images', exact: true }).click()
    await expect(admin.getByText('Uploaded', { exact: true })).toHaveCount(2)
    await expect(admin.getByRole('article')).toHaveCount(2)
    await admin.getByRole('combobox', { name: 'View group', exact: true }).selectOption('Client')
    await admin.getByRole('button', { name: 'Rename group', exact: true }).click()
    const rename = admin.getByRole('dialog')
    await rename.getByLabel('Group name', { exact: true }).fill('Admin')
    await rename.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(admin.getByRole('combobox', { name: 'View group', exact: true })).toHaveValue('Admin')
    await expect(admin.getByRole('combobox', { name: 'View group', exact: true }).locator('option[value="Client"]')).toHaveCount(0)

    await admin.getByRole('button', { name: 'Move up Details', exact: true }).click()
    await expect(admin.getByRole('article').getByRole('heading')).toHaveText(['Details', 'Overview'])
    await admin.screenshot({ path: info.outputPath('teacher-gallery.png'), fullPage: true })
    await admin.getByRole('button', { name: 'View screenshot Details', exact: true }).click()
    await expect(admin.getByRole('dialog').getByRole('heading', { name: 'Details', exact: true })).toBeVisible()
    await expect.poll(() => admin.getByRole('dialog').getByRole('img').evaluate(element => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
    await admin.screenshot({ path: info.outputPath('screenshot-viewer.png') })
    await admin.keyboard.press('ArrowRight')
    await expect(admin.getByRole('dialog').getByRole('heading', { name: 'Overview', exact: true })).toBeVisible()
    await admin.keyboard.press('ArrowLeft')
    await expect(admin.getByRole('dialog').getByRole('heading', { name: 'Details', exact: true })).toBeVisible()
    await admin.keyboard.press('Escape')
    await expect(admin.getByRole('dialog')).toHaveCount(0)
    const overview = admin.getByRole('article').filter({ has: admin.getByRole('heading', { name: 'Overview', exact: true }) })
    const deletedThumb = await overview.getByRole('img').getAttribute('src')
    expect(deletedThumb).toMatch(/^\/media\/.+\/thumb$/)
    await overview.getByRole('button', { name: 'Delete', exact: true }).click()
    await admin.getByRole('dialog').getByRole('button', { name: 'Delete screenshot', exact: true }).click()
    await expect(admin.getByRole('article')).toHaveCount(1)
    expect(await mediaStatus(admin, deletedThumb!)).toBe(404)

    const thumbnail = await admin.getByRole('article').getByRole('img').getAttribute('src')
    expect(thumbnail).toMatch(/^\/media\/.+\/thumb$/)
    const full = thumbnail!.replace(/\/thumb$/, '')
    await setAccess(admin, name, true)
    granted = true
    await studentA.evaluate(() => window.dispatchEvent(new Event('focus')))
    await studentA.getByRole('complementary').getByRole('button', { name, exact: true }).click()
    const gallery = studentA.getByRole('region', { name, exact: true })
    await expect(gallery.getByRole('heading', { name, exact: true })).toBeVisible()
    const image = gallery.getByRole('img', { name: 'Details', exact: true })
    await expect(image).toBeVisible()
    await expect.poll(() => image.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
    expect(await mediaStatus(studentA, thumbnail!)).toBe(200)
    expect(await mediaStatus(studentA, full)).toBe(200)
    expect(await mediaStatus(studentB, thumbnail!)).toBe(404)
    expect(await mediaStatus(studentB, full)).toBe(404)
    await expect(studentB.getByRole('complementary').getByRole('button', { name, exact: true })).toHaveCount(0)

    await setAccess(admin, name, false)
    granted = false
    expect(await mediaStatus(studentA, thumbnail!)).toBe(404)
    expect(await mediaStatus(studentA, full)).toBe(404)
    await studentA.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(gallery).toHaveCount(0)
    await expect(studentA.getByRole('complementary').getByRole('button', { name, exact: true })).toHaveCount(0)
  } finally {
    if (granted) await setAccess(admin, name, false).catch(() => undefined)
    await Promise.all([teacher.close(), contextA.close(), contextB.close()])
  }
})

test('上传确认损坏与截图操作断线均显示待核对并按当前相册回读', async ({ page }) => {
  await signIn(page, 'teacher')
  await page.getByRole('link', { name: 'Demo systems', exact: true }).click()
  await page.getByRole('row').filter({ hasText: 'library' }).getByRole('button', { name: 'Manage screenshots' }).click()
  await expect(page.getByRole('heading', { name: 'Library', exact: true })).toBeVisible()
  let galleryReads = 0
  let missingSystemKey = false
  page.on('request', request => {
    const url = new URL(request.url())
    if (!url.pathname.endsWith('/api/rpc/read')) return
    const input = JSON.parse(url.searchParams.get('input') || '{}')
    if (input.action !== 'gallery') return
    galleryReads++
    if (input.input?.systemKey !== 'library') missingSystemKey = true
  })
  const buffer = await sharp({
    create: { width: 24, height: 24, channels: 3, background: '#b6d2e2' },
  }).png().toBuffer()
  const responses = ['{incomplete', '{"ok":true}', '{"id":"unexpected"}', '{"ok":true,"id":7}']
  let uploads = 0
  await page.route(/\/api\/gallery\/upload\?/, route => {
    const body = responses[uploads++]
    return route.fulfill({ status: 200, contentType: 'application/json', body })
  })
  for (const [index] of responses.entries()) {
    const before = galleryReads
    await page.locator('input[type="file"]').setInputFiles({
      name: 'Unconfirmed-' + index + '.png', mimeType: 'image/png', buffer,
    })
    await page.getByRole('button', { name: 'Upload selected images', exact: true }).click()
    await expect(page.getByText(/^Result unconfirmed\./)).toHaveCount(index + 1)
    await expect(page.getByText('Uploaded', { exact: true })).toHaveCount(0)
    await expect.poll(() => galleryReads).toBeGreaterThan(before)
    expect(uploads).toBe(index + 1)
  }
  const beforeEdit = galleryReads
  await page.route(/\/api\/rpc\/write$/, route => route.abort('failed'))
  await page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Overview', exact: true }) })
    .getByRole('button', { name: 'Edit', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Screenshot name', { exact: true }).fill('Unconfirmed change')
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('No confirmation was received.')
  await expect.poll(() => galleryReads).toBeGreaterThan(beforeEdit)
  expect(missingSystemKey).toBe(false)
})
