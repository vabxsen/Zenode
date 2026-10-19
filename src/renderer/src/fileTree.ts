import type { TreeEntry } from '../../shared/api'
import { Component, el } from './component'
import { icon, type IconName } from './icons'
import { showMenu, type MenuItem } from './menu'
import { parentDir } from './paths'
import { isSortMode, SORT_MODES, sortTree, type SortMode } from './treeSort'

export interface FileTreeHandlers {
  onOpen(entry: TreeEntry): void
  onNewNote(dir: string): void
  onNewFolder(dir: string): void
  onNewCanvas(dir: string): void
  onRename(entry: TreeEntry, newName: string): Promise<void>
  // One or more entries (the selection).
  onDelete(entries: TreeEntry[]): void
  // Move entries into a folder ('' = vault root).
  onMove(paths: string[], destDir: string): void
  // Ask where to move entries (folder picker).
  onMoveTo(paths: string[]): void
  onReveal(path: string): void
  onHistory(path: string): void
  isBookmarked(path: string): boolean
  onToggleBookmark(path: string): void
}

const INDENT = 14
// Every row is this tall (see .zn-tree-row), which lets long trees draw only
// the rows in view.
const ROW_HEIGHT = 28
// Trees up to this many visible rows are drawn whole.
const VIRTUAL_FROM = 300
const OVERSCAN = 20
const SORT_KEY = 'zenode.fileSort'
// Tree entries being dragged (their paths, as JSON).
const PATHS_DRAG_TYPE = 'application/x-zenode-paths'

export { parentDir }

// Notes and canvases show without their extension.
export function displayName(entry: TreeEntry): string {
  if (entry.kind !== 'file') return entry.name
  if (entry.ext === 'md') return entry.name.slice(0, -3)
  if (entry.ext === 'canvas') return entry.name.slice(0, -7)
  return entry.name
}

const FIRST_CLASS = new Set(['md', 'canvas'])
const IMAGE = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'])

// What a dragged file becomes when dropped into a note: a link, or an embed for images.
function dragLink(entry: TreeEntry): string {
  if (entry.kind === 'folder') return entry.path
  const target = entry.ext === 'md' ? displayName(entry) : entry.name
  return IMAGE.has(entry.ext) ? `![[${target}]]` : `[[${target}]]`
}

function loadSort(): SortMode {
  try {
    const saved = localStorage.getItem(SORT_KEY)
    return isSortMode(saved) ? saved : 'name-asc'
  } catch {
    return 'name-asc'
  }
}

export class FileTree extends Component {
  private tree: TreeEntry[] = []
  private sorted: TreeEntry[] = []
  private sort: SortMode = loadSort()
  private expanded = new Set<string>()
  private active: string | null = null
  private selected = new Set<string>()
  // Where a Shift+click range starts.
  private anchor: string | null = null
  // Paths in the order shown (for Shift+click ranges).
  private visible: string[] = []
  private renaming: string | null = null
  // The live rename box. A re-render (e.g. from the file watcher) silently
  // discards it and keeps what the user typed, instead of committing.
  private renameInput: { el: HTMLInputElement; discard(): void } | null = null
  private renameDraft: { value: string; start: number; end: number } | null = null
  private readonly listEl: HTMLElement
  private readonly scrollEl: HTMLElement
  // Rows in display order (expanded folders' children included).
  private rows: Array<{ entry: TreeEntry; depth: number }> = []
  private windowFrame: number | null = null
  // The row that takes keyboard focus (one row is tabbable at a time).
  private focusPath: string | null = null

