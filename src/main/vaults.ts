// Creating vaults, the bundled Help vault, and the recent-vaults list.
import { app } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { fileNameProblem } from '../shared/fileNames'
import { loadSettings, saveSettings } from './settings'

// A new, empty vault folder named `name` inside `parent`. Never reuses an
// existing folder (that would turn someone's folder into a vault by accident).
export async function createVaultFolder(parent: string, name: string): Promise<string> {
  const clean = name.trim()
  const problem = fileNameProblem(clean)
  if (problem) throw new Error(problem)
  const root = join(parent, clean)
  await fs.mkdir(parent, { recursive: true })
  await fs.mkdir(root, { recursive: false }).catch((e: NodeJS.ErrnoException) => {
    throw new Error(e.code === 'EEXIST' ? `"${clean}" already exists in that folder. Pick another name.` : e.message)
  })
  const welcome = `# ${clean}\n\nThis is your new vault: a folder of plain Markdown files.\n\nPress Ctrl+N for a new note, Ctrl+O to find one, and Ctrl+P for every command.\n`
  await fs.writeFile(join(root, 'Welcome.md'), welcome, { flag: 'wx' })
  return root
}

// The Help vault shipped with the app.
function bundledHelp(): string {
  return app.isPackaged ? join(process.resourcesPath, 'help-vault') : join(__dirname, '../../resources/help-vault')
}

// A copy of the Help vault in the app's data folder (refreshed when Zenode's
// version changes), so the installed files are never edited.
export async function helpVault(): Promise<string> {
  const target = join(app.getPath('userData'), 'Zenode Help')
  const stamp = join(target, '.zenode', 'help-version')
  const current = await fs.readFile(stamp, 'utf8').catch(() => '')
  if (current !== app.getVersion()) {
    await fs.cp(bundledHelp(), target, { recursive: true, force: true })
    await fs.mkdir(join(target, '.zenode'), { recursive: true })
    await fs.writeFile(stamp, app.getVersion())
  }
  return target
}

export async function forgetVault(root: string): Promise<void> {
  const s = await loadSettings()
  await saveSettings({ ...s, recentVaults: s.recentVaults.filter((v) => v !== root), lastVault: s.lastVault === root ? undefined : s.lastVault })
}
