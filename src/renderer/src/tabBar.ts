// Draws a pane's tab bar: titles, dirty/conflict/pinned marks, close buttons,
// drag handles and the right-click menu.
import { el } from './component'
import { icon } from './icons'
import { showMenu } from './menu'
import { TAB_DRAG_TYPE, type Tab } from './paneTypes'

export interface TabBarHandlers {
  title(tab: Tab): string
  dragData(path: string): string
  onMenu(tab: Tab, x: number, y: number): void
  onClose(tab: Tab): void
  onActivate(tab: Tab): void
}

export function renderTabBar(bar: HTMLElement, tabs: Tab[], active: Tab | null, h: TabBarHandlers): void {
  bar.replaceChildren()
  bar.setAttribute('role', 'tablist')
  bar.setAttribute('aria-label', 'Open tabs')
  for (const tab of tabs) {
    const tabEl = el('div', 'zn-tab', bar)
    tabEl.setAttribute('role', 'tab')
    tabEl.setAttribute('aria-selected', String(tab === active))
    tabEl.tabIndex = tab === active ? 0 : -1
    if (tab === active) tabEl.classList.add('is-active')
    if (tab.dirty) tabEl.classList.add('is-dirty')
    if (tab.conflict) tabEl.classList.add('has-conflict')
    if (tab.kind === 'view') tabEl.classList.add('is-view')
    if (tab.pinned) tabEl.classList.add('is-pinned')
    el('span', 'zn-tab-title', tabEl, h.title(tab))
    tabEl.title = tab.kind === 'view' ? h.title(tab) : tab.path
    tabEl.draggable = true
    tabEl.addEventListener('dragstart', (e) => {
      e.dataTransfer?.setData(TAB_DRAG_TYPE, h.dragData(tab.path))
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
    })
    tabEl.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      h.onMenu(tab, e.clientX, e.clientY)
    })
    if (tab.pinned) {
      const pin = el('span', 'zn-tab-pin', tabEl)
      pin.title = 'Pinned (right-click to unpin)'
      pin.appendChild(icon('pin', 12))
    } else {
      const closeBtn = el('span', 'zn-tab-close', tabEl)
      closeBtn.setAttribute('role', 'button')
      closeBtn.setAttribute('aria-label', `Close ${h.title(tab)}`)
      closeBtn.appendChild(icon('close', 12))
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        h.onClose(tab)
      })
    }
    tabEl.addEventListener('mousedown', (e) => {
      if (e.button === 1) {
        e.preventDefault()
        h.onClose(tab)
      }
    })
    tabEl.addEventListener('click', () => h.onActivate(tab))
    // Left/Right move between tabs, Enter or Space shows one, Delete closes it.
    tabEl.addEventListener('keydown', (e) => {
      const i = tabs.indexOf(tab)
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        const next = (bar.children[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length] as HTMLElement | undefined)
        next?.focus()
      } else if (e.key === 'Enter' || e.key === ' ') {
        h.onActivate(tab)
      } else if (e.key === 'Delete') {
        h.onClose(tab)
      } else {
        return
      }
      e.preventDefault()
    })
  }
}

export interface TabMenuActions {
  close(): void
  closeOthers(): void
  togglePin(): void
  split(dir: 'right' | 'down'): void
  reveal(): void
}

export function showTabMenu(tab: Tab, x: number, y: number, a: TabMenuActions): void {
  const file = tab.kind === 'note' || tab.view?.filePath !== undefined
  showMenu(x, y, [
    { label: 'Close', action: a.close },
    { label: 'Close others', action: a.closeOthers },
    { label: tab.pinned ? 'Unpin' : 'Pin', action: a.togglePin },
    'separator',
    { label: 'Split right', action: () => a.split('right') },
    { label: 'Split down', action: () => a.split('down') },
    ...(file
      ? [
          'separator' as const,
          { label: 'Copy path', action: () => void navigator.clipboard.writeText(tab.path) },
          { label: 'Show in file tree', action: a.reveal }
        ]
      : [])
  ])
}

// Lets tabs dragged from any pane be dropped on this tab bar; onDrop gets the
// drag data and the index the tab should go to.
export function acceptTabDrops(bar: HTMLElement, onDrop: (data: string, index: number) => void): void {
  bar.addEventListener('dragover', (e) => {
    if (!e.dataTransfer?.types.includes(TAB_DRAG_TYPE)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    bar.classList.add('is-drop-target')
  })
  bar.addEventListener('dragleave', () => bar.classList.remove('is-drop-target'))
  bar.addEventListener('drop', (e) => {
    bar.classList.remove('is-drop-target')
    const data = e.dataTransfer?.getData(TAB_DRAG_TYPE)
    if (!data) return
    e.preventDefault()
    const tabs = [...bar.querySelectorAll<HTMLElement>('.zn-tab')]
    const i = tabs.findIndex((t) => {
      const r = t.getBoundingClientRect()
      return e.clientX < r.left + r.width / 2
    })
    onDrop(data, i === -1 ? tabs.length : i)
  })
}
