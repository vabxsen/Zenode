// Page preview: hovering an internal link shows the note (or the linked heading
// or block) in a popover. In Reading view and embeds a plain hover is enough; in
// the editor hold Ctrl, so the popover doesn't get in the way of writing.
import { Component, el } from './component'
import { renderInto, type ReadingContext } from './render/reading'
import { splitWikiTarget } from './render/markdown'
import { extractSection } from './render/sections'
import { baseName, stripExt } from './paths'

const SHOW_DELAY = 350
const HIDE_DELAY = 250

export interface HoverDeps {
  // The note a link in the editor belongs to.
  activePath(): string | null
  readingContext(path: string): Omit<ReadingContext, 'sourcePath' | 'onToggleTask'>
}

export class HoverPreview extends Component {
  private popover: HTMLElement | null = null
  private showTimer: number | null = null
  private hideTimer: number | null = null
  private anchor: HTMLElement | null = null

  constructor(
    private readonly root: HTMLElement,
    private readonly deps: HoverDeps
  ) {
    super()
  }

  onload(): void {
    this.registerDomEvent(this.root, 'mouseover', (e) => this.onOver(e))
    this.registerDomEvent(this.root, 'mouseout', (e) => this.onOut(e))
    this.registerDomEvent(window, 'keydown', (e) => {
      if (e.key === 'Escape') this.hide()
    })
    this.registerDomEvent(window, 'blur', () => this.hide())
    this.register(() => this.hide())
  }

  private onOver(e: MouseEvent): void {
    const target = e.target as HTMLElement
    if (this.popover?.contains(target)) this.cancelHide()
    const link = target.closest<HTMLElement>('[data-zn-wikilink]')
    if (!link || link === this.anchor) return
    const inEditor = !!link.closest('.cm-editor') && !link.closest('.zn-lp-embed, .zn-rendered')
    if (inEditor && !(e.ctrlKey || e.metaKey)) return
    this.cancelShow()
    this.showTimer = window.setTimeout(() => void this.show(link), SHOW_DELAY)
  }

  private onOut(e: MouseEvent): void {
    const to = e.relatedTarget as HTMLElement | null
    if (to && (this.popover?.contains(to) || (this.anchor && this.anchor.contains(to)))) return
    this.cancelShow()
    if (this.popover) this.scheduleHide()
  }

  private async show(link: HTMLElement): Promise<void> {
    const source = link.closest<HTMLElement>('[data-zn-source]')?.dataset.znSource ?? this.deps.activePath() ?? ''
    const { link: name, subpath } = splitWikiTarget(link.dataset.znWikilink ?? '')
    const ctx = this.deps.readingContext(source)
    const path = name ? ctx.resolve(name, source) : source
    if (!path || !path.toLowerCase().endsWith('.md')) return
    const text = await ctx.readNote(path)
    if (text === null) return
    const part = extractSection(text, subpath) ?? text
    this.hide()
    this.anchor = link
    const pop = el('div', 'zn-hover', document.body)
    pop.dataset.znSource = path
    const header = el('div', 'zn-hover-title', pop, stripExt(baseName(path)) + (subpath ? ` › ${subpath.replace(/^#\^?/, '')}` : ''))
    header.title = path
    const body = el('div', 'zn-hover-body', pop)
    this.popover = pop
    this.position(pop, link)
    pop.addEventListener('mouseenter', () => this.cancelHide())
    pop.addEventListener('mouseleave', () => this.scheduleHide())
    // Following a link from the preview closes it.
    pop.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('a')) this.hide()
    })
    await renderInto(body, part, { ...ctx, sourcePath: path })
    if (this.popover === pop) this.position(pop, link)
  }

  // Below the link if there's room, otherwise above; kept inside the window.
  private position(pop: HTMLElement, link: HTMLElement): void {
    const r = link.getBoundingClientRect()
    const width = Math.min(460, window.innerWidth - 24)
    pop.style.width = `${width}px`
    const left = Math.max(12, Math.min(r.left, window.innerWidth - width - 12))
    const height = pop.offsetHeight
    const below = r.bottom + 8
    const top = below + height > window.innerHeight - 12 && r.top - height - 8 > 12 ? r.top - height - 8 : below
    pop.style.left = `${left}px`
    pop.style.top = `${Math.max(12, top)}px`
  }

  private scheduleHide(): void {
    this.cancelHide()
    this.hideTimer = window.setTimeout(() => this.hide(), HIDE_DELAY)
  }

  private cancelHide(): void {
    if (this.hideTimer !== null) window.clearTimeout(this.hideTimer)
    this.hideTimer = null
  }

  private cancelShow(): void {
    if (this.showTimer !== null) window.clearTimeout(this.showTimer)
    this.showTimer = null
  }

  hide(): void {
    this.cancelShow()
    this.cancelHide()
    this.popover?.remove()
    this.popover = null
    this.anchor = null
  }
}
