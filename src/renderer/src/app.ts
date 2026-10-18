import type { TreeEntry, VaultInfo } from '../../shared/api'
import { BacklinksPanel } from './backlinks'
import { CanvasView, type CanvasHost } from './canvas/canvasView'
import { CommandRegistry } from './commands'
import { sanitizeHotkeys, sanitizeWorkspace } from './config'
import { Component, el } from './component'
import { registerCoreCommands } from './coreCommands'
import type { LinkTarget } from './editor/linkCompletion'
import { displayName, FileTree } from './fileTree'
import { GraphView } from './graph/graphView'
import { icon, type IconName } from './icons'
import { isCanvasPath } from './index/canvasMeta'
import { MetadataCache } from './index/metadataCache'
import { splitLinktext } from './index/parser'
import { openFileRecovery, restoreVersion } from './fileRecovery'
import { rewriteLinksAfterRename } from './fileOps'
import { offerRecovery } from './recovery'
import { SyncIndicator } from './sync/syncPanel'
import { baseName, isMarkdown, joinPath, parentDir, stripExt, stripMd } from './paths'
import { SearchPane } from './search/searchPane'
import { openSwitcher } from './switcher'
import { VIEW_PREFIX, Workspace, type OpenPosition, type WorkspaceView } from './workspace'

const api = window.zenode
const EXTERNAL = /^(https?:|mailto:)/i
const SIDEBAR_KEY = 'zenode.sidebarWidth'
const RIGHTBAR_KEY = 'zenode.rightbarHidden'
const RIGHT_PANE_KEY = 'zenode.rightPane'
const GRAPH_ID = `${VIEW_PREFIX}graph`
const MAX_RECENT = 30

type LeftPane = 'files' | 'search'
type RightPane = 'backlinks' | 'localGraph'

export class App extends Component {
  readonly commands = new CommandRegistry()
  private vault: VaultInfo | null = null
  private shell: Component | null = null
  private tree: FileTree | null = null
  private workspace: Workspace | null = null
  private cache: MetadataCache | null = null
  private search: SearchPane | null = null
  private backlinks: BacklinksPanel | null = null
  private localGraph: GraphView | null = null
  private globalGraph: GraphView | null = null
  private rightPaneEls: Record<RightPane, HTMLElement> | null = null
  private rightTabButtons: Record<RightPane, HTMLElement> | null = null
  private rightPane: RightPane = 'backlinks'
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
    this.register(this.registerCommands())
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

