import { Component, el } from '../component'
import { icon } from '../icons'
import type { MetadataCache } from '../index/metadataCache'
import { buildGraph, type GraphData, type GraphFilters, type NodeKind } from './graphData'
import { GraphRenderer, type Camera, type RenderEdge, type RenderNode } from './renderer'
import type { Forces } from './sim.worker'

type RGBA = [number, number, number, number]

const COLORS: Record<NodeKind | 'active' | 'hover', RGBA> = {
  note: [0.71, 0.71, 0.76, 1],
  tag: [0.2, 0.83, 0.6, 1],
  attachment: [0.98, 0.75, 0.14, 1],
  unresolved: [0.36, 0.36, 0.4, 1],
  active: [0.65, 0.55, 0.98, 1],
  hover: [0.77, 0.71, 0.99, 1]
}
const EDGE: RGBA = [0.6, 0.6, 0.7, 0.55]
const EDGE_HOT: RGBA = [0.65, 0.55, 0.98, 0.85]
const DIM = 0.3

export interface GraphSettings {
  filters: GraphFilters
  forces: Forces
  nodeSize: number
  depth: number
}

const DEFAULTS: Record<'global' | 'local', GraphSettings> = {
  global: {
    filters: { showTags: false, showAttachments: false, showOrphans: true, showUnresolved: false, search: '' },
    forces: { center: 0.08, repel: 10, linkStrength: 1, linkDistance: 60 },
    nodeSize: 1,
    depth: 1
  },
  local: {
    filters: { showTags: false, showAttachments: false, showOrphans: true, showUnresolved: true, search: '' },
    forces: { center: 0.12, repel: 8, linkStrength: 1, linkDistance: 50 },
    nodeSize: 1,
    depth: 1
  }
}

export interface GraphViewOptions {
  cache: MetadataCache
  mode: 'global' | 'local'
  getActive(): string | null
  onOpen(path: string): void
}

export class GraphView extends Component {
  readonly el: HTMLElement
  private readonly stage: HTMLElement
  private renderer: GraphRenderer | null = null
  private worker: Worker | null = null
  private data: GraphData = { nodes: [], links: [] }
  private positions: Float32Array = new Float32Array(0)
  private remembered = new Map<string, [number, number]>()
  private neighbors: number[][] = []
  private fade = new Float32Array(0)
  private cam: Camera = { x: 0, y: 0, scale: 1 }
  private autoFit = true
  private hover = -1
  private drag: { index: number; startX: number; startY: number; moved: boolean } | null = null
  private pan: { x: number; y: number } | null = null
  private simAlpha = 0
  private raf = 0
  private visible = false
  private rebuildTimer: number | null = null
  private settings: GraphSettings
  private center: string | null = null
  private readonly emptyEl: HTMLElement

  constructor(
    container: HTMLElement,
    private readonly opts: GraphViewOptions
  ) {
    super()
    this.settings = loadSettings(opts.mode)
    this.el = el('div', `zn-graph zn-graph-${opts.mode}`, container)
    this.stage = el('div', 'zn-graph-stage', this.el)
    this.emptyEl = el('div', 'zn-graph-empty', this.el)
    try {
      this.renderer = new GraphRenderer(this.stage)
    } catch (e) {
      this.emptyEl.textContent = `The graph needs WebGL2: ${(e as Error).message}`
    }
    this.buildControls()
  }

  onload(): void {
    if (!this.renderer) return
    this.worker = new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module', name: 'Zenode Graph Physics' })
    this.worker.onmessage = (e: MessageEvent<{ type: 'tick'; positions: Float32Array; alpha: number }>) => {
      if (e.data.positions.length !== this.data.nodes.length * 2) return // stale tick from a previous build
      this.positions = e.data.positions
      this.simAlpha = e.data.alpha
      this.requestDraw()
    }
    this.worker.postMessage({ type: 'forces', forces: this.settings.forces })

    const ro = new ResizeObserver(() => this.onResize())
    ro.observe(this.stage)
    this.register(() => ro.disconnect())
    this.register(this.opts.cache.onChange(() => this.rebuildSoon()))
    this.bindPointer()
    this.rebuild()
  }

