// The first screen: create a vault, open a folder or the Help vault, or pick a recent one.
import { el } from './component'
import { renderVaultChoices, starterLayout, type VaultActions } from './vaults/vaultPicker'

export async function renderWelcome(root: HTMLElement, a: VaultActions): Promise<void> {
  root.empty()
  root.className = 'zn-app is-welcome'
  const panel = el('main', 'zn-welcome', root)
  panel.setAttribute('aria-label', 'Welcome to Zenode')
  // The top edge moves the window (it has no title bar of its own).
  el('div', 'zn-welcome-drag zn-drag', root)
  const { main, recent } = starterLayout(panel)
  await renderVaultChoices(main, recent, a)
  main.querySelector<HTMLElement>('.zn-btn')?.focus()
}
