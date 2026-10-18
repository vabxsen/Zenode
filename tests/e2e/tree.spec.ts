// File tree: moving by drag and drop or "Move to…", multi-select, sorting.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, treeRow } from './fixture'

const read = (vault: string, path: string): string => readFileSync(join(vault, path), 'utf8')

test('dragging a note onto a folder moves it and updates links', async ({ page, vaultDir }) => {
  await treeRow(page, 'Ideas').dragTo(treeRow(page, 'Projects'))
  await expect.poll(() => existsSync(join(vaultDir, 'Projects/Ideas.md'))).toBe(true)
  expect(existsSync(join(vaultDir, 'Ideas.md'))).toBe(false)
  // Home linked [[Ideas]]; the name is still unique, so the link text stays and resolves.
  await expect.poll(() => read(vaultDir, 'Home.md')).toContain('[[Ideas]]')
  await expect(page.locator('.zn-notice').last()).not.toContainText('Could not')
})

test('moving a note rewrites path links that pointed at it', async ({ page, vaultDir }) => {
  await treeRow(page, 'Projects').click()
  // Home.md links to [[Projects/Roadmap]]; move Roadmap to the vault root.
  await treeRow(page, 'Roadmap').dragTo(page.locator('.zn-tree'), { targetPosition: { x: 40, y: 400 } })
  await expect.poll(() => existsSync(join(vaultDir, 'Roadmap.md'))).toBe(true)
  await expect.poll(() => read(vaultDir, 'Home.md')).toContain('Start at [[Roadmap]]')
})

test('"Move to…" picks a folder', async ({ page, vaultDir }) => {
  await treeRow(page, 'Formatting').click({ button: 'right' })
  await page.locator('.zn-menu-item', { hasText: 'Move to…' }).click()
  await page.locator('.zn-switcher-input').fill('proj')
  await page.keyboard.press('Enter')
  await expect.poll(() => existsSync(join(vaultDir, 'Projects/Formatting.md'))).toBe(true)
})

test('Ctrl+click selects several items for one delete', async ({ page, vaultDir }) => {
  await treeRow(page, 'Ideas').click()
  await treeRow(page, 'Formatting').click({ modifiers: ['Control'] })
  await expect(page.locator('.zn-tree-row.is-selected')).toHaveCount(2)
  page.once('dialog', (d) => void d.accept())
  await treeRow(page, 'Formatting').click({ button: 'right' })
  await page.locator('.zn-menu-item', { hasText: 'Delete 2 items' }).click()
  await expect.poll(() => [existsSync(join(vaultDir, 'Ideas.md')), existsSync(join(vaultDir, 'Formatting.md'))]).toEqual([false, false])
})

test('sort order can be changed from the tree header', async ({ page }) => {
  const labels = page.locator('.zn-tree > .zn-tree-row .zn-tree-label')
  await expect(labels.first()).toHaveText('Projects')
  await page.locator('.zn-tree-tool[aria-label="Change sort order"]').click()
  await page.locator('.zn-menu-item', { hasText: 'File name (Z to A)' }).click()
  // Folders still come first; files are Z to A.
  await expect(labels).toHaveText(['Projects', 'Ideas', 'Home', 'Formatting', 'Board'])
})

test('typing a new name survives the tree refreshing underneath', async ({ page, vaultDir }) => {
  await treeRow(page, 'Ideas').click({ button: 'right' })
  await page.locator('.zn-menu-item', { hasText: 'Rename' }).click()
  await expect(page.locator('.zn-tree-rename')).toBeFocused()
  await page.keyboard.press('Control+a')
  for (const [i, ch] of [...'Brainstorm'].entries()) {
    // Each new file makes the tree redraw while the rename box is open.
    writeFileSync(join(vaultDir, `noise ${i}.md`), '')
    await page.waitForTimeout(60)
    await page.keyboard.type(ch)
  }
  await page.keyboard.press('Enter')
  await expect.poll(() => existsSync(join(vaultDir, 'Brainstorm.md'))).toBe(true)
})
