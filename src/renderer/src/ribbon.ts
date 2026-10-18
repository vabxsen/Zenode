// The narrow strip of buttons on the far left. Each button has a tooltip and
// an accessible name that include its shortcut.
import { el } from './component'
import { icon, type IconName } from './icons'

export type RibbonItem = [IconName, string, () => void] | 'spacer'

export function buildRibbon(parent: HTMLElement, items: RibbonItem[]): HTMLElement {
  const ribbon = el('div', 'zn-ribbon', parent)
  ribbon.setAttribute('role', 'toolbar')
  ribbon.setAttribute('aria-label', 'App actions')
  ribbon.setAttribute('aria-orientation', 'vertical')
  for (const item of items) {
    if (item === 'spacer') {
      el('div', 'zn-ribbon-spacer', ribbon)
      continue
    }
    const [name, label, action] = item
    const btn = el('button', 'zn-ribbon-btn', ribbon)
    btn.title = label
    btn.setAttribute('aria-label', label)
    btn.appendChild(icon(name, 18))
    btn.addEventListener('click', action)
  }
  return ribbon
}
