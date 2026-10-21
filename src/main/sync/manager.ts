// Keeps vaults in step with the signed-in account: links each vault folder to
// a vault in the account, runs sync passes (one at a time per vault) when a
// vault opens, a few seconds after its files change, and every few minutes,
// and tells the vault's windows how sync is going.
//
// What syncs: vaults opened while signed in, and vaults that synced before.
// The Help vault and folders opened just to read one file (settings.syncSkip)
// sync only once turned on in Settings.
import { app } from 'electron'
import { promises as fs } from 'node:fs'
import { hostname } from 'node:os'
import { basename, join } from 'node:path'
import type { SyncSettings } from '../../shared/api'
import type { RemoteVault, SyncState, VaultSyncStatus } from '../../shared/sync'
import { atomicWrite } from '../fsutil'
import { describeError, log } from '../log'
import { folderKey as key, loadSettings, rememberVault, updateSettings } from '../settings'
import { SnapshotStore } from '../snapshots'
import { trashFile } from '../trash'
import { Vault } from '../vault'
import { allWindows, vaultEvents } from '../windows'
import { accountState, currentUid, idToken, loadAccount, onAccountChange, testSyncDir } from './account'
import { syncConfig } from './config'
import { emptyMemory, syncPass, type SyncMemory } from './engine'
import { FirestoreRemote } from './firestore'
import { FolderRemote } from './folderRemote'
import { deviceLabel } from './plan'
import type { RemoteStore } from './remote'
import { readVaultLink, writeVaultLink } from './vaultLink'

const PERIOD_MS = 5 * 60 * 1000
// After an edit: wait for typing to pause, then upload. The account is asked
// what changed at most this often by those passes (each question is a billed read).
const AFTER_CHANGE_MS = 10_000
const REMOTE_CHECK_MS = 60_000
const device = deviceLabel(hostname())

const lastRemoteCheck = new Map<string, number>()
type PassKind = 'full' | 'quick'
const pending = new Map<string, PassKind>()
const states = new Map<string, { state: SyncState; skipped: number }>()
const running = new Map<string, Promise<void>>()
const again = new Set<string>()
const timers = new Map<string, NodeJS.Timeout>()
// Passes re-run at once when another computer wrote at the same moment, a few times at most.
const MAX_RETRIES = 3
const retries = new Map<string, number>()

function store(uid: string): RemoteStore {
  if (testSyncDir) return new FolderRemote(join(testSyncDir, uid))
  const config = syncConfig()
  if (!config) throw new Error('Sync is not set up in this build of Zenode.')
  return new FirestoreRemote(config.projectId, () => uid, idToken)
}

const forAccount = (s: SyncSettings | undefined, uid: string): SyncSettings => (s && s.uid === uid ? s : { uid, links: {}, off: [] })

// The sync settings for the signed-in account (another account starts afresh).
async function syncSettings(uid: string): Promise<SyncSettings> {
  return forAccount((await loadSettings()).sync, uid)
}

// Changes them in turn with every other settings change, so none is lost.
async function updateSync(uid: string, change: (s: SyncSettings) => SyncSettings): Promise<void> {
  await updateSettings((s) => ({ ...s, sync: change(forAccount(s.sync, uid)) }))
}

// Whether this folder syncs now: not turned off, and not waiting to be turned on.
async function syncAllowed(root: string, uid: string): Promise<boolean> {
  const s = await loadSettings()
  return !forAccount(s.sync, uid).off.includes(key(root)) && !(s.syncSkip ?? []).includes(key(root))
}

const memoryFile = (uid: string, remoteId: string): string => join(app.getPath('userData'), 'sync', `${uid}-${remoteId}.json`)

async function readMemory(uid: string, remoteId: string): Promise<SyncMemory> {
  try {
    return { ...emptyMemory(), ...(JSON.parse(await fs.readFile(memoryFile(uid, remoteId), 'utf8')) as SyncMemory) }
  } catch {
    return emptyMemory()
  }
}

async function writeMemory(uid: string, remoteId: string, memory: SyncMemory): Promise<void> {
  const file = memoryFile(uid, remoteId)
  await fs.mkdir(join(file, '..'), { recursive: true })
  await atomicWrite(file, JSON.stringify(memory))
}

