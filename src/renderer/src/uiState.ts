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
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', up)
  })
}
