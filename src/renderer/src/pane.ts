import { EditorView } from '@codemirror/view'
import { contentHash } from '../../shared/hash'
import { Component, el, el as mk } from './component'
import { hideConflictBar, openCompareDialog, renderConflictBar } from './conflictUi'
import { createEditorState, dropNativeUndo, fromDisk, revealRange, spellcheckAttrs, spellcheckSetting, syncEditorTheme, taskToggle } from './editor/editor'
import { linksChanged, setSourceMode } from './editor/livePreview'
import { dialogHasFocus } from './focusGuard'
import { icon } from './icons'
import { confirmLargeNote, LARGE_NOTE, noteTitle, type MovedTab, type OpenPosition, type PaneHost, type PaneState, type Tab, type TextEdit, type WorkspaceView } from './paneTypes'
import { acceptTabDrops, buildTabStrip, renderTabBar, showTabMenu, tabMenuItems, type TabMenuActions } from './tabBar'
import { TabHistory } from './tabHistory'
import { renderInto } from './render/reading'
import { InlineTitle } from './inlineTitle'
import { showMenu } from './menu'
import { PaneHeader } from './paneHeader'
import { scheduleJournal, unjournal, writeJournal } from './paneJournal'

const SAVE_DELAY = 600

// One group of tabs with its own editor. The Workspace arranges panes in splits.
export class Pane extends Component {
  private tabs: Tab[] = []
  private active: Tab | null = null
  // Back/forward through the tabs this pane showed.
  private readonly history = new TabHistory()
  private navigating = false
  private readonly view: EditorView
  private readonly tabbarEl: HTMLElement
  private readonly tabsEl: HTMLElement
  private readonly header: PaneHeader
  private readonly inlineTitle: InlineTitle
  private readonly conflictEl: HTMLElement
  private readonly editorEl: HTMLElement
  private readonly readingEl: HTMLElement
  private defaultView: 'live' | 'source' | 'reading' = 'live'
  private readonly viewsEl: HTMLElement
  private readonly emptyEl: HTMLElement
  private statsTimer: number | null = null

  constructor(
    readonly el: HTMLElement,
    private readonly host: PaneHost
  ) {
    super()
    const container = el
    container.addEventListener('mousedown', () => this.host.onFocus(), true)
    container.addEventListener('focusin', () => this.host.onFocus())
    this.tabbarEl = mk('div', 'zn-tabbar', container)
    this.tabsEl = buildTabStrip(this.tabbarEl, { newNote: () => this.host.newNote(), listTabs: (x, y) => this.listTabs(x, y) })
    acceptTabDrops(this.tabbarEl, (data, index) => this.host.onDropTab(data, index))
    this.header = new PaneHeader(container, {
      go: (step) => void this.go(step),
      toggleReading: () => this.toggleReading(),
      toggleSource: () => this.toggleSource(),
      tabMenu: () => (this.active ? tabMenuItems(this.active, this.tabActions(this.active)) : [])
    })
    this.conflictEl = mk('div', 'zn-conflict', container)
    this.conflictEl.style.display = 'none'
    this.editorEl = mk('div', 'zn-editor', container)
    this.readingEl = mk('div', 'zn-reading', container)
    this.readingEl.tabIndex = -1
    this.viewsEl = mk('div', 'zn-views', container)
    this.emptyEl = mk('div', 'zn-empty', container)
    const inner = mk('div', 'zn-empty-inner', this.emptyEl)
    inner.appendChild(icon('note', 40))
    mk('div', 'zn-empty-title', inner, 'No note open')
    mk('div', 'zn-empty-hint', inner, 'Pick a note on the left, or press Ctrl+N to start a new one.')
    this.view = new EditorView({ parent: this.editorEl })
    this.inlineTitle = new InlineTitle(
      (name) => (this.active?.kind === 'note' ? this.host.renameNote(this.active.path, name) : Promise.resolve(false)),
      () => this.focus(),
      (height) => {
        this.view.scrollDOM.style.setProperty('--zn-inline-title-h', `${height}px`)
        this.view.requestMeasure()
      }
    )
    this.render()
  }

  onunload(): void {
    this.inlineTitle.destroy()
    this.view.destroy()
  }

  // The active note's path (null when a view tab or nothing is active).
  get activePath(): string | null {
    // Notes and file-backed views (canvases) count as the active file; the graph does not.
    if (this.active?.kind === 'note') return this.active.path
    return this.active?.view?.filePath ?? null
  }

