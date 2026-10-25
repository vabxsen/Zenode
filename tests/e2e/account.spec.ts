// Account and sync, with a pretend Google account and a folder standing in for
// the cloud (ZENODE_TEST_SYNC_DIR, honoured only in development builds).
import { _electron as electron, type Page } from '@playwright/test'
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, MAIN, test, testEnv, treeRow } from './fixture'

// What the pretend cloud holds for the test account: vault names and file texts.
function cloudFiles(cloud: string): { vaults: string[]; files: Record<string, string> } {
  const dir = join(cloud, 'test-user')
  if (!existsSync(join(dir, 'vaults.json'))) return { vaults: [], files: {} }
  const vaults = JSON.parse(readFileSync(join(dir, 'vaults.json'), 'utf8')) as Array<{ id: string; name: string }>
  const files: Record<string, string> = {}
  for (const name of readdirSync(dir).filter((f) => f !== 'vaults.json')) {
    const data = JSON.parse(readFileSync(join(dir, name), 'utf8')) as { files: Record<string, { content: string; deleted: boolean }> }
    for (const [path, f] of Object.entries(data.files)) if (!f.deleted) files[path] = f.content
  }
  return { vaults: vaults.map((v) => v.name), files }
}

async function signInFromSettings(page: Page): Promise<void> {
  await page.keyboard.press('Control+,')
  await page.locator('.zn-settings-tab', { hasText: 'Account & sync' }).click()
  await page.getByRole('button', { name: 'Sign in with Google', exact: true }).click()
  await expect(page.locator('.zn-set-name', { hasText: 'Signed in as Test user' })).toBeVisible()
}

test('signing in keeps the vault in the account, and edits follow', async ({ app, workDir, relaunch }) => {
  const cloud = join(workDir, 'cloud')
  await app.close()
  const { page } = await relaunch({ env: { ZENODE_TEST_SYNC_DIR: cloud } })
  // Signed out: no sync badge.
  await expect(page.locator('.zn-status-cloud')).toBeHidden()
  await signInFromSettings(page)
  await expect(page.locator('.zn-sync-status')).toHaveText(/Synced/)
  await expect.poll(() => cloudFiles(cloud).vaults).toEqual(['vault'])
  const files = cloudFiles(cloud).files
  expect(Object.keys(files).sort()).toEqual(expect.arrayContaining(['Home.md', 'Ideas.md', 'Board.canvas', 'Projects/Roadmap.md']))
  await page.keyboard.press('Escape')
  await expect(page.locator('.zn-status-cloud')).toHaveText('Synced')

  // An edit reaches the account a few seconds later.
  await treeRow(page, 'Ideas').click()
  await page.locator('.zn-pane-leaf .cm-content').first().focus()
  await page.keyboard.press('Control+End')
  await page.keyboard.type('\nSynced line')
  await expect.poll(() => cloudFiles(cloud).files['Ideas.md'] ?? '', { timeout: 40_000 }).toContain('Synced line')
  // This computer's layout stays here.
  expect(Object.keys(cloudFiles(cloud).files)).not.toContain('.zenode/workspace.json')
})

test('the Help vault only syncs when turned on', async ({ app, workDir, relaunch }) => {
  const cloud = join(workDir, 'cloud')
  await app.close()
  const { app: zen, page } = await relaunch({ env: { ZENODE_TEST_SYNC_DIR: cloud } })
  await signInFromSettings(page)
  await expect(page.locator('.zn-sync-status')).toHaveText(/Synced/)
  const opened = zen.waitForEvent('window')
  await page.evaluate(() => window.zenode.openHelpVault(true))
  const help = await opened
  await expect(treeRow(help, 'Welcome to Zenode')).toBeVisible()
  await expect.poll(() => help.evaluate(() => window.zenode.syncStatus().then((s) => s?.enabled))).toBe(false)
  await help.waitForTimeout(3000)
  expect(cloudFiles(cloud).vaults).toEqual(['vault'])
})

test('on a new computer, signing in brings the vault back', async ({ app, workDir, relaunch }) => {
  const cloud = join(workDir, 'cloud')
  await app.close()
  const first = await relaunch({ env: { ZENODE_TEST_SYNC_DIR: cloud } })
  await signInFromSettings(first.page)
  await expect(first.page.locator('.zn-sync-status')).toHaveText(/Synced/)
  await first.app.close()

  // A second computer: its own settings, no vaults, the same account.
  const pc2 = join(workDir, 'pc2')
  mkdirSync(pc2)
  const second = await electron.launch({
    args: [MAIN],
    env: { ...testEnv(pc2), ZENODE_TEST_SYNC_DIR: cloud }
  })
  try {
    const page = await second.firstWindow()
    await page.getByRole('button', { name: /Restore from your account/ }).click()
    await page.getByRole('button', { name: 'Sign in with Google', exact: true }).click()
    await page.getByRole('button', { name: 'Restore vault', exact: true }).click()
    await expect(treeRow(page, 'Home')).toBeVisible()
    await expect(treeRow(page, 'Roadmap').or(treeRow(page, 'Projects'))).toBeVisible()
    expect(readFileSync(join(pc2, 'vaults', 'vault', 'Home.md'), 'utf8')).toBe(readFileSync(join(workDir, 'vault', 'Home.md'), 'utf8'))
  } finally {
    await second.close()
  }
})
