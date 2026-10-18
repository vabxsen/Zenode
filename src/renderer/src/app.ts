import type { TreeEntry, VaultInfo } from '../../shared/api'
import { CanvasView, type CanvasHost } from './canvas/canvasView'
import { openCommandPalette } from './commandPalette'
import { CommandRegistry } from './commands'
import { setSpellcheckDefault } from './editor/editor'
import { attachmentDir, DEFAULT_EDITOR_SETTINGS, sanitizeEditorSettings, sanitizeHotkeys, sanitizeWorkspace, type EditorSettings } from './config'
import { Component, el } from './component'
import { registerCoreCommands } from './coreCommands'
import type { LinkTarget } from './editor/linkCompletion'
import type { FileTree } from './fileTree'
import { GRAPH_ID, makeGraphTab } from './graph/graphTab'
import type { GraphView } from './graph/graphView'
import { icon, type IconName } from './icons'
import { isCanvasPath } from './index/canvasMeta'
import { MetadataCache } from './index/metadataCache'
import { splitLinktext } from './index/parser'
import { openFileRecovery, restoreVersion } from './fileRecovery'
import { attachmentLinks, saveAttachments } from './fileOps'
import { relativeLinkTarget, subpathPosition } from './links'
import { FileActions } from './fileActions'
import { HoverPreview } from './hoverPreview'
import { registerPanelCommands } from './panelCommands'
import { registerTemplateCommands } from './templates/commands'
import { NoteTemplates } from './templates/noteTemplates'
import { registerWorkspaceCommands } from './workspaceCommands'
import { offerRecovery } from './recovery'
import type { ReadingContext } from './render/reading'
import { SyncIndicator } from './sync/syncPanel'
import { baseName, isMarkdown, parentDir, stripExt, stripMd } from './paths'
import { mentionLink, type Mention } from './panels/mentions'
import { LeftSidebar, RightSidebar, type LeftPane, type RightPane, type SidebarDeps } from './sidebars'
import { contentHash } from '../../shared/hash'
import { openSwitcher } from './switcher'
import { VIEW_PREFIX, Workspace, type OpenPosition } from './workspace'

const api = window.zenode
const EXTERNAL = /^(https?:|mailto:)/i
const SIDEBAR_KEY = 'zenode.sidebarWidth'
const RIGHTBAR_KEY = 'zenode.rightbarHidden'
const MAX_RECENT = 30

export class App extends Component {
  readonly commands = new CommandRegistry()
  private readonly files = new FileActions({
    cache: () => this.cache,
    workspace: () => this.workspace,
    tree: () => this.tree,
    refreshTree: () => this.refreshTree(),
    queueIndex: (task) => this.queueIndex(task),
    indexIdle: () => this.indexChain,
    openCanvas: (path) => this.openCanvas(path),
    notice: (m) => this.notice(m),
    renamed: (from, to) => this.left?.bookmarks.renamed(from, to),
    removed: (path) => this.left?.bookmarks.removed(path)
  })
  private readonly templates = new NoteTemplates({
    cache: () => this.cache,
    workspace: () => this.workspace,
    refreshTree: () => this.refreshTree(),
    openPath: (path) => this.openPath(path),
    notice: (m) => this.notice(m)
  })
  private editorSettings: EditorSettings = { ...DEFAULT_EDITOR_SETTINGS }
  private vault: VaultInfo | null = null
  private shell: Component | null = null
  private tree: FileTree | null = null
  private workspace: Workspace | null = null
  private cache: MetadataCache | null = null
  private left: LeftSidebar | null = null
  private right: RightSidebar | null = null
  private globalGraph: GraphView | null = null
  private statusEl: HTMLElement | null = null
  private titleEl: HTMLElement | null = null
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
    this.register(registerWorkspaceCommands(this.commands, () => this.workspace))
    this.register(
      registerTemplateCommands(this.commands, () => this.workspace !== null, () => this.workspace?.activeMode() != null, this.templates)
    )
    this.register(
      registerPanelCommands(this.commands, {
        hasVault: () => this.workspace !== null,
        activeFile: () => this.workspace?.activePath ?? null,
        toggleBookmark: (path) => this.left?.bookmarks.toggle(path),
        showLeft: (pane) => this.showPane(pane),
        showRight: (pane) => this.showRightPane(pane)
      })
    )
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