  focus(): void {
    if (this.active?.kind !== 'note') return
    if (this.active.reading) this.readingEl.focus({ preventScroll: true })
    else this.view.focus()
  }

  // ---------- Reading view and Source mode ----------

  // How newly opened notes are shown (from settings).
  setDefaultView(view: 'live' | 'source' | 'reading'): void {
    this.defaultView = view
  }

  // Turn spellcheck on or off in every open note.
  applySpellcheck(on: boolean): void {
    const effects = spellcheckSetting.reconfigure(spellcheckAttrs(on))
    for (const tab of this.tabs) {
      if (tab.kind !== 'note') continue
      if (tab === this.active) this.view.dispatch({ effects })
      else tab.state = tab.state!.update({ effects }).state
    }
  }

  // Ctrl+E: switch the active note between editing and Reading view.
  toggleReading(): void {
    const tab = this.active
    if (tab?.kind !== 'note') return
    if (!tab.reading) tab.state = this.view.state
    tab.reading = !tab.reading
    this.render()
    if (tab.reading) void this.renderReading(tab)
    this.focus()
  }

  // Switch the active note between Live Preview and plain Markdown (Source mode).
  toggleSource(): void {
    const tab = this.active
    if (tab?.kind !== 'note') return
    if (tab.reading) {
      tab.reading = false
      this.render()
    }
    tab.source = !tab.source
    this.view.dispatch({ effects: setSourceMode.of(tab.source) })
    this.focus()
  }

  activeMode(): 'live' | 'source' | 'reading' | null {
    const tab = this.active
    if (tab?.kind !== 'note') return null
    return tab.reading ? 'reading' : tab.source ? 'source' : 'live'
  }

  private async renderReading(tab: Tab): Promise<void> {
    if (tab !== this.active || !tab.reading) return
    const top = this.readingEl.scrollTop
    const body = el('div', 'zn-reading-body')
    await renderInto(body, this.docOf(tab), {
      ...this.host.readingContext(tab.path),
      sourcePath: tab.path,
      onToggleTask: (line, checked) => this.toggleTask(tab, line, checked)
    })
    if (tab !== this.active || !tab.reading) return
    this.readingEl.replaceChildren(body)
    this.inlineTitle.show(this.titleOf(tab), body)
    this.readingEl.scrollTop = top
  }

  // A task checkbox clicked in Reading view: flip "[ ]" / "[x]" on that line.
  private toggleTask(tab: Tab, line: number, checked: boolean): void {
    const state = tab === this.active ? this.view.state : tab.state!
    const spec = taskToggle(state, line, checked)
    if (!spec) return
    if (tab === this.active) this.view.dispatch(spec)
    else tab.state = state.update(spec).state
    void this.renderReading(tab)
  }

  openView(view: WorkspaceView): void {
    const existing = this.tabs.find((t) => t.path === view.id)
    if (existing) {
      view.destroy()
      this.activate(existing)
      return
    }
    this.viewsEl.appendChild(view.el)
    view.hide()
    const tab: Tab = { path: view.id, kind: 'view', state: null, view, lastSaved: '', dirty: false, timer: null, conflict: null, saving: null, journalTimer: null, journaled: false, reading: false, source: false, pinned: false }
    const at = this.active ? this.tabs.indexOf(this.active) + 1 : this.tabs.length
    this.tabs.splice(at, 0, tab)
    this.activate(tab)
  }

  // Switch to an open tab by its path or view id. Returns false if none is open.
  activateById(id: string): boolean {
    const tab = this.tabs.find((t) => t.path === id)
    if (tab) this.activate(tab)
    return !!tab
  }

  hasView(id: string): boolean {
    return this.tabs.some((t) => t.path === id)
  }

  async open(path: string, pos?: OpenPosition): Promise<void> {
    const existing = this.tabs.find((t) => t.path === path)
    if (existing) {
      this.activate(existing)
      if (pos) this.reveal(pos)
      return
    }
    let content: string
    try {
      content = await window.zenode.read(path)
    } catch (e) {
      this.host.onError(`Could not open ${path}: ${(e as Error).message}`)
      return
    }
    if (content.length > LARGE_NOTE && !(await confirmLargeNote(path, content.length))) return
    this.addNoteTab(path, content)
    if (pos) this.reveal(pos)
  }

