import type { TreeEntry, VaultInfo } from '../../shared/api'
import { Component, el } from './component'
import { displayName, FileTree, parentDir } from './fileTree'
import { icon, type IconName } from './icons'
import { noteTitle, Workspace } from './workspace'

const api = window.zenode
const EXTERNAL = /^(https?:|mailto:)/i
const SIDEBAR_KEY = 'zenode.sidebarWidth'

export class App extends Component {
  private vault: VaultInfo | null = null
  private shell: Component | null = null
  private tree: FileTree | null = null
  private workspace: Workspace | null = null
  private statusEl: HTMLElement | null = null
  private titleEl: HTMLElement | null = null
  private treeTimer: number | null = null
  private layoutTimer: number | null = null

  constructor(private readonly root: HTMLElement) {
    super()
  }

  async start(): Promise<void> {
    this.load()
    api.onBeforeClose(async () => {
      await this.workspace?.saveAll()
      await this.saveLayoutNow()
    })
    api.onVaultChanged((paths) => this.onVaultChanged(paths))
    this.registerDomEvent(window, 'keydown', (e) => this.onKeydown(e), { capture: true })

    const settings = await api.getSettings()
    if (settings.lastVault) {
      try {
        await this.enterVault(await api.openVault(settings.lastVault))
        return
      } catch {
        // The last vault was moved or deleted; fall through to the welcome screen.
      }
    }
    await this.showWelcome()
  }

  // ---------- Welcome ----------

  private async showWelcome(): Promise<void> {
    this.teardownShell()
    this.root.empty()
    this.root.className = 'zn-app is-welcome'
    el('div', 'zn-titlebar zn-drag', this.root)
    const panel = el('div', 'zn-welcome', this.root)
    const brand = el('div', 'zn-welcome-brand', panel)
    brand.appendChild(icon('logo', 44))
    el('div', 'zn-welcome-name', brand, 'Zenode')
    el('div', 'zn-welcome-tag', panel, 'Your notes, connected. Plain Markdown files on your own disk.')

    const open = el('button', 'zn-btn zn-btn-primary', panel)
    open.appendChild(icon('folderOpen', 16))
    el('span', '', open, 'Open folder as vault')
    open.addEventListener('click', () => void this.chooseVault())

    const settings = await api.getSettings()
    if (settings.recentVaults.length) {
      el('div', 'zn-welcome-section', panel, 'Recent vaults')
      const list = el('div', 'zn-recent', panel)
      for (const root of settings.recentVaults) {
        const row = el('button', 'zn-recent-row', list)
        el('span', 'zn-recent-name', row, root.split(/[\\/]/).pop() ?? root)
        el('span', 'zn-recent-path', row, root)
        row.addEventListener('click', async () => {
          try {
            await this.enterVault(await api.openVault(root))
          } catch (e) {
            this.notice(`Could not open vault: ${(e as Error).message}`)
          }
        })
      }
    }
  }

  private async chooseVault(): Promise<void> {
    const info = await api.chooseVault()
    if (info) await this.enterVault(info)
  }

  // ---------- Vault shell ----------

  private async enterVault(info: VaultInfo): Promise<void> {
    if (this.workspace) await this.workspace.closeAll()
    this.teardownShell()
    this.vault = info
    this.buildShell()
    await this.refreshTree()

    const settings = await api.getSettings()
    const ws = settings.workspaces[info.root]
    if (ws) {
      for (const path of ws.openFiles) await this.workspace!.open(path)
      if (ws.activeFile) await this.workspace!.open(ws.activeFile)
    }
  }

  private teardownShell(): void {
    if (this.shell) this.removeChild(this.shell)
    this.shell = null
    this.tree = null
    this.workspace = null
  }

