import { promises as fs, watch, type FSWatcher } from 'node:fs'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { TreeEntry, WriteResult } from '../shared/api'
import { fileNameProblem } from '../shared/fileNames'
import { contentHash } from '../shared/hash'
import { atomicWrite, readIfExists, withRetry } from './fsutil'

// Deleted files go here when the vault is set to keep them (like Obsidian's .trash).
export const TRASH_DIR = '.trash'

// Windows device names, which are never files (with or without an extension).
const DEVICE = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³]|conin\$|conout\$)(\..*)?$/i
// How long a folder's real location is trusted before it's checked again.
const REAL_DIR_CACHE_MS = 5000

function isInside(root: string, path: string): boolean {
  const back = relative(root, path)
  return !back.startsWith('..') && !isAbsolute(back)
}

// Called with a file's old content just before a write replaces it (for snapshots).
export type BeforeOverwrite = (rel: string, oldContent: string) => Promise<void>

function checkName(name: string): void {
  const problem = fileNameProblem(name)
  if (problem) throw new Error(problem)
}

// Owns the open vault: every renderer path goes through `abs()`, which
// rejects anything that resolves outside the vault root.
export class Vault {
  private watcher: FSWatcher | null = null
  private pending = new Set<string>()
  private flushTimer: NodeJS.Timeout | null = null
  private realRoot: Promise<string> | null = null
  private realDirs = new Map<string, { real: string; at: number }>()

  constructor(
    readonly root: string,
    private readonly beforeOverwrite?: BeforeOverwrite
  ) {}

  get name(): string {
    return basename(this.root)
  }

  abs(rel: string): string {
    const target = resolve(this.root, rel)
    const back = relative(this.root, target)
    if (back.startsWith('..') || isAbsolute(back)) {
      throw new Error(`Path is outside the vault: ${rel}`)
    }
    // No NTFS alternate data streams ("note.md:hidden") or device names ("CON", "NUL.md").
    if (back.split(sep).some((part) => part.includes(':') || DEVICE.test(part))) {
      throw new Error(`Not a usable file name: ${rel}`)
    }
    return target
  }

  // Like abs(), and also refuses a path whose real location on disk is outside the
  // vault, reached through a symbolic link or junction. File operations use this.
  async realAbs(rel: string): Promise<string> {
    const target = this.abs(rel)
    if (target === resolve(this.root)) return target
    const root = await (this.realRoot ??= fs.realpath(this.root).catch(() => this.root))
    const st = await fs.lstat(target).catch(() => null)
    const real = st?.isSymbolicLink() ? await fs.realpath(target) : join(await this.realDir(dirname(target)), basename(target))
    if (!isInside(root, real)) throw new Error(`Path leads outside the vault through a link: ${rel}`)
    return target
  }

  // realAbs() for a file or folder in the vault, never the vault folder itself
  // (which can't be renamed, moved or deleted from inside).
  async realEntry(rel: string): Promise<string> {
    const target = await this.realAbs(rel)
    if (target === resolve(this.root)) throw new Error("The vault folder itself can't be changed from inside the vault")
    return target
  }

  // A folder's real location (cached briefly; bulk reads share folders). A folder
  // that doesn't exist yet is placed under its nearest existing parent.
  private async realDir(dir: string): Promise<string> {
    const hit = this.realDirs.get(dir)
    if (hit && Date.now() - hit.at < REAL_DIR_CACHE_MS) return hit.real
    let real: string
    try {
      real = await fs.realpath(dir)
    } catch {
      const parent = dirname(dir)
      real = parent === dir ? dir : join(await this.realDir(parent), basename(dir))
    }
    if (this.realDirs.size > 5000) this.realDirs.clear()
    this.realDirs.set(dir, { real, at: Date.now() })
    return real
  }

  rel(absPath: string): string {
    return relative(this.root, absPath).split(sep).join('/')
  }

  async list(): Promise<TreeEntry[]> {
    return this.listDir(this.root)
  }