  // A new, active note tab showing `content` (the file as it is on disk).
  private addNoteTab(path: string, content: string): Tab {
    const tab: Tab = { path, kind: 'note', state: null, view: null, lastSaved: content, dirty: false, timer: null, conflict: null, saving: null, journalTimer: null, journaled: false, reading: false, source: false, pinned: false }
    tab.state = createEditorState(content, {
      onChange: () => this.onEdited(tab),
      onOpenLink: (href) => this.host.onOpenLink(href, tab.path),
      onOpenWikiLink: (target) => this.host.onOpenWikiLink(target, tab.path),
      onOpenTag: (tag) => this.host.onOpenTag(tag),
      isResolved: (link) => this.host.isResolved(link, tab.path),
      linkTargets: () => this.host.linkTargets(tab.path),
      renderContext: () => ({ ...this.host.readingContext(tab.path), sourcePath: tab.path }),
      onFiles: (files, pos) => void this.insertFiles(tab, files, pos)
    })
    tab.reading = this.defaultView === 'reading'
    tab.source = this.defaultView === 'source'
    if (tab.source) tab.state = tab.state.update({ effects: setSourceMode.of(true) }).state
    const at = this.active ? this.tabs.indexOf(this.active) + 1 : this.tabs.length
    this.tabs.splice(at, 0, tab)
    this.activate(tab)
    return tab
  }

  // Saves pasted/dropped files and puts links to them at pos.
  private async insertFiles(tab: Tab, files: File[], pos: number): Promise<void> {
    let markdown: string
    try {
      markdown = await this.host.importFiles(tab.path, files)
    } catch (e) {
      this.host.onError(`Could not add the file: ${(e as Error).message}`)
      return
    }
    if (!markdown || tab !== this.active || tab.kind !== 'note') return
    const at = Math.min(pos, this.view.state.doc.length)
    this.view.dispatch({ changes: { from: at, insert: markdown }, selection: { anchor: at + markdown.length } })
    this.view.focus()
  }

  // The active note's current text (unsaved edits included), or null.
  activeNote(): { path: string; text: string } | null {
    const tab = this.active
    return tab?.kind === 'note' ? { path: tab.path, text: this.docOf(tab) } : null
  }

  // Edits the active note being typed in (not Reading view): `build` gets its
  // text and cursor and returns the changes plus where the cursor goes after.
  editActive(build: (doc: string, cursor: number) => TextEdit): boolean {
    const tab = this.active
    if (tab?.kind !== 'note' || tab.reading) return false
    const { changes, cursor } = build(this.view.state.doc.toString(), this.view.state.selection.main.head)
    this.view.dispatch({ changes, selection: { anchor: cursor }, scrollIntoView: true, userEvent: 'input' })
    this.view.focus()
    return true
  }

  // Puts `text` into an open note as an ordinary edit (undoable; autosave writes
  // it). The text it replaces is kept in the file history. False if not open.
  replaceText(path: string, text: string): boolean {
    const tab = this.tabs.find((t) => t.path === path && t.kind === 'note')
    if (!tab) return false
    this.activate(tab)
    this.host.preserve(path, this.docOf(tab))
    this.setDoc(tab, text, false)
    return true
  }

  // Brings back unsaved text from the crash-recovery journal. If the file changed
  // since (or is gone), the tab opens in conflict so nothing is overwritten.
  async restoreUnsaved(path: string, content: string, baseHash: string): Promise<void> {
    let disk: string | null
    try {
      disk = await window.zenode.read(path)
    } catch {
      disk = null
    }
    if (disk === content) return
    const existing = this.tabs.find((t) => t.path === path && t.kind === 'note')
    const tab = existing ?? this.addNoteTab(path, disk ?? '')
    this.activate(tab)
    tab.lastSaved = disk ?? ''
    this.setDoc(tab, content, false)
    if (disk === null || contentHash(disk) !== baseHash) this.setConflict(tab, disk)
  }

  // ---------- Crash-recovery journal ----------

  private journal(tab: Tab): void {
    // A closed tab's entry stays on disk for recovery.
    if (this.tabs.includes(tab) && tab.kind === 'note') writeJournal(tab, this.docOf(tab), (m) => this.host.onError(m))
  }