export async function vaultStatus(root: string): Promise<VaultSyncStatus> {
  const uid = currentUid()
  const enabled = !!uid && (await syncAllowed(root, uid))
  const s = states.get(key(root))
  return { signedIn: !!uid, enabled, state: enabled ? (s?.state ?? { status: 'idle', lastSync: null }) : { status: 'off' }, skipped: s?.skipped ?? 0 }
}

function broadcast(root: string): void {
  void vaultStatus(root).then((status) => {
    for (const w of allWindows()) if (w.vault && key(w.vault.root) === key(root) && !w.win.isDestroyed()) w.win.webContents.send('sync:status', status)
  })
}

// The open window's vault (so writes keep its file history), or a fresh one.
function vaultFor(root: string): Vault {
  const open = allWindows().find((w) => w.vault && key(w.vault.root) === key(root))?.vault
  if (open) return open
  const snapshots = new SnapshotStore(app.getPath('userData'), root)
  return new Vault(root, async (rel, old) => {
    await snapshots.save(rel, old, 'auto').catch((e) => log('warn', `snapshot ${rel}: ${describeError(e)}`))
  })
}

// The account's vault for this folder: the one it was linked to (in settings,
// or in the folder itself after a reinstall), or a new one. Never matched by
// name, so two different vaults called "Notes" stay apart.
async function linkFor(root: string, uid: string, remote: RemoteStore): Promise<string> {
  const linked = (await syncSettings(uid)).links[key(root)] ?? (await readVaultLink(root, uid))
  const id = linked ?? (await remote.createVault(basename(root)))
  await link(root, uid, id)
  return id
}

// Records the link in settings (replacing any other folder linked to the same
// vault) and in the folder.
async function link(root: string, uid: string, id: string): Promise<void> {
  await updateSync(uid, (s) => {
    if (s.links[key(root)] === id) return s
    const links = Object.fromEntries(Object.entries(s.links).filter(([, v]) => v !== id))
    return { ...s, links: { ...links, [key(root)]: id } }
  })
  await writeVaultLink(root, uid, id)
}

async function runPass(root: string, kind: PassKind, rethrow = false): Promise<void> {
  const uid = currentUid()
  if (!uid || !(await syncAllowed(root, uid))) return
  const k = key(root)
  const localOnly = kind === 'quick' && Date.now() - (lastRemoteCheck.get(k) ?? 0) < REMOTE_CHECK_MS
  states.set(k, { state: { status: 'syncing' }, skipped: states.get(k)?.skipped ?? 0 })
  broadcast(root)
  try {
    const remote = store(uid)
    const remoteId = await linkFor(root, uid, remote)
    const vault = vaultFor(root)
    const { memory, report, retry } = await syncPass(vault.root, remoteId, await readMemory(uid, remoteId), {
      remote,
      device,
      read: (p) => vault.read(p),
      write: (p, c) => vault.write(p, c),
      trash: async (p) => {
        await trashFile(vault, p)
      },
      warn: (m) => void log('warn', m)
    }, { localOnly })
    if (!localOnly) lastRemoteCheck.set(k, Date.now())
    await writeMemory(uid, remoteId, memory)
    const tries = retry ? (retries.get(k) ?? 0) + 1 : 0
    retries.set(k, tries)
    if (retry && tries <= MAX_RETRIES) {
      again.add(k)
      pending.set(k, 'full')
    }
    states.set(k, { state: { status: 'idle', lastSync: Date.now() }, skipped: report.skipped })
    if (report.uploaded + report.downloaded + report.deleted + report.conflicts > 0) {
      void log('info', `sync ${vault.name}: ${JSON.stringify(report)}`)
    }
  } catch (e) {
    states.set(k, { state: { status: 'error', message: (e as Error).message }, skipped: states.get(k)?.skipped ?? 0 })
    void log('warn', `sync ${root}: ${describeError(e)}`)
    if (rethrow) throw e
  } finally {
    broadcast(root)
  }
}

// Syncs a vault now (or right after the pass already running). A quick pass
// only uploads, unless the account wasn't checked for a while.
export function syncVault(root: string, kind: PassKind = 'full'): Promise<void> {
  const k = key(root)
  const current = running.get(k)
  if (current) {
    again.add(k)
    if (kind === 'full' || !pending.has(k)) pending.set(k, kind)
    return current
  }
  const pass = runPass(root, kind).finally(() => {
    running.delete(k)
    const next = pending.get(k) ?? 'full'
    pending.delete(k)
    if (again.delete(k)) void syncVault(root, next)
  })
  running.set(k, pass)
  return pass
}

