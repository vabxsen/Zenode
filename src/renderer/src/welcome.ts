// The first screen: open a folder as a vault, or a recent vault.
import { el } from './component'
import { icon } from './icons'

export interface WelcomeActions {
  chooseVault(): void
  openRecent(root: string): Promise<void>
}

export async function renderWelcome(root: HTMLElement, a: WelcomeActions): Promise<void> {
  root.empty()
  root.className = 'zn-app is-welcome'
  el('div', 'zn-titlebar zn-drag', root)
  const panel = el('div', 'zn-welcome', root)
  const brand = el('div', 'zn-welcome-brand', panel)
  brand.appendChild(icon('logo', 44))
  el('div', 'zn-welcome-name', brand, 'Zenode')
  el('div', 'zn-welcome-tag', panel, 'Your notes, connected. Plain Markdown files on your own disk.')

  const open = el('button', 'zn-btn zn-btn-primary', panel)
  open.appendChild(icon('folderOpen', 16))
  el('span', '', open, 'Open folder as vault')
  open.addEventListener('click', () => a.chooseVault())

  const settings = await window.zenode.getSettings()
  if (!settings.recentVaults.length) return
  el('div', 'zn-welcome-section', panel, 'Recent vaults')
  const list = el('div', 'zn-recent', panel)
  for (const vault of settings.recentVaults) {
    const row = el('button', 'zn-recent-row', list)
    el('span', 'zn-recent-name', row, vault.split(/[\\/]/).pop() ?? vault)
    el('span', 'zn-recent-path', row, vault)
    row.addEventListener('click', () => void a.openRecent(vault))
  }
}
