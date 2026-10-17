import { el } from './component'

export interface MenuItem {
  label: string
  action: () => void
  danger?: boolean
}

let openMenu: HTMLElement | null = null

export function closeMenu(): void {
  openMenu?.remove()
  openMenu = null
}

// A small dark context menu that closes on outside click, Escape, or blur.
export function showMenu(x: number, y: number, items: Array<MenuItem | 'separator'>): void {
  closeMenu()
  const menu = el('div', 'zn-menu', document.body)
  for (const item of items) {
    if (item === 'separator') {
      el('div', 'zn-menu-sep', menu)
      continue
    }
    const row = el('div', `zn-menu-item${item.danger ? ' is-danger' : ''}`, menu, item.label)
    row.addEventListener('mousedown', (e) => e.preventDefault())
    row.addEventListener('click', () => {
      closeMenu()
      item.action()
    })
  }
  const { innerWidth, innerHeight } = window
  const rect = menu.getBoundingClientRect()
  menu.style.left = `${Math.min(x, innerWidth - rect.width - 8)}px`
  menu.style.top = `${Math.min(y, innerHeight - rect.height - 8)}px`
  openMenu = menu
}

window.addEventListener('mousedown', (e) => {
  if (openMenu && !openMenu.contains(e.target as Node)) closeMenu()
})
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeMenu()
})
window.addEventListener('blur', closeMenu)
