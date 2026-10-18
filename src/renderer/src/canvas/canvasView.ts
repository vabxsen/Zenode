import { EditorView } from '@codemirror/view'
import { Component, el } from '../component'
import type { EditorCallbacks } from '../editor/editor'
import { icon, type IconName } from '../icons'
import { baseName, isMarkdown } from '../paths'
import type { WorkspaceView } from '../workspace'
import { CanvasCamera } from './camera'
import { CanvasDocument, snap } from './canvasDocument'
import { contentKey, createNodeView, updateCardContent, type CardContext, type NodeView } from './cardContent'
import { nearestSide, renderEdges, renderTempEdge } from './edgeLayer'
import {
  colorOf,
  intersects,
  isFile,
  isGroup,
  isLink,
  isText,
  parseCanvas,
  PRESET_COLORS,
  serializeCanvas,
  stackOrder,
  type Point,
  type Rect,
  type Side
} from './model'

export interface CanvasHost {
  editorCallbacks(sourcePath: string): Omit<EditorCallbacks, 'onChange'>
  openPath(path: string): void
  openUrl(url: string): void
  resolve(link: string, from: string): string | null
  noteContent(path: string): string | null
  pickNote(onPick: (path: string) => void): void
  notice(message: string): void
  onSaved(path: string, content: string): void
  // Called when the tab closes, so the owner can unload the view.
  release(view: CanvasView): void
}

const SAVE_DELAY = 500
const MIN_W = 60
const MIN_H = 40
// Cards further than this (in screen pixels) outside the view are hidden.
const CULL_MARGIN = 300
// A drag shorter than this (screen pixels) from a port is a click, not a connection.
const CONNECT_MIN_DRAG = 20
const ZOOM_STEP = 1.25

type Interaction =
  | { kind: 'pan'; x: number; y: number }
  | { kind: 'move'; start: Point; origin: Map<string, Point>; before: string; moved: boolean }
  | { kind: 'resize'; id: string; start: Point; rect: Rect; before: string }
  | { kind: 'marquee'; start: Point; additive: Set<string> }
  | { kind: 'connect'; from: string; side: Side; start: Point }

// Error marker for a view whose file was deleted: it must never load or save again.
const DISCARDED = 'discarded'

export class CanvasView extends Component implements WorkspaceView {
  readonly el: HTMLElement
  private path: string
  private readonly doc = new CanvasDocument()
  private lastSaved = ''
  private dirty = false
  private saveTimer: number | null = null
  private error: string | null = null
  private readonly viewport: HTMLElement
  private readonly nodesLayer: HTMLElement
  private readonly labelsLayer: HTMLElement
  private readonly edgesG: SVGGElement
  private readonly tempG: SVGGElement
  private readonly selBox: HTMLElement
  private readonly errorEl: HTMLElement
  private readonly colorBar: HTMLElement
  private readonly camera: CanvasCamera
  private views = new Map<string, NodeView>()
  private editing: { id: string; before: string } | null = null
  private interaction: Interaction | null = null
  private spaceDown = false
  private ready = false

  constructor(
    path: string,
    private readonly host: CanvasHost
  ) {
    super()
    this.path = path
    this.el = el('div', 'zn-canvas')
    this.viewport = el('div', 'zn-canvas-viewport', this.el)
    this.viewport.tabIndex = 0
    const world = el('div', 'zn-canvas-world', this.viewport)
    const ns = 'http://www.w3.org/2000/svg'
    const svg = document.createElementNS(ns, 'svg')
    svg.classList.add('zn-canvas-edges')
    this.edgesG = document.createElementNS(ns, 'g')
    this.tempG = document.createElementNS(ns, 'g')
    svg.append(this.edgesG, this.tempG)
    this.nodesLayer = el('div', 'zn-canvas-nodes', world)
    world.insertBefore(svg, this.nodesLayer)
    this.labelsLayer = el('div', 'zn-canvas-labels', world)
    this.selBox = el('div', 'zn-canvas-selbox', this.viewport)
    this.selBox.style.display = 'none'
    this.errorEl = el('div', 'zn-canvas-error', this.el)
    this.errorEl.style.display = 'none'
    this.colorBar = el('div', 'zn-canvas-colors', this.el)
    this.camera = new CanvasCamera(this.viewport, world)
    this.buildToolbar()
  }

