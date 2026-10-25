// Split panes, moving tabs, pinning, history, and restoring the layout.
import type { Page } from '@playwright/test'
import { expect, test, treeRow } from './fixture'

const runCommand = async (page: Page, name: string): Promise<void> => {
  await page.keyboard.press('Control+p')
  await page.locator('.zn-palette .zn-switcher-input').fill(name)
  await page.keyboard.press('Enter')
}

const panes = (page: Page) => page.locator('.zn-pane-leaf')
const tabsIn = (page: Page, pane: number) => panes(page).nth(pane).locator('.zn-tab .zn-tab-title')

test('split right shows the note in a second pane, and the layout is restored', async ({ app, page, relaunch }) => {
  await treeRow(page, 'Home').click()
  await runCommand(page, 'Split right')
  await expect(panes(page)).toHaveCount(2)
  await expect(tabsIn(page, 1)).toHaveText(['Home'])
  // Open another note in the new (active) pane.
  await treeRow(page, 'Ideas').click()
  await expect(tabsIn(page, 1)).toHaveText(['Home', 'Ideas'])
  await expect(tabsIn(page, 0)).toHaveText(['Home'])
  await app.close()

  const second = await relaunch()
  await expect(second.page.locator('.zn-pane-leaf')).toHaveCount(2)
  await expect(second.page.locator('.zn-pane-leaf').nth(1).locator('.zn-tab .zn-tab-title')).toHaveText(['Home', 'Ideas'])
  await expect(second.page.locator('.zn-pane-leaf').nth(1).locator('.zn-tab.is-active')).toHaveText(/Ideas/)
})

test('a tab can be dragged to another pane, and an emptied pane closes', async ({ page }) => {
  await treeRow(page, 'Home').click()
  await treeRow(page, 'Ideas').click()
  // The new pane below shows the current note (Ideas).
  await runCommand(page, 'Split down')
  await expect(panes(page)).toHaveCount(2)
  await expect(tabsIn(page, 1)).toHaveText(['Ideas'])
  // Drag "Home" from the top pane to the bottom pane's tab bar.
  await panes(page).nth(0).locator('.zn-tab', { hasText: 'Home' }).dragTo(panes(page).nth(1).locator('.zn-tabbar'))
  await expect(tabsIn(page, 0)).toHaveText(['Ideas'])
  await expect(tabsIn(page, 1)).toHaveText(['Ideas', 'Home'])
  // Dragging a note the target already shows doesn't duplicate it; the top pane empties and closes.
  await panes(page).nth(0).locator('.zn-tab', { hasText: 'Ideas' }).dragTo(panes(page).nth(1).locator('.zn-tabbar'))
  await expect(panes(page)).toHaveCount(1)
  await expect(tabsIn(page, 0)).toHaveText(['Ideas', 'Home'])
})

test('Ctrl+Alt+arrows move between panes', async ({ page }) => {
  await treeRow(page, 'Home').click()
  await runCommand(page, 'Split right')
  await expect(panes(page).nth(1)).toHaveClass(/is-active-pane/)
  await page.keyboard.press('Control+Alt+ArrowLeft')
  await expect(panes(page).nth(0)).toHaveClass(/is-active-pane/)
  await page.keyboard.press('Control+Alt+ArrowRight')
  await expect(panes(page).nth(1)).toHaveClass(/is-active-pane/)
})

test('pinned tabs stay put and need unpinning to close', async ({ page }) => {
  await treeRow(page, 'Home').click()
  await treeRow(page, 'Ideas').click()
  await runCommand(page, 'Pin or unpin this tab')
  const tabs = page.locator('.zn-tab .zn-tab-title')
  await expect(tabs).toHaveText(['Ideas', 'Home'])
  await expect(page.locator('.zn-tab.is-pinned')).toHaveText(/Ideas/)
  await page.keyboard.press('Control+w')
  await expect(page.locator('.zn-notice').last()).toContainText('is pinned')
  await expect(tabs).toHaveText(['Ideas', 'Home'])
})

test('Alt+Left and Alt+Right move through recently shown tabs', async ({ page }) => {
  await treeRow(page, 'Home').click()
  await treeRow(page, 'Ideas').click()
  await page.keyboard.press('Alt+ArrowLeft')
  await expect(page.locator('.zn-tab.is-active')).toHaveText(/Home/)
  await page.keyboard.press('Alt+ArrowRight')
  await expect(page.locator('.zn-tab.is-active')).toHaveText(/Ideas/)
})

test('the same note in two panes stays in step after a save', async ({ page }) => {
  await treeRow(page, 'Ideas').click()
  await runCommand(page, 'Split right')
  await panes(page).nth(1).locator('.cm-content').focus()
  await page.keyboard.press('Control+End')
  await page.keyboard.type('\nTyped in the right pane')
  await page.keyboard.press('Control+s')
  await expect(panes(page).nth(0).locator('.cm-content')).toContainText('Typed in the right pane')
})
