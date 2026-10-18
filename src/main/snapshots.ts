import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { SnapshotInfo } from '../shared/api'
import { contentHash } from '../shared/hash'
import { atomicWrite } from './fsutil'

// Local file history ("file recovery"): copies of notes kept outside the vault in
// <userData>/snapshots/<vault>/<file>/<time>.snap, so a bad edit, a sync accident or
// a discarded version can be brought back.
//   - auto: the old content just before a save replaces it, at most once per interval
//   - kept: text the user chose to throw away (always stored)
const AUTO_INTERVAL = 5 * 60_000
const MAX_AGE = 7 * 24 * 60 * 60_000
const MAX_PER_FILE = 50
const ID = /^\d{13}$/

export class SnapshotStore {
  private readonly root: string

  constructor(userData: string, vaultRoot: string) {
    this.root = join(userData, 'snapshots', contentHash(vaultRoot.toLowerCase()))
  }

  private dirFor(rel: string): string {
    return join(this.root, contentHash(rel.toLowerCase()))
  }

  async save(rel: string, content: string, kind: 'auto' | 'kept', now = Date.now()): Promise<boolean> {
    if (!content.trim()) return false
    const dir = this.dirFor(rel)
    const existing = await this.ids(dir)
    const latest = existing[0]
    if (latest) {
      if (kind === 'auto' && now - Number(latest) < AUTO_INTERVAL) return false
      if ((await fs.readFile(join(dir, `${latest}.snap`), 'utf8').catch(() => null)) === content) return false
    }
    await fs.mkdir(dir, { recursive: true })
    await atomicWrite(join(dir, 'path.txt'), rel)
    let id = now
    while (existing.includes(String(id))) id++
    await atomicWrite(join(dir, `${id}.snap`), content)
    return true
  }

  async list(rel: string): Promise<SnapshotInfo[]> {
    const dir = this.dirFor(rel)
    const out: SnapshotInfo[] = []
    for (const id of await this.ids(dir)) {
      const stat = await fs.stat(join(dir, `${id}.snap`)).catch(() => null)
      if (stat) out.push({ id, time: Number(id), size: stat.size })
    }
    return out
  }

  read(rel: string, id: string): Promise<string> {
    if (!ID.test(id)) throw new Error('Invalid snapshot id')
    return fs.readFile(join(this.dirFor(rel), `${id}.snap`), 'utf8')
  }

  // Drops snapshots older than a week and all but the newest MAX_PER_FILE per file.
  async prune(now = Date.now()): Promise<void> {
    let dirs: string[]
    try {
      dirs = await fs.readdir(this.root)
    } catch {
      return
    }
    for (const name of dirs) {
      const dir = join(this.root, name)
      const ids = await this.ids(dir)
      const stale = ids.filter((id, i) => i >= MAX_PER_FILE || now - Number(id) > MAX_AGE)
      for (const id of stale) await fs.rm(join(dir, `${id}.snap`), { force: true })
      if (stale.length === ids.length) await fs.rm(dir, { recursive: true, force: true })
    }
  }

  // Snapshot ids in a file's folder, newest first.
  private async ids(dir: string): Promise<string[]> {
    try {
      return (await fs.readdir(dir))
        .filter((f) => f.endsWith('.snap'))
        .map((f) => f.slice(0, -5))
        .filter((id) => ID.test(id))
        .sort()
        .reverse()
    } catch {
      return []
    }
  }
}
