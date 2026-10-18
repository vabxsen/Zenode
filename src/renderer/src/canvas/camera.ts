// Pan and zoom for a canvas. The camera centre (x, y) is in world coordinates
// and sits at the middle of the viewport; scale is the zoom factor.
import { GRID } from './canvasDocument'
import { bounds, type Point, type Rect } from './model'

const MIN_SCALE = 0.1
const MAX_SCALE = 3
const ZOOMED_OUT = 0.35
const FIT_PAD = 80
const SAVE_DELAY = 400

export interface Cam {
  x: number
  y: number
  scale: number
}

export class CanvasCamera {
  cam: Cam = { x: 0, y: 0, scale: 1 }
  private saveTimer: number | null = null

  constructor(
    private readonly viewport: HTMLElement,
    private readonly world: HTMLElement
  ) {}

  size(): { w: number; h: number } {
    return { w: this.viewport.clientWidth, h: this.viewport.clientHeight }
  }

  toWorld(clientX: number, clientY: number): Point {
    const rect = this.viewport.getBoundingClientRect()
    const { w, h } = this.size()
    return {
      x: (clientX - rect.left - w / 2) / this.cam.scale + this.cam.x,
      y: (clientY - rect.top - h / 2) / this.cam.scale + this.cam.y
    }
  }

  // A world rectangle in viewport pixels (for the selection box).
  toViewport(r: Rect): Rect {
    const s = this.cam.scale
    const { w, h } = this.size()
    return { x: (r.x - this.cam.x) * s + w / 2, y: (r.y - this.cam.y) * s + h / 2, width: r.width * s, height: r.height * s }
  }

  // Moves the world layer and the dot grid to match the camera.
  apply(): void {
    const { w, h } = this.size()
    const s = this.cam.scale
    const ox = w / 2 - this.cam.x * s
    const oy = h / 2 - this.cam.y * s
    this.world.style.transform = `translate(${ox}px, ${oy}px) scale(${s})`
    const grid = GRID * s
    this.viewport.style.backgroundSize = `${grid}px ${grid}px`
    this.viewport.style.backgroundPosition = `${ox}px ${oy}px`
    this.viewport.classList.toggle('is-zoomed-out', s < ZOOMED_OUT)
  }

  pan(dxScreen: number, dyScreen: number): void {
    this.cam.x += dxScreen / this.cam.scale
    this.cam.y += dyScreen / this.cam.scale
  }

  // Zooms while keeping the world point under the cursor in place.
  zoomAt(clientX: number, clientY: number, factor: number): void {
    const before = this.toWorld(clientX, clientY)
    this.cam.scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, this.cam.scale * factor))
    const after = this.toWorld(clientX, clientY)
    this.cam.x += before.x - after.x
    this.cam.y += before.y - after.y
  }

  zoomCenter(factor: number): void {
    const r = this.viewport.getBoundingClientRect()
    this.zoomAt(r.left + r.width / 2, r.top + r.height / 2, factor)
  }

  // Frames all the given rectangles (never zooming in past 100%).
  fit(rects: Rect[]): void {
    const box = bounds(rects)
    const { w, h } = this.size()
    if (!box || !w || !h) {
      this.cam = { x: 0, y: 0, scale: 1 }
      return
    }
    this.cam = {
      x: box.x + box.width / 2,
      y: box.y + box.height / 2,
      scale: Math.max(MIN_SCALE, Math.min(1, (w - FIT_PAD * 2) / box.width, (h - FIT_PAD * 2) / box.height))
    }
  }

  // The visible world area grown by `marginPx` screen pixels, or null before layout.
  visibleRect(marginPx: number): Rect | null {
    const { w, h } = this.size()
    if (!w) return null
    const s = this.cam.scale
    const margin = marginPx / s
    return { x: this.cam.x - w / 2 / s - margin, y: this.cam.y - h / 2 / s - margin, width: w / s + margin * 2, height: h / s + margin * 2 }
  }

  // ---------- Remembered position, per canvas file (a per-viewer convenience) ----------

  restore(path: string): boolean {
    try {
      const raw = localStorage.getItem(storageKey(path))
      if (!raw) return false
      const c = JSON.parse(raw) as Cam
      if ([c.x, c.y, c.scale].every((v) => typeof v === 'number' && Number.isFinite(v))) {
        this.cam = { x: c.x, y: c.y, scale: c.scale }
        return true
      }
    } catch {
      // Ignore a broken saved camera.
    }
    return false
  }

  saveSoon(path: string): void {
    this.cancelSave()
    this.saveTimer = window.setTimeout(() => {
      try {
        localStorage.setItem(storageKey(path), JSON.stringify(this.cam))
      } catch {
        // The position just won't be remembered.
      }
    }, SAVE_DELAY)
  }

  cancelSave(): void {
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer)
    this.saveTimer = null
  }
}

function storageKey(path: string): string {
  return `zenode.canvas.view:${path}`
}
