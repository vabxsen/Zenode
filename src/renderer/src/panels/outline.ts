// Outline: the active note's headings; click one to jump to it.
import { Component, el } from '../component'
import type { MetadataCache } from '../index/metadataCache'
import { lineOffset } from '../links'
import type { OpenPosition } from '../workspace'

const REFRESH_DELAY = 150

export class OutlinePanel extends Component {
  private target: string | null = null
  private timer: number | null = null
  private readonly listEl: HTMLElement

  constructor(
    container: HTMLElement,
    private readonly cache: MetadataCache,
    private readonly onJump: (path: string, pos: OpenPosition) => void
  ) {
    super()
    const header = el('div', 'zn-panel-header', container)
    el('span', 'zn-panel-title', header, 'Outline')
    this.listEl = el('div', 'zn-outline', container)
  }

  onload(): void {
    this.register(
      this.cache.onChange((path) => {
        if (path === null || path === this.target) this.renderSoon()
      })
    )
    this.register(() => {
      if (this.timer !== null) window.clearTimeout(this.timer)
    })
    this.render()
  }

  setTarget(path: string | null): void {
    this.target = path
    this.render()
  }

  private renderSoon(): void {
    if (this.timer !== null) window.clearTimeout(this.timer)
    this.timer = window.setTimeout(() => this.render(), REFRESH_DELAY)
  }

  private render(): void {
    this.listEl.replaceChildren()
    const path = this.target
    const note = path ? this.cache.getNote(path) : undefined
    if (!path || !note || !path.toLowerCase().endsWith('.md')) {
      el('div', 'zn-panel-empty', this.listEl, 'Open a note to see its outline.')
      return
    }
    const headings = note.meta.headings
    if (!headings.length) {
      el('div', 'zn-panel-empty', this.listEl, 'No headings in this note.')
      return
    }
    const top = Math.min(...headings.map((h) => h.level))
    for (const h of headings) {
      const row = el('div', `zn-outline-item is-h${h.level}`, this.listEl, h.text)
      row.style.paddingLeft = `${10 + (h.level - top) * 14}px`
      row.title = h.text
      row.addEventListener('click', () => this.onJump(path, { from: lineOffset(note.content, h.line) }))
    }
  }
}