    await this.left?.bookmarks.load()
    this.commands.setCustomHotkeys(sanitizeHotkeys(await api.readConfig('hotkeys')))
    this.editorSettings = sanitizeEditorSettings(await api.readConfig('app'))
    this.workspace?.setDefaultView(this.editorSettings.defaultView)
    setSpellcheckDefault(this.editorSettings.spellcheck)
    // Open tabs live in .zenode/workspace.json; older versions kept them in the app settings.
    const ws = sanitizeWorkspace(await api.readConfig('workspace')) ?? (await api.getSettings()).workspaces[info.root]
    if (ws?.layout && this.workspace) {
      await this.workspace.restoreLayout(ws.layout, ws.activePane ?? 0, (path) => this.openTabPath(path))
    } else if (ws) {
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
    this.left = null
    this.right = null
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
    this.ribbonButton(ribbon, 'filePlus', 'New note (Ctrl+N)', () => void this.files.newNote(this.currentDir()))
    this.ribbonButton(ribbon, 'folderPlus', 'New folder', () => void this.files.newFolder(this.currentDir()))
    this.ribbonButton(ribbon, 'calendar', "Open today's daily note (Ctrl+Shift+D)", () => this.commands.execute('daily-notes:open-today'))
    this.ribbonButton(ribbon, 'canvas', 'New canvas', () => void this.files.newCanvas(this.currentDir()))
    el('div', 'zn-ribbon-spacer', ribbon)
    this.ribbonButton(ribbon, 'link', 'Toggle right sidebar (Ctrl+Shift+B)', () => this.toggleRightbar())
    this.ribbonButton(ribbon, 'folderOpen', 'Open another vault (Ctrl+Shift+O)', () => void this.chooseVault())

    const deps = this.sidebarDeps(shell, cache)
    this.left = new LeftSidebar(body, deps)
    this.tree = this.left.tree
    const sidebar = this.left.bar.el

    const resizer = el('div', 'zn-resizer', body)
    this.setupResizer(resizer, sidebar)

    const main = el('div', 'zn-main', body)
    this.workspace = shell.addChild(
      new Workspace(main, {
        onActiveChange: (path, title) => {
          this.tree?.setActive(path)
          this.titleEl!.textContent = title
          if (path) this.recent = [path, ...this.recent.filter((p) => p !== path)].slice(0, MAX_RECENT)
          this.left?.bookmarks.renderRecent()
          // Side panels keep showing the last note while a view tab (like the graph) is in front.
          const context = path ?? this.recent[0] ?? null
          this.right?.setTarget(context)
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
        preserve: (path, text) => this.preserve(path, text),
        importFiles: async (notePath, files) => {
          const dir = attachmentDir(this.editorSettings.attachmentFolder, notePath)
          const saved = await saveAttachments(files, dir)
          await this.refreshTree()
          return attachmentLinks(saved, notePath, (p, from) => cache.linktext(p, from))
        },
        readingContext: (path) => this.readingContext(cache, path),
        reopen: (path) => this.openTabPath(path),
        revealInTree: (path) => this.revealInTree(path)
      })
    )

    this.right = new RightSidebar(body, deps)

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
    shell.addChild(new HoverPreview(this.root, { activePath: () => this.workspace?.activePath ?? null, readingContext: (p) => this.readingContext(cache, p) }))
  }

  private sidebarDeps(shell: Component, cache: MetadataCache): SidebarDeps {
    return {
      root: this.root,
      shell,
      cache,
      vaultName: this.vault!.name,
      tree: {
        onOpen: (entry) => void this.openEntry(entry),
        onNewNote: (dir) => void this.files.newNote(dir),
        onNewFolder: (dir) => void this.files.newFolder(dir),
        onNewCanvas: (dir) => void this.files.newCanvas(dir),
        onRename: (entry, name) => this.files.rename(entry, name),
        onDelete: (entries) => void this.files.remove(entries),
        onMove: (paths, dir) => void this.files.moveAll(paths, dir),
        onMoveTo: (paths) => void this.files.moveTo(paths),
        onReveal: (path) => void api.reveal(path),
        onHistory: (path) => void this.showHistory(path)
      },
      openPath: (path, pos) => void this.openPath(path, pos),
      createNote: (name) => void this.files.createNamedNote(name),
      showSearch: (query) => this.showSearch(query),
      recent: () => this.recent,
      activePath: () => this.workspace?.activePath ?? null,
      linkMention: (m, target) => this.linkMention(m, target),
      notice: (m) => this.notice(m)
    }
  }

  private showPane(pane: LeftPane): void {
    this.root.classList.remove('is-sidebar-hidden')
    this.left?.show(pane)
  }

  private showSearch(initial?: string): void {
    this.showPane('search')
    this.left?.search.focus(initial)
  }

  private toggleLeftbar(): void {
    this.root.classList.toggle('is-sidebar-hidden')
    this.left?.bar.notifyVisibility()
  }

  private toggleRightbar(): void {
    const hidden = this.root.classList.toggle('is-rightbar-hidden')
    safeSet(RIGHTBAR_KEY, hidden ? '1' : '0')
    this.right?.bar.notifyVisibility()
  }

  private showRightPane(pane: RightPane): void {
    if (this.root.classList.contains('is-rightbar-hidden')) {
      this.root.classList.remove('is-rightbar-hidden')
      safeSet(RIGHTBAR_KEY, '0')
    }
    this.right?.show(pane)
  }

  // Turns an unlinked mention into a link. An open note is edited in its tab
  // (so unsaved typing is kept); otherwise the file is written if unchanged.
  private async linkMention(m: Mention, target: string): Promise<void> {
    const cache = this.cache
    const note = cache?.getNote(m.source)
    if (!cache || !note || note.content.slice(m.start, m.end) !== m.text) {
      this.notice('That note changed. The list has been refreshed.')
      return
    }
    const updated = note.content.slice(0, m.start) + mentionLink(cache.linktext(target, m.source), m.text) + note.content.slice(m.end)
    if (this.workspace?.isOpen(m.source)) {
      this.workspace.replaceText(m.source, updated)
      await this.workspace.save()
      return
    }
    try {
      const result = await api.writeChecked(m.source, updated, contentHash(note.content))
      if (result.status === 'conflict') {
        this.notice(`${stripExt(baseName(m.source))} changed on disk; not linked.`)
        return
      }
      await this.queueIndex(() => cache.setContent(m.source, updated))
    } catch (e) {
      this.notice(`Could not link the mention: ${(e as Error).message}`)
    }
  }

  // ---------- Graph view tab ----------

  private openGraph(): void {
    const shell = this.shell
    const cache = this.cache
    if (!shell || !cache || !this.workspace) return
    // openView reuses an existing graph tab (and discards the spare view).
    this.workspace.openView(
      makeGraphTab({
        shell,
        cache,
        getActive: () => this.workspace?.activePath ?? this.recent[0] ?? null,
        onOpen: (path) => void this.openPath(path),
        onGraphChange: (graph) => (this.globalGraph = graph)
      })
    )
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

  // ---------- Links ----------

  private async openWikiLink(target: string, fromPath: string): Promise<void> {
    const cache = this.cache
    if (!cache) return
    const { link, subpath } = splitLinktext(target)
    const resolved = link ? cache.resolve(link, fromPath) : fromPath
    if (!resolved) {
      await this.files.createNamedNote(link)
      return
    }
    await this.openPath(resolved, subpath ? this.subpathPosition(resolved, subpath) : undefined)
  }

  // Find "#Heading" or "#^block-id" inside a note.
  private subpathPosition(path: string, subpath: string): OpenPosition | undefined {
    const note = this.cache?.getNote(path)
    return note ? subpathPosition(note.content, note.meta, subpath) : undefined
  }

  private async openLink(href: string, fromPath: string): Promise<void> {
    if (EXTERNAL.test(href)) {
      await api.openUrl(href)
      return
    }
    // Relative Markdown link to another file in the vault.
    const target = relativeLinkTarget(href, fromPath)
    if (!target) return
    await this.openPath(target.path, target.subpath ? this.subpathPosition(target.path, target.subpath) : undefined)
  }

  // ---------- Quick switcher ----------

  private openQuickSwitcher(): void {
    const cache = this.cache
    if (!cache) return
    openSwitcher({
      items: cache.allNotes().map((n) => ({ path: n.path, aliases: n.meta.aliases })),
      recent: this.recent,
      onOpen: (path) => void this.openPath(path),
      onCreate: (name) => void this.files.createNamedNote(name)
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
      openCommandPalette: () => openCommandPalette(this.commands),
      openSwitcher: () => this.openQuickSwitcher(),
      showSearch: () => this.showSearch(),
      openGraph: () => this.openGraph(),
      toggleLeftSidebar: () => this.toggleLeftbar(),
      toggleRightSidebar: () => this.toggleRightbar(),
      newNote: () => void this.files.newNote(this.currentDir()),
      newCanvas: () => void this.files.newCanvas(this.currentDir()),
      hasActiveFile: () => !!this.workspace?.activePath,
      hasActiveNote: () => this.workspace?.activeMode() != null,
      toggleReading: () => this.workspace?.toggleReading(),
      toggleSource: () => this.workspace?.toggleSource(),
      toggleSpellcheck: () => void this.updateEditorSettings({ spellcheck: !this.editorSettings.spellcheck }),
      showHistory: () => void this.showHistory(this.workspace?.activePath ?? ''),
      revealActiveFile: () => this.revealInTree(this.workspace?.activePath ?? ''),
      collapseTree: () => this.tree?.collapseAll(),
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

  // Change editor settings, apply them to open notes and save .zenode/app.json.
  private async updateEditorSettings(change: Partial<EditorSettings>): Promise<void> {
    this.editorSettings = { ...this.editorSettings, ...change }
    setSpellcheckDefault(this.editorSettings.spellcheck)
    this.workspace?.applySpellcheck(this.editorSettings.spellcheck)
    this.workspace?.setDefaultView(this.editorSettings.defaultView)
    if (change.spellcheck !== undefined) this.notice(`Spellcheck ${change.spellcheck ? 'on' : 'off'}`)
    await api.writeConfig('app', this.editorSettings).catch((e: Error) => this.notice(`Could not save settings: ${e.message}`))
  }

  // Links, embeds and clicks for rendered Markdown (Reading view, embeds, previews).
  private readingContext(cache: MetadataCache, path: string): Omit<ReadingContext, 'sourcePath' | 'onToggleTask'> {
    return {
      resolve: (link, from) => cache.resolve(link, from),
      readNote: async (p) => cache.getNote(p)?.content ?? (await api.read(p).catch(() => null)),
      onOpenWikiLink: (target, from) => void this.openWikiLink(target, from),
      onOpenLink: (href) => void this.openLink(href, path),
      onOpenTag: (tag) => this.showSearch(`tag:${tag}`)
    }
  }

  private revealInTree(path: string): void {
    if (!path) return
    this.showPane('files')
    this.tree?.reveal(path)
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