  onunload(): void {
    cancelAnimationFrame(this.raf)
    this.worker?.terminate()
    this.renderer?.destroy()
    if (this.rebuildTimer !== null) window.clearTimeout(this.rebuildTimer)
  }

  // ---------- Visibility & active note ----------

  setVisible(visible: boolean): void {
    this.visible = visible
    if (visible) {
      this.onResize()
      this.requestDraw()
    }
  }

  setActive(path: string | null): void {
    if (this.opts.mode === 'local') {
      if (path === this.center) return
      this.center = path
      this.autoFit = true
      this.rebuild()
    } else {
      this.requestDraw()
    }
  }

  // ---------- Data ----------

  private rebuildSoon(): void {
    if (this.rebuildTimer !== null) window.clearTimeout(this.rebuildTimer)
    this.rebuildTimer = window.setTimeout(() => this.rebuild(), 250)
  }

  private rebuild(): void {
    if (!this.renderer || !this.worker) return
    // Remember where every node was, so the layout stays stable across rebuilds.
    this.data.nodes.forEach((n, i) => {
      if (this.positions.length >= i * 2 + 2) this.remembered.set(n.id, [this.positions[i * 2], this.positions[i * 2 + 1]])
    })
    const local = this.opts.mode === 'local'
    if (local) this.center = this.opts.getActive()
    this.data =
      local && !this.center
        ? { nodes: [], links: [] }
        : buildGraph(
            this.opts.cache,
            this.settings.filters,
            local ? { center: this.center!, depth: this.settings.depth } : undefined
          )
    const { nodes, links } = this.data
    this.emptyEl.textContent = nodes.length
      ? ''
      : local
        ? this.center
          ? 'This note has no links yet.'
          : 'Open a note to see its local graph.'
        : 'No notes to show.'
    this.emptyEl.style.display = nodes.length ? 'none' : ''

    this.neighbors = nodes.map(() => [])
    for (const [a, b] of links) {
      this.neighbors[a].push(b)
      this.neighbors[b].push(a)
    }

    // Seed positions: remembered, else next to a placed neighbour, else on a ring around the layout.
    const pos = new Float32Array(nodes.length * 2)
    const placed = new Uint8Array(nodes.length)
    let fresh = 0
    nodes.forEach((n, i) => {
      const p = this.remembered.get(n.id)
      if (p) {
        pos[i * 2] = p[0]
        pos[i * 2 + 1] = p[1]
        placed[i] = 1
      }
    })
    const ring = 60 + Math.sqrt(nodes.length) * 40
    nodes.forEach((_, i) => {
      if (placed[i]) return
      const anchor = this.neighbors[i].find((j) => placed[j])
      if (anchor !== undefined) {
        pos[i * 2] = pos[anchor * 2] + (Math.random() - 0.5) * 40
        pos[i * 2 + 1] = pos[anchor * 2 + 1] + (Math.random() - 0.5) * 40
      } else {
        const angle = Math.random() * Math.PI * 2
        const radius = ring * (0.5 + Math.random() * 0.5)
        pos[i * 2] = Math.cos(angle) * radius
        pos[i * 2 + 1] = Math.sin(angle) * radius
      }
      placed[i] = 1
      fresh++
    })
    this.positions = pos
    this.fade = new Float32Array(nodes.length).fill(1)
    this.hover = -1
    const radii = new Float32Array(nodes.map((n) => this.radius(n.degree)))
    this.worker.postMessage({
      type: 'init',
      count: nodes.length,
      links,
      positions: pos.slice(),
      radii,
      alpha: fresh > nodes.length / 2 ? 1 : fresh > 0 ? 0.5 : 0.15
    })
    this.requestDraw()
  }

  private radius(degree: number): number {
    return this.settings.nodeSize * Math.max(4, Math.min(2 + 1.8 * Math.sqrt(degree + 1), 18))
  }

  // ---------- Drawing ----------

  private requestDraw(): void {
    if (!this.raf) this.raf = requestAnimationFrame(() => this.frame())
  }

  private frame(): void {
    this.raf = 0
    if (!this.renderer || !this.visible || !this.renderer.width) return
    const animating = this.updateFade()
    if (this.autoFit) this.easeToFit()
    this.draw()
    if (animating || this.simAlpha > 0.005 || this.autoFitting) this.requestDraw()
  }

  private autoFitting = false

