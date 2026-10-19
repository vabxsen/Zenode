// Opening Zenode from Windows: note files, folders and zenode:// links, at
// start-up and while it's running; and update checks against a local feed.
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import electronPath from 'electron'
import { expect, MAIN, test, testEnv, treeRow } from './fixture'

// Launches Zenode again (a second instance) with these arguments; it hands them
// to the running one and exits.
async function launchAgain(workDir: string, ...args: string[]): Promise<number | null> {
  const child = spawn(electronPath as unknown as string, [MAIN, ...args], { env: testEnv(workDir), stdio: 'ignore' })
  return new Promise((done) => child.on('exit', done))
}

const activeTab = (page: Page) => page.locator('.zn-pane-leaf .zn-tab.is-active .zn-tab-title')

test('a note opened from Explorer opens in the window that has its vault', async ({ app, page, workDir, vaultDir }) => {
  expect(await launchAgain(workDir, join(vaultDir, 'Ideas.md'))).toBe(0)
  await expect(activeTab(page)).toHaveText('Ideas')
  expect(app.windows()).toHaveLength(1)
})

test('a note outside the open vaults opens its folder in a new window', async ({ app, page, workDir }) => {
  const loose = join(workDir, 'loose')
  mkdirSync(loose)
  writeFileSync(join(loose, 'Loose note.md'), '# Loose\n')
  const opened = app.waitForEvent('window')
  await launchAgain(workDir, join(loose, 'Loose note.md'))
  const win = await opened
  await expect(activeTab(win)).toHaveText('Loose note')
  await expect(treeRow(win, 'Loose note')).toBeVisible()
  await expect(treeRow(page, 'Loose note')).toHaveCount(0)
})

test('zenode:// links open notes, only in vaults Zenode knows', async ({ app, page, workDir }) => {
  // As Windows starts it for a link: "--" first, so the link can't add switches.
  await launchAgain(workDir, '--', 'zenode://open?vault=vault&file=Formatting')
  await expect(activeTab(page)).toHaveText('Formatting')
  await launchAgain(workDir, 'zenode://open?vault=vault&file=Projects%2FRoadmap.md')
  await expect(activeTab(page)).toHaveText('Roadmap')
  // Outside the vault, an unknown vault, an unknown action: nothing opens.
  writeFileSync(join(workDir, 'outside.md'), 'no\n')
  await launchAgain(workDir, 'zenode://open?vault=vault&file=..%2Foutside.md')
  await launchAgain(workDir, 'zenode://open?vault=Somewhere%20else&file=Home')
  await launchAgain(workDir, 'zenode://settings')
  await launchAgain(workDir, 'zenode://open?vault=vault&file=Home')
  await expect(activeTab(page)).toHaveText('Home')
  await expect(page.locator('.zn-tab-title', { hasText: 'outside' })).toHaveCount(0)
  expect(app.windows()).toHaveLength(1)
})

test('"Open folder as Zenode vault" opens the folder in its own window', async ({ app, page, workDir }) => {
  const folder = join(workDir, 'Some folder')
  mkdirSync(folder)
  writeFileSync(join(folder, 'Inside.md'), 'hi\n')
  const opened = app.waitForEvent('window')
  await launchAgain(workDir, `--open-folder=${folder}`)
  const win = await opened
  await expect(treeRow(win, 'Inside')).toBeVisible()
  await expect(treeRow(page, 'Home')).toBeVisible()
})

test('Zenode started with a note opens that note', async ({ app, vaultDir, relaunch }) => {
  await app.close()
  const { page } = await relaunch({ args: [join(vaultDir, 'Ideas.md')] })
  await expect(activeTab(page)).toHaveText('Ideas')
})

test('Settings shows when a newer version is out', async ({ app, relaunch }) => {
  // A local update feed with a much newer version.
  const server = createServer((req, res) => {
    if (req.url?.startsWith('/latest.yml')) {
      res.setHeader('Content-Type', 'text/yaml')
      res.end(
        [
          'version: 99.0.0',
          'files:',
          '  - url: Zenode-Setup-99.0.0.exe',
          '    sha512: AAAA',
          '    size: 1',
          'path: Zenode-Setup-99.0.0.exe',
          'sha512: AAAA',
          "releaseDate: '2026-10-01T00:00:00.000Z'"
        ].join('\n')
      )
    } else {
      res.statusCode = 404
      res.end()
    }
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  try {
    const port = (server.address() as AddressInfo).port
    await app.close()
    const { page } = await relaunch({ env: { ZENODE_TEST_UPDATE_FEED: `http://127.0.0.1:${port}/` } })
    await page.keyboard.press('Control+,')
    await page.locator('.zn-settings-tab', { hasText: 'General' }).click()
    const status = page.locator('.zn-update-status')
    const row = page.locator('.zn-set-row', { has: status })
    await row.getByRole('button', { name: 'Check now' }).click()
    await expect(status).toHaveText('Zenode 99.0.0 is available to download.')
    await expect(row.getByRole('button', { name: 'Download' })).toBeVisible()
    await expect(page.locator('.zn-notice', { hasText: 'Zenode 99.0.0 is out.' })).toBeVisible()
    await expect(page.getByRole('switch', { name: 'Check automatically' })).toBeChecked()
  } finally {
    server.close()
  }
})
