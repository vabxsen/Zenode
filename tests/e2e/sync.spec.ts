// Conflict copies left by sync apps are found and can be merged or tidied up.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from './fixture'

test('a OneDrive conflict copy is flagged and can be merged into the note', async ({ page, vaultDir, workDir }) => {
  const copy = join(vaultDir, 'Ideas-DESKTOP-PC42.md')
  writeFileSync(copy, '---\ntags: [brainstorm]\n---\n# Ideas\n\nBack to [[Home]]. #draft\n\nLINE FROM THE LAPTOP\n')
  const indicator = page.locator('.zn-status-sync')
  await expect(indicator).toHaveText(/1 sync conflict/)
  await indicator.click()
  const dialog = page.locator('.zn-dialog')
  await expect(dialog.locator('.zn-sync-row')).toContainText('Copy of Ideas.md (OneDrive, from DESKTOP-PC42)')
  await dialog.locator('button', { hasText: 'Compare and merge' }).click()

  const merge = page.locator('.zn-merge')
  await expect(merge.locator('.cm-merge-a')).toContainText('LINE FROM THE LAPTOP')
  // Copy the laptop's change across with the chunk's arrow, then save.
  await merge.locator('.cm-merge-revert button').first().click()
  await expect(merge.locator('.cm-merge-b')).toContainText('LINE FROM THE LAPTOP')
  await merge.locator('button', { hasText: 'Save and remove the copy' }).click()

  await expect.poll(() => readFileSync(join(vaultDir, 'Ideas.md'), 'utf8')).toContain('LINE FROM THE LAPTOP')
  await expect.poll(() => existsSync(copy)).toBe(false)
  // It went to the (test) trash, not into thin air.
  expect(readdirSync(join(workDir, 'trash')).some((f) => f.endsWith('Ideas-DESKTOP-PC42.md'))).toBe(true)
  await expect(dialog.locator('.zn-sync-empty')).toBeVisible()
  await dialog.locator('button', { hasText: 'Done' }).click()
  await expect(indicator).toBeHidden()
})

test('notes with merge markers are listed', async ({ page, vaultDir }) => {
  writeFileSync(join(vaultDir, 'Merged.md'), 'a\n<<<<<<< HEAD\nmine\n=======\ntheirs\n>>>>>>> origin/main\n')
  await page.locator('.zn-status-sync').click()
  await expect(page.locator('.zn-sync-row')).toContainText('contains merge markers')
})
