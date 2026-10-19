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
  // The watcher can deliver the new files in more than one batch. Count once the
  // tree has all of them (its scroll height covers every row, 28px each).
  await expect.poll(() => page.locator('.zn-sidebar-tree').evaluate((el) => el.scrollHeight)).toBeGreaterThan(MANY * 28)
  expect(await page.locator('.zn-tree-row').count()).toBeLessThan(150)

  // Scrolling to the end draws the last rows.
  // The watcher may still be delivering the new files: scroll again until the last one is in.
  await expect(async () => {
    await page.locator('.zn-sidebar-tree').evaluate((el) => (el.scrollTop = el.scrollHeight))
    await expect(treeRow(page, `Item ${MANY - 1}`)).toBeVisible({ timeout: 1000 })
  }).toPass()
  await expect(treeRow(page, 'Item 0000')).toHaveCount(0)

  // Opening a far-away note from the switcher, then revealing it, scrolls the tree there.
  await page.locator('.zn-sidebar-tree').evaluate((el) => (el.scrollTop = 0))
  // The switcher lists indexed notes, so reopen it until the new files are in.
  await expect(async () => {
    if (await page.locator('.zn-switcher-input').count()) await page.keyboard.press('Escape')
    await page.keyboard.press('Control+o')
    await page.locator('.zn-switcher-input').fill('Item 0600')
    await expect(page.locator('.zn-switcher-row.is-selected')).toContainText('Item 0600', { timeout: 1000 })
  }).toPass()
  await page.keyboard.press('Enter')
  await expect(page.locator('.zn-tabbar .is-active')).toHaveText(/Item 0600/)
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

test('a big canvas builds card editors only for cards in view', async ({ page, vaultDir }) => {
  const nodes = Array.from({ length: 300 }, (_, i) => ({
    id: `c${i}`, type: 'text', text: `Card ${i}`, x: (i % 20) * 400, y: Math.floor(i / 20) * 300, width: 250, height: 120
  }))
  writeFileSync(join(vaultDir, 'Big.canvas'), JSON.stringify({ nodes, edges: [] }))
  await expect(treeRow(page, 'Big')).toBeVisible()
  const canvas = page.locator('.zn-canvas:visible')

  // Opened zoomed out to fit: cards are plain shapes, no editors yet.
  await treeRow(page, 'Big').click()
  await expect(canvas.locator('.zn-cnode')).toHaveCount(300)
  await expect(canvas).toHaveClass(/is-far/)
  await expect(canvas.locator('.cm-editor')).toHaveCount(0)

  // At normal zoom near the first card, only the cards around it get editors.
  await page.evaluate(() => localStorage.setItem('zenode.canvas.view:Big.canvas', JSON.stringify({ x: 400, y: 200, scale: 1 })))
  await page.keyboard.press('Control+w')
  await treeRow(page, 'Big').click()
  await expect(canvas.locator('.cm-content', { hasText: /^Card 0$/ })).toBeVisible()
  const mounted = await canvas.locator('.cm-editor').count()
  expect(mounted).toBeGreaterThan(0)
  expect(mounted).toBeLessThan(60)
})
