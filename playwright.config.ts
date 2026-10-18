import { defineConfig } from '@playwright/test'

// End-to-end tests drive the built Electron app (run `npm run build` first;
// `npm run test:e2e` does both).
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
