import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, treeRow } from './fixture'

const read = (vault: string, path: string): string => readFileSync(join(vault, path), 'utf8')

test('opens the vault and lists its files', async ({ page }) => {
  await expect(treeRow(page, 'Home')).toBeVisible()
  await expect(treeRow(page, 'Ideas')).toBeVisible()
  await expect(treeRow(page, 'Board')).toBeVisible()
  await expect(treeRow(page, 'Projects')).toBeVisible()
  // Config lives in .zenode/, which stays out of the tree.
  await expect(treeRow(page, '.zenode')).toHaveCount(0)
})

test('creates a note, names it and saves what is typed', async ({ page, vaultDir }) => {
  await page.keyboard.press('Control+n')
  const rename = page.locator('.zn-tree-rename')
  await expect(rename).toBeFocused()
  await rename.fill('Meeting notes')
  await rename.press('Enter')
  await expect(page.locator('.zn-tabbar .is-active')).toHaveText(/Meeting notes/)
  await expect(page.locator('.cm-content').first()).toBeFocused()
  await page.keyboard.type('Agenda for [[Home]]')
  await page.keyboard.press('Control+s')
  await expect.poll(() => existsSync(join(vaultDir, 'Meeting notes.md')) && read(vaultDir, 'Meeting notes.md')).toBe('Agenda for [[Home]]')
})

test('renaming a note rewrites links to it', async ({ page, vaultDir }) => {
  await treeRow(page, 'Ideas').click({ button: 'right' })
  await page.locator('.zn-menu-item', { hasText: 'Rename' }).click()
  const rename = page.locator('.zn-tree-rename')
  await rename.fill('Brainstorm')
  await rename.press('Enter')
  await expect(treeRow(page, 'Brainstorm')).toBeVisible()
  await expect.poll(() => read(vaultDir, 'Home.md')).toContain('[[Brainstorm]]')
  // The canvas card text links to it too.
  await expect.poll(() => read(vaultDir, 'Board.canvas')).toContain('See [[Brainstorm]]')
})

test('search finds text and opens the note', async ({ page }) => {
  await page.keyboard.press('Control+Shift+f')
  const input = page.locator('.zn-search-input')
  await expect(input).toBeFocused()
  await input.fill('zephyr')
  const hit = page.locator('.zn-search-note', { hasText: 'Home' })
  await expect(hit).toBeVisible()
  await hit.locator('.zn-search-line').first().click()
  await expect(page.locator('.zn-tabbar .is-active')).toHaveText(/Home/)
})

test('opens a canvas with its cards and connection', async ({ page }) => {
  await treeRow(page, 'Board').click()
  const canvas = page.locator('.zn-canvas:visible')
  await expect(canvas.locator('.zn-cnode')).toHaveCount(2)
  await expect(canvas.locator('.zn-cedge')).toHaveCount(1)
  await expect(canvas.locator('.zn-cnode-body')).toContainText('Ship the beta')
})

test('uncaught renderer errors are written to the app log', async ({ page, workDir }) => {
  await page.evaluate(() => setTimeout(() => { throw new Error('e2e-log-probe') }))
  const logFile = join(workDir, 'userdata', 'logs', 'zenode.log')
  await expect.poll(() => (existsSync(logFile) ? readFileSync(logFile, 'utf8') : '')).toContain('e2e-log-probe')
})

test('quick switcher opens a note by fuzzy name', async ({ page }) => {
  await page.keyboard.press('Control+o')
  await page.locator('.zn-switcher-input').fill('rdmp')
  await page.keyboard.press('Enter')
  await expect(page.locator('.zn-tabbar .is-active')).toHaveText(/Roadmap/)
})

test('command palette finds and runs a command', async ({ page }) => {
  await page.keyboard.press('Control+p')
  const input = page.locator('.zn-palette .zn-switcher-input')
  await expect(input).toBeFocused()
  await input.fill('graph')
  const row = page.locator('.zn-palette-row').first()
  await expect(row).toContainText('Graph view: open')
  await expect(row.locator('kbd')).toHaveText('Ctrl+G')
  await page.keyboard.press('Enter')
  await expect(page.locator('.zn-palette')).toHaveCount(0)
  await expect(page.locator('.zn-tabbar .is-active')).toHaveText(/Graph view/)
  // The command just used is listed first next time.
  await page.keyboard.press('Control+p')
  await expect(page.locator('.zn-palette-row').first()).toContainText('Graph view: open')
})
