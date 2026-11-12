import { defineConfig } from '@playwright/test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export default defineConfig({
  testDir: 'tests/browser',
  workers: 1,
  retries: 0,
  timeout: 60000,
  expect: { timeout: 10000 },
  outputDir: process.env.CLASSROOM_QA_OUTPUT || join(tmpdir(), 'classroom-browser-results'),
  reporter: 'list',
  use: {
    browserName: 'chromium',
    channel: process.env.CHROMIUM_CHANNEL || undefined,
    viewport: { width: 1366, height: 768 },
    trace: 'off',
    video: 'off',
  },
})