  private easeToFit(): void {
    const target = this.fitCamera()
    if (!target) return
    const k = 0.15
    const dx = target.x - this.cam.x
    const dy = target.y - this.cam.y
    const ds = target.scale - this.cam.scale
    this.cam = { x: this.cam.x + dx * k, y: this.cam.y + dy * k, scale: this.cam.scale + ds * k }
    this.autoFitting = Math.abs(dx) + Math.abs(dy) > 0.5 || Math.abs(ds) > 0.002
  }

  private fitCamera(): Camera | null {
    const n = this.data.nodes.length
    if (!n || !this.renderer) return null
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (let i = 0; i < n; i++) {
      const x = this.positions[i * 2]
      const y = this.positions[i * 2 + 1]
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
    // Padding in screen pixels, so small panes (the local graph) still fill nicely.
    const padPx = this.opts.mode === 'local' ? 36 : 70
    const availW = Math.max(this.renderer.width - padPx * 2, 40)
    const availH = Math.max(this.renderer.height - padPx * 2, 40)
    const w = Math.max(maxX - minX, 1)
    const h = Math.max(maxY - minY, 1)
    const scale = Math.max(0.05, Math.min(availW / w, availH / h, this.opts.mode === 'local' ? 1.6 : 2))
    return { x: (minX + maxX) / 2, y: (minY + maxY) / 2, scale }
  }

  // Ease every node toward full or dimmed opacity, depending on the hovered node.
  private updateFade(): boolean {
    const hot = this.hover >= 0 ? new Set([this.hover, ...this.neighbors[this.hover]]) : null
    let moving = false
    for (let i = 0; i < this.fade.length; i++) {
      const target = !hot || hot.has(i) ? 1 : DIM
      const next = this.fade[i] + (target - this.fade[i]) * 0.2
      if (Math.abs(next - target) > 0.01) moving = true
      this.fade[i] = Math.abs(next - target) <= 0.01 ? target : next
    }
    return moving
  }

  private draw(): void {
    const { nodes, links } = this.data
    const active = this.opts.getActive()
    const scale = this.cam.scale
    // Labels fade in as you zoom in (always readable in the small local graph).
    const zoomLabel = this.opts.mode === 'local' ? 1 : Math.max(0, Math.min(1, (scale - 0.55) / 0.5))
    const hotSet = this.hover >= 0 ? new Set([this.hover, ...this.neighbors[this.hover]]) : null

    const renderNodes: RenderNode[] = nodes.map((n, i) => {
      const isActive = n.id === active
      const base = i === this.hover ? COLORS.hover : isActive ? COLORS.active : COLORS[n.kind]
      const a = this.fade[i] ?? 1
      const highlighted = hotSet?.has(i) ?? false
      return {
        x: this.positions[i * 2],
        y: this.positions[i * 2 + 1],
        r: this.radius(n.degree),
        color: [base[0], base[1], base[2], base[3] * a],
        label: n.label,
        labelAlpha: (highlighted || isActive ? 1 : zoomLabel) * a,
        labelBold: i === this.hover || isActive
      }
    })
    const renderEdges: RenderEdge[] = links.map(([a, b]) => {
      const hot = this.hover >= 0 && (a === this.hover || b === this.hover)
      const dim = Math.min(this.fade[a] ?? 1, this.fade[b] ?? 1)
      return {
        a,
        b,
        color: hot ? EDGE_HOT : [EDGE[0], EDGE[1], EDGE[2], EDGE[3] * (this.hover >= 0 ? dim : 1)],
        width: hot ? 1.8 : 1.25
      }
    })
    this.renderer!.draw(this.cam, renderNodes, renderEdges)
  }

  private onResize(): void {
    if (!this.renderer) return
    const rect = this.stage.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    this.renderer.resize(rect.width, rect.height)
    this.requestDraw()
  }

  // ---------- Interaction ----------

  private toWorld(sx: number, sy: number): [number, number] {
    const r = this.renderer!
    return [(sx - r.width / 2) / this.cam.scale + this.cam.x, (sy - r.height / 2) / this.cam.scale + this.cam.y]
  }

  private hitTest(sx: number, sy: number): number {
    const [wx, wy] = this.toWorld(sx, sy)
    let best = -1
    let bestD = Infinity
    for (let i = 0; i < this.data.nodes.length; i++) {
      const dx = this.positions[i * 2] - wx
      const dy = this.positions[i * 2 + 1] - wy
      const d = dx * dx + dy * dy
      const r = this.radius(this.data.nodes[i].degree) + 4 / this.cam.scale
      if (d <= r * r && d < bestD) {
        best = i
        bestD = d
      }
    }
    return best
  }

  private bindPointer(): void {
    const target = this.renderer!.textCanvas
    const local = (e: PointerEvent | WheelEvent | MouseEvent): [number, number] => {
      const rect = target.getBoundingClientRect()
      return [e.clientX - rect.left, e.clientY - rect.top]
    }
    this.registerDomEvent(target, 'pointerdown', (e) => {
      if (e.button !== 0) return
      target.setPointerCapture(e.pointerId)
      const [sx, sy] = local(e)
      const hit = this.hitTest(sx, sy)
      if (hit >= 0) {
        this.drag = { index: hit, startX: sx, startY: sy, moved: false }
      } else {
        this.pan = { x: sx, y: sy }
        this.autoFit = false
      }
    })
    this.registerDomEvent(target, 'pointermove', (e) => {
      const [sx, sy] = local(e)
      if (this.drag) {
        if (Math.abs(sx - this.drag.startX) + Math.abs(sy - this.drag.startY) > 3) this.drag.moved = true
        if (this.drag.moved) {
          const [wx, wy] = this.toWorld(sx, sy)
          this.worker?.postMessage({ type: 'drag', index: this.drag.index, x: wx, y: wy })
          this.autoFit = false
        }
        return
      }
      if (this.pan) {
        this.cam.x -= (sx - this.pan.x) / this.cam.scale
        this.cam.y -= (sy - this.pan.y) / this.cam.scale
        this.pan = { x: sx, y: sy }
        this.requestDraw()
        return
      }
      const hit = this.hitTest(sx, sy)
      if (hit !== this.hover) {
        this.hover = hit
        target.style.cursor = hit >= 0 ? 'pointer' : ''
        this.requestDraw()
      }
    })
    const end = (e: PointerEvent): void => {
      if (this.drag) {
        const { index, moved } = this.drag
        this.drag = null
        this.worker?.postMessage({ type: 'release', index })
        if (!moved) {
          const node = this.data.nodes[index]
          if (node && (node.kind === 'note' || node.kind === 'attachment')) this.opts.onOpen(node.id)
        }
      }
      this.pan = null
      if (target.hasPointerCapture(e.pointerId)) target.releasePointerCapture(e.pointerId)
    }
    this.registerDomEvent(target, 'pointerup', end)
    this.registerDomEvent(target, 'pointercancel', end)
    this.registerDomEvent(target, 'pointerleave', () => {
      if (!this.drag && !this.pan && this.hover !== -1) {
        this.hover = -1
        this.requestDraw()
      }
    })
    this.registerDomEvent(target, 'wheel', (e) => {
      e.preventDefault()
      const [sx, sy] = local(e)
      const [wx, wy] = this.toWorld(sx, sy)
      const factor = Math.exp(-e.deltaY * 0.0015)
      const scale = Math.max(0.03, Math.min(6, this.cam.scale * factor))
      // Keep the world point under the cursor fixed while zooming.
      this.cam = {
        scale,
        x: wx - (sx - this.renderer!.width / 2) / scale,
        y: wy - (sy - this.renderer!.height / 2) / scale
      }
      this.autoFit = false
      this.requestDraw()
    }, { passive: false })
    this.registerDomEvent(target, 'dblclick', (e) => {
      const [sx, sy] = local(e)
      if (this.hitTest(sx, sy) === -1) {
        this.autoFit = true
        this.requestDraw()
      }
    })
  }

  // ---------- Settings panel ----------

  private buildControls(): void {
    const bar = el('div', 'zn-graph-toolbar', this.el)
    const fit = el('button', 'zn-graph-btn', bar)
    fit.title = 'Fit to view (double-click the background)'
    fit.appendChild(icon('fit', 15))
    fit.addEventListener('click', () => {
      this.autoFit = true
      this.requestDraw()
    })
    const gear = el('button', 'zn-graph-btn', bar)
    gear.title = 'Graph settings'
    gear.appendChild(icon('settings', 15))
    const panel = el('div', 'zn-graph-panel', this.el)
    panel.style.display = 'none'
    gear.addEventListener('click', () => {
      panel.style.display = panel.style.display === 'none' ? '' : 'none'
    })

    const s = this.settings
    const changed = (rebuild: boolean, forces = false): void => {
      saveSettings(this.opts.mode, s)
      if (forces) this.worker?.postMessage({ type: 'forces', forces: s.forces })
      if (rebuild) this.rebuildSoon()
      else this.requestDraw()
    }

    section(panel, 'Filters')
    const search = el('input', 'zn-graph-search', panel)
    search.placeholder = 'Search files...'
    search.value = s.filters.search
    search.addEventListener('input', () => {
      s.filters.search = search.value
      changed(true)
    })
    toggle(panel, 'Tags', s.filters.showTags, (v) => ((s.filters.showTags = v), changed(true)))
    toggle(panel, 'Attachments', s.filters.showAttachments, (v) => ((s.filters.showAttachments = v), changed(true)))
    toggle(panel, 'Missing notes', s.filters.showUnresolved, (v) => ((s.filters.showUnresolved = v), changed(true)))
    if (this.opts.mode === 'global') {
      toggle(panel, 'Orphans', s.filters.showOrphans, (v) => ((s.filters.showOrphans = v), changed(true)))
    } else {
      slider(panel, 'Depth', 1, 4, 1, s.depth, (v) => ((s.depth = v), changed(true)))
    }

    section(panel, 'Display')
    slider(panel, 'Node size', 0.5, 2.5, 0.1, s.nodeSize, (v) => {
      s.nodeSize = v
      changed(false)
      this.rebuildSoon()
    })

    section(panel, 'Forces')
    slider(panel, 'Center force', 0, 0.4, 0.01, s.forces.center, (v) => ((s.forces.center = v), changed(false, true)))
    slider(panel, 'Repel force', 0, 30, 0.5, s.forces.repel, (v) => ((s.forces.repel = v), changed(false, true)))
    slider(panel, 'Link force', 0, 2, 0.05, s.forces.linkStrength, (v) => ((s.forces.linkStrength = v), changed(false, true)))
    slider(panel, 'Link distance', 10, 250, 5, s.forces.linkDistance, (v) => ((s.forces.linkDistance = v), changed(false, true)))
  }
}

function section(parent: HTMLElement, title: string): void {
  el('div', 'zn-graph-section', parent, title)
}

function toggle(parent: HTMLElement, label: string, value: boolean, onChange: (v: boolean) => void): void {
  const row = el('label', 'zn-graph-row', parent)
  el('span', '', row, label)
  const input = el('input', 'zn-switch', row)
  input.type = 'checkbox'
  input.checked = value
  input.addEventListener('change', () => onChange(input.checked))
}

function slider(
  parent: HTMLElement,
  label: string,
  min: number,
  max: number,
  step: number,
  value: number,
  onChange: (v: number) => void
): void {
  const row = el('label', 'zn-graph-row zn-graph-slider', parent)
  el('span', '', row, label)
  const input = el('input', '', row)
  input.type = 'range'
  input.min = String(min)
  input.max = String(max)
  input.step = String(step)
  input.value = String(value)
  input.addEventListener('input', () => onChange(Number(input.value)))
}

function loadSettings(mode: 'global' | 'local'): GraphSettings {
  const base = structuredClone(DEFAULTS[mode])
  try {
    const raw = localStorage.getItem(`zenode.graph.${mode}`)
    if (!raw) return base
    const saved = JSON.parse(raw) as Partial<GraphSettings>
    return {
      filters: { ...base.filters, ...saved.filters },
      forces: { ...base.forces, ...saved.forces },
      nodeSize: typeof saved.nodeSize === 'number' ? saved.nodeSize : base.nodeSize,
      depth: typeof saved.depth === 'number' ? saved.depth : base.depth
    }
  } catch {
    return base
  }
}

function saveSettings(mode: 'global' | 'local', settings: GraphSettings): void {
  try {
    localStorage.setItem(`zenode.graph.${mode}`, JSON.stringify(settings))
  } catch {
    // Settings just won't persist.
  }
}
