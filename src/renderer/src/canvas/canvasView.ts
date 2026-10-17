import { Compartment } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { Component, el } from '../component'
import { createEditorState, fromDisk, type EditorCallbacks } from '../editor/editor'
import { icon, type IconName } from '../icons'
import { baseName, isMarkdown, stripMd } from '../paths'
import { isImage, vaultUrl } from '../vaultUrl'
import type { WorkspaceView } from '../workspace'
import {
  arrowHead,
  bounds,
  contains,
  edgeGeometry,
  stackOrder,
  facingSide,
  intersects,
  isFile,
  isGroup,
  isLink,
  isText,
  KNOWN_TYPES,
  newId,
  parseCanvas,
  serializeCanvas,
  type CanvasData,
  type CanvasEdge,
  type CanvasNode,
  type Point,
  type Rect,
  type Side,
  type TextNode
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

const GRID = 20
const SAVE_DELAY = 500
const HISTORY_LIMIT = 100
const MIN_W = 60
const MIN_H = 40
const SIDES: Side[] = ['top', 'right', 'bottom', 'left']
const PRESET_COLORS: Record<string, string> = {
  '1': '#f87171',
  '2': '#fb923c',
  '3': '#facc15',
  '4': '#4ade80',
  '5': '#22d3ee',
  '6': '#c084fc'
}

const snap = (v: number): number => Math.round(v / GRID) * GRID
const colorOf = (c?: string): string | null => (c ? (PRESET_COLORS[c] ?? c) : null)

interface NodeView {
  el: HTMLElement
  content: HTMLElement
  key: string
  editor?: EditorView
  editable?: Compartment
}

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
  private data: CanvasData = { nodes: [], edges: [] }
  private lastSaved = ''
  private dirty = false
  private saveTimer: number | null = null
  private error: string | null = null
  private readonly viewport: HTMLElement
  private readonly world: HTMLElement
  private readonly nodesLayer: HTMLElement
  private readonly labelsLayer: HTMLElement
  private readonly svg: SVGSVGElement
  private readonly edgesG: SVGGElement
  private readonly tempG: SVGGElement
  private readonly selBox: HTMLElement
  private readonly errorEl: HTMLElement
  private readonly colorBar: HTMLElement
  private cam = { x: 0, y: 0, scale: 1 }
  private views = new Map<string, NodeView>()
  private selected = new Set<string>()
  private selectedEdges = new Set<string>()
  private editing: { id: string; before: string; text: string } | null = null
  private history: string[] = []
  private future: string[] = []
  private interaction: Interaction | null = null
  private spaceDown = false
  private camTimer: number | null = null
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
    this.world = el('div', 'zn-canvas-world', this.viewport)
    const ns = 'http://www.w3.org/2000/svg'
    this.svg = document.createElementNS(ns, 'svg')
    this.svg.classList.add('zn-canvas-edges')
    this.edgesG = document.createElementNS(ns, 'g')
    this.tempG = document.createElementNS(ns, 'g')
    this.svg.append(this.edgesG, this.tempG)
    this.nodesLayer = el('div', 'zn-canvas-nodes', this.world)
    this.world.insertBefore(this.svg, this.nodesLayer)
    this.labelsLayer = el('div', 'zn-canvas-labels', this.world)
    this.selBox = el('div', 'zn-canvas-selbox', this.viewport)
    this.selBox.style.display = 'none'
    this.errorEl = el('div', 'zn-canvas-error', this.el)
    this.errorEl.style.display = 'none'
    this.colorBar = el('div', 'zn-canvas-colors', this.el)
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
    const content = serializeCanvas(this.data)
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
    this.bindEvents()
  }

  onunload(): void {
    for (const view of this.views.values()) view.editor?.destroy()
    this.views.clear()
    if (this.camTimer !== null) window.clearTimeout(this.camTimer)
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
      this.data = parseCanvas(text)
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
    this.prune()
    this.renderAll()
    if (first && !this.restoreCamera()) this.fit()
    this.applyCamera()
  }

  private showError(message: string): void {
    this.error = message
    this.errorEl.textContent = message
    this.errorEl.style.display = ''
    this.el.classList.add('has-error')
  }

  // ---------- Changes & history ----------

  private snapshot(): string {
    return serializeCanvas(this.data)
  }

  private commit(before: string): void {
    if (before === this.snapshot()) return
    this.history.push(before)
    if (this.history.length > HISTORY_LIMIT) this.history.shift()
    this.future = []
    this.markDirty()
  }

  private markDirty(): void {
    if (this.error) return
    this.dirty = true
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer)
    this.saveTimer = window.setTimeout(() => void this.save(), SAVE_DELAY)
  }

  private undo(): void {
    const prev = this.history.pop()
    if (prev === undefined) return
    this.future.push(this.snapshot())
    this.restore(prev)
  }

  private redo(): void {
    const next = this.future.pop()
    if (next === undefined) return
    this.history.push(this.snapshot())
    this.restore(next)
  }

  private restore(text: string): void {
    this.data = parseCanvas(text)
    this.prune()
    this.renderAll()
    this.markDirty()
  }

  // Drop selection entries that no longer exist.
  private prune(): void {
    const ids = new Set(this.data.nodes.map((n) => n.id))
    for (const id of this.selected) if (!ids.has(id)) this.selected.delete(id)
    const edgeIds = new Set(this.data.edges.map((e) => e.id))
    for (const id of this.selectedEdges) if (!edgeIds.has(id)) this.selectedEdges.delete(id)
  }

  private node(id: string): CanvasNode | undefined {
    return this.data.nodes.find((n) => n.id === id)
  }

  // ---------- Camera ----------

  private size(): { w: number; h: number } {
    return { w: this.viewport.clientWidth, h: this.viewport.clientHeight }
  }

  private toWorld(clientX: number, clientY: number): Point {
    const rect = this.viewport.getBoundingClientRect()
    const { w, h } = this.size()
    return {
      x: (clientX - rect.left - w / 2) / this.cam.scale + this.cam.x,
      y: (clientY - rect.top - h / 2) / this.cam.scale + this.cam.y
    }
  }

  private applyCamera(): void {
    const { w, h } = this.size()
    const s = this.cam.scale
    this.world.style.transform = `translate(${w / 2 - this.cam.x * s}px, ${h / 2 - this.cam.y * s}px) scale(${s})`
    const grid = GRID * s
    this.viewport.style.backgroundSize = `${grid}px ${grid}px`
    this.viewport.style.backgroundPosition = `${w / 2 - this.cam.x * s}px ${h / 2 - this.cam.y * s}px`
    this.viewport.classList.toggle('is-zoomed-out', s < 0.35)
    this.cull()
    this.saveCameraSoon()
  }

  private zoomAt(clientX: number, clientY: number, factor: number): void {
    const before = this.toWorld(clientX, clientY)
    this.cam.scale = Math.max(0.1, Math.min(3, this.cam.scale * factor))
    const after = this.toWorld(clientX, clientY)
    this.cam.x += before.x - after.x
    this.cam.y += before.y - after.y
    this.applyCamera()
  }

  private fit(): void {
    const box = bounds(this.data.nodes)
    const { w, h } = this.size()
    if (!box || !w || !h) {
      this.cam = { x: 0, y: 0, scale: 1 }
      return
    }
    const pad = 80
    this.cam = {
      x: box.x + box.width / 2,
      y: box.y + box.height / 2,
      scale: Math.max(0.1, Math.min(1, (w - pad * 2) / box.width, (h - pad * 2) / box.height))
    }
  }

  private cameraKey(): string {
    return `zenode.canvas.view:${this.path}`
  }

  private restoreCamera(): boolean {
    try {
      const raw = localStorage.getItem(this.cameraKey())
      if (!raw) return false
      const c = JSON.parse(raw) as { x: number; y: number; scale: number }
      if ([c.x, c.y, c.scale].every((v) => typeof v === 'number' && Number.isFinite(v))) {
        this.cam = c
        return true
      }
    } catch {
      // Ignore a broken saved camera.
    }
    return false
  }

  private saveCameraSoon(): void {
    if (this.camTimer !== null) window.clearTimeout(this.camTimer)
    this.camTimer = window.setTimeout(() => {
      try {
        localStorage.setItem(this.cameraKey(), JSON.stringify(this.cam))
      } catch {
        // Camera position just won't be remembered.
      }
    }, 400)
  }

  // Hide cards outside the visible area (with a margin) to keep large canvases fast.
  private cull(): void {
    const { w, h } = this.size()
    if (!w) return
    const s = this.cam.scale
    const margin = 300 / s
    const view: Rect = {
      x: this.cam.x - w / 2 / s - margin,
      y: this.cam.y - h / 2 / s - margin,
      width: w / s + margin * 2,
      height: h / s + margin * 2
    }
    for (const n of this.data.nodes) {
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

  private renderNodes(): void {
    const ordered = stackOrder(this.data.nodes)
    const seen = new Set<string>()
    ordered.forEach((n, z) => {
      seen.add(n.id)
      let v = this.views.get(n.id)
      if (!v) {
        v = this.createNodeView(n)
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
      v.el.classList.toggle('is-selected', this.selected.has(n.id))
      v.el.classList.toggle('is-editing', this.editing?.id === n.id)
      // Stacking comes from z-index; never move an attached card (that would blur an editor).
      if (v.el.parentNode !== this.nodesLayer) this.nodesLayer.appendChild(v.el)
      const key = contentKey(n)
      if (key !== v.key) this.updateContent(n, v, key)
    })
    for (const [id, v] of this.views) {
      if (!seen.has(id)) {
        v.editor?.destroy()
        v.el.remove()
        this.views.delete(id)
      }
    }
  }

  private createNodeView(n: CanvasNode): NodeView {
    const kind = KNOWN_TYPES.has(n.type) ? n.type : 'unknown'
    const node = el('div', `zn-cnode zn-cnode-${kind}`)
    node.dataset.id = n.id
    const content = el('div', 'zn-cnode-content', node)
    el('div', 'zn-cnode-resize', node).dataset.handle = 'resize'
    for (const side of SIDES) {
      const port = el('div', `zn-cnode-port is-${side}`, node)
      port.dataset.port = side
    }
    return { el: node, content, key: '' }
  }

  private updateContent(n: CanvasNode, v: NodeView, key: string): void {
    // A text card being edited keeps its live editor; only sync if the text changed underneath (undo).
    if (isText(n) && v.editor) {
      const current = v.editor.state.doc.toString()
      if (current !== n.text) {
        v.editor.dispatch({ changes: { from: 0, to: current.length, insert: n.text }, annotations: fromDisk.of(true) })
      }
      v.key = key
      return
    }
    v.editor?.destroy()
    v.editor = undefined
    v.content.empty()
    v.key = key

    if (isText(n)) {
      const editable = new Compartment()
      const textNode = n
      const state = createEditorState(
        n.text,
        {
          ...this.host.editorCallbacks(this.path),
          onChange: () => {
            const live = this.node(textNode.id)
            if (!live || !isText(live) || !v.editor) return
            live.text = v.editor.state.doc.toString()
            v.key = contentKey(live)
            if (this.editing) this.editing.text = live.text
            this.markDirty()
          }
        },
        [editable.of(EditorView.editable.of(false))]
      )
      v.editable = editable
      v.editor = new EditorView({ state, parent: v.content })
      return
    }

    if (isFile(n)) {
      const target = this.host.resolve(n.file, this.path) ?? n.file
      const header = el('div', 'zn-cnode-header', v.content)
      header.appendChild(icon(isMarkdown(target) ? 'note' : 'files', 13))
      el('span', '', header, isMarkdown(target) ? stripMd(baseName(target)) : baseName(target))
      const body = el('div', 'zn-cnode-file', v.content)
      if (isImage(target)) {
        const img = el('img', 'zn-cnode-image', body)
        img.src = vaultUrl(target)
        img.alt = baseName(target)
        img.draggable = false
      } else if (isMarkdown(target)) {
        const text = this.host.noteContent(target)
        if (text === null) {
          el('div', 'zn-cnode-missing', body, `"${n.file}" not found`)
        } else {
          const state = createEditorState(text, { ...this.host.editorCallbacks(target), onChange: () => {} }, [
            EditorView.editable.of(false)
          ])
          v.editor = new EditorView({ state, parent: body })
        }
      } else {
        el('div', 'zn-cnode-missing', body, 'Double-click to open this file.')
      }
      return
    }

    if (isLink(n)) {
      let host = n.url
      try {
        host = new URL(n.url).host || n.url
      } catch {
        // Not a full URL; show it as typed.
      }
      const header = el('div', 'zn-cnode-header', v.content)
      header.appendChild(icon('link', 13))
      el('span', '', header, host)
      el('div', 'zn-cnode-url', v.content, n.url)
      el('div', 'zn-cnode-hint', v.content, 'Double-click to open in your browser')
      return
    }

    if (isGroup(n)) {
      el('div', 'zn-cgroup-label', v.content, n.label ?? '')
      if (n.background && isImage(n.background)) {
        v.content.style.backgroundImage = `url("${vaultUrl(this.host.resolve(n.background, this.path) ?? n.background)}")`
        v.content.classList.add(`bg-${n.backgroundStyle ?? 'cover'}`)
      }
      return
    }

    el('div', 'zn-cnode-missing', v.content, `Unsupported card type "${n.type}" (kept as-is)`)
  }

  private renderEdges(): void {
    const ns = 'http://www.w3.org/2000/svg'
    this.edgesG.replaceChildren()
    this.labelsLayer.replaceChildren()
    for (const e of this.data.edges) {
      const from = this.node(e.fromNode)
      const to = this.node(e.toNode)
      if (!from || !to) continue
      const fromSide = e.fromSide ?? facingSide(from, to)
      const toSide = e.toSide ?? facingSide(to, from)
      const geo = edgeGeometry(from, fromSide, to, toSide)
      const g = document.createElementNS(ns, 'g')
      g.classList.add('zn-cedge')
      g.dataset.edge = e.id
      if (this.selectedEdges.has(e.id)) g.classList.add('is-selected')
      const color = colorOf(e.color)
      if (color) g.style.setProperty('--edge-color', color)
      const hit = document.createElementNS(ns, 'path')
      hit.setAttribute('d', geo.path)
      hit.classList.add('zn-cedge-hit')
      const line = document.createElementNS(ns, 'path')
      line.setAttribute('d', geo.path)
      line.classList.add('zn-cedge-line')
      g.append(hit, line)
      if ((e.toEnd ?? 'arrow') === 'arrow') {
        const head = document.createElementNS(ns, 'path')
        head.setAttribute('d', arrowHead(geo.end, geo.endDir))
        head.classList.add('zn-cedge-head')
        g.appendChild(head)
      }
      if (e.fromEnd === 'arrow') {
        const head = document.createElementNS(ns, 'path')
        head.setAttribute('d', arrowHead(geo.start, geo.startDir))
        head.classList.add('zn-cedge-head')
        g.appendChild(head)
      }
      this.edgesG.appendChild(g)
      if (e.label) {
        const label = el('div', 'zn-cedge-label', this.labelsLayer, e.label)
        label.dataset.edge = e.id
        label.style.left = `${geo.mid.x}px`
        label.style.top = `${geo.mid.y}px`
        if (this.selectedEdges.has(e.id)) label.classList.add('is-selected')
      }
    }
  }

  private renderTempEdge(from: CanvasNode, side: Side, pointer: Point, target: CanvasNode | null): void {
    const ns = 'http://www.w3.org/2000/svg'
    this.tempG.replaceChildren()
    const geo = target ? edgeGeometry(from, side, target, nearestSide(target, pointer)) : edgeGeometry(from, side, pointer, null)
    const line = document.createElementNS(ns, 'path')
    line.setAttribute('d', geo.path)
    line.classList.add('zn-cedge-line', 'is-temp')
    const head = document.createElementNS(ns, 'path')
    head.setAttribute('d', arrowHead(geo.end, geo.endDir))
    head.classList.add('zn-cedge-head', 'is-temp')
    this.tempG.append(line, head)
  }

  // ---------- Toolbar ----------

  private buildToolbar(): void {
    const bar = el('div', 'zn-canvas-toolbar', this.el)
    const button = (name: IconName, label: string, action: () => void): void => {
      const b = el('button', 'zn-canvas-btn', bar)
      b.title = label
      b.appendChild(icon(name, 16))
      this.chromeClick(b, action)
    }
    button('filePlus', 'Add card (double-click the canvas)', () => this.addCard(this.cam))
    button('note', 'Add note from vault', () => this.host.pickNote((path) => this.addFile(path)))
    button('folderPlus', 'Group selection', () => this.groupSelection())
    el('div', 'zn-canvas-sep', bar)
    button('minus', 'Zoom out (Ctrl+scroll)', () => this.zoomCenter(1 / 1.25))
    button('fit', 'Zoom to fit', () => {
      this.fit()
      this.applyCamera()
    })
    button('plus', 'Zoom in (Ctrl+scroll)', () => this.zoomCenter(1.25))
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
    const r = this.viewport.getBoundingClientRect()
    this.zoomAt(r.left + r.width / 2, r.top + r.height / 2, factor)
  }

  private renderColorBar(): void {
    this.colorBar.replaceChildren()
    const any = this.selected.size + this.selectedEdges.size > 0
    this.colorBar.style.display = any && !this.error ? '' : 'none'
    if (!any) return
    const swatch = (value: string, css: string | null, title: string): void => {
      const b = el('button', 'zn-canvas-swatch', this.colorBar)
      b.title = title
      if (css) b.style.background = css
      else b.classList.add('is-clear')
      this.chromeClick(b, () => this.setColor(value))
    }
    swatch('', null, 'No color')
    for (const [k, css] of Object.entries(PRESET_COLORS)) swatch(k, css, `Color ${k}`)
    const del = el('button', 'zn-canvas-btn is-danger', this.colorBar)
    del.title = 'Delete (Del)'
    del.appendChild(icon('close', 14))
    this.chromeClick(del, () => this.deleteSelection())
  }

  // ---------- Operations ----------

  private addCard(at: Point, edit = true): TextNode {
    const before = this.snapshot()
    const node: TextNode = { id: newId(), type: 'text', text: '', x: snap(at.x - 125), y: snap(at.y - 30), width: 260, height: 60 }
    this.data.nodes.push(node)
    this.selectOnly(node.id)
    this.renderAll()
    this.commit(before)
    if (edit) this.startEditing(node.id)
    return node
  }

  private addFile(path: string): void {
    const before = this.snapshot()
    const md = isMarkdown(path)
    const node: CanvasNode = {
      id: newId(),
      type: 'file',
      file: path,
      x: snap(this.cam.x - 200),
      y: snap(this.cam.y - (md ? 200 : 150)),
      width: 400,
      height: md ? 400 : 300
    }
    this.data.nodes.push(node)
    this.selectOnly(node.id)
    this.renderAll()
    this.commit(before)
  }

  private groupSelection(): void {
    const before = this.snapshot()
    const picked = this.data.nodes.filter((n) => this.selected.has(n.id))
    const box = bounds(picked) ?? { x: this.cam.x - 200, y: this.cam.y - 150, width: 400, height: 300 }
    const pad = 40
    const group: CanvasNode = {
      id: newId(),
      type: 'group',
      label: 'Group',
      x: snap(box.x - pad),
      y: snap(box.y - pad),
      width: snap(box.width + pad * 2),
      height: snap(box.height + pad * 2)
    }
    this.data.nodes.unshift(group)
    this.selectOnly(group.id)
    this.renderAll()
    this.commit(before)
  }

  private setColor(color: string): void {
    const before = this.snapshot()
    for (const n of this.data.nodes) {
      if (!this.selected.has(n.id)) continue
      if (color) n.color = color
      else delete n.color
    }
    for (const e of this.data.edges) {
      if (!this.selectedEdges.has(e.id)) continue
      if (color) e.color = color
      else delete e.color
    }
    this.renderAll()
    this.commit(before)
  }

  private deleteSelection(): void {
    if (!this.selected.size && !this.selectedEdges.size) return
    const before = this.snapshot()
    this.data.nodes = this.data.nodes.filter((n) => !this.selected.has(n.id))
    this.data.edges = this.data.edges.filter(
      (e) => !this.selectedEdges.has(e.id) && !this.selected.has(e.fromNode) && !this.selected.has(e.toNode)
    )
    this.selected.clear()
    this.selectedEdges.clear()
    this.renderAll()
    this.commit(before)
  }

  private selectOnly(id: string): void {
    this.selected = new Set([id])
    this.selectedEdges.clear()
  }

  private startEditing(id: string): void {
    const n = this.node(id)
    const v = this.views.get(id)
    if (!n || !isText(n) || !v?.editor || !v.editable || this.error) return
    this.stopEditing()
    this.editing = { id, before: this.snapshot(), text: n.text }
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
      if (commit && next !== value) {
        const before = this.snapshot()
        apply(next)
        this.renderAll()
        this.commit(before)
      }
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

  // ---------- Input ----------

  private nodeAt(p: Point, exclude?: string): CanvasNode | null {
    // Topmost first.
    const ordered = stackOrder(this.data.nodes)
    for (let i = ordered.length - 1; i >= 0; i--) {
      const n = ordered[i]
      if (n.id !== exclude && p.x >= n.x && p.x <= n.x + n.width && p.y >= n.y && p.y <= n.y + n.height) return n
    }
    return null
  }

  private bindEvents(): void {
    const vp = this.viewport

    this.registerDomEvent(vp, 'pointerdown', (e) => {
      const target = e.target as HTMLElement
      const nodeEl = target.closest<HTMLElement>('.zn-cnode')
      const nodeId = nodeEl?.dataset.id ?? null

      if (this.editing) {
        if (nodeId === this.editing.id && !target.closest('[data-handle],[data-port]')) return
        this.stopEditing()
      }
      if (this.error) return
      vp.focus({ preventScroll: true })
      const world = this.toWorld(e.clientX, e.clientY)

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
        const n = this.node(nodeId)!
        this.selectOnly(nodeId)
        this.renderAll()
        this.interaction = { kind: 'resize', id: nodeId, start: world, rect: { x: n.x, y: n.y, width: n.width, height: n.height }, before: this.snapshot() }
      } else if (target.closest('[data-edge]')) {
        const edgeId = target.closest<HTMLElement | SVGElement>('[data-edge]')!.dataset.edge!
        if (!e.shiftKey) this.selected.clear()
        if (e.shiftKey && this.selectedEdges.has(edgeId)) this.selectedEdges.delete(edgeId)
        else {
          if (!e.shiftKey) this.selectedEdges.clear()
          this.selectedEdges.add(edgeId)
        }
        this.renderAll()
        return
      } else if (nodeId) {
        // Let links, tags and checkboxes inside a card work normally.
        if (target.closest('[data-zn-wikilink],[data-zn-href],[data-zn-tag],input')) return
        e.preventDefault()
        if (e.shiftKey && this.selected.has(nodeId)) {
          this.selected.delete(nodeId)
          this.renderAll()
          return
        }
        if (!this.selected.has(nodeId)) {
          if (!e.shiftKey) this.selected.clear()
          this.selected.add(nodeId)
        }
        this.selectedEdges.clear()
        this.renderAll()
        this.interaction = { kind: 'move', start: world, origin: this.moveSet(), before: this.snapshot(), moved: false }
      } else {
        e.preventDefault()
        const additive = e.shiftKey ? new Set(this.selected) : new Set<string>()
        if (!e.shiftKey) {
          this.selected.clear()
          this.selectedEdges.clear()
          this.renderAll()
        }
        this.interaction = { kind: 'marquee', start: world, additive }
      }
      vp.setPointerCapture(e.pointerId)
    })

    this.registerDomEvent(vp, 'pointermove', (e) => {
      const it = this.interaction
      if (!it) return
      const world = this.toWorld(e.clientX, e.clientY)
      switch (it.kind) {
        case 'pan':
          this.cam.x -= (e.clientX - it.x) / this.cam.scale
          this.cam.y -= (e.clientY - it.y) / this.cam.scale
          it.x = e.clientX
          it.y = e.clientY
          this.applyCamera()
          break
        case 'move': {
          const dx = world.x - it.start.x
          const dy = world.y - it.start.y
          if (!it.moved && Math.abs(dx) + Math.abs(dy) < 3 / this.cam.scale) return
          it.moved = true
          for (const [id, origin] of it.origin) {
            const n = this.node(id)
            if (!n) continue
            n.x = snap(origin.x + dx)
            n.y = snap(origin.y + dy)
          }
          this.renderNodes()
          this.renderEdges()
          break
        }
        case 'resize': {
          const n = this.node(it.id)
          if (!n) return
          n.width = Math.max(MIN_W, snap(it.rect.width + world.x - it.start.x))
          n.height = Math.max(MIN_H, snap(it.rect.height + world.y - it.start.y))
          this.renderNodes()
          this.renderEdges()
          break
        }
        case 'marquee': {
          const r = normRect(it.start, world)
          const s = this.cam.scale
          const { w, h } = this.size()
          const box = this.selBox.style
          box.display = ''
          box.left = `${(r.x - this.cam.x) * s + w / 2}px`
          box.top = `${(r.y - this.cam.y) * s + h / 2}px`
          box.width = `${r.width * s}px`
          box.height = `${r.height * s}px`
          this.selected = new Set(it.additive)
          for (const n of this.data.nodes) if (intersects(r, n)) this.selected.add(n.id)
          this.renderNodes()
          break
        }
        case 'connect': {
          const from = this.node(it.from)
          if (from) this.renderTempEdge(from, it.side, world, this.nodeAt(world, it.from))
          break
        }
      }
    })

    const end = (e: PointerEvent): void => {
      const it = this.interaction
      this.interaction = null
      if (vp.hasPointerCapture(e.pointerId)) vp.releasePointerCapture(e.pointerId)
      if (!it) return
      if (it.kind === 'move' && it.moved) this.commit(it.before)
      if (it.kind === 'resize') this.commit(it.before)
      if (it.kind === 'marquee') {
        this.selBox.style.display = 'none'
        this.renderAll()
      }
      if (it.kind === 'connect') {
        this.tempG.replaceChildren()
        const world = this.toWorld(e.clientX, e.clientY)
        const target = this.nodeAt(world, it.from)
        const from = this.node(it.from)
        if (!from) return
        const before = this.snapshot()
        let toId: string
        let toSide: Side
        if (target) {
          toId = target.id
          toSide = nearestSide(target, world)
        } else {
          // A click on a port without dragging does nothing; dropping on empty canvas
          // creates a new card there and connects it, like Obsidian.
          if (Math.hypot(world.x - it.start.x, world.y - it.start.y) < 20 / this.cam.scale) return
          const card: TextNode = { id: newId(), type: 'text', text: '', x: snap(world.x - 130), y: snap(world.y - 30), width: 260, height: 60 }
          this.data.nodes.push(card)
          toId = card.id
          toSide = facingSide(card, from)
        }
        const edge: CanvasEdge = { id: newId(), fromNode: it.from, fromSide: it.side, toNode: toId, toSide }
        this.data.edges.push(edge)
        this.renderAll()
        this.commit(before)
        if (!target) {
          this.selectOnly(toId)
          this.renderAll()
          this.startEditing(toId)
        }
      }
    }
    this.registerDomEvent(vp, 'pointerup', end)
    this.registerDomEvent(vp, 'pointercancel', end)

    this.registerDomEvent(vp, 'dblclick', (e) => {
      if (this.error) return
      const target = e.target as HTMLElement
      const edgeEl = target.closest<HTMLElement | SVGElement>('[data-edge]')
      if (edgeEl) {
        const edge = this.data.edges.find((x) => x.id === edgeEl.dataset.edge)
        if (!edge) return
        const labelEl = this.labelsLayer.querySelector<HTMLElement>(`[data-edge="${edge.id}"]`) ?? (target as HTMLElement)
        this.editLabel(labelEl, edge.label ?? '', (v) => {
          if (v) edge.label = v
          else delete edge.label
        })
        return
      }
      const nodeId = target.closest<HTMLElement>('.zn-cnode')?.dataset.id
      const n = nodeId ? this.node(nodeId) : null
      if (!n) {
        this.addCard(this.toWorld(e.clientX, e.clientY))
        return
      }
      if (isText(n)) this.startEditing(n.id)
      else if (isFile(n)) this.host.openPath(this.host.resolve(n.file, this.path) ?? n.file)
      else if (isLink(n)) this.host.openUrl(n.url)
      else if (isGroup(n)) {
        const labelEl = this.views.get(n.id)?.content.querySelector<HTMLElement>('.zn-cgroup-label')
        if (labelEl) this.editLabel(labelEl, n.label ?? '', (v) => (n.label = v))
      }
    })

    this.registerDomEvent(vp, 'wheel', (e) => {
      if (this.editing && (e.target as HTMLElement).closest('.zn-cnode.is-editing')) return
      e.preventDefault()
      if (e.ctrlKey) {
        this.zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0025))
      } else {
        const dx = e.shiftKey ? e.deltaY : e.deltaX
        const dy = e.shiftKey ? 0 : e.deltaY
        this.cam.x += dx / this.cam.scale
        this.cam.y += dy / this.cam.scale
        this.applyCamera()
      }
    }, { passive: false })

    this.registerDomEvent(vp, 'keydown', (e) => {
      if (this.editing) {
        if (e.key === 'Escape') {
          e.preventDefault()
          this.stopEditing()
        }
        return
      }
      const mod = e.ctrlKey || e.metaKey
      if (e.key === ' ' && !this.spaceDown) {
        this.spaceDown = true
        vp.classList.add('is-panning')
        e.preventDefault()
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        this.deleteSelection()
      } else if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) this.redo()
        else this.undo()
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        this.redo()
      } else if (mod && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        this.selected = new Set(this.data.nodes.map((n) => n.id))
        this.renderAll()
      } else if (e.key === 'Escape') {
        this.selected.clear()
        this.selectedEdges.clear()
        this.renderAll()
      } else if (e.key === 'Enter' && this.selected.size === 1) {
        e.preventDefault()
        this.startEditing([...this.selected][0])
      }
    })
    this.registerDomEvent(vp, 'keyup', (e) => {
      if (e.key === ' ') {
        this.spaceDown = false
        vp.classList.remove('is-panning')
      }
    })
  }

  // The selection plus every card fully inside a selected group moves together.
  private moveSet(): Map<string, Point> {
    const out = new Map<string, Point>()
    for (const n of this.data.nodes) {
      if (!this.selected.has(n.id)) continue
      out.set(n.id, { x: n.x, y: n.y })
      if (isGroup(n)) {
        for (const m of this.data.nodes) if (m.id !== n.id && contains(n, m)) out.set(m.id, { x: m.x, y: m.y })
      }
    }
    return out
  }
}

function contentKey(n: CanvasNode): string {
  if (isText(n)) return `text:${n.text}`
  if (isFile(n)) return `file:${n.file}:${n.subpath ?? ''}`
  if (isLink(n)) return `link:${n.url}`
  if (isGroup(n)) return `group:${n.label ?? ''}:${n.background ?? ''}:${n.backgroundStyle ?? ''}`
  return `other:${n.type}`
}

function nearestSide(r: Rect, p: Point): Side {
  const d = { top: Math.abs(p.y - r.y), bottom: Math.abs(p.y - (r.y + r.height)), left: Math.abs(p.x - r.x), right: Math.abs(p.x - (r.x + r.width)) }
  return (Object.entries(d) as Array<[Side, number]>).sort((a, b) => a[1] - b[1])[0][0]
}

function normRect(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) }
}
