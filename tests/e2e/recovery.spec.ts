// Unsaved text survives a crash: the app is killed while a note can't be saved,
// and the next launch offers the text back.
import { chmodSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { crash, expect, test, treeRow } from './fixture'

// Types into Ideas while the file is read-only, so autosave fails and the text
// stays unsaved long enough to reach the recovery journal.
async function typeUnsaved(page: Page, file: string): Promise<void> {
  chmodSync(file, 0o444)
  await treeRow(page, 'Ideas').click()
  await page.locator('.cm-content').first().click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type('\nUNSAVED THOUGHT')
  await expect(page.locator('.zn-notice').last()).toContainText('Could not save')
  // Give the journal time to write (it runs 1.5 s after the last edit).
  await page.waitForTimeout(2500)
}

test('unsaved text is offered back after a crash and restored', async ({ app, page, vaultDir, relaunch }) => {
  const file = join(vaultDir, 'Ideas.md')
  await typeUnsaved(page, file)
  await crash(app)
  chmodSync(file, 0o666)
  expect(readFileSync(file, 'utf8')).not.toContain('UNSAVED THOUGHT')

  const second = await relaunch()
  const dialog = second.page.locator('.zn-dialog')
  await expect(dialog).toContainText('Recover unsaved changes')
  await expect(dialog).toContainText('Ideas')
  await dialog.locator('button', { hasText: 'Restore' }).click()
  await expect.poll(() => readFileSync(file, 'utf8')).toContain('UNSAVED THOUGHT')
})

test('restoring never overwrites a version that changed after the crash', async ({ app, page, vaultDir, relaunch }) => {
  const file = join(vaultDir, 'Ideas.md')
  await typeUnsaved(page, file)
  await crash(app)
  chmodSync(file, 0o666)
  writeFileSync(file, 'NEWER VERSION FROM ANOTHER DEVICE\n')

  const second = await relaunch()
  await second.page.locator('.zn-dialog button', { hasText: 'Restore' }).click()
  await expect(second.page.locator('.zn-conflict')).toBeVisible()
  await expect(second.page.locator('.cm-content').first()).toContainText('UNSAVED THOUGHT')
  await second.page.waitForTimeout(1500)
  expect(readFileSync(file, 'utf8')).toBe('NEWER VERSION FROM ANOTHER DEVICE\n')
})

test('file history keeps the version before a save and can restore it', async ({ page, vaultDir }) => {
  const file = join(vaultDir, 'Ideas.md')
  const original = readFileSync(file, 'utf8')
  await treeRow(page, 'Ideas').click()
  await page.locator('.cm-content').first().click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type('\nA REGRETTABLE EDIT')
  await expect.poll(() => readFileSync(file, 'utf8')).toContain('A REGRETTABLE EDIT')

  await treeRow(page, 'Ideas').click({ button: 'right' })
  await page.locator('.zn-menu-item', { hasText: 'Show file history' }).click()
  const dialog = page.locator('.zn-dialog')
  await expect(dialog.locator('.zn-history-row')).toHaveCount(1)
  await expect(dialog.locator('.zn-history-preview')).toHaveText(original)
  await dialog.locator('button', { hasText: 'Restore this version' }).click()
  await expect(page.locator('.cm-content').first()).not.toContainText('A REGRETTABLE EDIT')
  await expect.poll(() => readFileSync(file, 'utf8')).toBe(original)
})

test('a clean quit leaves nothing to recover', async ({ app, page, relaunch }) => {
  await treeRow(page, 'Ideas').click()
  await page.locator('.cm-content').first().click()
  await page.keyboard.type('saved normally ')
  await app.close()
  const second = await relaunch()
  await expect(second.page.locator('.cm-content').first()).toContainText('saved normally')
  await second.page.waitForTimeout(1000)
  await expect(second.page.locator('.zn-dialog')).toHaveCount(0)
})