  // ---------- WorkspaceView ----------

  get id(): string {
    return this.path
  }

  get filePath(): string {
    return this.path
  }

  get title(): string {
    const name = baseName(this.path)
    return name.toLowerCase().endsWith('.canvas') ? name.slice(0, -7) : name
  }

  show(): void {
    this.el.style.display = ''
    if (!this.ready) void this.loadFromDisk(true)
    else this.applyCamera()
    requestAnimationFrame(() => this.viewport.focus({ preventScroll: true }))
  }

  hide(): void {
    this.stopEditing()
    this.el.style.display = 'none'
  }

  destroy(): void {
    void this.save()
    this.host.release(this)
    this.el.remove()
  }

  setPath(path: string): void {
    this.path = path
  }

  discard(): void {
    this.error = DISCARDED
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer)
  }

  async save(): Promise<void> {
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    if (this.error || !this.ready) return
    const content = serializeCanvas(this.doc.data)
    if (content === this.lastSaved) {
      this.dirty = false
      return
    }
    try {
      await window.zenode.write(this.path, content)
      this.lastSaved = content
      this.dirty = false
      this.host.onSaved(this.path, content)
    } catch (e) {
      this.host.notice(`Could not save ${this.path}: ${(e as Error).message}`)
    }
  }

  // Pick up edits made outside Zenode, unless there are unsaved changes here.
  async reloadFromDisk(): Promise<void> {
    if (this.dirty || this.editing) return
    // A file that failed to parse gets another try once it changes on disk.
    if (!this.ready) {
      if (this.error && this.error !== DISCARDED) await this.loadFromDisk(true)
      return
    }
    await this.loadFromDisk(false)
  }

  // ---------- Lifecycle ----------

  onload(): void {
    const ro = new ResizeObserver(() => this.applyCamera())
    ro.observe(this.viewport)
    this.register(() => ro.disconnect())
    this.bindPointer()
    this.bindKeys()
  }

  onunload(): void {
    for (const view of this.views.values()) view.editor?.destroy()
    this.views.clear()
    this.camera.cancelSave()
  }

  private async loadFromDisk(first: boolean): Promise<void> {
    let text: string
    try {
      text = await window.zenode.read(this.path)
    } catch (e) {
      this.showError(`Could not open ${this.path}: ${(e as Error).message}`)
      return
    }
    // Unchanged since we last read or wrote it; but a file repaired back to that text must clear the error.
    if (!first && text === this.lastSaved && !this.error) return
    try {
      this.doc.load(parseCanvas(text))
      this.error = null
      this.errorEl.style.display = 'none'
      this.el.classList.remove('has-error')
    } catch (e) {
      this.showError(`${(e as Error).message} Zenode will not change this file.`)
      return
    }
    // Remember the file as read, so opening alone never rewrites it.
    this.lastSaved = text
    this.ready = true
    this.renderAll()
    if (first && !this.camera.restore(this.path)) this.camera.fit(this.doc.data.nodes)
    this.applyCamera()
  }

  private showError(message: string): void {
    this.error = message
    this.errorEl.textContent = message
    this.errorEl.style.display = ''
    this.el.classList.add('has-error')
  }

  // ---------- Changes ----------

  // Runs an edit as one undo step, then redraws and schedules a save.
  private edit(change: () => void): void {
    const before = this.doc.snapshot()
    change()
    this.renderAll()
    this.commit(before)
  }

  private commit(before: string): void {
    if (this.doc.commit(before)) this.markDirty()
  }

  private markDirty(): void {
    if (this.error) return
    this.dirty = true
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer)
    this.saveTimer = window.setTimeout(() => void this.save(), SAVE_DELAY)
  }

  private undo(): void {
    if (!this.doc.undo()) return
    this.renderAll()
    this.markDirty()
  }

  private redo(): void {
    if (!this.doc.redo()) return
    this.renderAll()
    this.markDirty()
  }

  // ---------- Camera ----------

  private applyCamera(): void {
    this.camera.apply()
    this.cull()
    this.camera.saveSoon(this.path)
  }

  // Hide cards outside the visible area (with a margin) to keep large canvases fast.
  private cull(): void {
    const view = this.camera.visibleRect(CULL_MARGIN)
    if (!view) return
    for (const n of this.doc.data.nodes) {
      const v = this.views.get(n.id)
      if (v) v.el.style.display = intersects(view, n) || n.id === this.editing?.id ? '' : 'none'
    }
  }

  // ---------- Rendering ----------

  private renderAll(): void {
    this.renderNodes()
    this.renderEdges()
    this.renderColorBar()
    this.cull()
  }

  private renderEdges(): void {
    renderEdges(this.edgesG, this.labelsLayer, this.doc.data, this.doc.selectedEdges)
  }

  private renderNodes(): void {
    const ctx = this.cardContext()
    const seen = new Set<string>()
    stackOrder(this.doc.data.nodes).forEach((n, z) => {
      seen.add(n.id)
      let v = this.views.get(n.id)
      if (!v) {
        v = createNodeView(n)
        this.views.set(n.id, v)
      }
      const s = v.el.style
      s.left = `${n.x}px`
      s.top = `${n.y}px`
      s.width = `${n.width}px`
      s.height = `${n.height}px`
      s.zIndex = String(z + 1)
      const color = colorOf(n.color)
      if (color) s.setProperty('--card-color', color)
      else s.removeProperty('--card-color')
      v.el.classList.toggle('has-color', !!color)
      v.el.classList.toggle('is-selected', this.doc.selected.has(n.id))
      v.el.classList.toggle('is-editing', this.editing?.id === n.id)
      // Stacking comes from z-index; never move an attached card (that would blur an editor).
      if (v.el.parentNode !== this.nodesLayer) this.nodesLayer.appendChild(v.el)
      const key = contentKey(n)
      if (key !== v.key) updateCardContent(n, v, key, ctx)
    })
    for (const [id, v] of this.views) {
      if (!seen.has(id)) {
        v.editor?.destroy()
        v.el.remove()
        this.views.delete(id)
      }
    }
  }

  private cardContext(): CardContext {
    return {
      host: this.host,
      path: this.path,
      onTextChange: (id, v) => {
        const live = this.doc.node(id)
        if (!live || !isText(live) || !v.editor) return
        live.text = v.editor.state.doc.toString()
        v.key = contentKey(live)
        this.markDirty()
      }
    }
  }

  // ---------- Toolbar & color bar ----------

  private buildToolbar(): void {
    const bar = el('div', 'zn-canvas-toolbar', this.el)
    const button = (name: IconName, label: string, action: () => void): void => {
      const b = el('button', 'zn-canvas-btn', bar)
      b.title = label
      b.appendChild(icon(name, 16))
      this.chromeClick(b, action)
    }
    button('filePlus', 'Add card (double-click the canvas)', () => this.addCard(this.camera.cam))
    button('note', 'Add note from vault', () => this.host.pickNote((path) => this.addFile(path)))
    button('folderPlus', 'Group selection', () => this.edit(() => this.doc.groupSelection(this.camera.cam)))
    el('div', 'zn-canvas-sep', bar)
    button('minus', 'Zoom out (Ctrl+scroll)', () => this.zoomCenter(1 / ZOOM_STEP))
    button('fit', 'Zoom to fit', () => {
      this.camera.fit(this.doc.data.nodes)
      this.applyCamera()
    })
    button('plus', 'Zoom in (Ctrl+scroll)', () => this.zoomCenter(ZOOM_STEP))
  }

  // Toolbar buttons never take focus, so canvas shortcuts (undo, delete) keep working after a click.
  private chromeClick(button: HTMLElement, action: () => void): void {
    button.addEventListener('mousedown', (e) => e.preventDefault())
    button.addEventListener('click', () => {
      this.viewport.focus({ preventScroll: true })
      action()
    })
  }

  private zoomCenter(factor: number): void {
    this.camera.zoomCenter(factor)
    this.applyCamera()
  }

  private renderColorBar(): void {
    this.colorBar.replaceChildren()
    const any = this.doc.hasSelection()
    this.colorBar.style.display = any && !this.error ? '' : 'none'
    if (!any) return
    const swatch = (value: string, css: string | null, title: string): void => {
      const b = el('button', 'zn-canvas-swatch', this.colorBar)
      b.title = title
      if (css) b.style.background = css
      else b.classList.add('is-clear')
      this.chromeClick(b, () => this.edit(() => this.doc.setColor(value)))
    }
    swatch('', null, 'No color')
    for (const [k, css] of Object.entries(PRESET_COLORS)) swatch(k, css, `Color ${k}`)
    const del = el('button', 'zn-canvas-btn is-danger', this.colorBar)
    del.title = 'Delete (Del)'
    del.appendChild(icon('close', 14))
    this.chromeClick(del, () => this.deleteSelection())
  }

  // ---------- Operations ----------

  private addCard(at: Point): void {
    let id = ''
    this.edit(() => (id = this.doc.addText(at).id))
    this.startEditing(id)
  }

  private addFile(path: string): void {
    this.edit(() => this.doc.addFile(path, this.camera.cam, isMarkdown(path)))
  }

  private deleteSelection(): void {
    if (!this.doc.hasSelection()) return
    this.edit(() => this.doc.deleteSelection())
  }

  private startEditing(id: string): void {
    const n = this.doc.node(id)
    const v = this.views.get(id)
    if (!n || !isText(n) || !v?.editor || !v.editable || this.error) return
    this.stopEditing()
    this.editing = { id, before: this.doc.snapshot() }
    v.editor.dispatch({ effects: v.editable.reconfigure(EditorView.editable.of(true)) })
    v.el.classList.add('is-editing')
    v.el.style.display = ''
    requestAnimationFrame(() => {
      v.editor?.focus()
      const len = v.editor?.state.doc.length ?? 0
      v.editor?.dispatch({ selection: { anchor: len } })
    })
  }

  private stopEditing(): void {
    if (!this.editing) return
    const { id, before } = this.editing
    this.editing = null
    const v = this.views.get(id)
    if (v?.editor && v.editable) {
      v.editor.dispatch({ effects: v.editable.reconfigure(EditorView.editable.of(false)) })
      v.editor.contentDOM.blur()
    }
    v?.el.classList.remove('is-editing')
    this.commit(before)
    this.viewport.focus({ preventScroll: true })
  }

  // A floating text box over a group or edge label.
  private editLabel(anchorEl: HTMLElement, value: string, apply: (v: string) => void): void {
    const rect = anchorEl.getBoundingClientRect()
    const input = el('input', 'zn-canvas-label-input', document.body)
    input.value = value
    input.style.left = `${rect.left}px`
    input.style.top = `${rect.top}px`
    input.style.minWidth = `${Math.max(rect.width, 160)}px`
    let done = false
    const finish = (commit: boolean): void => {
      if (done) return
      done = true
      const next = input.value.trim()
      input.remove()
      if (commit && next !== value) this.edit(() => apply(next))
      this.viewport.focus({ preventScroll: true })
    }
    input.addEventListener('keydown', (e) => {
      e.stopPropagation()
      if (e.key === 'Enter') finish(true)
      if (e.key === 'Escape') finish(false)
    })
    input.addEventListener('blur', () => finish(true))
    requestAnimationFrame(() => {
      input.focus()
      input.select()
    })
  }

  // ---------- Pointer input ----------

  private bindPointer(): void {
    const vp = this.viewport
    this.registerDomEvent(vp, 'pointerdown', (e) => this.onPointerDown(e))
    this.registerDomEvent(vp, 'pointermove', (e) => this.onPointerMove(e))
    this.registerDomEvent(vp, 'pointerup', (e) => this.onPointerEnd(e))
    this.registerDomEvent(vp, 'pointercancel', (e) => this.onPointerEnd(e))
    this.registerDomEvent(vp, 'dblclick', (e) => this.onDoubleClick(e))
    this.registerDomEvent(vp, 'wheel', (e) => this.onWheel(e), { passive: false })
  }

  private onPointerDown(e: PointerEvent): void {
    const vp = this.viewport
    const doc = this.doc
    const target = e.target as HTMLElement
    const nodeId = target.closest<HTMLElement>('.zn-cnode')?.dataset.id ?? null

    if (this.editing) {
      if (nodeId === this.editing.id && !target.closest('[data-handle],[data-port]')) return
      this.stopEditing()
    }
    if (this.error) return
    vp.focus({ preventScroll: true })
    const world = this.camera.toWorld(e.clientX, e.clientY)

    if (e.button === 1 || (e.button === 0 && this.spaceDown)) {
      e.preventDefault()
      this.interaction = { kind: 'pan', x: e.clientX, y: e.clientY }
    } else if (e.button !== 0) {
      return
    } else if (target.dataset.port && nodeId) {
      e.preventDefault()
      this.interaction = { kind: 'connect', from: nodeId, side: target.dataset.port as Side, start: world }
    } else if (target.dataset.handle === 'resize' && nodeId) {
      e.preventDefault()
      const n = doc.node(nodeId)!
      doc.selectOnly(nodeId)
      this.renderAll()
      this.interaction = { kind: 'resize', id: nodeId, start: world, rect: { x: n.x, y: n.y, width: n.width, height: n.height }, before: doc.snapshot() }
    } else if (target.closest('[data-edge]')) {
      const edgeId = target.closest<HTMLElement | SVGElement>('[data-edge]')!.dataset.edge!
      if (!e.shiftKey) doc.selected.clear()
      if (e.shiftKey && doc.selectedEdges.has(edgeId)) doc.selectedEdges.delete(edgeId)
      else {
        if (!e.shiftKey) doc.selectedEdges.clear()
        doc.selectedEdges.add(edgeId)
      }
      this.renderAll()
      return
    } else if (nodeId) {
      // Let links, tags and checkboxes inside a card work normally.
      if (target.closest('[data-zn-wikilink],[data-zn-href],[data-zn-tag],input')) return
      e.preventDefault()
      if (e.shiftKey && doc.selected.has(nodeId)) {
        doc.selected.delete(nodeId)
        this.renderAll()
        return
      }
      if (!doc.selected.has(nodeId)) {
        if (!e.shiftKey) doc.selected.clear()
        doc.selected.add(nodeId)
      }
      doc.selectedEdges.clear()
      this.renderAll()
      this.interaction = { kind: 'move', start: world, origin: doc.moveSet(), before: doc.snapshot(), moved: false }
    } else {
      e.preventDefault()
      const additive = e.shiftKey ? new Set(doc.selected) : new Set<string>()
      if (!e.shiftKey) {
        doc.clearSelection()
        this.renderAll()
      }
      this.interaction = { kind: 'marquee', start: world, additive }
    }
    vp.setPointerCapture(e.pointerId)
  }

  private onPointerMove(e: PointerEvent): void {
    const it = this.interaction
    if (!it) return
    const world = this.camera.toWorld(e.clientX, e.clientY)
    switch (it.kind) {
      case 'pan':
        this.camera.pan(-(e.clientX - it.x), -(e.clientY - it.y))
        it.x = e.clientX
        it.y = e.clientY
        this.applyCamera()
        break
      case 'move': {
        const dx = world.x - it.start.x
        const dy = world.y - it.start.y
        if (!it.moved && Math.abs(dx) + Math.abs(dy) < 3 / this.camera.cam.scale) return
        it.moved = true
        for (const [id, origin] of it.origin) {
          const n = this.doc.node(id)
          if (!n) continue
          n.x = snap(origin.x + dx)
          n.y = snap(origin.y + dy)
        }
        this.renderNodes()
        this.renderEdges()
        break
      }
      case 'resize': {
        const n = this.doc.node(it.id)
        if (!n) return
        n.width = Math.max(MIN_W, snap(it.rect.width + world.x - it.start.x))
        n.height = Math.max(MIN_H, snap(it.rect.height + world.y - it.start.y))
        this.renderNodes()
        this.renderEdges()
        break
      }
      case 'marquee': {
        const r = normRect(it.start, world)
        const box = this.camera.toViewport(r)
        const s = this.selBox.style
        s.display = ''
        s.left = `${box.x}px`
        s.top = `${box.y}px`
        s.width = `${box.width}px`
        s.height = `${box.height}px`
        this.doc.selected = new Set(it.additive)
        for (const n of this.doc.data.nodes) if (intersects(r, n)) this.doc.selected.add(n.id)
        this.renderNodes()
        break
      }
      case 'connect': {
        const from = this.doc.node(it.from)
        if (from) renderTempEdge(this.tempG, from, it.side, world, this.doc.nodeAt(world, it.from))
        break
      }
    }
  }

  private onPointerEnd(e: PointerEvent): void {
    const it = this.interaction
    this.interaction = null
    if (this.viewport.hasPointerCapture(e.pointerId)) this.viewport.releasePointerCapture(e.pointerId)
    if (!it) return
    if (it.kind === 'move' && it.moved) this.commit(it.before)
    if (it.kind === 'resize') this.commit(it.before)
    if (it.kind === 'marquee') {
      this.selBox.style.display = 'none'
      this.renderAll()
    }
    if (it.kind === 'connect') this.finishConnect(it.from, it.side, it.start, this.camera.toWorld(e.clientX, e.clientY))
  }

  private finishConnect(fromId: string, side: Side, start: Point, world: Point): void {
    this.tempG.replaceChildren()
    const target = this.doc.nodeAt(world, fromId)
    // A click on a port without dragging does nothing; dropping on empty canvas
    // creates a new card there and connects it, like Obsidian.
    if (!target && Math.hypot(world.x - start.x, world.y - start.y) < CONNECT_MIN_DRAG / this.camera.cam.scale) return
    let toId: string | null = null
    this.edit(() => {
      toId = this.doc.connect(fromId, side, target ? { id: target.id, side: nearestSide(target, world) } : { at: world })
    })
    if (!target && toId) {
      this.doc.selectOnly(toId)
      this.renderAll()
      this.startEditing(toId)
    }
  }

  private onDoubleClick(e: MouseEvent): void {
    if (this.error) return
    const target = e.target as HTMLElement
    const edgeEl = target.closest<HTMLElement | SVGElement>('[data-edge]')
    if (edgeEl) {
      const edge = this.doc.data.edges.find((x) => x.id === edgeEl.dataset.edge)
      if (!edge) return
      const labelEl = this.labelsLayer.querySelector<HTMLElement>(`[data-edge="${edge.id}"]`) ?? target
      this.editLabel(labelEl, edge.label ?? '', (v) => {
        if (v) edge.label = v
        else delete edge.label
      })
      return
    }
    const nodeId = target.closest<HTMLElement>('.zn-cnode')?.dataset.id
    const n = nodeId ? this.doc.node(nodeId) : null
    if (!n) {
      this.addCard(this.camera.toWorld(e.clientX, e.clientY))
      return
    }
    if (isText(n)) this.startEditing(n.id)
    else if (isFile(n)) this.host.openPath(this.host.resolve(n.file, this.path) ?? n.file)
    else if (isLink(n)) this.host.openUrl(n.url)
    else if (isGroup(n)) {
      const labelEl = this.views.get(n.id)?.content.querySelector<HTMLElement>('.zn-cgroup-label')
      if (labelEl) this.editLabel(labelEl, n.label ?? '', (v) => (n.label = v))
    }
  }

  private onWheel(e: WheelEvent): void {
    if (this.editing && (e.target as HTMLElement).closest('.zn-cnode.is-editing')) return
    e.preventDefault()
    if (e.ctrlKey) {
      this.camera.zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0025))
    } else {
      this.camera.pan(e.shiftKey ? e.deltaY : e.deltaX, e.shiftKey ? 0 : e.deltaY)
    }
    this.applyCamera()
  }

  // ---------- Keyboard input ----------

  private bindKeys(): void {
    const vp = this.viewport
    this.registerDomEvent(vp, 'keydown', (e) => {
      if (this.editing) {
        if (e.key === 'Escape') {
          e.preventDefault()
          this.stopEditing()
        }
        return
      }
      const mod = e.ctrlKey || e.metaKey
      const key = e.key.toLowerCase()
      if (e.key === ' ' && !this.spaceDown) {
        this.spaceDown = true
        vp.classList.add('is-panning')
        e.preventDefault()
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        this.deleteSelection()
      } else if (mod && key === 'z') {
        e.preventDefault()
        if (e.shiftKey) this.redo()
        else this.undo()
      } else if (mod && key === 'y') {
        e.preventDefault()
        this.redo()
      } else if (mod && key === 'a') {
        e.preventDefault()
        this.doc.selectAll()
        this.renderAll()
      } else if (e.key === 'Escape') {
        this.doc.clearSelection()
        this.renderAll()
      } else if (e.key === 'Enter' && this.doc.selected.size === 1) {
        e.preventDefault()
        this.startEditing([...this.doc.selected][0])
      }
    })
    this.registerDomEvent(vp, 'keyup', (e) => {
      if (e.key === ' ') {
        this.spaceDown = false
        vp.classList.remove('is-panning')
      }
    })
  }
}

function normRect(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) }
}
