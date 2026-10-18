import { EditorSelection, type EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import type { WorkspaceState } from '../../shared/api'
import { contentHash } from '../../shared/hash'
import { Component, el } from './component'
import { hideConflictBar, openCompareDialog, renderConflictBar } from './conflictUi'
import { openDialog } from './dialog'
import { createEditorState, fromDisk, spellcheckAttrs, spellcheckSetting } from './editor/editor'
import type { LinkTarget } from './editor/linkCompletion'
import { linksChanged, setSourceMode } from './editor/livePreview'
import { icon } from './icons'
import { renderInto, type ReadingContext } from './render/reading'

const SAVE_DELAY = 600
// Unsaved text still unsaved after this long goes to the crash-recovery journal
// (continuous typing keeps postponing autosave, so this bounds what a crash can lose).
const JOURNAL_DELAY = 1500

// A non-note tab (e.g. the graph). The workspace mounts `el` and shows/hides it.
export interface WorkspaceView {
  readonly id: string
  readonly title: string
  readonly el: HTMLElement
  show(): void
  hide(): void
  destroy(): void
  // File-backed views (e.g. a canvas) follow renames, save and reload like notes.
  readonly filePath?: string
  setPath?(path: string): void
  save?(): Promise<void>
  reloadFromDisk?(): Promise<void>
  // The file was deleted: close without writing it back.
  discard?(): void
  // While the view's unsaved content conflicts with the file on disk: that content.
  conflictText?(): string | null
}

interface Tab {
  path: string
  kind: 'note' | 'view'
  state: EditorState | null
  view: WorkspaceView | null
  // The file's content as last read from or written to disk.
  lastSaved: string
  dirty: boolean
  timer: number | null
  // The file changed on disk (disk: new content) or vanished (disk: null) while
  // this tab had unsaved edits. Autosave pauses until the user picks a version.
  conflict: { disk: string | null } | null
  // The save in flight, so a change notification for our own write waits for it.
  saving: Promise<void> | null
  // Crash recovery: pending journal write, and whether an entry exists for this tab.
  journalTimer: number | null
  journaled: boolean
  // Reading view (rendered, read-only) and Source mode (plain Markdown) for note tabs.
  reading: boolean
  source: boolean
}

export const VIEW_PREFIX = 'zenode:'

export interface OpenPosition {
  from: number
  to?: number
}

export interface WorkspaceHost {
  // `path` is the active note (null for view tabs); `title` is what the tab shows.
  onActiveChange(path: string | null, title: string): void
  onOpenLink(href: string, fromPath: string): void
  onOpenWikiLink(target: string, fromPath: string): void
  onOpenTag(tag: string): void
  isResolved(link: string, fromPath: string): boolean
  linkTargets(fromPath: string): LinkTarget[]
  onSaved(path: string, content: string): void
  onStats(words: number, chars: number): void
  onLayoutChange(): void
  onError(message: string): void
  // Text about to be thrown away (the user chose another version): keep a copy.
  preserve(path: string, text: string): void
  // Saves pasted/dropped files for the note at notePath; returns the links to insert.
  importFiles(notePath: string, files: File[]): Promise<string>
  // Links, embeds and clicks for a note shown in Reading view.
  readingContext(path: string): Omit<ReadingContext, 'sourcePath' | 'onToggleTask'>
}

// Notes bigger than this (in characters) ask before opening: the live editor
// gets slow on multi-megabyte files, and they're often logs or exports.
const LARGE_NOTE = 5_000_000

async function confirmLargeNote(path: string, length: number): Promise<boolean> {
  const mb = (length / 1_000_000).toFixed(1)
  return openDialog({
    title: 'Open a very large note?',
    body: `"${noteTitle(path)}" is about ${mb} million characters. Editing it in Zenode may be slow. It won't be changed unless you edit it.`,
    buttons: [
      { label: 'Cancel', value: false },
      { label: 'Open anyway', value: true, primary: true }
    ],
    cancelValue: false
  })
}

export function noteTitle(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1)
  return name.toLowerCase().endsWith('.md') ? name.slice(0, -3) : name
}

export class Workspace extends Component {
  private tabs: Tab[] = []
  private active: Tab | null = null
  private readonly view: EditorView
  private readonly tabbarEl: HTMLElement
  private readonly conflictEl: HTMLElement
  private readonly editorEl: HTMLElement
  private readonly readingEl: HTMLElement
  private defaultView: 'live' | 'source' | 'reading' = 'live'
  private readonly viewsEl: HTMLElement
  private readonly emptyEl: HTMLElement
  private statsTimer: number | null = null

  constructor(
    container: HTMLElement,
    private readonly host: WorkspaceHost
  ) {
    super()
    this.tabbarEl = el('div', 'zn-tabbar', container)
    this.conflictEl = el('div', 'zn-conflict', container)
    this.conflictEl.style.display = 'none'
    this.editorEl = el('div', 'zn-editor', container)
    this.readingEl = el('div', 'zn-reading', container)
    this.readingEl.tabIndex = -1
    this.viewsEl = el('div', 'zn-views', container)
    this.emptyEl = el('div', 'zn-empty', container)
    const inner = el('div', 'zn-empty-inner', this.emptyEl)
    inner.appendChild(icon('note', 40))
    el('div', 'zn-empty-title', inner, 'No note open')
    el('div', 'zn-empty-hint', inner, 'Pick a note on the left, or press Ctrl+N to start a new one.')
    this.view = new EditorView({ parent: this.editorEl })
    this.render()
  }

