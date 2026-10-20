// Keeps vaults in step with the signed-in account: links each vault folder to
// a vault in the account, runs sync passes (one at a time per vault) when a
// vault opens, a few seconds after its files change, and every few minutes,
// and tells the vault's windows how sync is going.
import { app } from 'electron'
import { promises as fs } from 'node:fs'
import { hostname } from 'node:os'
import { basename, join, resolve } from 'node:path'
import type { SyncSettings } from '../../shared/api'
import type { RemoteVault, SyncState, VaultSyncStatus } from '../../shared/sync'
import { atomicWrite } from '../fsutil'
import { describeError, log } from '../log'
import { loadSettings, rememberVault, saveSettings } from '../settings'
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

const PERIOD_MS = 5 * 60 * 1000
const AFTER_CHANGE_MS = 5000
const device = deviceLabel(hostname())

const key = (root: string): string => resolve(root).toLowerCase()
const states = new Map<string, { state: SyncState; skipped: number }>()
const running = new Map<string, Promise<void>>()
const again = new Set<string>()
const timers = new Map<string, NodeJS.Timeout>()

function store(uid: string): RemoteStore {
  if (testSyncDir) return new FolderRemote(join(testSyncDir, uid))
  const config = syncConfig()
  if (!config) throw new Error('Sync is not set up in this build of Zenode.')
  return new FirestoreRemote(config.projectId, () => uid, idToken)
}

// The sync settings for the signed-in account (another account starts afresh).
async function syncSettings(uid: string): Promise<SyncSettings> {
  const s = (await loadSettings()).sync
  return s && s.uid === uid ? s : { uid, links: {}, off: [] }
}

async function saveSyncSettings(next: SyncSettings): Promise<void> {
  await saveSettings({ ...(await loadSettings()), sync: next })
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
  const enabled = !!uid && !(await syncSettings(uid)).off.includes(key(root))
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

// The account's vault for this folder: linked before, or one with the same
// name not linked to another folder (a vault coming back after a reinstall), or a new one.
async function linkFor(root: string, uid: string, remote: RemoteStore): Promise<string> {
  const settings = await syncSettings(uid)
  const linked = settings.links[key(root)]
  if (linked) return linked
  const taken = new Set(Object.values(settings.links))
  const name = basename(root)
  const match = (await remote.listVaults()).find((v) => !taken.has(v.id) && v.name.toLowerCase() === name.toLowerCase())
  const id = match?.id ?? (await remote.createVault(name))
  await saveSyncSettings({ ...(await syncSettings(uid)), links: { ...settings.links, [key(root)]: id } })
  return id
}

async function runPass(root: string, rethrow = false): Promise<void> {
  const uid = currentUid()
  if (!uid || (await syncSettings(uid)).off.includes(key(root))) return
  const k = key(root)
  states.set(k, { state: { status: 'syncing' }, skipped: states.get(k)?.skipped ?? 0 })
  broadcast(root)
  try {
    const remote = store(uid)
    const remoteId = await linkFor(root, uid, remote)
    const vault = vaultFor(root)
    const { memory, report } = await syncPass(vault.root, remoteId, await readMemory(uid, remoteId), {
      remote,
      device,
      read: (p) => vault.read(p),
      write: (p, c) => vault.write(p, c),
      trash: async (p) => {
        await trashFile(vault, p)
      },
      warn: (m) => void log('warn', m)
    })
    await writeMemory(uid, remoteId, memory)
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

// Syncs a vault now (or right after the pass already running).
export function syncVault(root: string): Promise<void> {
  const k = key(root)
  const current = running.get(k)
  if (current) {
    again.add(k)
    return current
  }
  const pass = runPass(root).finally(() => {
    running.delete(k)
    if (again.delete(k)) void syncVault(root)
  })
  running.set(k, pass)
  return pass
}

function scheduleSync(root: string, delay: number): void {
  const k = key(root)
  clearTimeout(timers.get(k))
  timers.set(k, setTimeout(() => void syncVault(root), delay))
}

// Open vaults, and with `recent` the other vaults this computer has opened.
async function syncAll(recent: boolean): Promise<void> {
  if (!currentUid()) return
  const roots = new Map<string, string>()
  for (const w of allWindows()) if (w.vault) roots.set(key(w.vault.root), w.vault.root)
  if (recent) {
    for (const r of (await loadSettings()).recentVaults) {
      const isDir = await fs.stat(r).then((s) => s.isDirectory(), () => false)
      if (isDir && !roots.has(key(r))) roots.set(key(r), r)
    }
  }
  for (const root of roots.values()) await syncVault(root)
}

export async function setSyncEnabled(root: string, on: boolean): Promise<VaultSyncStatus> {
  const uid = currentUid()
  if (!uid) throw new Error('Sign in first.')
  const s = await syncSettings(uid)
  const off = s.off.filter((r) => r !== key(root))
  await saveSyncSettings({ ...s, off: on ? off : [...off, key(root)] })
  if (on) void syncVault(root)
  else broadcast(root)
  return vaultStatus(root)
}

export async function remoteVaults(): Promise<RemoteVault[]> {
  const uid = currentUid()
  if (!uid) return []
  const settings = await syncSettings(uid)
  const recent = (await loadSettings()).recentVaults
  const rootOf = (id: string): string | null => {
    const k = Object.keys(settings.links).find((r) => settings.links[r] === id)
    return k ? (recent.find((r) => key(r) === k) ?? k) : null
  }
  return (await store(uid).listVaults()).map((v) => ({ ...v, localRoot: rootOf(v.id) })).sort((a, b) => b.updatedAt - a.updatedAt)
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
  const settings = await syncSettings(uid)
  await saveSyncSettings({ ...settings, links: { ...settings.links, [key(root)]: remoteId }, off: settings.off.filter((r) => r !== key(root)) })
  await runPass(root, true)
  await saveSettings(rememberVault(await loadSettings(), root))
  return root
}

export async function startSync(): Promise<void> {
  await loadAccount()
  vaultEvents.on('opened', (root) => scheduleSync(root, 1500))
  vaultEvents.on('changed', (root) => scheduleSync(root, AFTER_CHANGE_MS))
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
