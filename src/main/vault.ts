import { promises as fs, watch, type FSWatcher } from 'node:fs'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { TreeEntry, WriteResult } from '../shared/api'
import { fileNameProblem } from '../shared/fileNames'
import { contentHash } from '../shared/hash'
import { atomicWrite, readIfExists, withRetry } from './fsutil'

// Deleted files go here when the vault is set to keep them (like Obsidian's .trash).
export const TRASH_DIR = '.trash'

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
    return target
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
            ctime: stat?.birthtimeMs
          })
        }
      })
    )
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
    return entries.sort((a, b) => (a.kind === b.kind ? collator.compare(a.name, b.name) : a.kind === 'folder' ? -1 : 1))
  }

  read(rel: string): Promise<string> {
    const file = this.abs(rel)
    return withRetry(() => fs.readFile(file, 'utf8'))
  }

  async readMany(rels: string[]): Promise<Record<string, string | null>> {
    const out: Record<string, string | null> = {}
    const BATCH = 64
    for (let i = 0; i < rels.length; i += BATCH) {
      await Promise.all(
        rels.slice(i, i + BATCH).map(async (rel) => {
          try {
            const file = this.abs(rel)
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
    const file = this.abs(rel)
    const old = this.beforeOverwrite ? await readIfExists(file) : null
    if (old !== null && old !== content) await this.beforeOverwrite!(rel, old)
    // Recreating a note whose folder was moved or deleted outside Zenode.
    if (old === null) await fs.mkdir(dirname(file), { recursive: true })
    await atomicWrite(file, content)
  }

  // Writes only if the file still matches the version the page last saw, so an
  // edit made outside Zenode (another app, a sync client) is never overwritten silently.
  async writeChecked(rel: string, content: string, expectHash: string): Promise<WriteResult> {
    const file = this.abs(rel)
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
    const from = this.abs(rel)
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
    const file = this.abs(rel)
    await fs.mkdir(dirname(file), { recursive: true })
    await fs.writeFile(file, content, { flag: 'wx' })
  }

  async createFile(dirRel: string, baseName: string, ext: string): Promise<string> {
    checkName(ext ? `${baseName}.${ext}` : baseName)
    const dir = this.abs(dirRel)
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
    const dir = this.abs(dirRel)
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
    const dir = this.abs(dirRel)
    const target = await this.uniquePath(dir, name, '')
    await fs.mkdir(target)
    return this.rel(target)
  }

  async rename(rel: string, newName: string): Promise<string> {
    const name = newName.trim()
    checkName(name)
    const from = this.abs(rel)
    const to = this.abs(join(dirname(rel), name))
    if (from === to) return rel
    // Windows paths are case-insensitive: "note" -> "Note" is a rename of the same file.
    const caseOnly = from.toLowerCase() === to.toLowerCase()
    if (!caseOnly && (await exists(to))) throw new Error(`"${name}" already exists`)
    await withRetry(() => fs.rename(from, to))
    return this.rel(to)
  }

  // Moves a file or folder into another folder ('' = vault root), keeping its name.
  async move(rel: string, destDirRel: string): Promise<string> {
    const from = this.abs(rel)
    const destDir = this.abs(destDirRel)
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
    this.watcher = watch(this.root, { recursive: true }, (_event, filename) => {
      if (!filename) return
      const rel = filename.split(sep).join('/')
      if (rel.split('/').some((part) => part.startsWith('.')) || rel.endsWith('.zenode-tmp')) return
      this.pending.add(rel)
      if (this.flushTimer) clearTimeout(this.flushTimer)
      this.flushTimer = setTimeout(() => {
        const paths = [...this.pending]
        this.pending.clear()
        onChange(paths)
      }, 150)
    })
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
