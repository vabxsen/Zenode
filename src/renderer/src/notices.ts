// Short messages in the corner that fade after a few seconds. The area is a
// live region, so screen readers announce each one.
import { el } from './component'

const SHOW_MS = 4000
// Notices with a button stay longer, so there is time to use it.
const ACTION_SHOW_MS = 15000
const FADE_MS = 400

export interface NoticeAction {
  label: string
  run(): void
}

export function showNotice(message: string, action?: NoticeAction): void {
  let host = document.querySelector<HTMLElement>('.zn-notices')
  if (!host) {
    host = el('div', 'zn-notices', document.body)
    host.setAttribute('role', 'status')
    host.setAttribute('aria-live', 'polite')
  }
  const item = el('div', 'zn-notice', host, message)
  const showFor = action ? ACTION_SHOW_MS : SHOW_MS
  if (action) {
    const b = el('button', 'zn-btn zn-notice-action', item, action.label)
    b.addEventListener('click', () => {
      item.remove()
      action.run()
    })
  }
  window.setTimeout(() => item.classList.add('is-leaving'), showFor)
  window.setTimeout(() => item.remove(), showFor + FADE_MS)
}