function scheduleSync(root: string, delay: number, kind: PassKind): void {
  const k = key(root)
  clearTimeout(timers.get(k))
  timers.set(k, setTimeout(() => void syncVault(root, kind), delay))
}

// Open vaults, and with `linked` the closed vaults on this computer that
// synced before. Other folders it has opened are left alone.
async function syncAll(linked: boolean): Promise<void> {
  const uid = currentUid()
  if (!uid) return
  const roots = new Map<string, string>()
  for (const w of allWindows()) if (w.vault) roots.set(key(w.vault.root), w.vault.root)
  if (linked) {
    const settings = await loadSettings()
    const links = forAccount(settings.sync, uid).links
    for (const r of settings.recentVaults) {
      if (links[key(r)] && !roots.has(key(r)) && (await isDir(r))) roots.set(key(r), r)
    }
  }
  for (const root of roots.values()) await syncVault(root)
}

export async function setSyncEnabled(root: string, on: boolean): Promise<VaultSyncStatus> {
  const uid = currentUid()
  if (!uid) throw new Error('Sign in first.')
  await updateSync(uid, (s) => {
    const off = s.off.filter((r) => r !== key(root))
    return { ...s, off: on ? off : [...off, key(root)] }
  })
  // A choice made by hand ends "only once turned on" and is kept from then on.
  await updateSettings((s) => ({
    ...s,
    syncSkip: on ? (s.syncSkip ?? []).filter((r) => r !== key(root)) : s.syncSkip,
    syncChosen: (s.syncChosen ?? []).includes(key(root)) ? s.syncChosen : [...(s.syncChosen ?? []), key(root)]
  }))
  if (on) void syncVault(root)
  else broadcast(root)
  return vaultStatus(root)
}

const isDir = (p: string): Promise<boolean> => fs.stat(p).then((s) => s.isDirectory(), () => false)

export async function remoteVaults(): Promise<RemoteVault[]> {
  const uid = currentUid()
  if (!uid) return []
  const settings = await syncSettings(uid)
  const recent = (await loadSettings()).recentVaults
  // The folder linked to a vault, if it is still there (a deleted or moved
  // folder doesn't count, so the vault can be restored).
  const rootOf = async (id: string): Promise<string | null> => {
    const k = Object.keys(settings.links).find((r) => settings.links[r] === id)
    if (!k) return null
    const root = recent.find((r) => key(r) === k) ?? k
    return (await isDir(root)) ? root : null
  }
  const vaults = await store(uid).listVaults()
  const out = await Promise.all(vaults.map(async (v) => ({ ...v, localRoot: await rootOf(v.id) })))
  return out.sort((a, b) => b.updatedAt - a.updatedAt)
}

// Downloads a vault from the account into a new folder in `parent`, and
// returns the folder.
export async function restoreVault(remoteId: string, parent: string): Promise<string> {
  const uid = currentUid()
  if (!uid) throw new Error('Sign in first.')
  const remote = store(uid)
  const vault = (await remote.listVaults()).find((v) => v.id === remoteId)
  if (!vault) throw new Error('That vault is no longer in your account.')
  const safe = vault.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/[. ]+$/, '').trim() || 'Vault'
  let root = join(parent, safe)
  for (let i = 2; await fs.stat(root).then(() => true, () => false); i++) root = join(parent, `${safe} ${i}`)
  await fs.mkdir(root, { recursive: true })
  // The new folder replaces any old (missing) one linked to this vault.
  await link(root, uid, remoteId)
  await runPass(root, 'full', true)
  await updateSettings((s) => rememberVault(s, root))
  return root
}

export async function startSync(): Promise<void> {
  await loadAccount()
  vaultEvents.on('opened', (root) => scheduleSync(root, 1500, 'full'))
  vaultEvents.on('changed', (root) => scheduleSync(root, AFTER_CHANGE_MS, 'quick'))
  onAccountChange(() => {
    states.clear()
    for (const w of allWindows()) {
      if (w.win.isDestroyed()) continue
      w.win.webContents.send('account:changed', accountState())
      if (w.vault) broadcast(w.vault.root)
    }
    void syncAll(true)
  })
  setInterval(() => void syncAll(false), PERIOD_MS)
  if (currentUid()) setTimeout(() => void syncAll(true), 3000)
}