  private buildShell(): void {
    this.root.empty()
    this.root.className = 'zn-app'
    const shell = this.addChild(new Component())
    this.shell = shell

    const titlebar = el('div', 'zn-titlebar zn-drag', this.root)
    const brand = el('div', 'zn-titlebar-brand', titlebar)
    brand.appendChild(icon('logo', 15))
    el('span', '', brand, 'Zenode')
    this.titleEl = el('div', 'zn-titlebar-title', titlebar)

    const body = el('div', 'zn-body', this.root)
    const ribbon = el('div', 'zn-ribbon', body)
    this.ribbonButton(ribbon, 'sidebar', 'Toggle sidebar', () => this.root.classList.toggle('is-sidebar-hidden'))
    this.ribbonButton(ribbon, 'filePlus', 'New note (Ctrl+N)', () => void this.newNote(this.currentDir()))
    this.ribbonButton(ribbon, 'folderPlus', 'New folder', () => void this.newFolder(this.currentDir()))
    el('div', 'zn-ribbon-spacer', ribbon)
    this.ribbonButton(ribbon, 'folderOpen', 'Open another vault (Ctrl+O)', () => void this.switchVault())

    const sidebar = el('div', 'zn-sidebar', body)
    const header = el('div', 'zn-sidebar-header', sidebar)
    el('div', 'zn-sidebar-title', header, this.vault!.name)
    const treeHost = el('div', 'zn-sidebar-tree', sidebar)
    this.tree = shell.addChild(
      new FileTree(treeHost, {
        onOpen: (entry) => void this.openEntry(entry),
        onNewNote: (dir) => void this.newNote(dir),
        onNewFolder: (dir) => void this.newFolder(dir),
        onRename: (entry, name) => this.rename(entry, name),
        onDelete: (entry) => void this.remove(entry),
        onReveal: (path) => void api.reveal(path)
      })
    )

    const resizer = el('div', 'zn-resizer', body)
    this.setupResizer(resizer, sidebar)

    const main = el('div', 'zn-main', body)
    this.workspace = shell.addChild(
      new Workspace(main, {
        onActiveChange: (path) => {
          this.tree?.setActive(path)
          this.titleEl!.textContent = path ? noteTitle(path) : ''
        },
        onOpenLink: (href, from) => void this.openLink(href, from),
        onStats: (words, chars) => {
          this.statusEl!.textContent = words || chars ? `${words.toLocaleString()} words · ${chars.toLocaleString()} characters` : ''
        },
        onLayoutChange: () => this.saveLayoutSoon(),
        onError: (msg) => this.notice(msg)
      })
    )

    const status = el('div', 'zn-statusbar', this.root)
    el('div', 'zn-status-vault', status, this.vault!.root)
    this.statusEl = el('div', 'zn-status-stats', status)
  }

  private ribbonButton(parent: HTMLElement, name: IconName, label: string, action: () => void): void {
    const btn = el('button', 'zn-ribbon-btn', parent)
    btn.title = label
    btn.setAttribute('aria-label', label)
    btn.appendChild(icon(name, 18))
    btn.addEventListener('click', action)
  }

