// Daily notes and templates.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, test, treeRow } from './fixture'

const read = (vault: string, path: string): string => readFileSync(join(vault, path), 'utf8')
const pad = (n: number): string => String(n).padStart(2, '0')
const today = (): string => {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

async function runCommand(page: Page, name: string): Promise<void> {
  await page.keyboard.press('Control+p')
  await page.locator('.zn-switcher-input').fill(name)
  await page.keyboard.press('Enter')
}

test("Ctrl+Shift+D creates and opens today's note", async ({ page, vaultDir }) => {
  await page.keyboard.press('Control+Shift+d')
  await expect.poll(() => existsSync(join(vaultDir, `${today()}.md`))).toBe(true)
  await expect(page.locator('.zn-tabbar .is-active')).toHaveText(new RegExp(today()))
  // Again: the same note, not a copy.
  await page.keyboard.press('Control+Shift+d')
  await expect(page.locator('.zn-tabbar .zn-tab', { hasText: today() })).toHaveCount(1)
  expect(existsSync(join(vaultDir, `${today()} 1.md`))).toBe(false)
})

test('daily notes use the configured folder and template', async ({ page, vaultDir }) => {
  mkdirSync(join(vaultDir, '.zenode'), { recursive: true })
  writeFileSync(join(vaultDir, '.zenode/daily-notes.json'), JSON.stringify({ folder: 'Journal', template: 'Templates/Day' }))
  mkdirSync(join(vaultDir, 'Templates'))
  writeFileSync(join(vaultDir, 'Templates/Day.md'), '# {{title}}\n\nWritten {{date:YYYY}}.\n')
  await page.locator('.zn-ribbon-btn[aria-label^="Open today"]').click()
  const file = `Journal/${today()}.md`
  await expect.poll(() => existsSync(join(vaultDir, file))).toBe(true)
  expect(read(vaultDir, file)).toBe(`# ${today()}\n\nWritten ${new Date().getFullYear()}.\n`)
})

test('a template is inserted at the cursor with its properties on top', async ({ page, vaultDir }) => {
  mkdirSync(join(vaultDir, 'Templates'))
  writeFileSync(join(vaultDir, 'Templates/Meeting.md'), '---\ntype: meeting\ntags: [ignored]\n---\n## {{title}} notes\n')
  await expect(treeRow(page, 'Templates')).toBeVisible()
  await treeRow(page, 'Formatting').click()
  await page.locator('.cm-content').first().click()
  await page.keyboard.press('Control+End')
  await runCommand(page, 'Insert template')
  await page.locator('.zn-switcher-input').fill('Meeting')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Control+s')
  await expect.poll(() => read(vaultDir, 'Formatting.md')).toMatch(/^---\ntype: meeting\ntags: \[ignored\]\n---\n# Formatting\n/)
  expect(read(vaultDir, 'Formatting.md').endsWith('![[Ideas]]\n## Formatting notes\n')).toBe(true)
})
