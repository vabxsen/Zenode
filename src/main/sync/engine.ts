// One sync pass for one vault: scan the files here, fetch what changed in the
// account, plan (plan.ts), then carry the plan out. What was synced is kept in
// SyncMemory, so the next pass knows which side changed what.
import { promises as fs } from 'node:fs'
import { extname, join, relative, sep } from 'node:path'
import type { SyncReport } from '../../shared/sync'
import { contentHash } from '../../shared/hash'
import { conflictPath, planSync, type RemoteChange } from './plan'
import { MAX_FILE_BYTES, RemoteChangedError, type RemoteFile, type RemoteStore, type RemoteWrite } from './remote'

// Text files sync for now; images, PDFs and other attachments need cloud file
// storage (Firebase's paid plan) and are counted as skipped.
const TEXT_EXT = new Set(['md', 'markdown', 'canvas', 'txt', 'json', 'css', 'csv', 'tsv', 'yaml', 'yml', 'svg', 'html', 'xml', 'base', 'js', 'ts', 'py'])
// Folders that never sync: deleted files, version control, and other apps' settings.
const SKIP_DIRS = new Set(['.trash', '.git', '.obsidian', 'node_modules'])
// Files in .zenode that describe this computer rather than the vault: open
// tabs and pane layout, the Help vault's version stamp, and the account link.
const DEVICE_ONLY = new Set(['.zenode/workspace.json', '.zenode/help-version', '.zenode/sync.json'])

const isTextFile = (name: string): boolean => TEXT_EXT.has(extname(name).slice(1).toLowerCase())

// Whether a vault path takes part in sync, in both directions: what this
// computer uploads, and what it accepts from the account. Nothing from the
// account lands in hidden folders (other than .zenode), .git, .obsidian or
// .trash, or as a file type that isn't synced.
export function isSyncable(path: string): boolean {
  if (!path || DEVICE_ONLY.has(path) || path.endsWith('.zenode-tmp')) return false
  const parts = path.split('/')
  if (parts.some((p) => p === '' || p === '.' || p === '..')) return false
  const dirs = parts.slice(0, -1)
  if (dirs.some((d, i) => SKIP_DIRS.has(d) || (d.startsWith('.') && !(i === 0 && d === '.zenode')))) return false
  return isTextFile(parts[parts.length - 1])
}

export interface SyncMemory {
  cursor: string | null
  // Hash of each file as of the last sync.
  base: Record<string, string>
  // Hashes of unchanged files are reused: [mtime, size, hash].
  stat: Record<string, [number, number, string]>
  // Each file's version in the account as last seen; uploads expect it unchanged.
  versions: Record<string, string>
}

export const emptyMemory = (): SyncMemory => ({ cursor: null, base: {}, stat: {}, versions: {} })

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
        if (e.name.endsWith('.zenode-tmp') || DEVICE_ONLY.has(path)) continue
        const st = await fs.stat(full).catch(() => null)
        if (!st) continue
        if (!isTextFile(e.name) || st.size > MAX_FILE_BYTES) {
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

export interface PassResult {
  memory: SyncMemory
  report: SyncReport
  // Another computer wrote at the same moment: sync again soon.
  retry: boolean
}

// A conflict copy of `path` with this content is already here (from an
// interrupted pass), so it isn't made twice.
function hasCopy(local: Record<string, string>, path: string, hash: string): boolean {
  const prefix = `${path.replace(/\.[^./]+$/, '')} (Zenode conflict from `
  return Object.keys(local).some((p) => p.startsWith(prefix) && local[p] === hash)
}

export interface PassOptions {
  // Only send this computer's changes, without asking the account what changed
  // (a quick pass after an edit). Uploads still carry the versions last seen,
  // so a file changed elsewhere is refused and the next full pass handles it.
  localOnly?: boolean
}

export async function syncPass(root: string, remoteId: string, memory: SyncMemory, deps: EngineDeps, options: PassOptions = {}): Promise<PassResult> {
  const scan = await scanLocal(root, memory.stat)
  const page = options.localOnly ? { files: [], cursor: memory.cursor } : await deps.remote.changesSince(remoteId, memory.cursor)
  const incoming = page.files.filter((f) => {
    if (isSyncable(f.path)) return true
    deps.warn?.(`sync: ignored ${f.path} from the account (not a file Zenode syncs)`)
    return false
  })
  const remoteFiles = new Map(incoming.map((f) => [f.path, f]))
  const remote: Record<string, RemoteChange> = {}
  const versions = { ...memory.versions }
  for (const f of incoming) {
    remote[f.path] = { hash: f.hash, deleted: f.deleted }
    if (f.version) versions[f.path] = f.version
  }
  const plan = planSync(memory.base, scan.hashes, remote)
  const base = { ...plan.base }
  const report: SyncReport = { uploaded: 0, downloaded: 0, deleted: 0, conflicts: 0, skipped: scan.skipped }
  const outgoing: RemoteWrite[] = []
  const send = (f: RemoteFile): void => void outgoing.push({ ...f, expect: versions[f.path] ?? null })
  // A file that couldn't be handled keeps its old base, so the next pass tries again.
  const keepOld = (path: string): void => {
    if (memory.base[path] === undefined) delete base[path]
    else base[path] = memory.base[path]
  }
  const failed = (path: string, e: unknown): void => {
    deps.warn?.(`sync ${path}: ${(e as Error)?.message ?? e}`)
    keepOld(path)
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
      const content = remoteFiles.get(path)!.content
      const hash = contentHash(content)
      if (!hasCopy(scan.hashes, path, hash)) {
        const copy = conflictPath(path, deps.device, deps.now?.() ?? new Date())
        await deps.write(copy, content)
        send({ path: copy, hash, deleted: false, content })
        base[copy] = hash
      }
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
      send({ path, hash, deleted: false, content })
      base[path] = hash
    } catch (e) {
      failed(path, e)
    }
  }
  for (const path of plan.deleteRemote) send({ path, hash: '', deleted: true, content: '' })
  let retry = false
  if (outgoing.length) {
    try {
      Object.assign(versions, await deps.remote.put(remoteId, outgoing, deps.device))
      report.uploaded = outgoing.filter((f) => !f.deleted).length
      report.deleted += outgoing.length - report.uploaded
    } catch (e) {
      if (!(e instanceof RemoteChangedError)) throw e
      // Nothing (or not all) went up: those files stay unsynced, and the next
      // pass sees what the other computer wrote and handles it.
      for (const f of outgoing) keepOld(f.path)
      retry = true
    }
  }
  return { memory: { cursor: page.cursor, base, stat: scan.stat, versions }, report, retry }
}
