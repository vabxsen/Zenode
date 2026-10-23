// The bar above a pane's note or view: back and forward buttons, the open
// file's folder path and name, a button that switches between editing and
// Reading view, and a menu of more actions.
import { el } from './component'
import { icon, type IconName } from './icons'
import { showMenu, type MenuItem } from './menu'

export interface PaneHeaderState {
  // What the pane shows: a note, another kind of tab (graph, canvas), or nothing.
  kind: 'note' | 'view' | null
  // The file's vault path, or the view's title.
  path: string
  title: string
  mode: 'live' | 'source' | 'reading' | null
  canBack: boolean
  canForward: boolean
}

export interface PaneHeaderActions {
  go(step: 1 | -1): void
  toggleReading(): void
  toggleSource(): void
  // The tab's own menu items (close, split, copy path...).
  tabMenu(): Array<MenuItem | 'separator'>
}

export class PaneHeader {
  readonly el: HTMLElement
  private readonly back: HTMLButtonElement
  private readonly forward: HTMLButtonElement
  private readonly title: HTMLElement
  private readonly modeBtn: HTMLButtonElement
  private readonly moreBtn: HTMLButtonElement
  private state: PaneHeaderState | null = null

  constructor(parent: HTMLElement, private readonly actions: PaneHeaderActions) {
    this.el = el('div', 'zn-view-header', parent)
    const nav = el('div', 'zn-view-header-nav', this.el)
    this.back = button(nav, 'arrowLeft', 'Navigate back (Alt+Left)', () => actions.go(-1))
    this.forward = button(nav, 'arrowRight', 'Navigate forward (Alt+Right)', () => actions.go(1))
    this.title = el('div', 'zn-view-title', this.el)
    const right = el('div', 'zn-view-actions', this.el)
    this.modeBtn = button(right, 'reading', '', () => actions.toggleReading())
    this.moreBtn = button(right, 'more', 'More options', (e) => this.showMore(e))
  }

  update(state: PaneHeaderState): void {
    this.state = state
    this.el.style.display = state.kind ? '' : 'none'
    this.back.disabled = !state.canBack
    this.forward.disabled = !state.canForward
    this.renderTitle(state)
    const note = state.kind === 'note'
    this.modeBtn.style.display = note ? '' : 'none'
    if (note) {
      const reading = state.mode === 'reading'
      const label = reading ? 'Current view: reading. Click to edit (Ctrl+E)' : 'Current view: editing. Click to read (Ctrl+E)'
      this.modeBtn.replaceChildren(icon(reading ? 'editing' : 'reading', 16))
      this.modeBtn.title = label
      this.modeBtn.setAttribute('aria-label', label)
    }
  }

  // "Folder / Sub / Name", with the folders greyed.
  private renderTitle(state: PaneHeaderState): void {
    this.title.replaceChildren()
    if (state.kind !== 'note' && !state.path.includes('/')) {
      el('span', 'zn-view-title-name', this.title, state.title)
      return
    }
    const parts = state.path.split('/').slice(0, -1)
    for (const part of parts) {
      el('span', 'zn-view-title-parent', this.title, part)
      el('span', 'zn-view-title-sep', this.title, '/')
    }
    el('span', 'zn-view-title-name', this.title, state.title)
    this.title.title = state.path
  }

  private showMore(e: MouseEvent): void {
    const s = this.state
    if (!s) return
    const r = this.moreBtn.getBoundingClientRect()
    const items: Array<MenuItem | 'separator'> = []
    if (s.kind === 'note') {
      items.push(
        { label: s.mode === 'reading' ? 'Edit' : 'Reading view', icon: s.mode === 'reading' ? 'editing' : 'reading', action: () => this.actions.toggleReading() },
        { label: s.mode === 'source' ? 'Live Preview' : 'Source mode', action: () => this.actions.toggleSource() },
        'separator'
      )
    }
    items.push(...this.actions.tabMenu())
    e.stopPropagation()
    showMenu(r.right - 4, r.bottom + 4, items)
  }
}

function button(parent: HTMLElement, name: IconName, label: string, action: (e: MouseEvent) => void): HTMLButtonElement {
  const b = el('button', 'zn-icon-btn', parent)
  if (label) {
    b.title = label
    b.setAttribute('aria-label', label)
  }
  b.appendChild(icon(name, 16))
  b.addEventListener('click', action)
  return b
}
