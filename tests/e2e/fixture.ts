// Launches the built app against a fresh copy of tests/fixtures/vault, with its
// own settings folder, so tests never touch the user's vaults or settings.
import { test as base, _electron as electron, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const ROOT = resolve(__dirname, '../..')

export interface ZenodeFixtures {
  // A temp folder holding the vault copy and the app's settings folder.
  workDir: string
  vaultDir: string
  app: ElectronApplication
  page: Page
  // Start another app instance on the same settings and vault (e.g. after a kill).
  // withVault false: don't wait for a vault (e.g. to land on the welcome screen).
  relaunch: (opts?: { withVault?: boolean }) => Promise<{ app: ElectronApplication; page: Page }>
}

// Starts Zenode with settings that point straight at `vaultDir`.
async function launch(workDir: string, vaultDir: string): Promise<ElectronApplication> {
  const userData = join(workDir, 'userdata')
  const settings = join(userData, 'zenode-settings.json')
  if (!existsSync(settings)) {
    mkdirSync(userData, { recursive: true })
    writeFileSync(settings, JSON.stringify({ lastVault: vaultDir, recentVaults: [vaultDir], workspaces: {} }))
  }
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== 'ELECTRON_RENDERER_URL') env[k] = v
  return electron.launch({
    // Built by `npm run test:e2e` into out-e2e/, apart from the dev server's out/.
    args: [join(ROOT, 'out-e2e/main/index.js')],
    env: { ...env, ZENODE_USER_DATA: userData, ZENODE_TEST_TRASH: join(workDir, 'trash'), ZENODE_TEST_EXPORT_DIR: join(workDir, 'exports'), ZENODE_TEST_VAULT_PARENT: join(workDir, 'vaults') }
  })
}

// The first window, once its vault is shown (or, with withVault false, once the page is up).
async function ready(app: ElectronApplication, withVault = true): Promise<Page> {
  const page = await app.firstWindow()
  await page.waitForSelector(withVault ? '.zn-tree-row' : '.zn-app')
  return page
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
    const app = await launch(workDir, vaultDir)
    await use(app)
    // A test may already have killed it.
    await app.close().catch(() => undefined)
  },
  page: async ({ app }, use) => {
    await use(await ready(app))
  },
  relaunch: async ({ workDir, vaultDir }, use) => {
    const started: ElectronApplication[] = []
    await use(async (opts) => {
      const app = await launch(workDir, vaultDir)
      started.push(app)
      return { app, page: await ready(app, opts?.withVault !== false) }
    })
    for (const app of started) await app.close().catch(() => undefined)
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

// Simulates a crash: kills the app's whole process tree (app.process() can be a
// launcher whose child is the real main process) and waits until it is gone.
export async function crash(app: ElectronApplication): Promise<void> {
  const proc = app.process()
  const exited = new Promise<void>((done) => (proc.exitCode !== null ? done() : proc.once('exit', () => done())))
  if (process.platform === 'win32') execFileSync('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' })
  else proc.kill('SIGKILL')
  await exited
}
