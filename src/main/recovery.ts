import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { RecoveryEntry } from '../shared/api'
import { contentHash } from '../shared/hash'
import { atomicWrite } from './fsutil'

// Crash recovery: unsaved note text, journaled outside the vault in
// <userData>/recovery/<vault>/<file>.json while it can't be (or hasn't been)
// saved. A clean save removes the entry; anything left at startup survived a
// crash or a kill and is offered back to the user.
export class RecoveryJournal {
  private readonly root: string
  // Operations on one file run in order, so a remove can't overtake a put.
  private readonly queues = new Map<string, Promise<void>>()

  constructor(userData: string, vaultRoot: string) {
    this.root = join(userData, 'recovery', contentHash(vaultRoot.toLowerCase()))
  }

  private fileFor(path: string): string {
    return join(this.root, `${contentHash(path.toLowerCase())}.json`)
  }

  private queue(path: string, op: () => Promise<void>): Promise<void> {
    const file = this.fileFor(path)
    const next = (this.queues.get(file) ?? Promise.resolve()).catch(() => undefined).then(op)
    this.queues.set(file, next)
    void next.finally(() => {
      if (this.queues.get(file) === next) this.queues.delete(file)
    }).catch(() => undefined)
    return next
  }

  put(path: string, content: string, baseHash: string, now = Date.now()): Promise<void> {
    return this.queue(path, async () => {
      await fs.mkdir(this.root, { recursive: true })
      const entry: RecoveryEntry = { path, content, baseHash, time: now }
      await atomicWrite(this.fileFor(path), JSON.stringify(entry))
    })
  }

  remove(path: string): Promise<void> {
    return this.queue(path, () => fs.rm(this.fileFor(path), { force: true }))
  }

  async list(): Promise<RecoveryEntry[]> {
    let names: string[]
    try {
      names = await fs.readdir(this.root)
    } catch {
      return []
    }
    const out: RecoveryEntry[] = []
    for (const name of names.filter((n) => n.endsWith('.json'))) {
      try {
        const e = JSON.parse(await fs.readFile(join(this.root, name), 'utf8')) as RecoveryEntry
        if (typeof e.path === 'string' && typeof e.content === 'string' && typeof e.baseHash === 'string' && typeof e.time === 'number') out.push(e)
      } catch {
        // A damaged entry can't be restored; leave it for inspection.
      }
    }
    return out.sort((a, b) => b.time - a.time)
  }
}
