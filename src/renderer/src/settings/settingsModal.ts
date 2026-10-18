// The settings screen: sections listed on the left, the chosen one on the right.
// Every change applies and saves at once.
import { el } from '../component'

export interface SettingsSection {
  id: string
  name: string
  render(container: HTMLElement): void | Promise<void>
}

let open: { close(): void } | null = null

export function openSettings(sections: SettingsSection[], start = sections[0]?.id): void {
  open?.close()
  const bg = el('div', 'zn-modal-bg zn-settings-bg', document.body)
  const box = el('div', 'zn-settings', bg)
  box.setAttribute('role', 'dialog')
  box.setAttribute('aria-modal', 'true')
  box.setAttribute('aria-label', 'Settings')
  const nav = el('nav', 'zn-settings-nav', box)
  nav.setAttribute('aria-label', 'Settings sections')
  el('div', 'zn-settings-title', nav, 'Settings')
  const list = el('div', 'zn-settings-tabs', nav)
  list.setAttribute('role', 'tablist')
  list.setAttribute('aria-orientation', 'vertical')
  const body = el('div', 'zn-settings-body', box)
  body.setAttribute('role', 'tabpanel')
  body.tabIndex = -1
  const closeBtn = el('button', 'zn-settings-close', box, '×')
  closeBtn.setAttribute('aria-label', 'Close settings')

  const previousFocus = document.activeElement as HTMLElement | null
  const close = (): void => {
    window.removeEventListener('keydown', onKey, true)
    bg.remove()
    open = null
    previousFocus?.focus?.()
  }
  open = { close }

  const tabs = sections.map((s) => {
    const tab = el('button', 'zn-settings-tab', list, s.name)
    tab.setAttribute('role', 'tab')
    tab.id = `zn-settings-tab-${s.id}`
    tab.addEventListener('click', () => void show(s.id))
    return tab
  })
  // Sections may load data first; only the latest one asked for is shown.
  let shown = 0
  const show = async (id: string): Promise<void> => {
    const mine = ++shown
    const i = Math.max(0, sections.findIndex((s) => s.id === id))
    tabs.forEach((t, j) => {
      t.classList.toggle('is-active', i === j)
      t.setAttribute('aria-selected', String(i === j))
      t.tabIndex = i === j ? 0 : -1
    })
    body.setAttribute('aria-labelledby', tabs[i].id)
    const page = el('div', 'zn-settings-page')
    el('h2', 'zn-settings-heading', page, sections[i].name)
    await sections[i].render(page)
    if (mine !== shown) return
    body.replaceChildren(page)
    body.scrollTop = 0
  }

  // Up/Down move between sections; Escape closes; Tab stays inside the dialog.
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && !(e.target as HTMLElement).closest('.zn-hotkey-recording')) {
      e.preventDefault()
      e.stopPropagation()
      close()
      return
    }
    const target = e.target as HTMLElement
    if (target.closest('.zn-settings-tab') && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault()
      const i = tabs.indexOf(target as HTMLButtonElement)
      const next = tabs[(i + (e.key === 'ArrowDown' ? 1 : -1) + tabs.length) % tabs.length]
      next.focus()
      next.click()
    }
    if (e.key === 'Tab') {
      const focusable = [...box.querySelectorAll<HTMLElement>('button, input, select, textarea, [tabindex="0"]')].filter((n) => !n.hasAttribute('disabled') && n.offsetParent !== null)
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
  }
  window.addEventListener('keydown', onKey, true)
  closeBtn.addEventListener('click', close)
  bg.addEventListener('mousedown', (e) => {
    if (e.target === bg) close()
  })
  void show(start ?? sections[0].id).then(() => tabs[Math.max(0, sections.findIndex((s) => s.id === start))]?.focus())
}

export function closeSettings(): void {
  open?.close()
}
