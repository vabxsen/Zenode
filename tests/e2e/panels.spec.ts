// Sidebar panels: outline, outgoing links, tags, bookmarks, unlinked mentions.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, test, treeRow } from './fixture'

const read = (vault: string, path: string): string => readFileSync(join(vault, path), 'utf8')
const leftTab = (page: Page, title: string) => page.locator(`.zn-sidebar .zn-sidebar-tab[aria-label="${title}"]`)
const rightTab = (page: Page, title: string) => page.locator(`.zn-rightbar .zn-sidebar-tab[aria-label="${title}"]`)

test('outline lists headings and jumps to one', async ({ page, vaultDir }) => {
  writeFileSync(join(vaultDir, 'Guide.md'), '# Guide\n\nIntro\n\n## Setup\n\nSteps\n\n### Details\n\nMore\n')
  await treeRow(page, 'Guide').click()
  await rightTab(page, 'Outline').click()
  const items = page.locator('.zn-outline-item')
  await expect(items).toHaveText(['Guide', 'Setup', 'Details'])
  await items.nth(2).click()
  await expect(page.locator('.cm-activeLine').first()).toContainText('Details')
})

test('outgoing links list the notes a note links to', async ({ page }) => {
  await treeRow(page, 'Home').click()
  await rightTab(page, 'Outgoing links').click()
  await expect(page.locator('.zn-outgoing-item:not(.is-unresolved) .zn-outgoing-name')).toHaveText(['Ideas', 'Roadmap'])
  await page.locator('.zn-outgoing-item', { hasText: 'Ideas' }).click()
  await expect(page.locator('.zn-tabbar .is-active')).toHaveText(/Ideas/)
})

test('tags panel counts tags and searches on click', async ({ page }) => {
  await leftTab(page, 'Tags').click()
  await expect(page.locator('.zn-tag-name')).toHaveText(['#brainstorm', '#draft'])
  await page.locator('.zn-tag-item', { hasText: '#draft' }).click()
  await expect(page.locator('.zn-search-input')).toHaveValue('tag:#draft')
  await expect(page.locator('.zn-search-results')).toContainText('Ideas')
})

test('bookmarks are saved, follow renames and open the file', async ({ page, vaultDir }) => {
  await treeRow(page, 'Ideas').click({ button: 'right' })
  await page.locator('.zn-menu-item', { hasText: /^Bookmark$/ }).click()
  await leftTab(page, 'Bookmarks').click()
  await expect(page.locator('.zn-bookmarks .zn-bookmark-name')).toHaveText(['Ideas'])
  await expect.poll(() => existsSync(join(vaultDir, '.zenode/bookmarks.json')) && read(vaultDir, '.zenode/bookmarks.json')).toContain('"Ideas.md"')

  // Renaming the file keeps the bookmark pointing at it.
  await leftTab(page, 'Files').click()
  await treeRow(page, 'Ideas').click({ button: 'right' })
  await page.locator('.zn-menu-item', { hasText: 'Rename' }).click()
  await page.locator('.zn-tree-rename').fill('Thoughts')
  await page.keyboard.press('Enter')
  await expect.poll(() => read(vaultDir, '.zenode/bookmarks.json')).toContain('"Thoughts.md"')

  await leftTab(page, 'Bookmarks').click()
  await page.locator('.zn-bookmarks .zn-bookmark-item', { hasText: 'Thoughts' }).click()
  await expect(page.locator('.zn-tabbar .is-active')).toHaveText(/Thoughts/)
})

test('unlinked mentions can be turned into links', async ({ page, vaultDir }) => {
  writeFileSync(join(vaultDir, 'Standup.md'), 'We talked about the roadmap today.\n')
  await expect(treeRow(page, 'Standup')).toBeVisible()
  await treeRow(page, 'Projects').click()
  await treeRow(page, 'Roadmap').click()
  await rightTab(page, 'Backlinks').click()
  await page.locator('.zn-mentions-toggle').click()
  const mention = page.locator('.zn-mention', { hasText: 'Standup' })
  await expect(mention).toContainText('We talked about the roadmap today.')
  await mention.locator('.zn-mention-link').click()
  await expect.poll(() => read(vaultDir, 'Standup.md')).toBe('We talked about the [[Roadmap|roadmap]] today.\n')
  // Now it's a backlink, not a mention.
  await expect(page.locator('.zn-backlinks')).toContainText('Standup')
  await expect(page.locator('.zn-mention')).toHaveCount(0)
})
