// First run and choosing vaults: create one, open the Help vault, forget a recent one.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ElectronApplication, Page } from '@playwright/test'
import { expect, test, treeRow } from './fixture'

// Restarts on the welcome screen (no last vault), keeping `vaultDir` as a recent one.
async function welcome(app: ElectronApplication, workDir: string, vaultDir: string, relaunch: (opts?: { withVault?: boolean }) => Promise<{ page: Page }>): Promise<Page> {
  await app.close()
  writeFileSync(join(workDir, 'userdata', 'zenode-settings.json'), JSON.stringify({ recentVaults: [vaultDir], workspaces: {} }))
  const { page } = await relaunch({ withVault: false })
  await expect(page.locator('.zn-welcome')).toBeVisible()
  return page
}

test('a new vault is created from the welcome screen', async ({ app, workDir, vaultDir, relaunch }) => {
  const page = await welcome(app, workDir, vaultDir, relaunch)
  await expect(page.locator('.zn-vault-action-title')).toHaveText(['Create a new vault', 'Open folder as vault', 'Open the Zenode Help vault'])
  await page.locator('.zn-vault-action', { hasText: 'Create a new vault' }).click()
  const input = page.locator('.zn-prompt-input')
  await expect(input).toBeFocused()
  await input.fill('Bad:name')
  await expect(page.locator('.zn-prompt-problem')).toContainText("can't contain")
  await expect(page.locator('.zn-dialog .zn-btn-primary')).toBeDisabled()
  await input.fill('My notes')
  await page.keyboard.press('Enter')
  await expect(treeRow(page, 'Welcome')).toBeVisible()
  expect(existsSync(join(workDir, 'vaults', 'My notes', 'Welcome.md'))).toBe(true)
})

test('the Help vault opens and its links work', async ({ app, workDir, vaultDir, relaunch }) => {
  const page = await welcome(app, workDir, vaultDir, relaunch)
  await page.locator('.zn-vault-action', { hasText: 'Help vault' }).click()
  await expect(treeRow(page, 'Welcome to Zenode')).toBeVisible()
  await treeRow(page, 'Welcome to Zenode').click()
  await page.locator('.cm-content .zn-internal', { hasText: 'Keyboard shortcuts' }).first().click({ modifiers: ['Control'] })
  await expect(page.locator('.zn-tabbar .is-active')).toHaveText(/Keyboard shortcuts/)
  expect(existsSync(join(workDir, 'userdata', 'Zenode Help', 'Welcome to Zenode.md'))).toBe(true)
})

test('a recent vault can be removed from the list', async ({ app, workDir, vaultDir, relaunch }) => {
  const page = await welcome(app, workDir, vaultDir, relaunch)
  await expect(page.locator('.zn-recent-row')).toHaveCount(1)
  await page.locator('.zn-recent-forget').click()
  await expect(page.locator('.zn-recent-row')).toHaveCount(0)
  const settings = JSON.parse(readFileSync(join(workDir, 'userdata', 'zenode-settings.json'), 'utf8'))
  expect(settings.recentVaults).toEqual([])
  expect(existsSync(vaultDir)).toBe(true)
})

test('Ctrl+Shift+O lists vaults and opens the Help vault in a new window', async ({ app, page }) => {
  await page.keyboard.press('Control+Shift+o')
  const dialog = page.locator('.zn-vault-manager')
  await expect(dialog.locator('.zn-recent-row.is-current')).toContainText('(this window)')
  const opened = app.waitForEvent('window')
  await dialog.locator('.zn-vault-action', { hasText: 'Help vault' }).click()
  const help = await opened
  await expect(treeRow(help, 'Welcome to Zenode')).toBeVisible()
  await expect(page.locator('.zn-vault-manager')).toHaveCount(0)
})
