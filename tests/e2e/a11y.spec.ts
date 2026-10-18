// Accessibility: axe-core finds no serious or critical problems on the main
// screens, in both themes, and the app can be used from the keyboard.
import axe from 'axe-core'
import type { Page } from '@playwright/test'
import { expect, test, treeRow } from './fixture'

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

// axe-core is injected straight into the page (AxeBuilder needs a second page,
// which Electron can't open).
async function audit(page: Page, label: string): Promise<void> {
  if (!(await page.evaluate(() => 'axe' in window))) await page.evaluate(axe.source)
  const summary = await page.evaluate(async (tags) => {
    const w = window as unknown as { axe: typeof axe }
    const results = await w.axe.run(document, { runOnly: { type: 'tag', values: tags } })
    return results.violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => {
        const where = v.nodes.slice(0, 4).map((n) => `${n.target.join(' ')} | ${(n.failureSummary ?? '').split('\n').slice(1, 2).join('')}`)
        return [`${v.id} (${v.impact}): ${v.help}`, ...where].join('\n    ')
      })
  }, TAGS)
  expect(summary, `${label}:\n${summary.join('\n')}`).toEqual([])
}

async function setTheme(page: Page, theme: 'dark' | 'light'): Promise<void> {
  await page.keyboard.press('Control+,')
  await page.locator('.zn-settings-tab', { hasText: 'Appearance' }).click()
  await page.getByLabel('Theme', { exact: true }).selectOption(theme)
  await page.keyboard.press('Escape')
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
}

for (const theme of ['dark', 'light'] as const) {
  test(`main window, note and panels have no serious problems (${theme})`, async ({ page }) => {
    await setTheme(page, theme)
    await treeRow(page, 'Formatting').click()
    await expect(page.locator('.cm-content').first()).toBeVisible()
    await audit(page, 'note in Live Preview')
    await page.keyboard.press('Control+e')
    await audit(page, 'Reading view')
    await page.locator('.zn-rightbar .zn-sidebar-tab[aria-label="Outline"]').click()
    await page.locator('.zn-sidebar .zn-sidebar-tab[aria-label="Search"]').click()
    await audit(page, 'search and outline')
  })

  test(`dialogs have no serious problems (${theme})`, async ({ page }) => {
    await setTheme(page, theme)
    await page.keyboard.press('Control+,')
    await audit(page, 'settings')
    await page.locator('.zn-settings-tab', { hasText: 'Hotkeys' }).click()
    await audit(page, 'hotkeys')
    await page.keyboard.press('Escape')
    await page.keyboard.press('Control+p')
    await audit(page, 'command palette')
    await page.keyboard.press('Escape')
    await page.keyboard.press('Control+Shift+o')
    await expect(page.locator('.zn-vault-manager')).toBeVisible()
    await audit(page, 'vaults')
  })
}

test('the app can be driven from the keyboard', async ({ page }) => {
  // Settings: arrow keys move between sections, Escape closes.
  await page.keyboard.press('Control+,')
  await expect(page.locator('.zn-settings-tab.is-active')).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(page.locator('.zn-settings-heading')).toHaveText('Editor')
  await page.keyboard.press('Escape')
  await expect(page.locator('.zn-settings')).toHaveCount(0)

  // File tree: arrow keys move through rows, Enter opens.
  await treeRow(page, 'Home').focus()
  await page.keyboard.press('ArrowDown')
  await expect(treeRow(page, 'Ideas')).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.locator('.zn-tabbar .is-active')).toHaveText(/Ideas/)

  // A visible focus ring on keyboard focus.
  await treeRow(page, 'Home').focus()
  await page.keyboard.press('ArrowDown')
  const outline = await page.evaluate(() => getComputedStyle(document.activeElement!).outlineStyle)
  expect(outline).not.toBe('none')
})
