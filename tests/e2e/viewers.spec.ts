// Images, PDFs and text files open in their own tabs.
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { expect, test, treeRow } from './fixture'

// A 4×2 image.
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="2"><rect width="4" height="2" fill="red"/></svg>'

function mediaFolder(vault: string): string {
  const dir = join(vault, 'Media')
  mkdirSync(dir, { recursive: true })
  return dir
}

test('an image opens in a viewer that zooms', async ({ page, vaultDir }) => {
  writeFileSync(join(mediaFolder(vaultDir), 'dot.svg'), SVG)
  await treeRow(page, 'Media').click()
  await treeRow(page, 'dot.svg').click()
  const viewer = page.locator('.zn-file-view.is-image')
  await expect(viewer.locator('.zn-file-title')).toHaveText('Media/dot.svg')
  await expect.poll(() => viewer.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(4)
  await expect(viewer.locator('.zn-image-zoom')).toHaveText('100%')
  await viewer.locator('button[aria-label="Zoom in"]').click()
  await expect(viewer.locator('.zn-image-zoom')).toHaveText('125%')
  await viewer.locator('button[aria-label="Fit to window"]').click()
  await expect(viewer.locator('.zn-image-zoom')).toHaveText('100%')
})

test('a text file shows its content and reloads when it changes', async ({ page, vaultDir }) => {
  const file = join(mediaFolder(vaultDir), 'data.csv')
  writeFileSync(file, 'name,count\napple,3\n')
  await treeRow(page, 'Media').click()
  await treeRow(page, 'data.csv').click()
  const text = page.locator('.zn-file-view.is-text .zn-file-text')
  await expect(text).toHaveText('name,count\napple,3\n')
  writeFileSync(file, 'name,count\npear,5\n')
  await expect(text).toHaveText('name,count\npear,5\n')
})

test('a PDF opens in the built-in viewer and the tab follows a rename', async ({ page, vaultDir }) => {
  execFileSync(process.execPath, [resolve(__dirname, 'make-pdf.cjs'), join(mediaFolder(vaultDir), 'Paper.pdf'), 'Zenode'])
  await treeRow(page, 'Media').click()
  await treeRow(page, 'Paper.pdf').click()
  await expect(page.locator('.zn-file-view.is-pdf iframe')).toHaveAttribute('src', /\/Media\/Paper\.pdf$/)
  await treeRow(page, 'Paper.pdf').click({ button: 'right' })
  await page.locator('.zn-menu-item', { hasText: 'Rename' }).click()
  await page.locator('.zn-tree-rename').fill('Article.pdf')
  await page.keyboard.press('Enter')
  await expect(page.locator('.zn-tabbar .is-active')).toHaveText(/Article\.pdf/)
  await expect(page.locator('.zn-file-view.is-pdf iframe')).toHaveAttribute('src', /\/Media\/Article\.pdf$/)
})
