// Tags: every #tag in the vault with how often it's used; nested tags
// (#work/launch) sit under their parent. Click one to search for it.
import { Component, el } from '../component'
import type { MetadataCache } from '../index/metadataCache'
import { countTags } from './tagCount'

const REFRESH_DELAY = 300

export class TagsPanel extends Component {
  private timer: number | null = null
  private readonly listEl: HTMLElement
  private readonly countEl: HTMLElement

  constructor(
    container: HTMLElement,
    private readonly cache: MetadataCache,
    private readonly onTag: (tag: string) => void
  ) {
    super()
    const header = el('div', 'zn-panel-header', container)
    el('span', 'zn-panel-title', header, 'Tags')
    this.countEl = el('span', 'zn-panel-count', header)
    this.listEl = el('div', 'zn-tags', container)
  }

  onload(): void {
    this.register(this.cache.onChange(() => this.renderSoon()))
    this.register(() => {
      if (this.timer !== null) window.clearTimeout(this.timer)
    })
    this.render()
  }

  private renderSoon(): void {
    if (this.timer !== null) window.clearTimeout(this.timer)
    this.timer = window.setTimeout(() => this.render(), REFRESH_DELAY)
  }

  private render(): void {
    this.listEl.replaceChildren()
    const tags = countTags(this.cache.allNotes())
    this.countEl.textContent = tags.length ? String(tags.length) : ''
    if (!tags.length) {
      el('div', 'zn-panel-empty', this.listEl, 'No tags yet. Add #tags to your notes.')
      return
    }
    for (const t of tags) {
      const row = el('div', 'zn-tag-item', this.listEl)
      row.style.paddingLeft = `${10 + t.depth * 14}px`
      el('span', 'zn-tag-name', row, t.depth ? `/${t.tag.split('/').pop()}` : t.tag)
      if (t.count) el('span', 'zn-tag-count', row, String(t.count))
      row.title = t.tag
      row.addEventListener('click', () => this.onTag(t.tag))
    }
  }
}
