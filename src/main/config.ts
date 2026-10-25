import { promises as fs } from 'node:fs'
import { isAbsolute, join, relative } from 'node:path'
import { atomicWrite } from './fsutil'

// Per-vault configuration lives in <vault>/.zenode/<name>.json, like Obsidian's
// .obsidian folder. Only plain, known-shaped names are allowed, so the page can
// never use this to reach other files.
export const CONFIG_DIR = '.zenode'
const NAME = /^[a-z][a-z0-9-]{0,63}$/

export function configPath(vaultRoot: string, name: string): string {
  if (!NAME.test(name)) throw new Error(`Invalid config name: ${name}`)
  return join(vaultRoot, CONFIG_DIR, `${name}.json`)
}

// Refuses `path` when its real location is outside the vault, e.g. a .zenode
// folder or theme that is a link (junction) to somewhere else on the disk.
export async function checkInsideVault(vaultRoot: string, path: string): Promise<void> {
  const [root, real] = await Promise.all([fs.realpath(vaultRoot), fs.realpath(path)])
  const back = relative(root, real)
  if (back.startsWith('..') || isAbsolute(back)) throw new Error(`Path leads outside the vault through a link: ${relative(vaultRoot, path)}`)
}

// Missing or unreadable config comes back as null; the page falls back to defaults.
export async function readConfig(vaultRoot: string, name: string): Promise<unknown> {
  try {
    const file = configPath(vaultRoot, name)
    await checkInsideVault(vaultRoot, file)
    return JSON.parse(await fs.readFile(file, 'utf8')) as unknown
  } catch (e) {
    if ((e as Error).message.startsWith('Invalid config name')) throw e
    return null
  }
}

export async function writeConfig(vaultRoot: string, name: string, data: unknown): Promise<void> {
  const file = configPath(vaultRoot, name)
  await fs.mkdir(join(vaultRoot, CONFIG_DIR), { recursive: true })
  await checkInsideVault(vaultRoot, join(vaultRoot, CONFIG_DIR))
  await atomicWrite(file, `${JSON.stringify(data, null, 2)}\n`)
}

// ---------- CSS themes and snippets ----------
// .zenode/themes/<Name>/theme.css (Obsidian's layout) and .zenode/snippets/<name>.css.

export type CssKind = 'theme' | 'snippet'
// No path separators (either kind), reserved characters or control characters.
const CSS_NAME = /^[^/\\:*?"<>|\x00-\x1f]{1,100}$/

function cssPath(vaultRoot: string, kind: CssKind, name: string): string {
  if (!CSS_NAME.test(name) || name.startsWith('.')) throw new Error(`Invalid ${kind} name: ${name}`)
  return kind === 'theme' ? join(vaultRoot, CONFIG_DIR, 'themes', name, 'theme.css') : join(vaultRoot, CONFIG_DIR, 'snippets', `${name}.css`)
}

export async function listCss(vaultRoot: string): Promise<{ themes: string[]; snippets: string[] }> {
  const dir = (sub: string) => fs.readdir(join(vaultRoot, CONFIG_DIR, sub), { withFileTypes: true }).catch(() => [])
  const [themeDirs, snippetFiles] = await Promise.all([dir('themes'), dir('snippets')])
  const themes: string[] = []
  for (const d of themeDirs) {
    if (!d.isDirectory() || !CSS_NAME.test(d.name)) continue
    const ok = await fs.stat(join(vaultRoot, CONFIG_DIR, 'themes', d.name, 'theme.css')).then(() => true, () => false)
    if (ok) themes.push(d.name)
  }
  const snippets = snippetFiles.filter((f) => f.isFile() && f.name.toLowerCase().endsWith('.css')).map((f) => f.name.slice(0, -4))
  const sort = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' })
  return { themes: themes.sort(sort), snippets: snippets.sort(sort) }
}

const MAX_CSS = 4 * 1024 * 1024

export async function readCss(vaultRoot: string, kind: CssKind, name: string): Promise<string> {
  const file = cssPath(vaultRoot, kind, name)
  await checkInsideVault(vaultRoot, file)
  const stat = await fs.stat(file)
  if (stat.size > MAX_CSS) throw new Error(`${name} is larger than 4 MB`)
  return fs.readFile(file, 'utf8')
}

// The folder for themes or snippets, created if missing (to open in Explorer).
export async function cssFolder(vaultRoot: string, kind: CssKind): Promise<string> {
  const dir = join(vaultRoot, CONFIG_DIR, kind === 'theme' ? 'themes' : 'snippets')
  await fs.mkdir(dir, { recursive: true })
  await checkInsideVault(vaultRoot, dir)
  return dir
}
