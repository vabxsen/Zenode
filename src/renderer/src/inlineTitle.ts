// The note's name as a large title above its text. It can be edited in place:
// Enter (or leaving it) renames the file, Escape puts the old name back.
import { el } from './component'

export class InlineTitle {
  readonly el: HTMLElement
  private name = ''
  private resize: ResizeObserver

  constructor(
    // Renames the note; resolves false when that didn't happen.
    private readonly rename: (name: string) => Promise<boolean>,
    // Moves on into the note's text (after Enter).
    private readonly leave: () => void,
    // The title's height changed (the editor makes room for it).
    onResize: (height: number) => void
  ) {
    this.el = el('div', 'zn-inline-title')
    this.el.contentEditable = 'plaintext-only'
    this.el.spellcheck = false
    this.el.setAttribute('role', 'textbox')
    this.el.setAttribute('aria-label', 'Note name')
    this.el.addEventListener('keydown', (e) => this.onKey(e))
    this.el.addEventListener('blur', () => void this.commit())
    // Pasted text arrives as one plain line.
    this.el.addEventListener('paste', (e) => {
      e.preventDefault()
      const text = (e.clipboardData?.getData('text/plain') ?? '').replace(/\s+/g, ' ')
      document.execCommand('insertText', false, text)
    })
    this.resize = new ResizeObserver(() => onResize(this.el.isConnected ? this.el.offsetHeight : 0))
    this.resize.observe(this.el)
  }

  // Shows `name` in `parent` (first child), or hides the title when name is null.
  show(name: string | null, parent: HTMLElement | null): void {
    if (name === null || !parent) {
      this.el.remove()
      return
    }
    if (this.el.parentElement !== parent || parent.firstChild !== this.el) parent.prepend(this.el)
    if (this.name !== name || document.activeElement !== this.el) {
      this.name = name
      this.el.textContent = name
    }
  }

  destroy(): void {
    this.resize.disconnect()
    this.el.remove()
  }

  private onKey(e: KeyboardEvent): void {
    if (e.key === 'Enter' || e.key === 'ArrowDown') {
      if (e.key === 'ArrowDown' && !this.atEnd()) return
      e.preventDefault()
      this.leave()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      this.el.textContent = this.name
      this.leave()
    }
  }

  private atEnd(): boolean {
    const sel = window.getSelection()
    return !!sel && sel.isCollapsed && sel.focusOffset === (sel.focusNode?.textContent ?? '').length
  }

  private async commit(): Promise<void> {
    const next = (this.el.textContent ?? '').trim()
    if (!next || next === this.name) {
      this.el.textContent = this.name
      return
    }
    if (!(await this.rename(next))) this.el.textContent = this.name
  }
}
