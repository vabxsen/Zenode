// Small per-viewer UI memory kept in localStorage (sidebar width, which panes
// are shown). Storage can be unavailable; then things just aren't remembered.

const SIDEBAR_KEY = 'zenode.sidebarWidth'

export function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Storage unavailable; the setting just won't be remembered.
  }
}

// Drag the handle to resize the left sidebar (160-600 px, remembered).
export function setupSidebarResizer(handle: HTMLElement, sidebar: HTMLElement): void {
  const saved = Number(safeGet(SIDEBAR_KEY))
  if (saved >= 160 && saved <= 600) sidebar.style.width = `${saved}px`
  // Keyboard: focus the divider and use Left/Right.
  handle.setAttribute('role', 'separator')
  handle.setAttribute('aria-orientation', 'vertical')
  handle.setAttribute('aria-label', 'Resize the left sidebar')
  handle.setAttribute('aria-valuemin', '160')
  handle.setAttribute('aria-valuemax', '600')
  const report = (): void => handle.setAttribute('aria-valuenow', String(Math.round(sidebar.getBoundingClientRect().width) || 260))
  report()
  handle.tabIndex = 0
  handle.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const width = Math.max(160, Math.min(600, sidebar.getBoundingClientRect().width + (e.key === 'ArrowRight' ? 20 : -20)))
    sidebar.style.width = `${width}px`
    safeSet(SIDEBAR_KEY, String(Math.round(width)))
    report()
  })
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault()
    handle.setPointerCapture(e.pointerId)
    const startX = e.clientX
    const startW = sidebar.getBoundingClientRect().width
    const move = (ev: PointerEvent): void => {
      sidebar.style.width = `${Math.max(160, Math.min(600, startW + ev.clientX - startX))}px`
    }
    const up = (): void => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', up)
      safeSet(SIDEBAR_KEY, String(Math.round(sidebar.getBoundingClientRect().width)))
      report()
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', up)
  })
}