  onunload(): void {
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
    this.readingEl.scrollTop = top
  }

  // A task checkbox clicked in Reading view: flip "[ ]" / "[x]" on that line.
  private toggleTask(tab: Tab, line: number, checked: boolean): void {
    const state = tab === this.active ? this.view.state : tab.state!
    if (line < 0 || line >= state.doc.lines) return
    const text = state.doc.line(line + 1)
    const m = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])\]/.exec(text.text)
    if (!m) return
    const at = text.from + m[1].length
    const spec = { changes: { from: at, to: at + 1, insert: checked ? 'x' : ' ' } }
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
    const tab: Tab = { path: view.id, kind: 'view', state: null, view, lastSaved: '', dirty: false, timer: null, conflict: null, saving: null, journalTimer: null, journaled: false, reading: false, source: false }
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
    const tab: Tab = { path, kind: 'note', state: null, view: null, lastSaved: content, dirty: false, timer: null, conflict: null, saving: null, journalTimer: null, journaled: false, reading: false, source: false }
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

  private scheduleJournal(tab: Tab): void {
    if (tab.journalTimer !== null) window.clearTimeout(tab.journalTimer)
    tab.journalTimer = window.setTimeout(() => this.journal(tab), JOURNAL_DELAY)
  }

  private journal(tab: Tab): void {
    if (tab.journalTimer !== null) window.clearTimeout(tab.journalTimer)
    tab.journalTimer = null
    if (!this.tabs.includes(tab) || tab.kind !== 'note') return
    const text = this.docOf(tab)
    if (text === tab.lastSaved) return
    tab.journaled = true
    window.zenode.journalPut(tab.path, text, contentHash(tab.lastSaved)).catch((e: Error) => this.host.onError(`Could not keep a recovery copy: ${e.message}`))
  }

  private unjournal(tab: Tab): void {
    if (tab.journalTimer !== null) window.clearTimeout(tab.journalTimer)
    tab.journalTimer = null
    if (!tab.journaled) return
    tab.journaled = false
    void window.zenode.journalRemove(tab.path).catch(() => undefined)
  }

  // Select a range in the active note and scroll it to the middle of the view.
  private reveal(pos: OpenPosition): void {
    if (this.active?.kind !== 'note') return
    const len = this.view.state.doc.length
    const from = Math.min(pos.from, len)
    const to = Math.min(pos.to ?? pos.from, len)
    this.view.dispatch({
      selection: EditorSelection.range(from, to),
      effects: EditorView.scrollIntoView(from, { y: 'center' })
    })
    requestAnimationFrame(() => this.view.focus())
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
    if (tab.kind === 'note') this.view.setState(tab.state!)
    this.render()
    if (tab.kind === 'view') tab.view!.show()
    if (tab.reading) void this.renderReading(tab)
    this.updateStats()
    this.host.onActiveChange(this.activePath, this.titleOf(tab))
    this.host.onLayoutChange()
    if (tab.kind === 'note') requestAnimationFrame(() => this.focus())
  }

  private titleOf(tab: Tab): string {
    return tab.view ? tab.view.title : noteTitle(tab.path)
  }

  async close(tab: Tab | null = this.active): Promise<void> {
    if (!tab) return
    if (tab.conflict || (tab.view?.conflictText?.() ?? null) !== null) {
      // Closing would silently drop the user's version; make them choose first.
      this.activate(tab)
      this.host.onError(`"${this.titleOf(tab)}" has unsaved changes that conflict with the file on disk. Choose a version first.`)
      return
    }
    await this.save(tab)
    this.dispose(tab)
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
    this.scheduleJournal(tab)
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
      this.unjournal(tab)
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
    this.unjournal(tab)
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
    this.unjournal(tab)
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
        this.unjournal(tab)
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

  serialize(): WorkspaceState {
    return { openFiles: this.tabs.map((t) => t.path), activeFile: this.active?.path ?? null }
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

  private render(): void {
    this.tabbarEl.empty()
    for (const tab of this.tabs) {
      const tabEl = el('div', 'zn-tab', this.tabbarEl)
      if (tab === this.active) tabEl.classList.add('is-active')
      if (tab.dirty) tabEl.classList.add('is-dirty')
      if (tab.conflict) tabEl.classList.add('has-conflict')
      if (tab.kind === 'view') tabEl.classList.add('is-view')
      el('span', 'zn-tab-title', tabEl, this.titleOf(tab))
      tabEl.title = tab.kind === 'view' ? this.titleOf(tab) : tab.path
      const closeBtn = el('span', 'zn-tab-close', tabEl)
      closeBtn.appendChild(icon('close', 12))
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        void this.close(tab)
      })
      tabEl.addEventListener('mousedown', (e) => {
        if (e.button === 1) {
          e.preventDefault()
          void this.close(tab)
        }
      })
      tabEl.addEventListener('click', () => this.activate(tab))
    }
    this.renderConflict()
    const kind = this.active?.kind
    const reading = kind === 'note' && this.active!.reading
    this.editorEl.style.display = kind === 'note' && !reading ? '' : 'none'
    this.readingEl.style.display = reading ? '' : 'none'
    this.viewsEl.style.display = kind === 'view' ? '' : 'none'
    this.emptyEl.style.display = kind ? 'none' : ''
    this.tabbarEl.classList.toggle('is-empty', this.tabs.length === 0)
  }
}