  // Select a range in the active note and scroll it to the middle of the view.
  private reveal(pos: OpenPosition): void {
    if (this.active?.kind === 'note') revealRange(this.view, pos.from, pos.to ?? pos.from)
  }

  // Re-run link styling after the vault's links changed (e.g. a missing note was created).
  refreshLinks(): void {
    if (this.active?.kind === 'note') this.view.dispatch({ effects: linksChanged.of(null) })
  }

  isOpen(path: string): boolean {
    return this.tabs.some((t) => t.path === path)
  }

  private activate(tab: Tab): void {
    const prev = this.active
    if (prev && prev !== tab) {
      if (prev.kind === 'note') prev.state = this.view.state
      else prev.view?.hide()
    }
    this.active = tab
    if (!this.navigating) this.history.push(tab.path)
    if (tab.kind === 'note') {
      if (prev !== tab) dropNativeUndo(this.view)
      this.view.setState(tab.state!)
      syncEditorTheme(this.view)
    }
    this.render()
    if (tab.kind === 'view') tab.view!.show()
    if (tab.reading) void this.renderReading(tab)
    this.updateStats()
    this.host.onActiveChange(this.activePath, this.titleOf(tab))
    this.host.onLayoutChange()
    if (tab.kind === 'note') requestAnimationFrame(() => {
      if (this.host.isActivePane() && !dialogHasFocus()) this.focus()
    })
  }

  private titleOf(tab: Tab): string {
    return tab.view ? tab.view.title : noteTitle(tab.path)
  }

  async close(tab: Tab | null = this.active): Promise<void> {
    if (!tab) return
    if (tab.pinned) {
      this.host.onError(`"${this.titleOf(tab)}" is pinned. Unpin it to close it.`)
      return
    }
    if (tab.conflict || (tab.view?.conflictText?.() ?? null) !== null) {
      // Closing would silently drop the user's version; make them choose first.
      this.activate(tab)
      this.host.onError(`"${this.titleOf(tab)}" has unsaved changes that conflict with the file on disk. Choose a version first.`)
      return
    }
    await this.save(tab)
    this.dispose(tab)
    if (!this.tabs.length) this.host.onEmptied()
  }

  // Close the tab showing path (saving it first), if this pane has one.
  closePath(path: string): Promise<void> {
    return this.close(this.tabs.find((t) => t.path === path) ?? null)
  }

  // Close every other unpinned tab.
  async closeOthers(keep: Tab | null = this.active): Promise<void> {
    for (const tab of this.tabs.slice()) if (tab !== keep && !tab.pinned) await this.close(tab)
  }

  togglePin(tab: Tab | null = this.active): void {
    if (!tab) return
    tab.pinned = !tab.pinned
    // Pinned tabs are kept together at the front, in the order they were pinned.
    this.tabs.splice(this.tabs.indexOf(tab), 1)
    // Just after the pinned group (as its last member when pinning, as the first unpinned tab otherwise).
    const firstUnpinned = this.tabs.findIndex((t) => !t.pinned)
    this.tabs.splice(firstUnpinned === -1 ? this.tabs.length : firstUnpinned, 0, tab)
    this.render()
    this.host.onLayoutChange()
  }

  // ---------- History (Alt+Left / Alt+Right) ----------

  async go(step: 1 | -1): Promise<void> {
    const path = this.history.step(step)
    if (path === undefined) return
    this.navigating = true
    try {
      const tab = this.tabs.find((t) => t.path === path)
      if (tab) this.activate(tab)
      else await this.host.reopen(path)
    } finally {
      this.navigating = false
    }
  }

  // ---------- Moving tabs between panes ----------

  hasTab(path: string): boolean {
    return this.tabs.some((t) => t.path === path)
  }

  // Takes a tab out of this pane without closing it, to put in another pane.
  detachTab(path: string): MovedTab | null {
    const tab = this.tabs.find((t) => t.path === path)
    if (!tab) return null
    if (tab === this.active && tab.kind === 'note') tab.state = this.view.state
    const i = this.tabs.indexOf(tab)
    this.tabs.splice(i, 1)
    if (tab.view) {
      tab.view.hide()
      tab.view.el.remove()
    }
    if (this.active === tab) {
      this.active = null
      const next = this.tabs[Math.min(i, this.tabs.length - 1)]
      if (next) this.activate(next)
      else {
        this.render()
        this.host.onActiveChange(null, '')
      }
    } else this.render()
    return tab
  }

