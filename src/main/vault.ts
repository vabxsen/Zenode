import { promises as fs, watch, type FSWatcher } from 'node:fs'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { TreeEntry } from '../shared/api'

const INVALID_NAME = /[\\/:*?"<>|]/

// Owns the open vault: every renderer path goes through `abs()`, which
// rejects anything that resolves outside the vault root.
export class Vault {
  private watcher: FSWatcher | null = null
  private pending = new Set<string>()
  private flushTimer: NodeJS.Timeout | null = null

  constructor(readonly root: string) {}

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
    for (const d of dirents) {
      if (d.name.startsWith('.')) continue
      const full = join(dir, d.name)
      if (d.isDirectory()) {
        entries.push({ name: d.name, path: this.rel(full), kind: 'folder', ext: '', children: await this.listDir(full) })
      } else if (d.isFile()) {
        entries.push({ name: d.name, path: this.rel(full), kind: 'file', ext: extname(d.name).slice(1).toLowerCase() })
      }
    }
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
    return entries.sort((a, b) => (a.kind === b.kind ? collator.compare(a.name, b.name) : a.kind === 'folder' ? -1 : 1))
  }

  read(rel: string): Promise<string> {
    return fs.readFile(this.abs(rel), 'utf8')
  }

  async readMany(rels: string[]): Promise<Record<string, string | null>> {
    const out: Record<string, string | null> = {}
    const BATCH = 64
    for (let i = 0; i < rels.length; i += BATCH) {
      await Promise.all(
        rels.slice(i, i + BATCH).map(async (rel) => {
          try {
            out[rel] = await fs.readFile(this.abs(rel), 'utf8')
          } catch {
            out[rel] = null
          }
        })
      )
    }
    return out
  }

  // Write to a temp file and rename, so a crash never leaves a half-written note.
  async write(rel: string, content: string): Promise<void> {
    const target = this.abs(rel)
    const temp = `${target}.zenode-tmp`
    await fs.writeFile(temp, content, 'utf8')
    await fs.rename(temp, target)
  }

  async createFile(dirRel: string, baseName: string, ext: string): Promise<string> {
    const dir = this.abs(dirRel)
    const target = await this.uniquePath(dir, baseName, ext ? `.${ext}` : '')
    await fs.writeFile(target, '', { flag: 'wx' })
    return this.rel(target)
  }

  async createFolder(dirRel: string, name: string): Promise<string> {
    const dir = this.abs(dirRel)
    const target = await this.uniquePath(dir, name, '')
    await fs.mkdir(target)
    return this.rel(target)
  }

  async rename(rel: string, newName: string): Promise<string> {
    const name = newName.trim()
    if (!name || INVALID_NAME.test(name) || name === '.' || name === '..') {
      throw new Error(`Invalid name: ${newName}`)
    }
    const from = this.abs(rel)
    const to = this.abs(join(dirname(rel), name))
    if (from === to) return rel
    const caseOnly = from.toLowerCase() === to.toLowerCase()
    if (!caseOnly && (await exists(to))) throw new Error(`"${name}" already exists`)
    await fs.rename(from, to)
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
