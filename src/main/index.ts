import { app, dialog, ipcMain, net, protocol, shell, type IpcMainInvokeEvent } from 'electron'
import { promises as fs } from 'node:fs'
import { basename, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { PdfExportRequest, TrashResult, VaultInfo } from '../shared/api'
import { isRunnable, safeExternalUrl } from '../shared/linkSafety'
import { exportPdf } from './exportPdf'
import { trashFile } from './trash'
import { accountState, cancelSignIn, signIn, signOut } from './sync/account'
import { remoteVaults, restoreVault, setSyncEnabled, startSync, syncVault, vaultStatus } from './sync/manager'
import { openLaunchTarget } from './launch'
import { knownVault } from './launchArgs'
import type { UpdatePrefs } from '../shared/updates'
import { checkForUpdates, installUpdate, setUpdatePrefs, startUpdates, updateStatus } from './updates'
import { hardenSessions, isAppFrame, isAppOrigin } from './hardening'
import { createVaultFolder, forgetVault, helpVault } from './vaults'
import { cssFolder, listCss, readCss, readConfig, writeConfig, type CssKind } from './config'
import { errorCode, friendlyError } from './fsutil'
import { describeError, isLogLevel, log } from './log'
import { loadSettings } from './settings'
import type { RecoveryJournal } from './recovery'
import type { SnapshotStore } from './snapshots'
import { mainWindow, TITLE_BAR_HEIGHT, vaultById, VaultWindow, windowFor, windowWithVault } from './windows'


if (!app.isPackaged) {
  // In development, never reuse cached renderer modules across reloads (stale code after edits).
  app.commandLine.appendSwitch('disable-http-cache')
  // End-to-end tests run with their own settings folder, so they never touch the user's.
  if (process.env.ZENODE_USER_DATA) app.setPath('userData', process.env.ZENODE_USER_DATA)
}
// End-to-end tests answer the "this file can run programs" question with this ("yes"/"no").
const testConfirm = app.isPackaged ? undefined : process.env.ZENODE_TEST_CONFIRM

async function confirmRunnable(w: VaultWindow, file: string): Promise<boolean> {
  if (testConfirm) return testConfirm === 'yes'
  const { response } = await dialog.showMessageBox(w.win, {
    type: 'warning',
    buttons: ['Cancel', 'Open anyway'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
    title: 'Open a program?',
    message: `"${basename(file)}" can run programs on this computer.`,
    detail: 'Only open it if you trust where it came from.'
  })
  return response === 1
}

// End-to-end tests create vaults here instead of asking for a folder.
const testVaultParent = app.isPackaged ? undefined : process.env.ZENODE_TEST_VAULT_PARENT

// One Zenode process: launching it again brings the open window forward.
// (The lock is per settings folder, so test instances don't collide.)
const isFirstInstance = app.requestSingleInstanceLock()
if (!isFirstInstance) app.quit()
// A second launch with a file, folder or zenode:// link opens it here.
app.on('second-instance', (_e, argv, cwd) => {
  void openLaunchTarget(argv.slice(1), cwd).then((opened) => opened || mainWindow()?.focus())
})

process.on('uncaughtException', (e) => void log('error', `main: ${describeError(e)}`))
process.on('unhandledRejection', (e) => void log('error', `main (promise): ${describeError(e)}`))

// vault://<vault id>/<path> serves files from that open vault (images in canvases and notes).
protocol.registerSchemesAsPrivileged([
  { scheme: 'vault', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }
])

const VAULT_FILE_CSP = "sandbox; default-src 'none'; img-src vault: data:; media-src vault:; style-src 'unsafe-inline'; font-src vault: data:"

function registerVaultProtocol(): void {
  protocol.handle('vault', async (request) => {
    const url = new URL(request.url)
    const vault = vaultById(url.hostname)
    if (!vault) return new Response('No such vault is open', { status: 404 })
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Not allowed', { status: 405 })
    try {
      const rel = decodeURIComponent(url.pathname.replace(/^\/+/, ''))
      // realAbs() rejects anything outside the vault, including through links.
      const file = await vault.realAbs(rel)
      const res = await net.fetch(pathToFileURL(file).toString())
      const headers = new Headers(res.headers)
      headers.set('X-Content-Type-Options', 'nosniff')
      // The app page may read vault files with fetch() (e.g. to put images into a PDF).
      const origin = request.headers.get('Origin')
      if (origin && isAppOrigin(origin)) headers.set('Access-Control-Allow-Origin', origin)
      // A vault file shown as a page (HTML, SVG) can never run scripts. PDFs are
      // left alone for the built-in PDF viewer.
      if (!/\.pdf$/i.test(file)) headers.set('Content-Security-Policy', VAULT_FILE_CSP)
      return new Response(res.body, { status: res.status, headers })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
}

// Opens `root` in window `w`, unless another window already has it: then that
// one comes forward and null is returned (one window per vault).
async function openVaultIn(w: VaultWindow, root: string): Promise<VaultInfo | null> {
  const other = windowWithVault(root, w)
  if (other) {
    other.focus()
    return null
  }
  return w.openVault(root)
}

// A vault the page names must be one the user already opened (from the vault list).
async function requireKnownVault(root: unknown): Promise<string> {
  const known = knownVault(root, (await loadSettings()).recentVaults)
  if (!known) throw new Error('That folder is not in your list of vaults. Use "Open folder as vault" to add it.')
  return known
}

async function chooseFolder(w: VaultWindow): Promise<string | null> {
  const result = await dialog.showOpenDialog(w.win, {
    title: 'Open folder as vault',
    properties: ['openDirectory', 'createDirectory']
  })
  return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
}

// IPC is answered for the window that sent it. File-system errors reach the
// page as plain-language messages; unexpected ones are also logged.
function handle<A extends unknown[], R>(channel: string, fn: (w: VaultWindow, ...args: A) => R | Promise<R>): void {
  ipcMain.handle(channel, async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
    const w = windowFor(event.sender)
    if (!w || !isAppFrame(event.sender, event.senderFrame)) throw new Error('Unexpected IPC sender')
    try {
      return await fn(w, ...(args as A))
    } catch (e) {
      if (!errorCode(e)) void log('warn', `${channel}: ${describeError(e)}`)
      throw friendlyError(e)
    }
  })
}

function registerIpc(): void {
  handle('vault:choose', async (w) => {
    const root = await chooseFolder(w)
    return root ? openVaultIn(w, root) : null
  })
  handle('vault:open', async (w, root: unknown) => openVaultIn(w, await requireKnownVault(root)))
  // Another vault in a new window (a folder picker when no root is given).
  handle('vault:openInNewWindow', async (w, root?: unknown) => {
    const folder = root === undefined || root === null ? await chooseFolder(w) : await requireKnownVault(root)
    if (!folder) return
    const open = windowWithVault(folder)
    if (open) open.focus()
    else await VaultWindow.create(folder)
  })
  handle('vault:current', (w) => w.info())
  handle('app:takeOpenRequest', (w) => w.takeOpenRequest())
  // A new vault: asks where (unless given), creates the folder, opens it here or in a new window.
  handle('vault:create', async (w, name: string, newWindow: boolean) => {
    let parent = testVaultParent
    if (!parent) {
      const result = await dialog.showOpenDialog(w.win, { title: 'Where should the new vault go?', properties: ['openDirectory', 'createDirectory'] })
      if (result.canceled || !result.filePaths.length) return null
      parent = result.filePaths[0]
    }
    const root = await createVaultFolder(parent, String(name ?? ''))
    if (newWindow) {
      await VaultWindow.create(root)
      return null
    }
    return openVaultIn(w, root)
  })
  handle('vault:openHelp', async (w, newWindow: boolean) => {
    const root = await helpVault()
    const open = windowWithVault(root)
    if (open) {
      open.focus()
      return null
    }
    if (newWindow) {
      await VaultWindow.create(root)
      return null
    }
    return openVaultIn(w, root)
  })
  handle('settings:forgetVault', (_w, root: string) => forgetVault(String(root)))
  handle('app:titleBar', (w, color: string, symbolColor: string) => {
    const hex = /^#[0-9a-f]{6}$/i
    if (!hex.test(color) || !hex.test(symbolColor)) throw new Error('Invalid colour')
    w.win.setTitleBarOverlay({ color, symbolColor, height: TITLE_BAR_HEIGHT })
    w.win.setBackgroundColor(color)
  })
  handle('app:info', () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: `${process.platform} ${process.getSystemVersion()}`,
    userData: app.getPath('userData')
  }))
  handle('account:state', () => accountState())
  handle('account:signIn', () => signIn())
  handle('account:cancelSignIn', () => cancelSignIn())
  handle('account:signOut', () => signOut())
  handle('sync:status', (w) => (w.vault ? vaultStatus(w.vault.root) : null))
  handle('sync:now', async (w) => {
    const root = w.requireVault().root
    await syncVault(root)
    return vaultStatus(root)
  })
  handle('sync:setEnabled', (w, on: boolean) => setSyncEnabled(w.requireVault().root, on === true))
  handle('sync:remoteVaults', () => remoteVaults())
  // Downloads a vault from the account into a folder the user picks, then
  // opens it here (on the welcome screen) or in a new window.
  handle('sync:restore', async (w, remoteId: string) => {
    let parent = testVaultParent
    if (!parent) {
      const result = await dialog.showOpenDialog(w.win, { title: 'Where should the vault go?', properties: ['openDirectory', 'createDirectory'] })
      if (result.canceled || !result.filePaths.length) return null
      parent = result.filePaths[0]
    }
    if (testVaultParent) await fs.mkdir(parent, { recursive: true })
    const root = await restoreVault(String(remoteId), parent)
    if (w.vault) {
      await VaultWindow.create(root)
      return null
    }
    return w.openVault(root)
  })
  handle('update:status', () => updateStatus())
  handle('update:check', () => checkForUpdates())
  handle('update:setPrefs', (_w, change: Partial<UpdatePrefs>) => setUpdatePrefs(change))
  handle('update:install', () => installUpdate())
  handle('export:pdf', (w, req: PdfExportRequest) => {
    const vault = w.requireVault()
    // The note's folder, checked to be inside the vault.
    const dir = dirname(vault.abs(typeof req?.path === 'string' ? req.path : ''))
    return exportPdf(w.win, req, dir)
  })
  handle('settings:get', () => loadSettings())
  handle('config:read', (w, name: string) => readConfig(w.requireVault().root, name))
  handle('config:write', (w, name: string, data: unknown) => writeConfig(w.requireVault().root, name, data))
  const cssKind = (kind: unknown): CssKind => {
    if (kind !== 'theme' && kind !== 'snippet') throw new Error('Invalid kind')
    return kind
  }
  handle('css:list', (w) => listCss(w.requireVault().root))
  handle('css:read', (w, kind: unknown, name: string) => readCss(w.requireVault().root, cssKind(kind), name))
  handle('css:openFolder', async (w, kind: unknown) => {
    const error = await shell.openPath(await cssFolder(w.requireVault().root, cssKind(kind)))
    if (error) throw new Error(error)
  })

  handle('fs:list', (w) => w.requireVault().list())
  handle('fs:read', (w, path: string) => w.requireVault().read(path))
  handle('fs:readMany', (w, paths: string[]) => w.requireVault().readMany(paths))
  handle('fs:write', (w, path: string, content: string) => w.requireVault().write(path, content))
  handle('fs:writeChecked', (w, path: string, content: string, expectHash: string) => w.requireVault().writeChecked(path, content, expectHash))
  handle('fs:createAt', (w, path: string, content: string) => w.requireVault().createAt(path, content))
  handle('fs:createFile', (w, dir: string, base: string, ext: string) => w.requireVault().createFile(dir, base, ext))
  handle('fs:saveAttachment', (w, dir: string, fileName: string, bytes: Uint8Array) => {
    if (!(bytes instanceof Uint8Array)) throw new Error('Invalid file data')
    return w.requireVault().saveAttachment(dir, fileName, bytes)
  })
  handle('fs:createFolder', (w, dir: string, name: string) => w.requireVault().createFolder(dir, name))
  handle('fs:rename', (w, path: string, newName: string) => w.requireVault().rename(path, newName))
  handle('fs:move', (w, path: string, destDir: string) => w.requireVault().move(path, destDir))
  // Deletes go to the Recycle Bin, or to the vault's .trash folder when
  // .zenode/app.json says "trashOption": "local" (or the Recycle Bin can't take it).
  handle('fs:trash', (w, path: string): Promise<TrashResult> => trashFile(w.requireVault(), path))
  handle('fs:reveal', async (w, path: string) => shell.showItemInFolder(await w.requireVault().realAbs(path)))
  // Opens a vault file in its default app. Files that would run as programs
  // need a yes first. Resolves false when the user said no.
  handle('fs:openExternal', async (w, path: string): Promise<boolean> => {
    const file = await w.requireVault().realAbs(path)
    if (isRunnable(file) && !(await confirmRunnable(w, file))) return false
    const error = await shell.openPath(file)
    if (error) throw new Error(error)
    return true
  })
  // Paths go through Vault.abs() first so the page can only name files inside the vault.
  const snapshotsFor = (w: VaultWindow, path: string): SnapshotStore => {
    w.requireVault().abs(path)
    if (!w.snapshots) throw new Error('No vault is open')
    return w.snapshots
  }
  handle('snapshots:list', (w, path: string) => snapshotsFor(w, path).list(path))
  handle('snapshots:read', (w, path: string, id: string) => snapshotsFor(w, path).read(path, id))
  handle('snapshots:keep', async (w, path: string, content: string) => {
    await snapshotsFor(w, path).save(path, content, 'kept')
  })
  const journalFor = (w: VaultWindow, path?: string): RecoveryJournal => {
    if (path !== undefined) w.requireVault().abs(path)
    if (!w.journal) throw new Error('No vault is open')
    return w.journal
  }
  handle('journal:put', (w, path: string, content: string, baseHash: string) => journalFor(w, path).put(path, content, baseHash))
  handle('journal:remove', (w, path: string) => journalFor(w, path).remove(path))
  handle('journal:list', (w) => journalFor(w).list())
  handle('app:log', (_w, level: unknown, message: unknown) => {
    if (!isLogLevel(level) || typeof message !== 'string') throw new Error('Invalid log entry')
    return log(level, `renderer: ${message}`)
  })
  handle('app:openUrl', async (_w, url: string) => {
    const safe = safeExternalUrl(url)
    if (!safe) throw new Error(`Zenode only opens web and email links: ${String(url).slice(0, 200)}`)
    await shell.openExternal(safe)
  })

  ipcMain.on('app:ready-to-close', (event) => {
    if (isAppFrame(event.sender, event.senderFrame)) windowFor(event.sender)?.closeNow()
  })
}

app.whenReady().then(async () => {
  if (!isFirstInstance) return
  hardenSessions()
  registerVaultProtocol()
  registerIpc()
  if (!(await openLaunchTarget(process.argv.slice(1), process.cwd()))) await VaultWindow.create()
  await startUpdates()
  await startSync()
})

app.on('window-all-closed', () => app.quit())