  // Puts a tab taken from another pane here (at index, or after the active tab) and shows it.
  attachTab(tab: MovedTab, index?: number): void {
    if (tab.view) this.viewsEl.appendChild(tab.view.el)
    const at = index ?? (this.active ? this.tabs.indexOf(this.active) + 1 : this.tabs.length)
    this.tabs.splice(Math.max(0, Math.min(at, this.tabs.length)), 0, tab)
    this.activate(tab)
  }

  get isEmpty(): boolean {
    return this.tabs.length === 0
  }

  // Re-announce the active tab (when this pane becomes the active one).
  announce(): void {
    this.host.onActiveChange(this.activePath, this.active ? this.titleOf(this.active) : '')
    this.updateStats()
  }

  state(): PaneState {
    return {
      tabs: this.tabs.map((t) => t.path),
      active: this.active?.path ?? null,
      pinned: this.tabs.filter((t) => t.pinned).map((t) => t.path)
    }
  }

  // After restoring tabs from a saved layout: re-pin them and show the saved active tab.
  applyState(state: PaneState): void {
    for (const path of state.pinned) {
      const tab = this.tabs.find((t) => t.path === path)
      if (tab && !tab.pinned) this.togglePin(tab)
    }
    const active = state.active ? this.tabs.find((t) => t.path === state.active) : null
    if (active) this.activate(active)
  }

  private dispose(tab: Tab): void {
    if (tab.timer !== null) window.clearTimeout(tab.timer)
    // A journal entry that still exists stays on disk for recovery.
    if (tab.journalTimer !== null) window.clearTimeout(tab.journalTimer)
    tab.view?.destroy()
    const i = this.tabs.indexOf(tab)
    if (i === -1) return
    this.tabs.splice(i, 1)
    if (this.active === tab) {
      this.active = null
      const next = this.tabs[Math.min(i, this.tabs.length - 1)]
      if (next) {
        this.activate(next)
        return
      }
      dropNativeUndo(this.view)
      this.host.onActiveChange(null, '')
      this.host.onStats(0, 0)
    }
    this.render()
    this.host.onLayoutChange()
  }

  cycle(delta: number): void {
    if (this.tabs.length < 2 || !this.active) return
    const i = this.tabs.indexOf(this.active)
    this.activate(this.tabs[(i + delta + this.tabs.length) % this.tabs.length])
  }

  private docOf(tab: Tab): string {
    // sliceDoc() joins lines with the note's own line break (CRLF notes stay CRLF).
    return (tab === this.active ? this.view.state : tab.state!).sliceDoc()
  }

  private onEdited(tab: Tab): void {
    if (!tab.dirty) {
      tab.dirty = true
      this.render()
    }
    if (tab.timer !== null) window.clearTimeout(tab.timer)
    tab.timer = window.setTimeout(() => void this.save(tab), SAVE_DELAY)
    scheduleJournal(tab, (t) => this.journal(t))
    if (tab === this.active) this.updateStats()
  }

  async save(tab: Tab | null = this.active): Promise<void> {
    if (!tab) return
    if (tab.kind === 'view') {
      await tab.view?.save?.()
      return
    }
    if (tab.timer !== null) {
      window.clearTimeout(tab.timer)
      tab.timer = null
    }
    // Waiting for the user to pick a version in the conflict bar.
    if (tab.conflict) return
    // Only edits are saved: a note Zenode merely opened is never rewritten.
    if (!tab.dirty) return
    if (tab.saving) await tab.saving
    const run = this.writeTab(tab)
    tab.saving = run
    try {
      await run
    } finally {
      if (tab.saving === run) tab.saving = null
    }
  }

  private async writeTab(tab: Tab): Promise<void> {
    const content = this.docOf(tab)
    if (content === tab.lastSaved) {
      if (tab.dirty) {
        tab.dirty = false
        this.render()
      }
      return
    }
    try {
      // Only overwrite the version we last saw; anything else is a conflict.
      const result = await window.zenode.writeChecked(tab.path, content, contentHash(tab.lastSaved))
      if (result.status === 'conflict') {
        this.setConflict(tab, result.disk)
        return
      }
      this.saved(tab, content)
    } catch (e) {
      this.host.onError(`Could not save ${tab.path}: ${(e as Error).message}`)
    }
  }

