import { defineConfig } from '@playwright/test'

// End-to-end tests drive the built Electron app in out-e2e/ (built by
// `npm run test:e2e`, kept apart from the dev server's out/).
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // One Electron app at a time keeps runs stable on CI machines.
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { trace: 'retain-on-failure' }
})
