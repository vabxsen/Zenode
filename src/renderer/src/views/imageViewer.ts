// An image with zoom (Ctrl+wheel or wheel, buttons, double-click) and pan (drag).
import { el } from '../component'

const MIN_SCALE = 0.05
const MAX_SCALE = 32
const STEP = 1.25

export class ImageViewer {
  readonly el: HTMLElement
  private readonly img: HTMLImageElement
  private readonly label: HTMLElement
  private scale = 1
  private x = 0
  private y = 0
  private fitted = true

  constructor(parent: HTMLElement, alt: string) {
    this.el = el('div', 'zn-image-viewer', parent)
    this.img = el('img', 'zn-image-viewer-img', this.el)
    this.img.alt = alt
    this.img.draggable = false
    const bar = el('div', 'zn-image-tools', this.el)
    const btn = (text: string, title: string, action: () => void): void => {
      const b = el('button', 'zn-image-tool', bar, text)
      b.title = title
      b.setAttribute('aria-label', title)
      b.addEventListener('click', action)
    }
    btn('−', 'Zoom out', () => this.zoomBy(1 / STEP))
    this.label = el('span', 'zn-image-zoom', bar)
    btn('+', 'Zoom in', () => this.zoomBy(STEP))
    btn('Fit', 'Fit to window', () => this.fit())
    btn('1:1', 'Actual size', () => this.actual())

    this.img.addEventListener('load', () => this.fit())
    this.el.addEventListener('wheel', (e) => this.onWheel(e), { passive: false })
    this.el.addEventListener('dblclick', (e) => {
      if ((e.target as HTMLElement).closest('.zn-image-tools')) return
      if (this.fitted) this.actual(e.clientX, e.clientY)
      else this.fit()
    })
    this.el.addEventListener('pointerdown', (e) => this.onDrag(e))
    new ResizeObserver(() => {
      if (this.fitted) this.fit()
    }).observe(this.el)
  }

  setSource(url: string): void {
    this.img.src = url
  }

  fit(): void {
    const { width, height } = this.el.getBoundingClientRect()
    const nw = this.img.naturalWidth
    const nh = this.img.naturalHeight
    if (!nw || !nh || !width || !height) return
    // Small images stay at their real size; big ones shrink to fit.
    this.scale = Math.min(1, width / nw, height / nh)
    this.x = (width - nw * this.scale) / 2
    this.y = (height - nh * this.scale) / 2
    this.fitted = true
    this.apply()
  }

  private actual(cx?: number, cy?: number): void {
    this.zoomTo(1, cx, cy)
  }

  private zoomBy(factor: number, cx?: number, cy?: number): void {
    this.zoomTo(this.scale * factor, cx, cy)
  }

  // Zooms keeping the point under (cx, cy) (default: the centre) in place.
  private zoomTo(next: number, cx?: number, cy?: number): void {
    const r = this.el.getBoundingClientRect()
    const px = (cx ?? r.left + r.width / 2) - r.left
    const py = (cy ?? r.top + r.height / 2) - r.top
    const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, next))
    this.x = px - ((px - this.x) * scale) / this.scale
    this.y = py - ((py - this.y) * scale) / this.scale
    this.scale = scale
    this.fitted = false
    this.apply()
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault()
    this.zoomBy(e.deltaY < 0 ? STEP : 1 / STEP, e.clientX, e.clientY)
  }

  private onDrag(e: PointerEvent): void {
    if (e.button !== 0 || (e.target as HTMLElement).closest('.zn-image-tools')) return
    e.preventDefault()
    this.el.setPointerCapture(e.pointerId)
    this.el.classList.add('is-dragging')
    const sx = e.clientX - this.x
    const sy = e.clientY - this.y
    const move = (ev: PointerEvent): void => {
      this.x = ev.clientX - sx
      this.y = ev.clientY - sy
      this.fitted = false
      this.apply()
    }
    const up = (): void => {
      this.el.classList.remove('is-dragging')
      this.el.removeEventListener('pointermove', move)
      this.el.removeEventListener('pointerup', up)
    }
    this.el.addEventListener('pointermove', move)
    this.el.addEventListener('pointerup', up)
  }

  private apply(): void {
    this.img.style.transform = `translate(${this.x}px, ${this.y}px) scale(${this.scale})`
    this.label.textContent = `${Math.round(this.scale * 100)}%`
  }
}
