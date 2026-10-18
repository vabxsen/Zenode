// A sidebar with icon tabs along the top and one pane shown at a time. The
// shown pane is remembered per sidebar.
import { el } from './component'
import { icon, type IconName } from './icons'

interface SidebarPane {
  id: string
  el: HTMLElement
  button: HTMLButtonElement
  // Told when the pane becomes visible or hidden (e.g. to pause a graph).
  onVisibility?(visible: boolean): void
}

export class Sidebar {
  readonly el: HTMLElement
  private readonly tabs: HTMLElement
  private readonly panes: SidebarPane[] = []
  private current: string | null = null

  constructor(
    parent: HTMLElement,
    className: string,
    private readonly storageKey: string,
    // Whether the sidebar itself is showing (it can be collapsed).
    private readonly isOpen: () => boolean
  ) {
    this.el = el('div', className, parent)
    this.tabs = el('div', 'zn-sidebar-tabs', this.el)
    this.tabs.setAttribute('role', 'tablist')
  }

  // Adds a pane and returns its container.
  add(id: string, iconName: IconName, title: string, paneClass = '', onVisibility?: (visible: boolean) => void): HTMLElement {
    const button = el('button', 'zn-sidebar-tab', this.tabs)
    button.title = title
    button.setAttribute('aria-label', title)
    button.setAttribute('role', 'tab')
    button.appendChild(icon(iconName, 16))
    button.addEventListener('click', () => this.show(id))
    const pane = el('div', `zn-pane${paneClass ? ` ${paneClass}` : ''}`, this.el)
    pane.setAttribute('role', 'tabpanel')
    pane.style.display = 'none'
    this.panes.push({ id, el: pane, button, onVisibility })
    return pane
  }

  get shown(): string | null {
    return this.current
  }

  show(id: string): void {
    if (!this.panes.some((p) => p.id === id)) return
    this.current = id
    try {
      localStorage.setItem(this.storageKey, id)
    } catch {
      // Not remembered across restarts.
    }
    for (const p of this.panes) {
      const on = p.id === id
      p.el.style.display = on ? '' : 'none'
      p.button.classList.toggle('is-active', on)
      p.button.setAttribute('aria-selected', String(on))
    }
    this.notifyVisibility()
  }

  // Shows the pane that was open last time (or `fallback`).
  restore(fallback: string): void {
    let saved: string | null = null
    try {
      saved = localStorage.getItem(this.storageKey)
    } catch {
      saved = null
    }
    this.show(saved && this.panes.some((p) => p.id === saved) ? saved : fallback)
  }

  // Call after the sidebar is collapsed or expanded.
  notifyVisibility(): void {
    const open = this.isOpen()
    for (const p of this.panes) p.onVisibility?.(open && p.id === this.current)
  }
}
