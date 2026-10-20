// One sync pass for one vault: scan the files here, fetch what changed in the
// account, plan (plan.ts), then carry the plan out. What was synced is kept in
// SyncMemory, so the next pass knows which side changed what.
import { promises as fs } from 'node:fs'
import { extname, join, relative, sep } from 'node:path'
import type { SyncReport } from '../../shared/sync'
import { contentHash } from '../../shared/hash'
import { conflictPath, planSync, type RemoteChange } from './plan'
import { MAX_FILE_BYTES, type RemoteFile, type RemoteStore } from './remote'

// Text files sync for now; images, PDFs and other attachments need cloud file
// storage (Firebase's paid plan) and are counted as skipped.
const TEXT_EXT = new Set(['md', 'markdown', 'canvas', 'txt', 'json', 'css', 'csv', 'tsv', 'yaml', 'yml', 'svg', 'html', 'xml', 'base', 'js', 'ts', 'py'])
// Folders that never sync: deleted files, version control, and other apps' settings.
const SKIP_DIRS = new Set(['.trash', '.git', '.obsidian', 'node_modules'])

export interface SyncMemory {
  cursor: string | null
  // Hash of each file as of the last sync.
  base: Record<string, string>
  // Hashes of unchanged files are reused: [mtime, size, hash].
  stat: Record<string, [number, number, string]>
}

export const emptyMemory = (): SyncMemory => ({ cursor: null, base: {}, stat: {} })

export interface EngineDeps {
  remote: RemoteStore
  device: string
  read(path: string): Promise<string>
  write(path: string, content: string): Promise<void>
  trash(path: string): Promise<void>
  // Problems with single files (the pass carries on without them).
  warn?(message: string): void
  now?: () => Date
}

interface LocalScan {
  hashes: Record<string, string>
  stat: SyncMemory['stat']
  skipped: number
}

export async function scanLocal(root: string, prev: SyncMemory['stat']): Promise<LocalScan> {
  const out: LocalScan = { hashes: {}, stat: {}, skipped: 0 }
  const walk = async (dir: string): Promise<void> => {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const e of entries) {
      const full = join(dir, e.name)
      const path = relative(root, full).split(sep).join('/')
      if (e.isDirectory()) {
        // Hidden folders are skipped, except Zenode's own settings.
        if (SKIP_DIRS.has(e.name) || (e.name.startsWith('.') && path !== '.zenode')) continue
        await walk(full)
      } else if (e.isFile()) {
        if (e.name.endsWith('.zenode-tmp')) continue
        const st = await fs.stat(full).catch(() => null)
        if (!st) continue
        if (!TEXT_EXT.has(extname(e.name).slice(1).toLowerCase()) || st.size > MAX_FILE_BYTES) {
          out.skipped++
          continue
        }
        const known = prev[path]
        const hash = known && known[0] === st.mtimeMs && known[1] === st.size ? known[2] : contentHash(await fs.readFile(full, 'utf8'))
        out.hashes[path] = hash
        out.stat[path] = [st.mtimeMs, st.size, hash]
      }
    }
  }
  await walk(root)
  return out
}

export async function syncPass(root: string, remoteId: string, memory: SyncMemory, deps: EngineDeps): Promise<{ memory: SyncMemory; report: SyncReport }> {
  const scan = await scanLocal(root, memory.stat)
  const page = await deps.remote.changesSince(remoteId, memory.cursor)
  const remoteFiles = new Map(page.files.map((f) => [f.path, f]))
  const remote: Record<string, RemoteChange> = {}
  for (const f of page.files) remote[f.path] = { hash: f.hash, deleted: f.deleted }
  const plan = planSync(memory.base, scan.hashes, remote)
  const base = { ...plan.base }
  const report: SyncReport = { uploaded: 0, downloaded: 0, deleted: 0, conflicts: 0, skipped: scan.skipped }
  const outgoing: RemoteFile[] = []
  // A file that couldn't be handled keeps its old base, so the next pass tries again.
  const failed = (path: string, e: unknown): void => {
    deps.warn?.(`sync ${path}: ${(e as Error)?.message ?? e}`)
    if (memory.base[path] === undefined) delete base[path]
    else base[path] = memory.base[path]
  }

  for (const path of plan.download) {
    try {
      await deps.write(path, remoteFiles.get(path)!.content)
      report.downloaded++
    } catch (e) {
      failed(path, e)
    }
  }
  for (const path of plan.deleteLocal) {
    try {
      await deps.trash(path)
      report.deleted++
    } catch (e) {
      failed(path, e)
    }
  }
  for (const path of plan.conflict) {
    try {
      // The other computer's version, kept here and sent to the account so every computer has both.
      const copy = conflictPath(path, deps.device, deps.now?.() ?? new Date())
      const content = remoteFiles.get(path)!.content
      await deps.write(copy, content)
      outgoing.push({ path: copy, hash: contentHash(content), deleted: false, content })
      base[copy] = contentHash(content)
      report.conflicts++
    } catch (e) {
      failed(path, e)
      continue
    }
    plan.upload.push(path)
  }
  for (const path of plan.upload) {
    try {
      // Read now: the file may have changed since the scan.
      const content = await deps.read(path)
      const hash = contentHash(content)
      outgoing.push({ path, hash, deleted: false, content })
      base[path] = hash
    } catch (e) {
      failed(path, e)
    }
  }
  for (const path of plan.deleteRemote) outgoing.push({ path, hash: '', deleted: true, content: '' })
  if (outgoing.length) {
    await deps.remote.put(remoteId, outgoing, deps.device)
    report.uploaded = outgoing.filter((f) => !f.deleted).length
    report.deleted += outgoing.length - report.uploaded
  }
  return { memory: { cursor: page.cursor, base, stat: scan.stat }, report }
}
