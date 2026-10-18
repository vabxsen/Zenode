// Where deleted files go.
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, test, treeRow } from './fixture'

async function remove(page: Page, name: string): Promise<void> {
  page.once('dialog', (d) => void d.accept())
  await treeRow(page, name).click({ button: 'right' })
  await page.locator('.zn-menu-item', { hasText: /^Delete$/ }).click()
}

test("with trashOption local, deletes go to the vault's .trash folder", async ({ page, vaultDir, workDir }) => {
  mkdirSync(join(vaultDir, '.zenode'), { recursive: true })
  writeFileSync(join(vaultDir, '.zenode/app.json'), JSON.stringify({ trashOption: 'local' }))
  await remove(page, 'Ideas')
  await expect.poll(() => existsSync(join(vaultDir, '.trash/Ideas.md'))).toBe(true)
  await expect(treeRow(page, 'Ideas')).toHaveCount(0)
  // A second file with the same name doesn't replace the first.
  writeFileSync(join(vaultDir, 'Ideas.md'), 'again\n')
  await expect(treeRow(page, 'Ideas')).toBeVisible()
  await remove(page, 'Ideas')
  await expect.poll(() => readdirSync(join(vaultDir, '.trash')).sort()).toEqual(['Ideas 1.md', 'Ideas.md'])
  // Folders too; the .trash folder itself never shows in the tree.
  await remove(page, 'Projects')
  await expect.poll(() => existsSync(join(vaultDir, '.trash/Projects/Roadmap.md'))).toBe(true)
  await expect(treeRow(page, '.trash')).toHaveCount(0)
  expect(existsSync(join(workDir, 'trash'))).toBe(false)
})

test('by default deletes go to the Recycle Bin', async ({ page, vaultDir, workDir }) => {
  await remove(page, 'Ideas')
  // Tests use their own folder in place of the real Recycle Bin.
  await expect.poll(() => existsSync(join(workDir, 'trash')) && readdirSync(join(workDir, 'trash')).some((f) => f.endsWith('Ideas.md'))).toBe(true)
  expect(existsSync(join(vaultDir, '.trash'))).toBe(false)
})

test('the delete command switches where deletes go', async ({ page, vaultDir }) => {
  await page.keyboard.press('Control+p')
  await page.locator('.zn-switcher-input').fill('Deleted files')
  await page.keyboard.press('Enter')
  await expect(page.locator('.zn-notice').last()).toContainText(".trash folder")
  await remove(page, 'Formatting')
  await expect.poll(() => existsSync(join(vaultDir, '.trash/Formatting.md'))).toBe(true)
})
