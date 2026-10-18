// Launches the built app against a fresh copy of tests/fixtures/vault, with its
// own settings folder, so tests never touch the user's vaults or settings.
import { test as base, _electron as electron, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const ROOT = resolve(__dirname, '../..')

export interface ZenodeFixtures {
  // A temp folder holding the vault copy and the app's settings folder.
  workDir: string
  vaultDir: string
  app: ElectronApplication
  page: Page
}

export const test = base.extend<ZenodeFixtures>({
  workDir: async ({}, use) => {
    const dir = mkdtempSync(join(tmpdir(), 'zenode-e2e-'))
    await use(dir)
    rmSync(dir, { recursive: true, force: true })
  },
  vaultDir: async ({ workDir }, use) => {
    const vault = join(workDir, 'vault')
    cpSync(join(ROOT, 'tests/fixtures/vault'), vault, { recursive: true })
    await use(vault)
  },
  app: async ({ workDir, vaultDir }, use) => {
    // Settings that point the app straight at the copied vault.
    const userData = join(workDir, 'userdata')
    mkdirSync(userData, { recursive: true })
    writeFileSync(join(userData, 'zenode-settings.json'), JSON.stringify({ lastVault: vaultDir, recentVaults: [vaultDir], workspaces: {} }))
    const env: Record<string, string> = {}
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== 'ELECTRON_RENDERER_URL') env[k] = v
    const app = await electron.launch({
      args: [join(ROOT, 'out/main/index.js')],
      env: { ...env, ZENODE_USER_DATA: userData }
    })
    await use(app)
    await app.close()
  },
  page: async ({ app }, use) => {
    const page = await app.firstWindow()
    await page.waitForSelector('.zn-tree-row')
    await use(page)
  }
})

export { expect } from '@playwright/test'

// The tree row for a file or folder, by its visible name.
export function treeRow(page: Page, name: string): Locator {
  return page.locator('.zn-tree-row', { has: page.locator('.zn-tree-label', { hasText: new RegExp(`^${escapeRegExp(name)}$`) }) })
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
