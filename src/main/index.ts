import { app, BrowserWindow, dialog, ipcMain, net, protocol, shell, type IpcMainInvokeEvent } from 'electron'
import { promises as fs } from 'node:fs'
import { basename, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { VaultInfo } from '../shared/api'
import { readConfig, writeConfig } from './config'
import { errorCode, friendlyError } from './fsutil'
import { describeError, isLogLevel, log } from './log'
import { loadSettings, rememberVault, saveSettings } from './settings'
import { RecoveryJournal } from './recovery'
import { SnapshotStore } from './snapshots'
import { Vault } from './vault'

const BG = '#0b0b0f'
const EXTERNAL_URL = /^(https?:|mailto:)/i

let win: BrowserWindow | null = null
let vault: Vault | null = null
let snapshots: SnapshotStore | null = null
let journal: RecoveryJournal | null = null
let readyToClose = false

if (!app.isPackaged) {
  // In development, never reuse cached renderer modules across reloads (stale code after edits).
  app.commandLine.appendSwitch('disable-http-cache')
  // End-to-end tests run with their own settings folder, so they never touch the user's.
  if (process.env.ZENODE_USER_DATA) app.setPath('userData', process.env.ZENODE_USER_DATA)
}
const testTrash = app.isPackaged ? undefined : process.env.ZENODE_TEST_TRASH

process.on('uncaughtException', (e) => void log('error', `main: ${describeError(e)}`))
process.on('unhandledRejection', (e) => void log('error', `main (promise): ${describeError(e)}`))

// vault://file/<path> serves files from the open vault (images in canvases and notes).
protocol.registerSchemesAsPrivileged([
  { scheme: 'vault', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
])

function registerVaultProtocol(): void {
  protocol.handle('vault', async (request) => {
    if (!vault) return new Response('No vault is open', { status: 404 })
    try {
      const rel = decodeURIComponent(new URL(request.url).pathname.replace(/^\/+/, ''))
      // Vault.abs() rejects anything that resolves outside the vault.
      return await net.fetch(pathToFileURL(vault.abs(rel)).toString())
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 720,
    minHeight: 480,
    show: false,
    backgroundColor: BG,
    title: 'Zenode',
    titleBarStyle: 'hidden',
    // One pixel shorter than the title bar so its bottom border stays visible.
    titleBarOverlay: { color: BG, symbolColor: '#a1a1aa', height: 37 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true
    }
  })

  win.once('ready-to-show', () => win?.show())

  // The renderer never navigates or opens windows itself; web links go to the browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (EXTERNAL_URL.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  win.webContents.on('render-process-gone', (_e, details) => void log('error', `renderer gone: ${details.reason} (exit ${details.exitCode})`))

  // Give the renderer a chance to flush unsaved notes before the window goes away.
  win.on('close', (e) => {
    if (readyToClose || !win) return
    e.preventDefault()
    win.webContents.send('app:before-close')
    setTimeout(() => {
      readyToClose = true
      win?.close()
    }, 3000)
  })
  win.on('closed', () => {
    win = null
    vault?.unwatch()
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function requireVault(): Vault {
  if (!vault) throw new Error('No vault is open')
  return vault
}

async function openVault(root: string): Promise<VaultInfo> {
  const stat = await fs.stat(root)
  if (!stat.isDirectory()) throw new Error(`Not a folder: ${root}`)
  vault?.unwatch()
  const store = new SnapshotStore(app.getPath('userData'), root)
  snapshots = store
  journal = new RecoveryJournal(app.getPath('userData'), root)
  vault = new Vault(root, async (rel, old) => {
    // History must never block a save.
    await store.save(rel, old, 'auto').catch((e) => log('warn', `snapshot ${rel}: ${describeError(e)}`))
  })
  void store.prune().catch((e) => log('warn', `snapshot prune: ${describeError(e)}`))
  vault.watch((paths) => win?.webContents.send('vault:changed', paths))
  await saveSettings(rememberVault(await loadSettings(), root))
  win?.setTitle(`${vault.name} - Zenode`)
  return { root: vault.root, name: vault.name }
}

// Only accept IPC from our own window. File-system errors reach the page as
// plain-language messages; unexpected ones are also logged.
function handle<A extends unknown[], R>(channel: string, fn: (...args: A) => R | Promise<R>): void {
  ipcMain.handle(channel, async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
    if (!win || event.sender !== win.webContents) throw new Error('Unexpected IPC sender')
    try {
      return await fn(...(args as A))
    } catch (e) {
      if (!errorCode(e)) void log('warn', `${channel}: ${describeError(e)}`)
      throw friendlyError(e)
    }
  })
}

function registerIpc(): void {
  handle('vault:choose', async () => {
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      title: 'Open folder as vault',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return openVault(result.filePaths[0])
  })
  handle('vault:open', (root: string) => openVault(root))
  handle('vault:current', () => (vault ? { root: vault.root, name: vault.name } : null))
  handle('settings:get', () => loadSettings())
  handle('config:read', (name: string) => readConfig(requireVault().root, name))
  handle('config:write', (name: string, data: unknown) => writeConfig(requireVault().root, name, data))

  handle('fs:list', () => requireVault().list())
  handle('fs:read', (path: string) => requireVault().read(path))
  handle('fs:readMany', (paths: string[]) => requireVault().readMany(paths))
  handle('fs:write', (path: string, content: string) => requireVault().write(path, content))
  handle('fs:writeChecked', (path: string, content: string, expectHash: string) => requireVault().writeChecked(path, content, expectHash))
  handle('fs:createFile', (dir: string, base: string, ext: string) => requireVault().createFile(dir, base, ext))
  handle('fs:saveAttachment', (dir: string, fileName: string, bytes: Uint8Array) => {
    if (!(bytes instanceof Uint8Array)) throw new Error('Invalid file data')
    return requireVault().saveAttachment(dir, fileName, bytes)
  })
  handle('fs:createFolder', (dir: string, name: string) => requireVault().createFolder(dir, name))
  handle('fs:rename', (path: string, newName: string) => requireVault().rename(path, newName))
  handle('fs:trash', async (path: string) => {
    const file = requireVault().abs(path)
    // End-to-end tests use their own trash folder instead of the user's Recycle Bin.
    if (testTrash) {
      await fs.mkdir(testTrash, { recursive: true })
      await fs.rename(file, join(testTrash, `${Date.now()}-${basename(file)}`))
      return
    }
    await shell.trashItem(file)
  })
  handle('fs:reveal', (path: string) => shell.showItemInFolder(requireVault().abs(path)))
  handle('fs:openExternal', async (path: string) => {
    const error = await shell.openPath(requireVault().abs(path))
    if (error) throw new Error(error)
  })
  // Paths go through Vault.abs() first so the page can only name files inside the vault.
  const snapshotsFor = (path: string): SnapshotStore => {
    requireVault().abs(path)
    if (!snapshots) throw new Error('No vault is open')
    return snapshots
  }
  handle('snapshots:list', (path: string) => snapshotsFor(path).list(path))
  handle('snapshots:read', (path: string, id: string) => snapshotsFor(path).read(path, id))
  handle('snapshots:keep', async (path: string, content: string) => {
    await snapshotsFor(path).save(path, content, 'kept')
  })
  const journalFor = (path?: string): RecoveryJournal => {
    if (path !== undefined) requireVault().abs(path)
    if (!journal) throw new Error('No vault is open')
    return journal
  }
  handle('journal:put', (path: string, content: string, baseHash: string) => journalFor(path).put(path, content, baseHash))
  handle('journal:remove', (path: string) => journalFor(path).remove(path))
  handle('journal:list', () => journalFor().list())
  handle('app:log', (level: unknown, message: unknown) => {
    if (!isLogLevel(level) || typeof message !== 'string') throw new Error('Invalid log entry')
    return log(level, `renderer: ${message}`)
  })
  handle('app:openUrl', async (url: string) => {
    if (!EXTERNAL_URL.test(url)) throw new Error(`Refusing to open: ${url}`)
    await shell.openExternal(url)
  })

  ipcMain.on('app:ready-to-close', (event) => {
    if (!win || event.sender !== win.webContents) return
    readyToClose = true
    win.close()
  })
}

app.whenReady().then(() => {
  registerVaultProtocol()
  registerIpc()
  createWindow()
})

app.on('window-all-closed', () => app.quit())