  constructor(
    private readonly container: HTMLElement,
    title: string,
    private readonly handlers: FileTreeHandlers
  ) {
    super()
    const header = el('div', 'zn-sidebar-header', container)
    el('div', 'zn-sidebar-title', header, title)
    const tools = el('div', 'zn-tree-tools', header)
    const tool = (name: IconName, label: string, action: (e: MouseEvent) => void): void => {
      const b = el('button', 'zn-tree-tool', tools)
      b.title = label
      b.setAttribute('aria-label', label)
      b.appendChild(icon(name, 15))
      b.addEventListener('click', action)
    }
    tool('filePlus', 'New note', () => this.handlers.onNewNote(''))
    tool('folderPlus', 'New folder', () => this.handlers.onNewFolder(''))
    tool('sort', 'Change sort order', (e) => this.sortMenu(e))
    tool('collapse', 'Collapse all', () => this.collapseAll())
    this.scrollEl = el('div', 'zn-sidebar-tree', container)
    this.listEl = el('div', 'zn-tree', this.scrollEl)
    this.listEl.setAttribute('role', 'tree')
    this.listEl.setAttribute('aria-label', 'Files')
    this.listEl.setAttribute('aria-multiselectable', 'true')
  }

  onload(): void {
    this.registerDomEvent(this.container, 'contextmenu', (e) => {
      if ((e.target as HTMLElement).closest('.zn-tree-row, .zn-sidebar-header')) return
      e.preventDefault()
      showMenu(e.clientX, e.clientY, [
        { label: 'New note', action: () => this.handlers.onNewNote('') },
        { label: 'New folder', action: () => this.handlers.onNewFolder('') },
        { label: 'New canvas', action: () => this.handlers.onNewCanvas('') }
      ])
    })
    // Dropping on empty space below the tree moves to the vault root.
    this.registerDomEvent(this.listEl, 'dragover', (e) => this.onDragOver(e, ''))
    this.registerDomEvent(this.listEl, 'dragleave', () => this.clearDropTarget())
    this.registerDomEvent(this.listEl, 'drop', (e) => this.onDrop(e, ''))
    this.registerDomEvent(this.listEl, 'keydown', (e) => this.onTreeKey(e))
    // Long trees redraw the rows in view as you scroll or resize.
    this.registerDomEvent(this.scrollEl, 'scroll', () => this.drawWindowSoon())
    const resize = new ResizeObserver(() => this.drawWindowSoon())
    resize.observe(this.scrollEl)
    this.register(() => resize.disconnect())
  }

  private get isVirtual(): boolean {
    return this.rows.length > VIRTUAL_FROM
  }

  private drawWindowSoon(): void {
    if (!this.isVirtual || this.windowFrame !== null) return
    this.windowFrame = requestAnimationFrame(() => {
      this.windowFrame = null
      this.drawRows()
    })
  }

  // Scrolls a long tree so the row for `path` is drawn (short trees are all drawn).
  private scrollToRow(path: string): void {
    const i = this.rows.findIndex((r) => r.entry.path === path)
    if (i === -1 || !this.isVirtual) return
    const top = i * ROW_HEIGHT
    const view = this.scrollEl.clientHeight
    if (top < this.scrollEl.scrollTop || top + ROW_HEIGHT > this.scrollEl.scrollTop + view) {
      this.scrollEl.scrollTop = Math.max(0, top - view / 2)
    }
    this.drawRows()
  }

  setTree(tree: TreeEntry[]): void {
    this.tree = tree
    this.sorted = sortTree(tree, this.sort)
    const all = new Set<string>()
    const walk = (entries: TreeEntry[]): void => {
      for (const e of entries) {
        all.add(e.path)
        if (e.children) walk(e.children)
      }
    }
    walk(tree)
    for (const p of this.selected) if (!all.has(p)) this.selected.delete(p)
    this.render()
  }

  setActive(path: string | null): void {
    this.active = path
    if (path) this.expandParents(path)
    this.render()
  }

  // Shows a path: expands its folders and scrolls it into view.
  reveal(path: string): void {
    this.setActive(path)
    this.scrollToRow(path)
    this.listEl.querySelector<HTMLElement>(`[data-path="${CSS.escape(path)}"]`)?.scrollIntoView({ block: 'nearest' })
  }