  private saved(tab: Tab, content: string): void {
    tab.lastSaved = content
    this.host.onSaved(tab.path, content)
    if (this.docOf(tab) === content) {
      tab.dirty = false
      unjournal(tab)
    }
    this.render()
  }

  // Saves everything that can be saved. Text in conflicted tabs is kept as a
  // snapshot, since it can't be written without the user's say.
  async saveAll(): Promise<void> {
    await Promise.all(this.tabs.map((t) => this.save(t)))
    for (const tab of this.tabs) {
      if (tab.conflict) this.host.preserve(tab.path, this.docOf(tab))
      const viewText = tab.view?.conflictText?.() ?? null
      if (viewText !== null && tab.view?.filePath) this.host.preserve(tab.view.filePath, viewText)
    }
  }

  // Close a view's tab without saving (the view already kept what it needed).
  closeView(id: string): void {
    const tab = this.tabs.find((t) => t.path === id)
    if (tab) this.dispose(tab)
  }

  // ---------- Conflicts with the file on disk ----------

  private setConflict(tab: Tab, disk: string | null): void {
    tab.conflict = { disk }
    tab.dirty = true
    // The user's text can't be saved until they choose, so make sure a crash can't lose it.
    this.journal(tab)
    this.render()
  }

  private clearConflict(tab: Tab): void {
    tab.conflict = null
    this.render()
  }

  // Replace a tab's text as a change from disk (no autosave, no undo step merge).
  private setDoc(tab: Tab, text: string, fromDiskChange: boolean): void {
    const state = tab === this.active ? this.view.state : tab.state!
    const spec = { changes: { from: 0, to: state.doc.length, insert: text }, annotations: fromDisk.of(fromDiskChange) }
    if (tab === this.active) {
      this.view.dispatch(spec)
      this.updateStats()
      if (tab.reading) void this.renderReading(tab)
    } else {
      tab.state = state.update(spec).state
    }
  }

  // Write the user's version over whatever is on disk now (or recreate the file).
  private async keepMine(tab: Tab): Promise<void> {
    const conflict = tab.conflict
    if (!conflict) return
    const content = this.docOf(tab)
    try {
      if (conflict.disk === null) {
        await window.zenode.write(tab.path, content)
      } else {
        const result = await window.zenode.writeChecked(tab.path, content, contentHash(conflict.disk))
        if (result.status === 'conflict') {
          // It changed again in the meantime: show the newest version.
          this.setConflict(tab, result.disk)
          return
        }
      }
      tab.conflict = null
      this.saved(tab, content)
    } catch (e) {
      this.host.onError(`Could not save ${tab.path}: ${(e as Error).message}`)
    }
  }

  private useDisk(tab: Tab): void {
    const disk = tab.conflict?.disk
    if (disk === undefined || disk === null) return
    this.host.preserve(tab.path, this.docOf(tab))
    tab.lastSaved = disk
    this.setDoc(tab, disk, true)
    tab.dirty = false
    unjournal(tab)
    this.clearConflict(tab)
  }

  private async compare(tab: Tab): Promise<void> {
    const disk = tab.conflict?.disk
    if (disk === undefined || disk === null) return
    const merged = await openCompareDialog(this.titleOf(tab), disk, this.docOf(tab))
    if (merged === null || !tab.conflict) return
    if (merged !== this.docOf(tab)) this.setDoc(tab, merged, false)
    await this.keepMine(tab)
  }

  private discardTab(tab: Tab): void {
    this.host.preserve(tab.path, this.docOf(tab))
    tab.conflict = null
    unjournal(tab)
    this.dispose(tab)
  }

  async closeAll(): Promise<void> {
    await this.saveAll()
    for (const tab of this.tabs.slice()) this.dispose(tab)
  }

  // A file or folder was renamed: retarget every tab under it.
  renamed(from: string, to: string): void {
    for (const tab of this.tabs) {
      if (tab.kind === 'view' && tab.view?.filePath === undefined) continue
      let next: string | null = null
      if (tab.path === from) next = to
      else if (tab.path.startsWith(`${from}/`)) next = to + tab.path.slice(from.length)
      if (next === null) continue
      // Move a recovery entry to the new path.
      if (tab.journaled) {
        unjournal(tab)
        tab.path = next
        this.journal(tab)
      }
      tab.path = next
      tab.view?.setPath?.(next)
    }
    this.render()
    if (this.active) this.host.onActiveChange(this.activePath, this.titleOf(this.active))
    this.host.onLayoutChange()
  }

