// M2 editor features: Reading view, Live Preview rendering, attachments,
// find & replace, tables and hover previews.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, treeRow } from './fixture'

const read = (vault: string, path: string): string => readFileSync(join(vault, path), 'utf8')

test('Reading view renders Obsidian Markdown and task boxes edit the note', async ({ page, vaultDir }) => {
  await treeRow(page, 'Formatting').click()
  await page.keyboard.press('Control+e')
  const reading = page.locator('.zn-reading')
  await expect(reading).toBeVisible()
  await expect(reading.locator('.callout[data-callout="note"]')).toContainText('A callout')
  await expect(reading.locator('mark')).toHaveText('this highlight')
  await expect(reading.locator('.katex')).toHaveCount(2)
  await expect(reading.locator('table td').first()).toHaveText('Apple')
  await expect(reading.locator('.zn-mermaid svg')).toHaveCount(1)
  await expect(reading.locator('.zn-embed-note')).toContainText('Back to')
  await reading.locator('.zn-task-box').first().click()
  await expect.poll(() => read(vaultDir, 'Formatting.md')).toContain('- [x] An open task')
  // Ctrl+E again goes back to editing.
  await page.keyboard.press('Control+e')
  await expect(page.locator('.zn-editor .cm-content')).toBeVisible()
})

test('Live Preview renders embeds, math, tables and diagrams in place', async ({ page }) => {
  await treeRow(page, 'Formatting').click()
  const editor = page.locator('.zn-editor')
  await expect(editor.locator('.zn-lp-table td').first()).toHaveText('Apple')
  await expect(editor.locator('.zn-lp-math .katex')).toHaveCount(1)
  await expect(editor.locator('.zn-lp-inline-math .katex')).toHaveCount(1)
  await expect(editor.locator('.zn-lp-mermaid svg')).toHaveCount(1)
  await expect(editor.locator('.zn-lp-embed .zn-embed-note')).toContainText('Back to')
  await expect(editor.locator('.cm-line.zn-callout-title')).toContainText('A callout')
})

test('pasting an image saves it and inserts an embed', async ({ page, vaultDir }) => {
  await treeRow(page, 'Home').click()
  await page.locator('.zn-editor .cm-content').click()
  await page.keyboard.press('Control+End')
  await page.evaluate(() => {
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
    const data = new DataTransfer()
    data.items.add(new File([bytes], 'image.png', { type: 'image/png' }))
    document.querySelector('.zn-editor .cm-content')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  })
  await expect.poll(() => readdirSync(vaultDir).filter((f) => f.startsWith('Pasted image')).length).toBe(1)
  const saved = readdirSync(vaultDir).find((f) => f.startsWith('Pasted image'))!
  await expect.poll(() => read(vaultDir, 'Home.md')).toContain(`![[${saved}]]`)
  expect([...readFileSync(join(vaultDir, saved))].slice(0, 4)).toEqual([137, 80, 78, 71])
})

test('find and replace changes the note', async ({ page, vaultDir }) => {
  await treeRow(page, 'Home').click()
  await page.locator('.zn-editor .cm-content').click()
  await page.keyboard.press('Control+h')
  await page.locator('.cm-search input[name="search"]').fill('zephyr')
  await page.locator('.cm-search input[name="replace"]').fill('breeze')
  await page.locator('.cm-search button[name="replaceAll"]').click()
  await expect.poll(() => read(vaultDir, 'Home.md')).toContain('looks for the word breeze')
})

test('Tab moves through table cells and aligns the table', async ({ page, vaultDir }) => {
  await treeRow(page, 'Formatting').click()
  // Clicking the rendered table puts the cursor in it and reveals its source.
  await page.locator('.zn-editor .zn-lp-table').click()
  await expect(page.locator('.zn-editor .zn-lp-table')).toHaveCount(0)
  await page.keyboard.press('Tab')
  await expect.poll(() => read(vaultDir, 'Formatting.md')).toContain('| Fruit | Count |\n| ----- | ----- |\n| Apple | 3     |')
})

test('hovering a link in Reading view previews the note', async ({ page }) => {
  await treeRow(page, 'Formatting').click()
  await page.keyboard.press('Control+e')
  await page.locator('.zn-reading a.zn-internal', { hasText: 'Ideas' }).first().hover()
  await expect(page.locator('.zn-hover')).toContainText('Back to')
  await page.mouse.move(5, 5)
  await expect(page.locator('.zn-hover')).toHaveCount(0)
})

test('attachments go to the configured folder', async ({ page, vaultDir }) => {
  // .zenode/app.json is read when the vault opens, so this test writes it through the app.
  await page.evaluate(() => window.zenode.writeConfig('app', { attachmentFolder: './assets' }))
  await page.reload()
  await page.waitForSelector('.zn-tree-row')
  await treeRow(page, 'Projects').click()
  await treeRow(page, 'Roadmap').click()
  await page.locator('.zn-editor .cm-content').click()
  await page.evaluate(() => {
    const data = new DataTransfer()
    data.items.add(new File([new Uint8Array([1, 2, 3])], 'notes.pdf', { type: 'application/pdf' }))
    document.querySelector('.zn-editor .cm-content')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  })
  await expect.poll(() => existsSync(join(vaultDir, 'Projects/assets/notes.pdf'))).toBe(true)
  await expect.poll(() => read(vaultDir, 'Projects/Roadmap.md')).toContain('![[notes.pdf]]')
})

test('after switching notes, typing and undo still work in each note', async ({ page }) => {
  await treeRow(page, 'Home').click()
  const editor = page.locator('.cm-content').first()
  await editor.click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type(' first')
  await treeRow(page, 'Ideas').click()
  await expect(page.locator('.zn-tabbar .is-active')).toHaveText(/Ideas/)
  await treeRow(page, 'Home').click()
  // The editor element was swapped out of the page and back in: it must still take focus and keys.
  await editor.click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type(' second')
  await expect(editor).toContainText('zephyr. first second')
  await page.keyboard.press('Control+z')
  await expect(editor).toContainText('zephyr. first')
  await expect(editor).not.toContainText('second')
  await page.keyboard.press('Control+z')
  await expect(editor).not.toContainText('first')
})