  collapseAll(): void {
    this.expanded.clear()
    this.render()
  }

  startRename(path: string): void {
    this.expandParents(path)
    this.renaming = path
    this.render()
    this.scrollToRow(path)
  }

  // Keep folder expansion in sync when a folder is renamed or moved.
  renamePath(from: string, to: string): void {
    const next = new Set<string>()
    for (const p of this.expanded) {
      next.add(p === from ? to : p.startsWith(`${from}/`) ? to + p.slice(from.length) : p)
    }
    this.expanded = next
  }

  private expandParents(path: string): void {
    let dir = parentDir(path)
    while (dir) {
      this.expanded.add(dir)
      dir = parentDir(dir)
    }
  }

  private sortMenu(e: MouseEvent): void {
    showMenu(
      e.clientX,
      e.clientY,
      SORT_MODES.map(({ mode, label }) => ({
        label: `${mode === this.sort ? '✓ ' : ''}${label}`,
        action: () => {
          this.sort = mode
          try {
            localStorage.setItem(SORT_KEY, mode)
          } catch {
            // The order just won't be remembered.
          }
          this.setTree(this.tree)
        }
      }))
    )
  }

  render(): void {
    this.rows = []
    const walk = (entries: TreeEntry[], depth: number): void => {
      for (const entry of entries) {
        this.rows.push({ entry, depth })
        if (entry.kind === 'folder' && this.expanded.has(entry.path) && entry.children) walk(entry.children, depth + 1)
      }
    }
    walk(this.sorted, 0)
    this.visible = this.rows.map((r) => r.entry.path)
    this.drawRows()
  }

  // Draws every row, or for a long tree just the rows in view inside a list as tall as all of them.
  private drawRows(): void {
    if (this.renameInput) {
      // Leaving the view: keep what was typed for when the row comes back.
      const { value, selectionStart, selectionEnd } = this.renameInput.el
      this.renameDraft = { value, start: selectionStart ?? value.length, end: selectionEnd ?? value.length }
      this.renameInput.discard()
      this.renameInput = null
    }
    // Measure and size before emptying: reading the scroll position of an
    // emptied list would make the browser clamp it, jumping back to the top.
    let from = 0
    let to = this.rows.length
    if (this.isVirtual) {
      const top = this.scrollEl.scrollTop
      const view = this.scrollEl.clientHeight
      this.listEl.style.height = `${this.rows.length * ROW_HEIGHT}px`
      from = Math.max(0, Math.min(this.rows.length - 1, Math.floor(top / ROW_HEIGHT) - OVERSCAN))
      to = Math.min(this.rows.length, from + Math.ceil(view / ROW_HEIGHT) + 2 * OVERSCAN)
      this.listEl.style.paddingTop = `${from * ROW_HEIGHT}px`
    } else {
      this.listEl.style.height = ''
      this.listEl.style.paddingTop = ''
    }
    // Keep focus on the row that has it, however it got there (keys, click, Tab).
    // Read it before emptying the list, which takes focus away. (The rename box
    // takes its own focus back.)
    const active = document.activeElement
    const focused = active instanceof HTMLElement && active.classList.contains('zn-tree-row') ? active : null
    const hadFocus = !!focused && this.listEl.contains(focused)
    if (hadFocus && focused.dataset.path) this.focusPath = focused.dataset.path
    this.listEl.empty()
    if (this.rows.length === 0) {
      el('div', 'zn-tree-empty', this.listEl, 'No notes yet. Press Ctrl+N to create one.')
      return
    }
    if (!this.focusPath || !this.rows.some((r) => r.entry.path === this.focusPath)) this.focusPath = this.active ?? this.rows[0].entry.path
    for (let i = from; i < to; i++) this.renderRow(this.rows[i].entry, this.rows[i].depth)
    if (hadFocus) this.rowEl(this.focusPath)?.focus({ preventScroll: true })
  }