  private setupResizer(handle: HTMLElement, sidebar: HTMLElement): void {
    const saved = Number(safeGet(SIDEBAR_KEY))
    if (saved >= 160 && saved <= 600) sidebar.style.width = `${saved}px`
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      handle.setPointerCapture(e.pointerId)
      const startX = e.clientX
      const startW = sidebar.getBoundingClientRect().width
      const move = (ev: PointerEvent): void => {
        sidebar.style.width = `${Math.max(160, Math.min(600, startW + ev.clientX - startX))}px`
      }
      const up = (): void => {
        handle.removeEventListener('pointermove', move)
        handle.removeEventListener('pointerup', up)
        safeSet(SIDEBAR_KEY, String(Math.round(sidebar.getBoundingClientRect().width)))
      }
      handle.addEventListener('pointermove', move)
      handle.addEventListener('pointerup', up)
    })
  }

  // ---------- File operations ----------

  private currentDir(): string {
    const active = this.workspace?.activePath
    return active ? parentDir(active) : ''
  }

  private async refreshTree(): Promise<void> {
    if (!this.tree) return
    try {
      this.tree.setTree(await api.list())
    } catch (e) {
      this.notice(`Could not read the vault: ${(e as Error).message}`)
    }
  }

  private refreshTreeSoon(): void {
    if (this.treeTimer !== null) window.clearTimeout(this.treeTimer)
    this.treeTimer = window.setTimeout(() => void this.refreshTree(), 120)
  }

  private onVaultChanged(paths: string[]): void {
    this.refreshTreeSoon()
    void this.workspace?.reloadChanged(paths)
  }

  private async openEntry(entry: TreeEntry): Promise<void> {
    if (entry.ext === 'md') {
      await this.workspace?.open(entry.path)
    } else {
      try {
        await api.openExternal(entry.path)
      } catch (e) {
        this.notice((e as Error).message)
      }
    }
  }

  private async newNote(dir: string): Promise<void> {
    if (!this.vault) return
    try {
      const path = await api.createFile(dir, 'Untitled', 'md')
      await this.refreshTree()
      await this.workspace?.open(path)
      this.tree?.startRename(path)
    } catch (e) {
      this.notice(`Could not create note: ${(e as Error).message}`)
    }
  }

  private async newFolder(dir: string): Promise<void> {
    try {
      const path = await api.createFolder(dir, 'Untitled folder')
      await this.refreshTree()
      this.tree?.startRename(path)
    } catch (e) {
      this.notice(`Could not create folder: ${(e as Error).message}`)
    }
  }

  private async rename(entry: TreeEntry, newName: string): Promise<void> {
    try {
      await this.workspace?.saveAll()
      const wasActive = this.workspace?.activePath === entry.path
      const to = await api.rename(entry.path, newName)
      this.workspace?.renamed(entry.path, to)
      if (entry.kind === 'folder') this.tree?.renamePath(entry.path, to)
      await this.refreshTree()
      // Naming the open note moves you straight into writing it.
      if (wasActive) this.workspace?.focus()
    } catch (e) {
      this.notice((e as Error).message)
      await this.refreshTree()
    }
  }

  private async remove(entry: TreeEntry): Promise<void> {
    const what = entry.kind === 'folder' ? `the folder "${entry.name}" and everything in it` : `"${displayName(entry)}"`
    if (!window.confirm(`Move ${what} to the Recycle Bin?`)) return
    try {
      this.workspace?.removed(entry.path)
      await api.trash(entry.path)
      await this.refreshTree()
    } catch (e) {
      this.notice(`Could not delete: ${(e as Error).message}`)
    }
  }

  private async openLink(href: string, fromPath: string): Promise<void> {
    if (EXTERNAL.test(href)) {
      await api.openUrl(href)
      return
    }
    // Relative link to another note in the vault.
    let target = decodeURI(href.split('#')[0])
    if (!target) return
    if (!/\.[a-z0-9]+$/i.test(target)) target += '.md'
    const base = parentDir(fromPath)
    const parts = (target.startsWith('/') ? target.slice(1) : base ? `${base}/${target}` : target).split('/')
    const resolved: string[] = []
    for (const part of parts) {
      if (part === '..') resolved.pop()
      else if (part && part !== '.') resolved.push(part)
    }
    await this.workspace?.open(resolved.join('/'))
  }

  private async switchVault(): Promise<void> {
    const info = await api.chooseVault()
    if (info) await this.enterVault(info)
  }

  // ---------- Layout persistence ----------

  private saveLayoutSoon(): void {
    if (this.layoutTimer !== null) window.clearTimeout(this.layoutTimer)
    this.layoutTimer = window.setTimeout(() => void this.saveLayoutNow(), 500)
  }

  private async saveLayoutNow(): Promise<void> {
    if (this.layoutTimer !== null) window.clearTimeout(this.layoutTimer)
    this.layoutTimer = null
    if (this.workspace && this.vault) await api.saveWorkspace(this.workspace.serialize())
  }

  // ---------- Keyboard ----------

  private onKeydown(e: KeyboardEvent): void {
    if (!e.ctrlKey || e.altKey) return
    const key = e.key.toLowerCase()
    const handled = (fn: () => void): void => {
      e.preventDefault()
      e.stopPropagation()
      fn()
    }
    if (key === 'o') return handled(() => void (this.vault ? this.switchVault() : this.chooseVault()))
    if (!this.workspace) return
    if (key === 'n' && !e.shiftKey) return handled(() => void this.newNote(this.currentDir()))
    if (key === 's') return handled(() => void this.workspace!.save())
    if (key === 'w') return handled(() => void this.workspace!.close())
    if (key === 'tab') return handled(() => this.workspace!.cycle(e.shiftKey ? -1 : 1))
    if (key === '\\') return handled(() => this.root.classList.toggle('is-sidebar-hidden'))
  }

  // ---------- Notices ----------

  notice(message: string): void {
    let host = document.querySelector<HTMLElement>('.zn-notices')
    if (!host) host = el('div', 'zn-notices', document.body)
    const item = el('div', 'zn-notice', host, message)
    window.setTimeout(() => item.classList.add('is-leaving'), 4000)
    window.setTimeout(() => item.remove(), 4400)
  }
}

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Storage unavailable; the width just won't be remembered.
  }
}
