// Short messages in the corner that fade after a few seconds. The area is a
// live region, so screen readers announce each one.
import { el } from './component'

const SHOW_MS = 4000
const FADE_MS = 400

export function showNotice(message: string): void {
  let host = document.querySelector<HTMLElement>('.zn-notices')
  if (!host) {
    host = el('div', 'zn-notices', document.body)
    host.setAttribute('role', 'status')
    host.setAttribute('aria-live', 'polite')
  }
  const item = el('div', 'zn-notice', host, message)
  window.setTimeout(() => item.classList.add('is-leaving'), SHOW_MS)
  window.setTimeout(() => item.remove(), SHOW_MS + FADE_MS)
}