  private renderRow(entry: TreeEntry, depth: number): void {
    const isFolder = entry.kind === 'folder'
    const row = el('div', 'zn-tree-row', this.listEl)
    row.style.paddingLeft = `${8 + depth * INDENT}px`
    row.dataset.path = entry.path
    row.setAttribute('role', 'treeitem')
    row.setAttribute('aria-level', String(depth + 1))
    row.setAttribute('aria-selected', String(this.selected.has(entry.path)))
    row.tabIndex = entry.path === this.focusPath ? 0 : -1
    if (isFolder) row.setAttribute('aria-expanded', String(this.expanded.has(entry.path)))
    if (entry.path === this.active) row.classList.add('is-active')
    if (this.selected.has(entry.path)) row.classList.add('is-selected')
    if (!isFolder && !FIRST_CLASS.has(entry.ext)) row.classList.add('is-other')

    const twisty = el('span', 'zn-tree-twisty', row)
    if (isFolder) {
      twisty.appendChild(icon('chevron', 14))
      if (this.expanded.has(entry.path)) twisty.classList.add('is-open')
    }

    if (this.renaming === entry.path) {
      this.renderRenameInput(row, entry)
    } else {
      el('span', 'zn-tree-label', row, displayName(entry))
      if (!isFolder && entry.ext && entry.ext !== 'md') el('span', 'zn-tree-ext', row, entry.ext)
    }

    row.addEventListener('click', (e) => this.onRowClick(e, entry))
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      if (!this.selected.has(entry.path)) this.selectOnly(entry.path)
      this.rowMenu(entry, e.clientX, e.clientY)
    })
    // Drag to move (onto folders), or into a note to link it.
    row.draggable = this.renaming !== entry.path
    row.addEventListener('dragstart', (e) => {
      const paths = this.selected.has(entry.path) ? [...this.selected] : [entry.path]
      e.dataTransfer?.setData(PATHS_DRAG_TYPE, JSON.stringify(paths))
      e.dataTransfer?.setData('text/plain', paths.map((p) => dragLink(this.find(p) ?? entry)).join('\n'))
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copyMove'
    })
    const dropDir = isFolder ? entry.path : parentDir(entry.path)
    row.addEventListener('dragover', (e) => this.onDragOver(e, dropDir))
    row.addEventListener('drop', (e) => this.onDrop(e, dropDir))
  }

  // ---------- Selection ----------

  private selectOnly(path: string): void {
    this.selected = new Set([path])
    this.anchor = path
    this.render()
  }

  private rowEl(path: string | null): HTMLElement | null {
    return path ? this.listEl.querySelector<HTMLElement>(`[data-path="${CSS.escape(path)}"]`) : null
  }

  // Moves keyboard focus to a row (drawing it first in a long tree).
  private focusRow(path: string): void {
    this.focusPath = path
    this.scrollToRow(path)
    this.listEl.querySelectorAll<HTMLElement>('.zn-tree-row').forEach((r) => (r.tabIndex = r.dataset.path === path ? 0 : -1))
    const row = this.rowEl(path)
    row?.focus()
    row?.scrollIntoView({ block: 'nearest' })
  }

  // Arrow keys move, Right/Left open and close folders, Enter opens, F2 renames, Delete deletes.
  private onTreeKey(e: KeyboardEvent): void {
    const row = (e.target as HTMLElement).closest<HTMLElement>('.zn-tree-row')
    if (!row || (e.target as HTMLElement).closest('.zn-tree-rename')) return
    const i = this.rows.findIndex((r) => r.entry.path === row.dataset.path)
    if (i === -1) return
    const { entry, depth } = this.rows[i]
    const isFolder = entry.kind === 'folder'
    const go = (j: number): void => {
      if (j >= 0 && j < this.rows.length) this.focusRow(this.rows[j].entry.path)
    }
    switch (e.key) {
      case 'ArrowDown':
        go(i + 1)
        break
      case 'ArrowUp':
        go(i - 1)
        break
      case 'Home':
        go(0)
        break
      case 'End':
        go(this.rows.length - 1)
        break
      case 'ArrowRight':
        if (isFolder && !this.expanded.has(entry.path)) {
          this.expanded.add(entry.path)
          this.render()
          this.focusRow(entry.path)
        } else if (isFolder) go(i + 1)
        break
      case 'ArrowLeft':
        if (isFolder && this.expanded.has(entry.path)) {
          this.expanded.delete(entry.path)
          this.render()
          this.focusRow(entry.path)
        } else if (depth > 0) {
          const parent = parentDir(entry.path)
          if (parent) this.focusRow(parent)
        }
        break
      case 'Enter':
        this.focusPath = entry.path
        this.onRowClick(new MouseEvent('click'), entry)
        this.rowEl(entry.path)?.focus()
        break
      case 'F2':
        this.startRename(entry.path)
        break
      case 'Delete': {
        const paths = this.selected.has(entry.path) ? [...this.selected] : [entry.path]
        this.handlers.onDelete(paths.map((p) => this.find(p)).filter((x): x is TreeEntry => !!x))
        break
      }
      default:
        return
    }
    e.preventDefault()
    e.stopPropagation()
  }

  private onRowClick(e: MouseEvent, entry: TreeEntry): void {
    this.focusPath = entry.path
    if (this.renaming === entry.path) return
    if (e.ctrlKey || e.metaKey) {
      // Ctrl+click adds to or removes from the selection without opening.
      if (this.selected.has(entry.path)) this.selected.delete(entry.path)
      else this.selected.add(entry.path)
      this.anchor = entry.path
      this.render()
      return
    }
    if (e.shiftKey && this.anchor) {
      const a = this.visible.indexOf(this.anchor)
      const b = this.visible.indexOf(entry.path)
      if (a !== -1 && b !== -1) {
        this.selected = new Set(this.visible.slice(Math.min(a, b), Math.max(a, b) + 1))
        this.render()
        return
      }
    }
    this.selected = new Set([entry.path])
    this.anchor = entry.path
    if (entry.kind === 'folder') {
      if (this.expanded.has(entry.path)) this.expanded.delete(entry.path)
      else this.expanded.add(entry.path)
      this.render()
    } else {
      this.render()
      this.handlers.onOpen(entry)
    }
  }

  private find(path: string, entries: TreeEntry[] = this.tree): TreeEntry | null {
    for (const e of entries) {
      if (e.path === path) return e
      if (e.children) {
        const hit = this.find(path, e.children)
        if (hit) return hit
      }
    }
    return null
  }

  private rowMenu(entry: TreeEntry, x: number, y: number): void {
    const paths = [...this.selected]
    if (paths.length > 1) {
      const entries = paths.map((p) => this.find(p)).filter((e): e is TreeEntry => !!e)
      showMenu(x, y, [
        { label: `Move ${paths.length} items to…`, action: () => this.handlers.onMoveTo(paths) },
        { label: 'Copy paths', action: () => void navigator.clipboard.writeText(paths.join('\n')) },
        'separator',
        { label: `Delete ${paths.length} items`, danger: true, action: () => this.handlers.onDelete(entries) }
      ])
      return
    }
    const isFolder = entry.kind === 'folder'
    const dir = isFolder ? entry.path : parentDir(entry.path)
    const items: Array<MenuItem | 'separator'> = [
      ...(isFolder ? [] : [{ label: 'Open', action: () => this.handlers.onOpen(entry) }]),
      { label: 'New note', action: () => this.handlers.onNewNote(dir) },
      { label: 'New folder', action: () => this.handlers.onNewFolder(dir) },
      { label: 'New canvas', action: () => this.handlers.onNewCanvas(dir) },
      'separator',
      { label: 'Rename', action: () => this.startRename(entry.path) },
      { label: 'Move to…', action: () => this.handlers.onMoveTo([entry.path]) },
      { label: 'Copy path', action: () => void navigator.clipboard.writeText(entry.path) },
      { label: 'Show in Explorer', action: () => this.handlers.onReveal(entry.path) },
      ...(isFolder
        ? []
        : [
            { label: 'Show file history', action: () => this.handlers.onHistory(entry.path) },
            {
              label: this.handlers.isBookmarked(entry.path) ? 'Remove bookmark' : 'Bookmark',
              action: () => this.handlers.onToggleBookmark(entry.path)
            }
          ]),
      'separator',
      { label: 'Delete', danger: true, action: () => this.handlers.onDelete([entry]) }
    ]
    showMenu(x, y, items)
  }

  // ---------- Drag and drop ----------

  private draggedPaths(e: DragEvent): string[] | null {
    if (!e.dataTransfer?.types.includes(PATHS_DRAG_TYPE)) return null
    try {
      const paths = JSON.parse(e.dataTransfer.getData(PATHS_DRAG_TYPE)) as unknown
      return Array.isArray(paths) ? paths.filter((p): p is string => typeof p === 'string') : null
    } catch {
      return null
    }
  }

  private onDragOver(e: DragEvent, dir: string): void {
    if (!e.dataTransfer?.types.includes(PATHS_DRAG_TYPE)) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    this.clearDropTarget()
    const target = dir ? this.listEl.querySelector(`[data-path="${CSS.escape(dir)}"]`) : this.listEl
    target?.classList.add('is-drop-target')
  }

  private clearDropTarget(): void {
    for (const t of this.container.querySelectorAll('.is-drop-target')) t.classList.remove('is-drop-target')
  }

  private onDrop(e: DragEvent, dir: string): void {
    this.clearDropTarget()
    const paths = this.draggedPaths(e)
    if (!paths) return
    e.preventDefault()
    e.stopPropagation()
    // Skip items already in that folder, and a folder dropped onto itself or inside itself.
    const moving = paths.filter((p) => parentDir(p) !== dir && p !== dir && !dir.startsWith(`${p}/`))
    if (moving.length) this.handlers.onMove(moving, dir)
  }

  // ---------- Renaming ----------

  private renderRenameInput(row: HTMLElement, entry: TreeEntry): void {
    const input = el('input', 'zn-tree-rename', row)
    // Notes and canvases are renamed without touching their extension.
    const ext = entry.kind === 'file' && FIRST_CLASS.has(entry.ext) ? `.${entry.ext}` : ''
    const keepExt = ext !== ''
    const draft = this.renameDraft
    input.value = draft ? draft.value : keepExt ? entry.name.slice(0, -ext.length) : entry.name
    let done = false
    this.renameInput = { el: input, discard: () => (done = true) }
    const finish = async (commit: boolean): Promise<void> => {
      if (done) return
      done = true
      this.renaming = null
      this.renameInput = null
      this.renameDraft = null
      const value = input.value.trim()
      const newName = keepExt ? `${value}${ext}` : value
      // A confirmed but unchanged name still goes through (as a no-op rename), so the app can move focus on.
      if (commit && value) {
        await this.handlers.onRename(entry, newName)
      } else {
        this.render()
      }
    }
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void finish(true)
      if (e.key === 'Escape') void finish(false)
      e.stopPropagation()
    })
    input.addEventListener('blur', () => void finish(true))
    input.addEventListener('click', (e) => e.stopPropagation())
    const place = (): void => {
      if (done) return
      input.focus()
      if (draft) {
        input.setSelectionRange(draft.start, draft.end)
      } else {
        const dot = keepExt ? input.value.length : input.value.lastIndexOf('.')
        input.setSelectionRange(0, dot > 0 ? dot : input.value.length)
      }
    }
    // A redraw while typing: take focus back in the same task, so no keystroke
    // lands between the old box going and the new one appearing.
    if (draft && input.isConnected) place()
    else requestAnimationFrame(place)
  }
}
