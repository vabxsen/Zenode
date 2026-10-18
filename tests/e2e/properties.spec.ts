// Properties: front matter edited through the Properties table.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, test, treeRow } from './fixture'

const read = (vault: string, path: string): string => readFileSync(join(vault, path), 'utf8')
const row = (page: Page, key: string) => page.locator(`.zn-prop-row[data-key="${key}"]`)

async function openIdeas(page: Page): Promise<void> {
  await treeRow(page, 'Ideas').click()
  await expect(page.locator('.zn-props')).toBeVisible()
}

async function save(page: Page): Promise<void> {
  await page.keyboard.press('Control+s')
}

test('front matter shows as properties and tags can be added', async ({ page, vaultDir }) => {
  await openIdeas(page)
  await expect(row(page, 'tags').locator('.zn-prop-chip')).toHaveText(['#brainstorm×'])
  await row(page, 'tags').locator('.zn-prop-chip-input').fill('#idea')
  await page.keyboard.press('Enter')
  await expect(row(page, 'tags').locator('.zn-prop-chip')).toHaveCount(2)
  // Focus stays in the tag box for the next one.
  await expect(row(page, 'tags').locator('.zn-prop-chip-input')).toBeFocused()
  await save(page)
  await expect.poll(() => read(vaultDir, 'Ideas.md')).toBe('---\ntags: [brainstorm, idea]\n---\n# Ideas\n\nBack to [[Home]]. #draft\n')
})

test('a new property is added and given a value', async ({ page, vaultDir }) => {
  await openIdeas(page)
  await page.locator('.zn-props-add').click()
  await page.keyboard.type('status')
  await page.keyboard.press('Enter')
  await expect(row(page, 'status').locator('.zn-prop-input')).toBeFocused()
  await page.keyboard.type('draft')
  await page.keyboard.press('Enter')
  await save(page)
  await expect.poll(() => read(vaultDir, 'Ideas.md')).toContain('---\ntags: [brainstorm]\nstatus: draft\n---\n')
})

test('changing a type converts the value and is remembered for the vault', async ({ page, vaultDir }) => {
  await openIdeas(page)
  await page.locator('.zn-props-add').click()
  await page.keyboard.type('done')
  await page.keyboard.press('Enter')
  await row(page, 'done').locator('.zn-prop-type').click()
  await page.locator('.zn-menu-item', { hasText: 'Checkbox' }).click()
  const box = row(page, 'done').locator('.zn-prop-check')
  await expect(box).not.toBeChecked()
  await box.check()
  await save(page)
  await expect.poll(() => read(vaultDir, 'Ideas.md')).toContain('done: true\n---')
  await expect.poll(() => existsSync(join(vaultDir, '.zenode/types.json')) && JSON.parse(read(vaultDir, '.zenode/types.json'))).toEqual({ types: { done: 'checkbox' } })
})

test('a property can be renamed and removed', async ({ page, vaultDir }) => {
  await openIdeas(page)
  await row(page, 'tags').locator('.zn-prop-key').fill('topics')
  await page.keyboard.press('Enter')
  await expect(row(page, 'topics')).toBeVisible()
  await save(page)
  await expect.poll(() => read(vaultDir, 'Ideas.md')).toContain('---\ntopics: [brainstorm]\n---')
  await row(page, 'topics').locator('.zn-prop-type').click()
  await page.locator('.zn-menu-item', { hasText: 'Remove property' }).click()
  await expect(page.locator('.zn-prop-row')).toHaveCount(0)
  await save(page)
  await expect.poll(() => read(vaultDir, 'Ideas.md')).toMatch(/^---\n---\n# Ideas/)
})
