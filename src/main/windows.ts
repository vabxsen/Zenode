// One window per open vault. Each window has its own vault, file history and
// crash journal; IPC calls are routed to the window that sent them.
import { app, BrowserWindow, shell, type WebContents } from 'electron'
import { EventEmitter } from 'node:events'
import { promises as fs } from 'node:fs'
import { join, resolve } from 'node:path'
import type { VaultInfo } from '../shared/api'
import { contentHash } from '../shared/hash'
import { safeExternalUrl } from '../shared/linkSafety'
import { describeError, log } from './log'
import { RecoveryJournal } from './recovery'
import { loadSettings, rememberVault, saveSettings } from './settings'
import { SnapshotStore } from './snapshots'
import { Vault } from './vault'

const BG = '#0b0b0f'
// How long a closing window waits for the page to save before closing anyway.
const CLOSE_TIMEOUT = 3000
const CASCADE = 28

// The vault:// host for a vault: stable, lower-case, and safe in a URL.
export function vaultId(root: string): string {
  return `v${contentHash(resolve(root).toLowerCase())}`
}

const windows = new Map<number, VaultWindow>()

// Sync listens here: a vault was opened in a window, or files in it changed.
export const vaultEvents = new EventEmitter<{ opened: [root: string]; changed: [root: string] }>()

export class VaultWindow {
  readonly win: BrowserWindow
  vault: Vault | null = null
  snapshots: SnapshotStore | null = null
  journal: RecoveryJournal | null = null
  private readyToClose = false
  private pendingOpen: string | null = null

  private constructor() {
    const prev = BrowserWindow.getFocusedWindow()
    const [x, y] = prev ? prev.getPosition().map((n) => n + CASCADE) : [undefined, undefined]
    this.win = new BrowserWindow({
      width: 1280,
      height: 820,
      x,
      y,
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
    const id = this.win.webContents.id
    windows.set(id, this)
    this.win.once('ready-to-show', () => this.win.show())

    // The renderer never navigates or opens windows itself; web links go to the browser.
    this.win.webContents.setWindowOpenHandler(({ url }) => {
      const safe = safeExternalUrl(url)
      if (safe) void shell.openExternal(safe)
      return { action: 'deny' }
    })
    this.win.webContents.on('will-navigate', (e) => e.preventDefault())
    this.win.webContents.on('render-process-gone', (_e, details) => void log('error', `renderer gone: ${details.reason} (exit ${details.exitCode})`))

    // Give the page a chance to flush unsaved notes before the window goes away.
    this.win.on('close', (e) => {
      if (this.readyToClose) return
      e.preventDefault()
      this.win.webContents.send('app:before-close')
      setTimeout(() => this.closeNow(), CLOSE_TIMEOUT)
    })
    this.win.on('closed', () => {
      windows.delete(id)
      this.vault?.unwatch()
    })
  }

  // A new window, with `root` already open as its vault when given.
  static async create(root?: string): Promise<VaultWindow> {
    const w = new VaultWindow()
    if (root) await w.openVault(root)
    if (process.env.ELECTRON_RENDERER_URL) void w.win.loadURL(process.env.ELECTRON_RENDERER_URL)
    else void w.win.loadFile(join(__dirname, '../renderer/index.html'))
    return w
  }

  requireVault(): Vault {
    if (!this.vault) throw new Error('No vault is open')
    return this.vault
  }

  info(): VaultInfo | null {
    return this.vault ? { root: this.vault.root, name: this.vault.name, id: vaultId(this.vault.root) } : null
  }

  async openVault(root: string): Promise<VaultInfo> {
    const stat = await fs.stat(root)
    if (!stat.isDirectory()) throw new Error(`Not a folder: ${root}`)
    this.vault?.unwatch()
    const userData = app.getPath('userData')
    const store = new SnapshotStore(userData, root)
    this.snapshots = store
    this.journal = new RecoveryJournal(userData, root)
    const vault = new Vault(root, async (rel, old) => {
      // History must never block a save.
      await store.save(rel, old, 'auto').catch((e) => log('warn', `snapshot ${rel}: ${describeError(e)}`))
    })
    this.vault = vault
    void store.prune().catch((e) => log('warn', `snapshot prune: ${describeError(e)}`))
    vault.watch((paths) => {
      this.win.webContents.send('vault:changed', paths)
      vaultEvents.emit('changed', vault.root)
    })
    await saveSettings(rememberVault(await loadSettings(), root))
    this.win.setTitle(`${vault.name} - Zenode`)
    vaultEvents.emit('opened', vault.root)
    return this.info()!
  }

  // A file (in this window's vault) to open; the page asks for it once its
  // vault is showing, and is told when one arrives later.
  requestOpen(file: string): void {
    this.pendingOpen = file
    if (!this.win.webContents.isLoading()) this.win.webContents.send('app:open-requested')
  }

  takeOpenRequest(): string | null {
    const file = this.pendingOpen
    this.pendingOpen = null
    return file
  }

  focus(): void {
    if (this.win.isMinimized()) this.win.restore()
    this.win.focus()
  }

  closeNow(): void {
    this.readyToClose = true
    if (!this.win.isDestroyed()) this.win.close()
  }
}

export function windowFor(sender: WebContents): VaultWindow | null {
  return windows.get(sender.id) ?? null
}

// The window that has `root` open (other than `except`), if any.
export function windowWithVault(root: string, except?: VaultWindow): VaultWindow | null {
  const id = vaultId(root)
  for (const w of windows.values()) {
    if (w !== except && w.vault && vaultId(w.vault.root) === id) return w
  }
  return null
}

export function vaultById(id: string): Vault | null {
  for (const w of windows.values()) if (w.vault && vaultId(w.vault.root) === id) return w.vault
  return null
}

// The window to bring forward when Zenode is launched again.
export function mainWindow(): VaultWindow | null {
  const focused = BrowserWindow.getFocusedWindow()
  if (focused) {
    const w = windowFor(focused.webContents)
    if (w) return w
  }
  return [...windows.values()].pop() ?? null
}

export function allWindows(): VaultWindow[] {
  return [...windows.values()]
}