    this.commands.setCustomHotkeys(sanitizeHotkeys(await api.readConfig('hotkeys')))
    // Open tabs live in .zenode/workspace.json; older versions kept them in the app settings.
    const ws = sanitizeWorkspace(await api.readConfig('workspace')) ?? (await api.getSettings()).workspaces[info.root]
    if (ws) {
      for (const path of ws.openFiles) await this.openTabPath(path)
      if (ws.activeFile) await this.openTabPath(ws.activeFile)
    }
    if (this.workspace) await offerRecovery(this.workspace, (m) => this.notice(m))
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
    this.localGraph = null
    this.globalGraph = null
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
    this.ribbonButton(ribbon, 'sidebar', 'Toggle left sidebar (Ctrl+\\)', () => this.commands.execute('app:toggle-left-sidebar'))
    this.ribbonButton(ribbon, 'switcher', 'Quick switcher (Ctrl+O)', () => this.openQuickSwitcher())
    this.ribbonButton(ribbon, 'search', 'Search (Ctrl+Shift+F)', () => this.showSearch())
    this.ribbonButton(ribbon, 'graph', 'Graph view (Ctrl+G)', () => this.openGraph())
    this.ribbonButton(ribbon, 'filePlus', 'New note (Ctrl+N)', () => void this.newNote(this.currentDir()))
    this.ribbonButton(ribbon, 'folderPlus', 'New folder', () => void this.newFolder(this.currentDir()))
    this.ribbonButton(ribbon, 'canvas', 'New canvas', () => void this.newCanvas(this.currentDir()))
    el('div', 'zn-ribbon-spacer', ribbon)
    this.ribbonButton(ribbon, 'link', 'Toggle right sidebar (Ctrl+Shift+B)', () => this.toggleRightbar())
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
        onNewCanvas: (dir) => void this.newCanvas(dir),
        onRename: (entry, name) => this.rename(entry, name),
        onDelete: (entry) => void this.remove(entry),
        onReveal: (path) => void api.reveal(path),
        onHistory: (path) => void this.showHistory(path)
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
        onActiveChange: (path, title) => {
          this.tree?.setActive(path)
          this.titleEl!.textContent = title
          if (path) this.recent = [path, ...this.recent.filter((p) => p !== path)].slice(0, MAX_RECENT)
          // Side panels keep showing the last note while a view tab (like the graph) is in front.
          const context = path ?? this.recent[0] ?? null
          this.backlinks?.setTarget(context)
          this.localGraph?.setActive(context)
          this.globalGraph?.setActive(context)
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
        onError: (msg) => this.notice(msg),
        preserve: (path, text) => this.preserve(path, text)
      })
    )

    // Right sidebar: backlinks and the local graph.
    const rightbar = el('div', 'zn-rightbar', body)
    const rtabs = el('div', 'zn-sidebar-tabs', rightbar)
    const blTab = el('button', 'zn-sidebar-tab', rtabs)
    blTab.title = 'Backlinks'
    blTab.appendChild(icon('link', 16))
    const lgTab = el('button', 'zn-sidebar-tab', rtabs)
    lgTab.title = 'Local graph'
    lgTab.appendChild(icon('graph', 16))
    blTab.addEventListener('click', () => this.showRightPane('backlinks'))
    lgTab.addEventListener('click', () => this.showRightPane('localGraph'))
    const blPane = el('div', 'zn-pane', rightbar)
    const lgPane = el('div', 'zn-pane zn-pane-graph', rightbar)
    this.backlinks = shell.addChild(new BacklinksPanel(blPane, cache, (path, pos) => void this.openPath(path, pos)))
    this.localGraph = shell.addChild(
      new GraphView(lgPane, {
        cache,
        mode: 'local',
        getActive: () => this.workspace?.activePath ?? this.recent[0] ?? null,
        onOpen: (path) => void this.openPath(path)
      })
    )
    this.rightPaneEls = { backlinks: blPane, localGraph: lgPane }
    this.rightTabButtons = { backlinks: blTab, localGraph: lgTab }
    this.showRightPane(safeGet(RIGHT_PANE_KEY) === 'localGraph' ? 'localGraph' : 'backlinks', false)

    // Live link styling follows the index.
    shell.register(cache.onChange(() => this.workspace?.refreshLinks()))

    const status = el('div', 'zn-statusbar', this.root)
    el('div', 'zn-status-vault', status, this.vault!.root)
    shell.addChild(new SyncIndicator(status, {
      cache,
      workspace: () => this.workspace,
      openPath: (path) => void this.openPath(path),
      notice: (m) => this.notice(m)
    }))
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
    this.localGraph?.setVisible(!hidden && this.rightPane === 'localGraph')
  }

  private showRightPane(pane: RightPane, reveal = true): void {
    if (!this.rightPaneEls || !this.rightTabButtons) return
    this.rightPane = pane
    safeSet(RIGHT_PANE_KEY, pane)
    if (reveal && this.root.classList.contains('is-rightbar-hidden')) {
      this.root.classList.remove('is-rightbar-hidden')
      safeSet(RIGHTBAR_KEY, '0')
    }
    for (const key of ['backlinks', 'localGraph'] as RightPane[]) {
      this.rightPaneEls[key].style.display = key === pane ? '' : 'none'
      this.rightTabButtons[key].classList.toggle('is-active', key === pane)
    }
    const shown = !this.root.classList.contains('is-rightbar-hidden')
    this.localGraph?.setVisible(shown && pane === 'localGraph')
  }

  // ---------- Graph view tab ----------

  private openGraph(): void {
    const shell = this.shell
    const cache = this.cache
    if (!shell || !cache || !this.workspace) return
    // openView reuses an existing graph tab (and discards the spare view).
    this.workspace.openView(this.makeGraphTab(shell, cache))
  }

  // The graph component is created lazily, the first time its tab is shown.
  private makeGraphTab(shell: Component, cache: MetadataCache): WorkspaceView {
    const host = document.createElement('div')
    host.className = 'zn-view-host'
    let graph: GraphView | null = null
    const ensure = (): GraphView => {
      if (!graph) {
        graph = shell.addChild(
          new GraphView(host, {
            cache,
            mode: 'global',
            getActive: () => this.workspace?.activePath ?? this.recent[0] ?? null,
            onOpen: (path) => void this.openPath(path)
          })
        )
        this.globalGraph = graph
      }
      return graph
    }
    return {
      id: GRAPH_ID,
      title: 'Graph view',
      el: host,
      show: () => ensure().setVisible(true),
      hide: () => graph?.setVisible(false),
      destroy: () => {
        if (graph) shell.removeChild(graph)
        if (this.globalGraph === graph) this.globalGraph = null
        graph = null
        host.remove()
      }
    }
  }

  private async openTabPath(path: string): Promise<void> {
    if (path === GRAPH_ID) this.openGraph()
    else if (isCanvasPath(path)) this.openCanvas(path)
    else if (!path.startsWith(VIEW_PREFIX)) await this.workspace?.open(path)
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
    if (isCanvasPath(path)) {
      this.openCanvas(path)
      return
    }
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

  private async newCanvas(dir: string): Promise<void> {
    try {
      const path = await api.createFile(dir, 'Untitled', 'canvas')
      await this.refreshTree()
      this.openCanvas(path)
      this.tree?.startRename(path)
    } catch (e) {
      this.notice(`Could not create canvas: ${(e as Error).message}`)
    }
  }

  // ---------- Canvas ----------

  private openCanvas(path: string): void {
    const shell = this.shell
    if (!shell || !this.workspace) return
    if (this.workspace.activateById(path)) return
    const view = shell.addChild(new CanvasView(path, this.canvasHost()))
    this.workspace.openView(view)
  }

  private canvasHost(): CanvasHost {
    const cache = this.cache!
    return {
      editorCallbacks: (source) => ({
        onOpenLink: (href) => void this.openLink(href, source),
        onOpenWikiLink: (target) => void this.openWikiLink(target, source),
        onOpenTag: (tag) => this.showSearch(`tag:${tag}`),
        isResolved: (link) => !this.indexBuilt || cache.resolve(link, source) !== null,
        linkTargets: () => this.linkTargets(source)
      }),
      openPath: (path) => void this.openPath(path),
      openUrl: (url) => {
        if (EXTERNAL.test(url)) void api.openUrl(url)
        else this.notice(`Not a web link: ${url}`)
      },
      resolve: (link, from) => cache.resolve(link, from),
      noteContent: (path) => cache.getNote(path)?.content ?? null,
      pickNote: (onPick) =>
        openSwitcher({
          items: cache.allNotes().map((n) => ({ path: n.path, aliases: n.meta.aliases })),
          recent: this.recent,
          onOpen: (path) => onPick(path),
          onCreate: (name) => this.notice(`No note named "${name}"`)
        }),
      notice: (message) => this.notice(message),
      onSaved: (path, content) => void this.queueIndex(() => cache.setContent(path, content)),
      release: (view) => this.shell?.removeChild(view),
      preserve: (path, text) => this.preserve(path, text),
      close: (view) => this.workspace?.closeView(view.id)
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
        const reindex = (path: string, content: string): Promise<void> => this.queueIndex(() => cache.setContent(path, content))
        const { links, files, skipped } = await rewriteLinksAfterRename(cache, pending, entry.path, to, reindex)
        if (links) this.notice(`Updated ${links} link${links === 1 ? '' : 's'} in ${files} file${files === 1 ? '' : 's'}.`)
        if (skipped.length) this.notice(`Links not updated in ${skipped.join(', ')}: changed outside Zenode just now. Rename again to retry.`)
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
    if (!this.workspace || !this.vault) return
    try {
      await api.writeConfig('workspace', this.workspace.serialize())
    } catch (e) {
      this.notice(`Could not save the open tabs: ${(e as Error).message}`)
    }
  }

  // ---------- Keyboard ----------

  private onKeydown(e: KeyboardEvent): void {
    const cmd = this.commands.match(e)
    if (!cmd) return
    e.preventDefault()
    e.stopPropagation()
    this.commands.execute(cmd.id)
  }

  private registerCommands(): () => void {
    const ws = (): Workspace => this.workspace!
    return registerCoreCommands(this.commands, {
      hasVault: () => this.workspace !== null,
      chooseVault: () => void this.chooseVault(),
      openSwitcher: () => this.openQuickSwitcher(),
      showSearch: () => this.showSearch(),
      openGraph: () => this.openGraph(),
      toggleLeftSidebar: () => this.root.classList.toggle('is-sidebar-hidden'),
      toggleRightSidebar: () => this.toggleRightbar(),
      newNote: () => void this.newNote(this.currentDir()),
      newCanvas: () => void this.newCanvas(this.currentDir()),
      hasActiveFile: () => !!this.workspace?.activePath,
      showHistory: () => void this.showHistory(this.workspace?.activePath ?? ''),
      save: () => void ws().save(),
      closeTab: () => void ws().close(),
      cycleTab: (step) => ws().cycle(step)
    })
  }

  private async showHistory(path: string): Promise<void> {
    if (!path) return
    const notice = (m: string): void => this.notice(m)
    await openFileRecovery(path, stripExt(baseName(path)), {
      notice,
      restore: (text) => restoreVersion(this.workspace, path, text, notice)
    })
  }

  // Keep a copy of text the user is throwing away, in the local file history.
  private preserve(path: string, text: string): void {
    api.keepSnapshot(path, text).catch((e: Error) => this.notice(`Could not keep a copy of ${path}: ${e.message}`))
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
