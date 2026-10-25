// The narrow strip of buttons on the far left: the left sidebar's toggle in
// the title bar row, then the app actions. Each button has a tooltip and an
// accessible name that include its shortcut.
import { el } from './component'
import { icon, type IconName } from './icons'

export type RibbonItem = [IconName, string, () => void]

export function buildRibbon(parent: HTMLElement, toggle: RibbonItem, items: RibbonItem[]): HTMLElement {
  const ribbon = el('div', 'zn-ribbon', parent)
  const top = el('div', 'zn-ribbon-top zn-drag', ribbon)
  addButton(top, toggle)
  const actions = el('div', 'zn-ribbon-actions', ribbon)
  actions.setAttribute('role', 'toolbar')
  actions.setAttribute('aria-label', 'App actions')
  actions.setAttribute('aria-orientation', 'vertical')
  for (const item of items) addButton(actions, item)
  return ribbon
}

function addButton(parent: HTMLElement, [name, label, action]: RibbonItem): void {
  const btn = el('button', 'zn-icon-btn zn-ribbon-btn', parent)
  btn.title = label
  btn.setAttribute('aria-label', label)
  btn.appendChild(icon(name, 16))
  btn.addEventListener('click', action)
}