  private async listDir(dir: string): Promise<TreeEntry[]> {
    const dirents = await fs.readdir(dir, { withFileTypes: true })
    const entries: TreeEntry[] = []
    await Promise.all(
      dirents.map(async (d) => {
        if (d.name.startsWith('.')) return
        const full = join(dir, d.name)
        if (d.isDirectory()) {
          entries.push({ name: d.name, path: this.rel(full), kind: 'folder', ext: '', children: await this.listDir(full) })
        } else if (d.isFile()) {
          const stat = await fs.stat(full).catch(() => null)
          entries.push({
            name: d.name,
            path: this.rel(full),
            kind: 'file',
            ext: extname(d.name).slice(1).toLowerCase(),
            mtime: stat?.mtimeMs,
            ctime: stat?.birthtimeMs,
            size: stat?.size
          })
        }
      })
    )
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
    return entries.sort((a, b) => (a.kind === b.kind ? collator.compare(a.name, b.name) : a.kind === 'folder' ? -1 : 1))
  }

  async read(rel: string): Promise<string> {
    const file = await this.realAbs(rel)
    return withRetry(() => fs.readFile(file, 'utf8'))
  }

  async readMany(rels: string[]): Promise<Record<string, string | null>> {
    const out: Record<string, string | null> = {}
    const BATCH = 64
    for (let i = 0; i < rels.length; i += BATCH) {
      await Promise.all(
        rels.slice(i, i + BATCH).map(async (rel) => {
          try {
            const file = await this.realAbs(rel)
            out[rel] = await withRetry(() => fs.readFile(file, 'utf8'))
          } catch {
            out[rel] = null
          }
        })
      )
    }
    return out
  }

  async write(rel: string, content: string): Promise<void> {
    const file = await this.realAbs(rel)
    const old = this.beforeOverwrite ? await readIfExists(file) : null
    if (old !== null && old !== content) await this.beforeOverwrite!(rel, old)
    // Recreating a note whose folder was moved or deleted outside Zenode.
    if (old === null) await fs.mkdir(dirname(file), { recursive: true })
    await atomicWrite(file, content)
  }

  // Writes only if the file still matches the version the page last saw, so an
  // edit made outside Zenode (another app, a sync client) is never overwritten silently.
  async writeChecked(rel: string, content: string, expectHash: string): Promise<WriteResult> {
    const file = await this.realAbs(rel)
    const disk = await readIfExists(file)
    if (disk === null || contentHash(disk) !== expectHash) {
      // Already identical to what we'd write (e.g. the same edit synced back): nothing to do.
      if (disk === content) return { status: 'ok' }
      return { status: 'conflict', disk }
    }
    if (disk === content) return { status: 'ok' }
    if (this.beforeOverwrite) await this.beforeOverwrite(rel, disk)
    await atomicWrite(file, content)
    return { status: 'ok' }
  }

  // Moves a file or folder into the vault's .trash folder (hidden from the tree),
  // under a unique name. Returns its new vault-relative path.
  async moveToVaultTrash(rel: string): Promise<string> {
    const from = await this.realEntry(rel)
    const dir = join(this.root, TRASH_DIR)
    await fs.mkdir(dir, { recursive: true })
    const name = basename(from)
    const isDir = (await fs.stat(from)).isDirectory()
    const ext = isDir ? '' : extname(name)
    const to = await this.uniquePath(dir, ext ? name.slice(0, -ext.length) : name, ext)
    await withRetry(() => fs.rename(from, to))
    return this.rel(to)
  }

  // Creates a file with content (and any missing folders). Never overwrites:
  // fails if something with that name already exists.
  async createAt(rel: string, content: string): Promise<void> {
    for (const part of rel.split('/')) checkName(part)
    const file = await this.realAbs(rel)
    await fs.mkdir(dirname(file), { recursive: true })
    await fs.writeFile(file, content, { flag: 'wx' })
  }

  async createFile(dirRel: string, baseName: string, ext: string): Promise<string> {
    checkName(ext ? `${baseName}.${ext}` : baseName)
    const dir = await this.realAbs(dirRel)
    const target = await this.uniquePath(dir, baseName, ext ? `.${ext}` : '')
    await fs.writeFile(target, '', { flag: 'wx' })
    return this.rel(target)
  }

