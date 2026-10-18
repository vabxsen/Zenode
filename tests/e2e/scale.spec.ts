// Long lists stay quick: the file tree draws only the rows in view, and
// backlinks show a page at a time.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, treeRow } from './fixture'

const MANY = 1200

test('a folder with many files draws only the rows in view', async ({ page, vaultDir }) => {
  const dir = join(vaultDir, 'Many')
  mkdirSync(dir)
  for (let i = 0; i < MANY; i++) writeFileSync(join(dir, `Item ${String(i).padStart(4, '0')}.md`), `# Item ${i}\n`)
  await expect(treeRow(page, 'Many')).toBeVisible()
  await treeRow(page, 'Many').click()
  await expect(treeRow(page, 'Item 0000')).toBeVisible()
  expect(await page.locator('.zn-tree-row').count()).toBeLessThan(150)

  // Scrolling to the end draws the last rows.
  await page.locator('.zn-sidebar-tree').evaluate((el) => (el.scrollTop = el.scrollHeight))
  await expect(treeRow(page, `Item ${MANY - 1}`)).toBeVisible()
  await expect(treeRow(page, 'Item 0000')).toHaveCount(0)

  // Opening a far-away note from the switcher, then revealing it, scrolls the tree there.
  await page.locator('.zn-sidebar-tree').evaluate((el) => (el.scrollTop = 0))
  await page.keyboard.press('Control+o')
  await page.locator('.zn-switcher-input').fill('Item 0600')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Control+p')
  await page.locator('.zn-switcher-input').fill('Reveal current file')
  await page.keyboard.press('Enter')
  await expect(treeRow(page, 'Item 0600')).toBeVisible()
  await expect(treeRow(page, 'Item 0600')).toHaveClass(/is-active/)
})

test('backlinks of a much-linked note come a page at a time', async ({ page, vaultDir }) => {
  writeFileSync(join(vaultDir, 'Hub.md'), '# Hub\n')
  const dir = join(vaultDir, 'Spokes')
  mkdirSync(dir)
  for (let i = 0; i < 150; i++) writeFileSync(join(dir, `Spoke ${i}.md`), `Points at [[Hub]].\n`)
  await expect(treeRow(page, 'Hub')).toBeVisible()
  await expect(page.locator('.zn-app[data-index="ready"]')).toHaveCount(1)
  await treeRow(page, 'Hub').click()
  await page.locator('.zn-rightbar .zn-sidebar-tab[aria-label="Backlinks"]').click()
  const groups = page.locator('.zn-backlinks .zn-backlink-note')
  await expect(groups).toHaveCount(100)
  await page.locator('.zn-backlinks-more').click()
  await expect(groups).toHaveCount(150)
  await expect(page.locator('.zn-backlinks-more')).toHaveCount(0)
})
