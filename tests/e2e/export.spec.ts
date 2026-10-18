// Export to PDF.
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, treeRow } from './fixture'

test('a note exports to a PDF with the chosen page settings', async ({ page, workDir }) => {
  const out = join(workDir, 'exports')
  mkdirSync(out, { recursive: true })
  await treeRow(page, 'Formatting').click()
  await page.keyboard.press('Control+p')
  await page.locator('.zn-switcher-input').fill('Export to PDF')
  await page.keyboard.press('Enter')
  const dialog = page.locator('.zn-export-dialog')
  await expect(dialog).toContainText('Page size')
  await dialog.locator('select').first().selectOption('Letter')
  await dialog.locator('button', { hasText: 'Export…' }).click()
  const file = join(out, 'Formatting.pdf')
  await expect.poll(() => existsSync(file), { timeout: 30000 }).toBe(true)
  await expect(page.locator('.zn-notice').last()).toContainText('Exported to')
  expect(readFileSync(file).subarray(0, 5).toString()).toBe('%PDF-')
  expect(statSync(file).size).toBeGreaterThan(5000)
  await test.info().attach('export', { path: file, contentType: 'application/pdf' })
  // Letter is 612 points wide.
  expect(readFileSync(file).toString('latin1')).toMatch(/MediaBox\s*\[\s*0 0 612 792/)
})