  // Saves pasted or dropped bytes as a new file in dirRel (created if needed),
  // never overwriting: "photo.png" becomes "photo 1.png" if taken. Returns its path.
  async saveAttachment(dirRel: string, fileName: string, bytes: Uint8Array): Promise<string> {
    const name = fileName.trim()
    checkName(name)
    const dot = name.lastIndexOf('.')
    const base = dot > 0 ? name.slice(0, dot) : name
    const ext = dot > 0 ? name.slice(dot) : ''
    const dir = await this.realAbs(dirRel)
    await fs.mkdir(dir, { recursive: true })
    for (let attempt = 0; ; attempt++) {
      const target = await this.uniquePath(dir, base, ext)
      try {
        await fs.writeFile(target, bytes, { flag: 'wx' })
        return this.rel(target)
      } catch (e) {
        // Another write took the name between the check and the write: try the next one.
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST' || attempt > 5) throw e
      }
    }
  }

  async createFolder(dirRel: string, name: string): Promise<string> {
    checkName(name)
    const dir = await this.realAbs(dirRel)
    const target = await this.uniquePath(dir, name, '')
    await fs.mkdir(target)
    return this.rel(target)
  }

  async rename(rel: string, newName: string): Promise<string> {
    const name = newName.trim()
    checkName(name)
    const from = await this.realEntry(rel)
    const to = await this.realAbs(join(dirname(rel), name))
    if (from === to) return rel
    // Windows paths are case-insensitive: "note" -> "Note" is a rename of the same file.
    const caseOnly = from.toLowerCase() === to.toLowerCase()
    if (!caseOnly && (await exists(to))) throw new Error(`"${name}" already exists`)
    await withRetry(() => fs.rename(from, to))
    return this.rel(to)
  }

  // Moves a file or folder into another folder ('' = vault root), keeping its name.
  async move(rel: string, destDirRel: string): Promise<string> {
    const from = await this.realEntry(rel)
    const destDir = await this.realAbs(destDirRel)
    const stat = await fs.stat(destDir).catch(() => null)
    if (!stat?.isDirectory()) throw new Error(`"${destDirRel || 'the vault root'}" is not a folder`)
    const to = join(destDir, basename(from))
    if (to === from) return rel
    if (`${destDir}${sep}`.toLowerCase().startsWith(`${from}${sep}`.toLowerCase())) throw new Error("A folder can't be moved into itself")
    if (await exists(to)) throw new Error(`"${basename(from)}" already exists in ${destDirRel || 'the vault root'}`)
    await withRetry(() => fs.rename(from, to))
    return this.rel(to)
  }

  private async uniquePath(dir: string, base: string, suffix: string): Promise<string> {
    let candidate = join(dir, `${base}${suffix}`)
    for (let i = 1; await exists(candidate); i++) {
      candidate = join(dir, `${base} ${i}${suffix}`)
    }
    return candidate
  }

  watch(onChange: (paths: string[]) => void): void {
    this.unwatch()
    const watcher = watch(this.root, { recursive: true }, (event, filename) => {
      if (!filename) return
      const rel = filename.split(sep).join('/')
      if (rel.split('/').some((part) => part.startsWith('.')) || rel.endsWith('.zenode-tmp')) return
      if (event === 'rename') {
        this.queueChange(rel, onChange)
        return
      }
      // A "change" to a folder is only its own metadata: on Windows, even the
      // first listing of a folder updates its last-access time. What happens
      // inside it (adds, removes, renames, edits) is reported for those entries.
      void fs.stat(join(this.root, filename)).then(
        (stat) => stat.isDirectory(),
        () => false
      ).then((isFolder) => {
        if (!isFolder && this.watcher === watcher) this.queueChange(rel, onChange)
      })
    })
    this.watcher = watcher
  }

  // Batches changes so a burst (a save, a sync) arrives as one call.
  private queueChange(rel: string, onChange: (paths: string[]) => void): void {
    this.pending.add(rel)
    if (this.flushTimer) clearTimeout(this.flushTimer)
    this.flushTimer = setTimeout(() => {
      const paths = [...this.pending]
      this.pending.clear()
      onChange(paths)
    }, 150)
  }

  unwatch(): void {
    this.watcher?.close()
    this.watcher = null
    if (this.flushTimer) clearTimeout(this.flushTimer)
    this.pending.clear()
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await fs.access(path)
    return true
  } catch {
    return false
  }
}