  // A file or folder was deleted: close its tabs without saving.
  removed(path: string): void {
    for (const tab of this.tabs.slice()) {
      if (tab.kind === 'view' && tab.view?.filePath === undefined) continue
      if (tab.path === path || tab.path.startsWith(`${path}/`)) {
        tab.view?.discard?.()
        this.dispose(tab)
      }
    }
  }

  // Pick up edits made outside Zenode. With unsaved changes here, that's a
  // conflict: nothing is overwritten and the user picks a version.
  async reloadChanged(paths: string[]): Promise<void> {
    const changed = new Set(paths)
    for (const tab of this.tabs.slice()) {
      if (tab.kind === 'view') {
        if (tab.view?.filePath !== undefined && changed.has(tab.path)) await tab.view.reloadFromDisk?.()
        continue
      }
      if (!changed.has(tab.path)) continue
      if (tab.saving) await tab.saving
      let disk: string | null
      try {
        disk = await window.zenode.read(tab.path)
      } catch {
        disk = null
      }
      if (!this.tabs.includes(tab)) continue
      if (disk === tab.lastSaved) {
        if (tab.conflict) this.clearConflict(tab)
        continue
      }
      if (tab.dirty || tab.conflict) {
        // The disk caught up with exactly what's in the editor (e.g. synced back): no conflict.
        if (disk === this.docOf(tab)) {
          tab.lastSaved = disk
          tab.dirty = false
          this.clearConflict(tab)
          continue
        }
        this.setConflict(tab, disk)
        continue
      }
      // No unsaved changes: follow the disk (a deleted or moved file closes its tab).
      if (disk === null) {
        this.dispose(tab)
        continue
      }
      tab.lastSaved = disk
      this.setDoc(tab, disk, true)
    }
  }

  private updateStats(): void {
    if (this.statsTimer !== null) window.clearTimeout(this.statsTimer)
    this.statsTimer = window.setTimeout(() => {
      const text = this.active?.kind === 'note' ? this.view.state.doc.toString() : ''
      const words = text.trim() ? text.trim().split(/\s+/).length : 0
      this.host.onStats(words, text.length)
    }, 150)
  }

  private renderConflict(): void {
    const tab = this.active
    if (!tab || tab.kind !== 'note' || !tab.conflict) {
      hideConflictBar(this.conflictEl)
      return
    }
    renderConflictBar(this.conflictEl, tab.conflict.disk, 'note', {
      compare: () => void this.compare(tab),
      keepMine: () => void this.keepMine(tab),
      useDisk: () => this.useDisk(tab),
      closeTab: () => this.discardTab(tab)
    })
  }

  private tabActions(tab: Tab): TabMenuActions {
    return {
      close: () => void this.close(tab),
      closeOthers: () => void this.closeOthers(tab),
      togglePin: () => this.togglePin(tab),
      split: (dir) => this.host.splitWith(tab.path, dir),
      reveal: () => this.host.revealInTree(tab.path)
    }
  }

  private listTabs(x: number, y: number): void {
    showMenu(x, y, this.tabs.map((t) => ({ label: this.titleOf(t), action: () => this.activate(t) })))
  }

  private render(): void {
    renderTabBar(this.tabsEl, this.tabs, this.active, {
      title: (tab) => this.titleOf(tab),
      dragData: (path) => this.host.dragData(path),
      onMenu: (tab, x, y) => showTabMenu(tab, x, y, this.tabActions(tab)),
      onClose: (tab) => void this.close(tab),
      onActivate: (tab) => this.activate(tab)
    })
    this.renderConflict()
    const tab = this.active
    const kind = tab?.kind ?? null
    const reading = kind === 'note' && tab!.reading
    this.editorEl.style.display = kind === 'note' && !reading ? '' : 'none'
    this.readingEl.style.display = reading ? '' : 'none'
    this.viewsEl.style.display = kind === 'view' ? '' : 'none'
    this.emptyEl.style.display = kind ? 'none' : ''
    const title = tab ? this.titleOf(tab) : ''
    this.header.update({ kind, path: tab?.path ?? '', title, mode: this.activeMode(), canBack: this.history.canStep(-1), canForward: this.history.canStep(1) })
    if (!reading) this.inlineTitle.show(kind === 'note' ? title : null, this.view.scrollDOM)
  }
}
