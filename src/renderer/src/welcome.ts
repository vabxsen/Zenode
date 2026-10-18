// The first screen: create a vault, open a folder or the Help vault, or pick a recent one.
import { el } from './component'
import { icon } from './icons'
import { renderVaultChoices, type VaultActions } from './vaults/vaultPicker'

export async function renderWelcome(root: HTMLElement, a: VaultActions): Promise<void> {
  root.empty()
  root.className = 'zn-app is-welcome'
  el('div', 'zn-titlebar zn-drag', root)
  const panel = el('main', 'zn-welcome', root)
  panel.setAttribute('aria-label', 'Welcome to Zenode')
  const brand = el('div', 'zn-welcome-brand', panel)
  brand.appendChild(icon('logo', 44))
  el('h1', 'zn-welcome-name', brand, 'Zenode')
  el('div', 'zn-welcome-tag', panel, 'Your notes, connected. Plain Markdown files on your own disk.')
  await renderVaultChoices(panel, a)
  panel.querySelector<HTMLElement>('button')?.focus()
}
