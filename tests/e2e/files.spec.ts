// File edge cases and the promise that Zenode leaves files it only reads alone.
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { expect, test, treeRow } from './fixture'

function hashTree(root: string, dir = root): Record<string, string> {
  const out: Record<string, string> = {}
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    // .zenode/ is Zenode's own config (open tabs), not user content.
    if (name === '.zenode') continue
    if (statSync(full).isDirectory()) Object.assign(out, hashTree(root, full))
    else out[relative(root, full)] = createHash('sha256').update(readFileSync(full)).digest('hex')
  }
  return out
}

test('opening and browsing every file changes nothing on disk', async ({ app, page, vaultDir }) => {
  // A note written by a Windows editor (CRLF line endings, byte-order mark).
  writeFileSync(join(vaultDir, 'Windows note.md'), '﻿# From Notepad\r\n\r\nLine one\r\nLine two\r\n')
  await expect(treeRow(page, 'Windows note')).toBeVisible()
  const before = hashTree(vaultDir)
  await treeRow(page, 'Projects').click()
  for (const name of ['Home', 'Ideas', 'Roadmap', 'Board', 'Windows note']) {
    await treeRow(page, name).click()
    await page.waitForTimeout(300)
  }
  await page.keyboard.press('Control+g')
  await page.waitForTimeout(500)
  await app.close()
  expect(hashTree(vaultDir)).toEqual(before)
})

test('editing a CRLF note keeps its line endings', async ({ page, vaultDir }) => {
  const file = join(vaultDir, 'Windows note.md')
  writeFileSync(file, '# From Notepad\r\n\r\nLine one\r\n')
  await treeRow(page, 'Windows note').click()
  await page.locator('.cm-content').first().click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type('Line two')
  await page.keyboard.press('Enter')
  await expect.poll(() => readFileSync(file, 'utf8')).toBe('# From Notepad\r\n\r\nLine one\r\nLine two\r\n')
})

test('an invalid name is refused with a clear message', async ({ page }) => {
  await treeRow(page, 'Ideas').click({ button: 'right' })
  await page.locator('.zn-menu-item', { hasText: 'Rename' }).click()
  const rename = page.locator('.zn-tree-rename')
  await rename.fill('What: now?')
  await rename.press('Enter')
  await expect(page.locator('.zn-notice').last()).toHaveText('Names can\'t contain ":". Avoid < > : " / \\ | ? *')
  await expect(treeRow(page, 'Ideas')).toBeVisible()
})

test('a very large note asks before opening', async ({ page, vaultDir }) => {
  writeFileSync(join(vaultDir, 'Huge log.md'), 'x'.repeat(5_200_000))
  await treeRow(page, 'Huge log').click()
  const dialog = page.locator('.zn-dialog')
  await expect(dialog).toContainText('Open a very large note?')
  await dialog.locator('button', { hasText: 'Cancel' }).click()
  await expect(page.locator('.zn-tabbar .zn-tab', { hasText: 'Huge log' })).toHaveCount(0)
})
