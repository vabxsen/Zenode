// Settings: appearance (theme, accent, text size, zoom, themes and snippets),
// hotkeys and daily-note options.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, test } from './fixture'

// A .zenode config file ({} until it's written; polls retry until then).
const json = (vault: string, name: string): Record<string, unknown> => {
  const file = join(vault, '.zenode', `${name}.json`)
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {}
}

async function openSection(page: Page, name: string): Promise<void> {
  if (!(await page.locator('.zn-settings').count())) await page.keyboard.press('Control+,')
  await page.locator('.zn-settings-tab', { hasText: name }).click()
  await expect(page.locator('.zn-settings-heading')).toHaveText(name)
}

const row = (page: Page, name: string) => page.locator('.zn-set-row', { has: page.locator('.zn-set-name', { hasText: new RegExp(`^${name}$`) }) })
const cssVar = (page: Page, name: string, on: 'html' | 'body' = 'body') =>
  page.evaluate(([n, el]) => getComputedStyle(el === 'html' ? document.documentElement : document.body).getPropertyValue(n).trim(), [name, on] as const)

test('the theme can be chosen and is kept after a restart', async ({ app, page, vaultDir, relaunch }) => {
  await openSection(page, 'Appearance')
  await row(page, 'Theme').locator('select').selectOption('light')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await expect(page.locator('body')).toHaveClass(/theme-light/)
  expect(await cssVar(page, '--zn-bg')).toBe('#ffffff')
  await row(page, 'Theme').locator('select').selectOption('dark')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect.poll(() => json(vaultDir, 'appearance').theme).toBe('dark')
  await app.close()
  const second = await relaunch()
  await expect(second.page.locator('html')).toHaveAttribute('data-theme', 'dark')
})

test('accent colour, text size and zoom apply at once', async ({ page, vaultDir }) => {
  await openSection(page, 'Appearance')
  const before = await cssVar(page, '--zn-accent-strong')
  const color = row(page, 'Accent colour').locator('input[type="color"]')
  await color.evaluate((el: HTMLInputElement) => {
    el.value = '#10b981'
    el.dispatchEvent(new Event('change', { bubbles: true }))
  })
  expect(await cssVar(page, '--zn-accent-strong')).toBe('#10b981')
  await row(page, 'Accent colour').locator('button', { hasText: 'Default' }).click()
  expect(await cssVar(page, '--zn-accent-strong')).toBe(before)

  await row(page, 'Text size').locator('input[type="range"]').fill('20')
  expect(await cssVar(page, '--zn-text-size')).toBe('20px')
  await expect.poll(() => json(vaultDir, 'appearance').fontSize).toBe(20)

  await page.keyboard.press('Escape')
  await expect(page.locator('.zn-settings')).toHaveCount(0)
  await page.keyboard.press('Control+=')
  await expect.poll(() => json(vaultDir, 'appearance').zoom).toBe(1.1)
  await page.keyboard.press('Control+0')
  await expect.poll(() => json(vaultDir, 'appearance').zoom).toBe(1)
})

test('CSS snippets and an Obsidian-style theme load from .zenode', async ({ page, vaultDir }) => {
  mkdirSync(join(vaultDir, '.zenode/snippets'), { recursive: true })
  writeFileSync(join(vaultDir, '.zenode/snippets/outline.css'), '.zn-statusbar { outline: 3px solid rgb(1, 2, 3); }')
  mkdirSync(join(vaultDir, '.zenode/themes/Mint'), { recursive: true })
  writeFileSync(join(vaultDir, '.zenode/themes/Mint/theme.css'), '.theme-dark, .theme-light { --background-primary: rgb(10, 20, 30); --text-normal: rgb(200, 250, 220); }')

  await openSection(page, 'Appearance')
  await row(page, 'outline').locator('input').check()
  await expect.poll(() => page.locator('.zn-statusbar').evaluate((el) => getComputedStyle(el).outlineColor)).toBe('rgb(1, 2, 3)')
  await row(page, 'CSS theme').locator('select').selectOption('Mint')
  await expect.poll(() => cssVar(page, '--zn-bg')).toBe('rgb(10, 20, 30)')
  expect(await cssVar(page, '--zn-text')).toBe('rgb(200, 250, 220)')
  await expect.poll(() => json(vaultDir, 'appearance')).toMatchObject({ cssTheme: 'Mint', snippets: ['outline'] })

  await row(page, 'CSS theme').locator('select').selectOption('')
  await expect.poll(() => cssVar(page, '--zn-bg')).not.toBe('rgb(10, 20, 30)')
})

test('a hotkey can be added, warns about clashes, and works', async ({ page, vaultDir }) => {
  await openSection(page, 'Hotkeys')
  await page.locator('.zn-hotkey-search').fill('quick switcher')
  const cmd = page.locator('.zn-hotkey-row', { hasText: 'Quick switcher' }).first()
  await cmd.locator('button[aria-label^="Add a hotkey"]').click()
  await expect(cmd.locator('.zn-hotkey-prompt')).toBeVisible()
  await page.keyboard.press('Control+Shift+k')
  await expect(cmd.locator('.zn-hotkey-chip', { hasText: 'Ctrl+Shift+K' })).toBeVisible()
  await expect.poll(() => existsSync(join(vaultDir, '.zenode/hotkeys.json')) && JSON.stringify(json(vaultDir, 'hotkeys'))).toContain('"key":"k"')

  // Ctrl+N is "New note": the new chip is marked as a clash.
  await cmd.locator('button[aria-label^="Add a hotkey"]').click()
  await page.keyboard.press('Control+n')
  await expect(cmd.locator('.zn-hotkey-chip.is-conflict', { hasText: 'Ctrl+N' })).toBeVisible()
  await cmd.locator('.zn-hotkey-chip', { hasText: 'Ctrl+N' }).locator('button').click()
  await expect(cmd.locator('.zn-hotkey-chip', { hasText: 'Ctrl+N' })).toHaveCount(0)

  await page.keyboard.press('Escape')
  await page.keyboard.press('Control+Shift+k')
  await expect(page.locator('.zn-switcher-input')).toBeFocused()
})

test('daily note settings show a preview of the name', async ({ page, vaultDir }) => {
  await openSection(page, 'Daily notes')
  const format = row(page, 'Name format').locator('input')
  await format.fill('YYYY/[Week] WW')
  await expect(row(page, 'Name format').locator('.zn-set-preview')).toContainText(`Today: ${new Date().getFullYear()}/Week`)
  await format.press('Enter')
  await expect.poll(() => json(vaultDir, 'daily-notes').format).toBe('YYYY/[Week] WW')
  await format.fill('HH:mm')
  await expect(row(page, 'Name format').locator('.zn-set-preview')).toHaveClass(/is-error/)
})
