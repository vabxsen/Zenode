// A note edited here AND changed outside Zenode before the edit is saved must
// never be silently overwritten either way.
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, test, treeRow } from './fixture'

const read = (vault: string, path: string): string => readFileSync(join(vault, path), 'utf8')

// Opens Roadmap, types at the end, and changes the file on disk straight away
// (before autosave), so the edit and the outside change collide.
async function collide(page: Page, vaultDir: string, outside: string | null): Promise<void> {
  await treeRow(page, 'Projects').click()
  await treeRow(page, 'Roadmap').click()
  const editor = page.locator('.cm-content').first()
  await editor.click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type('\nMY LINE')
  const file = join(vaultDir, 'Projects/Roadmap.md')
  if (outside === null) rmSync(file)
  else writeFileSync(file, outside)
  await expect(page.locator('.zn-conflict')).toBeVisible()
}

test('outside change + unsaved edit: nothing is overwritten, keep mine wins on request', async ({ page, vaultDir }) => {
  await collide(page, vaultDir, '# Roadmap\n\nEDITED ELSEWHERE\n')
  await expect(page.locator('.zn-tabbar .is-active')).toHaveClass(/has-conflict/)
  // Autosave is paused: the outside version stays on disk.
  await page.waitForTimeout(1500)
  expect(read(vaultDir, 'Projects/Roadmap.md')).toBe('# Roadmap\n\nEDITED ELSEWHERE\n')
  await page.locator('.zn-conflict button', { hasText: 'Keep my version' }).click()
  await expect(page.locator('.zn-conflict')).toBeHidden()
  await expect.poll(() => read(vaultDir, 'Projects/Roadmap.md')).toContain('MY LINE')
})

test('use the version on disk replaces the editor text', async ({ page, vaultDir }) => {
  await collide(page, vaultDir, 'FROM DISK\n')
  await page.locator('.zn-conflict button', { hasText: 'Use the version on disk' }).click()
  await expect(page.locator('.zn-conflict')).toBeHidden()
  await expect(page.locator('.cm-content').first()).toHaveText('FROM DISK')
  await page.waitForTimeout(1000)
  expect(read(vaultDir, 'Projects/Roadmap.md')).toBe('FROM DISK\n')
})

test('compare lets the user merge both versions', async ({ page, vaultDir }) => {
  await collide(page, vaultDir, '# Roadmap\n\nTHEIR LINE\n')
  await page.locator('.zn-conflict button', { hasText: 'Compare' }).click()
  const merge = page.locator('.zn-merge')
  await expect(merge).toBeVisible()
  await expect(merge.locator('.cm-merge-a')).toContainText('THEIR LINE')
  await expect(merge.locator('.cm-merge-b')).toContainText('MY LINE')
  // Edit the right-hand side to keep both lines, then save.
  await merge.locator('.cm-merge-b .cm-content').click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type('\nTHEIR LINE')
  await merge.locator('button', { hasText: 'Save my version' }).click()
  await expect(merge).toBeHidden()
  await expect.poll(() => read(vaultDir, 'Projects/Roadmap.md')).toMatch(/MY LINE[\s\S]*THEIR LINE/)
})

test('a note deleted outside Zenode keeps unsaved text and can be saved again', async ({ page, vaultDir }) => {
  await collide(page, vaultDir, null)
  await expect(page.locator('.zn-conflict')).toContainText('deleted or moved')
  await page.locator('.zn-conflict button', { hasText: 'Save it again' }).click()
  await expect(page.locator('.zn-conflict')).toBeHidden()
  await expect.poll(() => existsSync(join(vaultDir, 'Projects/Roadmap.md')) && read(vaultDir, 'Projects/Roadmap.md')).toContain('MY LINE')
})

test('a conflicted tab cannot be closed by accident', async ({ page, vaultDir }) => {
  await collide(page, vaultDir, 'OTHER\n')
  await page.keyboard.press('Control+w')
  await expect(page.locator('.zn-tabbar .zn-tab', { hasText: 'Roadmap' })).toHaveCount(1)
  await expect(page.locator('.zn-notice').last()).toContainText('Choose a version first')
})

test('outside change without unsaved edits just reloads', async ({ page, vaultDir }) => {
  await treeRow(page, 'Home').click()
  await expect(page.locator('.cm-content').first()).toContainText('zephyr')
  writeFileSync(join(vaultDir, 'Home.md'), '# Home\n\nRewritten outside.\n')
  await expect(page.locator('.cm-content').first()).toContainText('Rewritten outside.')
  await expect(page.locator('.zn-conflict')).toBeHidden()
})
