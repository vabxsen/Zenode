// What Windows asks Zenode to open, from the command line of a new launch or a
// second launch: a note or canvas file (file association), a folder ("Open
// folder as Zenode vault" in Explorer), or a zenode:// link. Parsing is pure;
// turning a target into a vault and file is in resolveTarget.
import { promises as fs } from 'node:fs'
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'

export type LaunchTarget =
  | { kind: 'folder'; path: string }
  | { kind: 'file'; path: string }
  // zenode://open?vault=<name or folder of a known vault>&file=<path in the vault>
  | { kind: 'link'; vault: string; file?: string }

const OPENABLE = /\.(md|canvas)$/i
export const PROTOCOL = 'zenode'
const FOLDER_SWITCH = '--open-folder'

function fromLink(url: string): LaunchTarget | null {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  if (u.protocol !== `${PROTOCOL}:`) return null
  // zenode://open?... (host "open") or zenode:open?...
  const action = (u.host || u.pathname.replace(/^\/+|\/+$/g, '')).toLowerCase()
  if (action !== 'open') return null
  const vault = u.searchParams.get('vault')
  if (!vault) return null
  const file = u.searchParams.get('file') || undefined
  return { kind: 'link', vault, file }
}

// `args` are the arguments after the executable (and after the app path in development).
export function parseLaunchArgs(args: string[], cwd: string): LaunchTarget | null {
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a.startsWith(`${FOLDER_SWITCH}=`)) return { kind: 'folder', path: resolve(cwd, a.slice(FOLDER_SWITCH.length + 1)) }
    if (a === FOLDER_SWITCH && args[i + 1]) return { kind: 'folder', path: resolve(cwd, args[i + 1]) }
    if (a.toLowerCase().startsWith(`${PROTOCOL}:`)) return fromLink(a)
  }
  // Otherwise the last plain argument that names a note or canvas.
  const file = args.filter((a) => !a.startsWith('-') && OPENABLE.test(a)).pop()
  return file ? { kind: 'file', path: resolve(cwd, file) } : null
}

export interface Resolved {
  root: string
  // The file to open, relative to the vault with forward slashes.
  file?: string
}

const isDir = (p: string) => fs.stat(p).then((s) => s.isDirectory(), () => false)
const isFile = (p: string) => fs.stat(p).then((s) => s.isFile(), () => false)
const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

export function isInside(root: string, p: string): boolean {
  const back = relative(root, p)
  return back !== '' && !back.startsWith('..') && !isAbsolute(back)
}

const vaultPath = (root: string, file: string) => relative(root, file).split(/[\\/]/).join('/')

// The vault a file belongs to: the deepest known vault holding it, else the
// nearest folder above it that is a vault (.zenode or .obsidian), else its own folder.
async function vaultFor(file: string, known: string[]): Promise<string> {
  const holding = known.filter((r) => isInside(r, file)).sort((a, b) => b.length - a.length)
  if (holding[0]) return holding[0]
  for (let dir = dirname(file); ; ) {
    if ((await isDir(join(dir, '.zenode'))) || (await isDir(join(dir, '.obsidian')))) return dir
    const up = dirname(dir)
    if (up === dir) return dirname(file)
    dir = up
  }
}

// Links only open vaults Zenode already knows, and only notes and canvases in
// them, so a web page can't make Zenode open an arbitrary folder or program.
async function resolveLink(t: { vault: string; file?: string }, known: string[]): Promise<Resolved | null> {
  const root = known.find((r) => (isAbsolute(t.vault) ? sameName(resolve(r), resolve(t.vault)) : sameName(basename(r), t.vault)))
  if (!root || !(await isDir(root))) return null
  if (!t.file) return { root }
  const name = extname(t.file) ? t.file : `${t.file}.md`
  const file = resolve(root, name)
  if (!isInside(root, file) || !OPENABLE.test(file) || !(await isFile(file))) return { root }
  return { root, file: vaultPath(root, file) }
}

export async function resolveTarget(t: LaunchTarget, known: string[]): Promise<Resolved | null> {
  if (t.kind === 'link') return resolveLink(t, known)
  if (t.kind === 'folder') return (await isDir(t.path)) ? { root: t.path } : null
  if (!OPENABLE.test(t.path) || !(await isFile(t.path))) return null
  const root = await vaultFor(t.path, known)
  return { root, file: vaultPath(root, t.path) }
}
