import type { TreeEntry, VaultInfo } from '../../shared/api'
import { BacklinksPanel } from './backlinks'
import { Component, el } from './component'
import type { LinkTarget } from './editor/linkCompletion'
import { displayName, FileTree } from './fileTree'
import { icon, type IconName } from './icons'
import { applyEdits, MetadataCache } from './index/metadataCache'
import { splitLinktext } from './index/parser'
import { baseName, isMarkdown, joinPath, parentDir, stripMd } from './paths'
import { SearchPane } from './search/searchPane'
import { openSwitcher } from './switcher'
import { noteTitle, Workspace, type OpenPosition } from './workspace'

const api = window.zenode
const EXTERNAL = /^(https?:|mailto:)/i
const SIDEBAR_KEY = 'zenode.sidebarWidth'
const RIGHTBAR_KEY = 'zenode.rightbarHidden'
const MAX_RECENT = 30

type LeftPane = 'files' | 'search'

export class App extends Component {
  private vault: VaultInfo | null = null
  private shell: Component | null = null
  private tree: FileTree | null = null
  private workspace: Workspace | null = null
  private cache: MetadataCache | null = null
  private search: SearchPane | null = null
  private backlinks: BacklinksPanel | null = null
  private statusEl: HTMLElement | null = null
  private titleEl: HTMLElement | null = null
  private paneEls: Record<LeftPane, HTMLElement> | null = null
  private tabButtons: Record<LeftPane, HTMLElement> | null = null
  private treeTimer: number | null = null
  private layoutTimer: number | null = null
  private indexBuilt = false
  private indexChain: Promise<void> = Promise.resolve()
  private recent: string[] = []

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
    this.cache = new MetadataCache()
    this.indexBuilt = false
    this.recent = []
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
    this.cache?.dispose()
    this.shell = null
    this.tree = null
    this.workspace = null
    this.cache = null
    this.search = null
    this.backlinks = null
  }

  private buildShell(): void {
    this.root.empty()
    this.root.className = 'zn-app'
    if (safeGet(RIGHTBAR_KEY) === '1') this.root.classList.add('is-rightbar-hidden')
    const shell = this.addChild(new Component())
    this.shell = shell
    const cache = this.cache!

    const titlebar = el('div', 'zn-titlebar zn-drag', this.root)
    const brand = el('div', 'zn-titlebar-brand', titlebar)
    brand.appendChild(icon('logo', 15))
    el('span', '', brand, 'Zenode')
    this.titleEl = el('div', 'zn-titlebar-title', titlebar)

    const body = el('div', 'zn-body', this.root)
    const ribbon = el('div', 'zn-ribbon', body)
    this.ribbonButton(ribbon, 'sidebar', 'Toggle left sidebar (Ctrl+\\)', () => this.root.classList.toggle('is-sidebar-hidden'))
    this.ribbonButton(ribbon, 'switcher', 'Quick switcher (Ctrl+O)', () => this.openQuickSwitcher())
    this.ribbonButton(ribbon, 'search', 'Search (Ctrl+Shift+F)', () => this.showSearch())
    this.ribbonButton(ribbon, 'filePlus', 'New note (Ctrl+N)', () => void this.newNote(this.currentDir()))
    this.ribbonButton(ribbon, 'folderPlus', 'New folder', () => void this.newFolder(this.currentDir()))
    el('div', 'zn-ribbon-spacer', ribbon)
    this.ribbonButton(ribbon, 'link', 'Toggle backlinks (Ctrl+Shift+B)', () => this.toggleRightbar())
    this.ribbonButton(ribbon, 'folderOpen', 'Open another vault (Ctrl+Shift+O)', () => void this.chooseVault())

    // Left sidebar: Files and Search panes.
    const sidebar = el('div', 'zn-sidebar', body)
    const tabs = el('div', 'zn-sidebar-tabs', sidebar)
    const filesTab = el('button', 'zn-sidebar-tab', tabs)
    filesTab.title = 'Files'
    filesTab.appendChild(icon('files', 16))
    const searchTab = el('button', 'zn-sidebar-tab', tabs)
    searchTab.title = 'Search'
    searchTab.appendChild(icon('search', 16))
    filesTab.addEventListener('click', () => this.showPane('files'))
    searchTab.addEventListener('click', () => this.showSearch())

    const filesPane = el('div', 'zn-pane', sidebar)
    const header = el('div', 'zn-sidebar-header', filesPane)
    el('div', 'zn-sidebar-title', header, this.vault!.name)
    const treeHost = el('div', 'zn-sidebar-tree', filesPane)
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
    const searchPane = el('div', 'zn-pane zn-pane-search', sidebar)
    this.search = shell.addChild(new SearchPane(searchPane, cache, (path, pos) => void this.openPath(path, pos)))
    this.paneEls = { files: filesPane, search: searchPane }
    this.tabButtons = { files: filesTab, search: searchTab }
    this.showPane('files')

    const resizer = el('div', 'zn-resizer', body)
    this.setupResizer(resizer, sidebar)

    const main = el('div', 'zn-main', body)
    this.workspace = shell.addChild(
      new Workspace(main, {
        onActiveChange: (path) => {
          this.tree?.setActive(path)
          this.backlinks?.setTarget(path)
          this.titleEl!.textContent = path ? noteTitle(path) : ''
          if (path) this.recent = [path, ...this.recent.filter((p) => p !== path)].slice(0, MAX_RECENT)
        },
        onOpenLink: (href, from) => void this.openLink(href, from),
        onOpenWikiLink: (target, from) => void this.openWikiLink(target, from),
        onOpenTag: (tag) => this.showSearch(`tag:${tag}`),
        isResolved: (link, from) => !this.indexBuilt || cache.resolve(link, from) !== null,
        linkTargets: (from) => this.linkTargets(from),
        onSaved: (path, content) => this.queueIndex(() => cache.setContent(path, content)),
        onStats: (words, chars) => {
          this.statusEl!.textContent = words || chars ? `${words.toLocaleString()} words · ${chars.toLocaleString()} characters` : ''
        },
        onLayoutChange: () => this.saveLayoutSoon(),
        onError: (msg) => this.notice(msg)
      })
    )

    // Right sidebar: backlinks.
    const rightbar = el('div', 'zn-rightbar', body)
    this.backlinks = shell.addChild(new BacklinksPanel(rightbar, cache, (path, pos) => void this.openPath(path, pos)))

    // Live link styling follows the index.
    shell.register(cache.onChange(() => this.workspace?.refreshLinks()))

    const status = el('div', 'zn-statusbar', this.root)
    el('div', 'zn-status-vault', status, this.vault!.root)
    this.statusEl = el('div', 'zn-status-stats', status)
  }

  private showPane(pane: LeftPane): void {
    if (!this.paneEls || !this.tabButtons) return
    this.root.classList.remove('is-sidebar-hidden')
    for (const key of ['files', 'search'] as LeftPane[]) {
      this.paneEls[key].style.display = key === pane ? '' : 'none'
      this.tabButtons[key].classList.toggle('is-active', key === pane)
    }
  }

  private showSearch(initial?: string): void {
    this.showPane('search')
    this.search?.focus(initial)
  }

  private toggleRightbar(): void {
    const hidden = this.root.classList.toggle('is-rightbar-hidden')
    safeSet(RIGHTBAR_KEY, hidden ? '1' : '0')
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

  // ---------- Index ----------

  // Index updates run one at a time so a rebuild and an incremental update never interleave.
  private queueIndex(task: () => Promise<void>): Promise<void> {
    this.indexChain = this.indexChain.then(task).catch((e) => console.error('Index update failed', e))
    return this.indexChain
  }

  private linkTargets(from: string): LinkTarget[] {
    const cache = this.cache
    if (!cache) return []
    return cache.allNotes().map((note) => ({
      title: stripMd(baseName(note.path)),
      folder: parentDir(note.path),
      linktext: cache.linktext(note.path, from)
    }))
  }

  // ---------- File operations ----------

  private currentDir(): string {
    const active = this.workspace?.activePath
    return active ? parentDir(active) : ''
  }

  private async refreshTree(): Promise<void> {
    if (!this.tree || !this.cache) return
    let entries: TreeEntry[]
    try {
      entries = await api.list()
    } catch (e) {
      this.notice(`Could not read the vault: ${(e as Error).message}`)
      return
    }
    this.tree.setTree(entries)
    const cache = this.cache
    if (!this.indexBuilt) {
      await this.queueIndex(async () => {
        await cache.build(entries)
        this.indexBuilt = true
      })
    } else {
      await this.queueIndex(() => cache.sync(entries))
    }
  }

  private refreshTreeSoon(): void {
    if (this.treeTimer !== null) window.clearTimeout(this.treeTimer)
    this.treeTimer = window.setTimeout(() => void this.refreshTree(), 120)
  }

  private onVaultChanged(paths: string[]): void {
    this.refreshTreeSoon()
    const cache = this.cache
    if (cache) void this.queueIndex(() => cache.refresh(paths))
    void this.workspace?.reloadChanged(paths)
  }

  private async openEntry(entry: TreeEntry): Promise<void> {
    await this.openPath(entry.path)
  }

  private async openPath(path: string, pos?: OpenPosition): Promise<void> {
    if (isMarkdown(path)) {
      await this.workspace?.open(path, pos)
      return
    }
    try {
      await api.openExternal(path)
    } catch (e) {
      this.notice((e as Error).message)
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

  // Create a note from a name typed in the switcher or an unresolved link ("Folder/Name" allowed).
  private async createNamedNote(name: string): Promise<void> {
    const clean = stripMd(name.trim().replace(/\\/g, '/'))
    if (!clean) return
    const dir = parentDir(clean)
    const base = baseName(clean)
    let path: string
    try {
      path = await api.createFile(dir, base, 'md')
    } catch {
      try {
        path = await api.createFile('', base, 'md')
      } catch (e) {
        this.notice(`Could not create note: ${(e as Error).message}`)
        return
      }
    }
    await this.refreshTree()
    await this.workspace?.open(path)
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

  // Rename a file or folder, then rewrite every link in the vault that pointed at it.
  private async rename(entry: TreeEntry, newName: string): Promise<void> {
    const cache = this.cache
    try {
      await this.workspace?.saveAll()
      await this.indexChain
      const wasActive = this.workspace?.activePath === entry.path
      const pending = cache ? cache.collectRenameRefs(entry.path, entry.kind === 'folder') : []
      const to = await api.rename(entry.path, newName)
      this.workspace?.renamed(entry.path, to)
      if (entry.kind === 'folder') this.tree?.renamePath(entry.path, to)
      await this.refreshTree()
      if (cache && to !== entry.path && pending.length) {
        const edits = cache.buildRenameEdits(pending, entry.path, to)
        let count = 0
        for (const [path, list] of edits) {
          const note = cache.getNote(path)
          if (!note) continue
          const updated = applyEdits(note.content, list)
          await api.write(path, updated)
          await this.queueIndex(() => cache.setContent(path, updated))
          count += list.length
        }
        if (count) this.notice(`Updated ${count} link${count === 1 ? '' : 's'} in ${edits.size} note${edits.size === 1 ? '' : 's'}.`)
      }
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

  // ---------- Links ----------

  private async openWikiLink(target: string, fromPath: string): Promise<void> {
    const cache = this.cache
    if (!cache) return
    const { link, subpath } = splitLinktext(target)
    const resolved = link ? cache.resolve(link, fromPath) : fromPath
    if (!resolved) {
      await this.createNamedNote(link)
      return
    }
    await this.openPath(resolved, subpath ? this.subpathPosition(resolved, subpath) : undefined)
  }

  // Find "#Heading" or "#^block-id" inside a note.
  private subpathPosition(path: string, subpath: string): OpenPosition | undefined {
    const note = this.cache?.getNote(path)
    if (!note) return undefined
    const content = note.content
    if (subpath.startsWith('#^')) {
      const at = content.indexOf(`^${subpath.slice(2)}`)
      return at === -1 ? undefined : { from: content.lastIndexOf('\n', at) + 1 }
    }
    const wanted = subpath.slice(1).trim().toLowerCase()
    const heading = note.meta.headings.find((h) => h.text.trim().toLowerCase() === wanted)
    if (!heading) return undefined
    let offset = 0
    for (let i = 0; i < heading.line; i++) offset = content.indexOf('\n', offset) + 1
    return { from: offset }
  }

  private async openLink(href: string, fromPath: string): Promise<void> {
    if (EXTERNAL.test(href)) {
      await api.openUrl(href)
      return
    }
    // Relative Markdown link to another file in the vault.
    let decoded = href
    try {
      decoded = decodeURI(href)
    } catch {
      // Use the raw href.
    }
    const [target, ...rest] = decoded.split('#')
    if (!target) return
    let path = (target.startsWith('/') ? joinPath('', target.slice(1)) : joinPath(parentDir(fromPath), target)) ?? ''
    if (!path) return
    if (!/\.[a-z0-9]+$/i.test(path)) path += '.md'
    const subpath = rest.length ? `#${rest.join('#')}` : ''
    await this.openPath(path, subpath ? this.subpathPosition(path, subpath) : undefined)
  }

  // ---------- Quick switcher ----------

  private openQuickSwitcher(): void {
    const cache = this.cache
    if (!cache) return
    openSwitcher({
      items: cache.allNotes().map((n) => ({ path: n.path, aliases: n.meta.aliases })),
      recent: this.recent,
      onOpen: (path) => void this.openPath(path),
      onCreate: (name) => void this.createNamedNote(name)
    })
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
    if (key === 'o' && e.shiftKey) return handled(() => void this.chooseVault())
    if (!this.workspace) {
      if (key === 'o') return handled(() => void this.chooseVault())
      return
    }
    if (key === 'o') return handled(() => this.openQuickSwitcher())
    if (key === 'f' && e.shiftKey) return handled(() => this.showSearch())
    if (key === 'b' && e.shiftKey) return handled(() => this.toggleRightbar())
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
    // Storage unavailable; the setting just won't be remembered.
  }
}
