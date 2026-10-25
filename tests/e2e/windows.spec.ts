// Several vaults in their own windows, and one Zenode process.
import { spawn } from 'node:child_process'
import { cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import electronPath from 'electron'
import { expect, test, treeRow } from './fixture'

const ROOT = resolve(__dirname, '../..')

test('another vault opens in its own window and edits go to that vault', async ({ app, page, workDir, vaultDir }) => {
  const second = join(workDir, 'second')
  cpSync(join(ROOT, 'tests/fixtures/vault'), second, { recursive: true })
  writeFileSync(join(second, 'Only here.md'), '# Only here\n')

  // The page can only open vaults from the vault list (new folders go through the folder picker).
  await expect(page.evaluate((root) => window.zenode.openVaultInNewWindow(root), second)).rejects.toThrow('not in your list of vaults')
  expect(app.windows()).toHaveLength(1)
  const settingsFile = join(workDir, 'userdata', 'zenode-settings.json')
  const settings = JSON.parse(readFileSync(settingsFile, 'utf8')) as { recentVaults: string[] }
  writeFileSync(settingsFile, JSON.stringify({ ...settings, recentVaults: [...settings.recentVaults, second] }))

  const opened = app.waitForEvent('window')
  await page.evaluate((root) => window.zenode.openVaultInNewWindow(root), second)
  const win2 = await opened
  await expect(treeRow(win2, 'Only here')).toBeVisible()
  await expect(treeRow(page, 'Only here')).toHaveCount(0)

  // A new note made in the second window lands in the second vault.
  await win2.keyboard.press('Control+n')
  await win2.locator('.zn-tree-rename').fill('From window two')
  await win2.keyboard.press('Enter')
  await expect.poll(() => existsSync(join(second, 'From window two.md'))).toBe(true)
  expect(existsSync(join(vaultDir, 'From window two.md'))).toBe(false)

  // Opening a vault that already has a window brings it forward instead.
  await page.evaluate((root) => window.zenode.openVaultInNewWindow(root), second)
  await page.evaluate((root) => window.zenode.openVaultInNewWindow(root), vaultDir)
  expect(app.windows()).toHaveLength(2)
})

test('launching Zenode again keeps the one running instance', async ({ app, page, workDir }) => {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== 'ELECTRON_RENDERER_URL') env[k] = v
  const child = spawn(electronPath as unknown as string, [join(ROOT, 'out-e2e/main/index.js')], {
    env: { ...env, ZENODE_USER_DATA: join(workDir, 'userdata') },
    stdio: 'ignore'
  })
  const code = await new Promise<number | null>((done) => child.on('exit', done))
  expect(code).toBe(0)
  expect(app.windows()).toHaveLength(1)
  await expect(treeRow(page, 'Home')).toBeVisible()
})
