import { app, dialog, ipcMain, net, protocol, shell, type IpcMainInvokeEvent } from 'electron'
import { promises as fs } from 'node:fs'
import { basename, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { VaultInfo } from '../shared/api'
import { readConfig, writeConfig } from './config'
import { errorCode, friendlyError } from './fsutil'
import { describeError, isLogLevel, log } from './log'
import { loadSettings } from './settings'
import type { RecoveryJournal } from './recovery'
import type { SnapshotStore } from './snapshots'
import { mainWindow, vaultById, VaultWindow, windowFor, windowWithVault } from './windows'

const EXTERNAL_URL = /^(https?:|mailto:)/i

if (!app.isPackaged) {
  // In development, never reuse cached renderer modules across reloads (stale code after edits).
  app.commandLine.appendSwitch('disable-http-cache')
  // End-to-end tests run with their own settings folder, so they never touch the user's.
  if (process.env.ZENODE_USER_DATA) app.setPath('userData', process.env.ZENODE_USER_DATA)
}
const testTrash = app.isPackaged ? undefined : process.env.ZENODE_TEST_TRASH

// One Zenode process: launching it again brings the open window forward.
// (The lock is per settings folder, so test instances don't collide.)
const isFirstInstance = app.requestSingleInstanceLock()
if (!isFirstInstance) app.quit()
app.on('second-instance', () => mainWindow()?.focus())

process.on('uncaughtException', (e) => void log('error', `main: ${describeError(e)}`))
process.on('unhandledRejection', (e) => void log('error', `main (promise): ${describeError(e)}`))

// vault://<vault id>/<path> serves files from that open vault (images in canvases and notes).
protocol.registerSchemesAsPrivileged([
  { scheme: 'vault', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
])

function registerVaultProtocol(): void {
  protocol.handle('vault', async (request) => {
    const url = new URL(request.url)
    const vault = vaultById(url.hostname)
    if (!vault) return new Response('No such vault is open', { status: 404 })
    try {
      const rel = decodeURIComponent(url.pathname.replace(/^\/+/, ''))
      // Vault.abs() rejects anything that resolves outside the vault.
      return await net.fetch(pathToFileURL(vault.abs(rel)).toString())
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
    if (!w) throw new Error('Unexpected IPC sender')
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
  handle('vault:open', (w, root: string) => openVaultIn(w, root))
  // Another vault in a new window (a folder picker when no root is given).
  handle('vault:openInNewWindow', async (w, root?: string) => {
    const folder = root ?? (await chooseFolder(w))
    if (!folder) return
    const open = windowWithVault(folder)
    if (open) open.focus()
    else await VaultWindow.create(folder)
  })
  handle('vault:current', (w) => w.info())
  handle('settings:get', () => loadSettings())
  handle('config:read', (w, name: string) => readConfig(w.requireVault().root, name))
  handle('config:write', (w, name: string, data: unknown) => writeConfig(w.requireVault().root, name, data))

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
  handle('fs:trash', async (w, path: string) => {
    const file = w.requireVault().abs(path)
    // End-to-end tests use their own trash folder instead of the user's Recycle Bin.
    if (testTrash) {
      await fs.mkdir(testTrash, { recursive: true })
      await fs.rename(file, join(testTrash, `${Date.now()}-${basename(file)}`))
      return
    }
    await shell.trashItem(file)
  })
  handle('fs:reveal', (w, path: string) => shell.showItemInFolder(w.requireVault().abs(path)))
  handle('fs:openExternal', async (w, path: string) => {
    const error = await shell.openPath(w.requireVault().abs(path))
    if (error) throw new Error(error)
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
    if (!EXTERNAL_URL.test(url)) throw new Error(`Refusing to open: ${url}`)
    await shell.openExternal(url)
  })

  ipcMain.on('app:ready-to-close', (event) => windowFor(event.sender)?.closeNow())
}

app.whenReady().then(async () => {
  if (!isFirstInstance) return
  registerVaultProtocol()
  registerIpc()
  await VaultWindow.create()
})

app.on('window-all-closed', () => app.quit())
