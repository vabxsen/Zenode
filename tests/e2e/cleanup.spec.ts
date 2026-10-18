// Finding and deleting attachments nothing uses.
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, treeRow } from './fixture'

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"/>'

test('unused attachments are listed and only ticked ones are deleted', async ({ page, vaultDir, workDir }) => {
  const media = join(vaultDir, 'Media')
  mkdirSync(media)
  for (const name of ['used.svg', 'orphan.svg', 'keep.svg']) writeFileSync(join(media, name), SVG)
  writeFileSync(join(vaultDir, 'Gallery.md'), '![[used.svg]]\n')
  await expect(treeRow(page, 'Gallery')).toBeVisible()

  await page.keyboard.press('Control+p')
  await page.locator('.zn-switcher-input').fill('Find unused attachments')
  await page.keyboard.press('Enter')
  const dialog = page.locator('.zn-cleanup-dialog')
  await expect(dialog.locator('.zn-cleanup-path')).toHaveText(['Media/keep.svg', 'Media/orphan.svg'])
  await dialog.locator('.zn-cleanup-row', { hasText: 'keep.svg' }).locator('input').uncheck()
  await dialog.locator('button', { hasText: 'Delete ticked files' }).click()

  await expect.poll(() => existsSync(join(media, 'orphan.svg'))).toBe(false)
  expect(existsSync(join(media, 'keep.svg'))).toBe(true)
  expect(existsSync(join(media, 'used.svg'))).toBe(true)
  expect(readdirSync(join(workDir, 'trash')).some((f) => f.endsWith('orphan.svg'))).toBe(true)
  await expect(page.locator('.zn-notice').last()).toContainText('Moved 1 unused file')
})

test('with nothing unused, it says so', async ({ page }) => {
  await page.keyboard.press('Control+p')
  await page.locator('.zn-switcher-input').fill('Find unused attachments')
  await page.keyboard.press('Enter')
  await expect(page.locator('.zn-notice').last()).toContainText('No unused attachments')
})
