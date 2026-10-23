// Choosing a vault: create one, open a folder, open the Help vault, or pick a
// recent one (each removable from the list). Used by the welcome screen and by
// the "Manage vaults" dialog.
import { fileNameProblem } from '../../../shared/fileNames'
import { el } from '../component'
import { promptText } from '../dialog'
import { openRestoreDialog } from '../account/restoreDialog'
import { icon } from '../icons'
import { logoMark } from '../logo'

export interface VaultActions {
  // The vault open in this window, if any (marked in the list).
  current: string | null
  open(root: string): Promise<void>
  create(name: string): Promise<void>
  openFolder(): Promise<void>
  openHelp(): Promise<void>
  // Downloads a vault from the Zenode account (welcome screen only).
  restore?(remoteId: string): Promise<void>
  notice(message: string): void
}

const nameOf = (root: string): string => root.split(/[\\/]/).filter(Boolean).pop() ?? root

// One option: its name and a line about it, with a button at the end. The
// whole row responds to a click.
function action(parent: HTMLElement, title: string, desc: string, button: string, run: () => Promise<void>, notice: (m: string) => void, primary = false): HTMLElement {
  const row = el('div', 'zn-vault-action', parent)
  const text = el('div', 'zn-vault-action-text', row)
  el('div', 'zn-vault-action-title', text, title)
  el('div', 'zn-vault-action-desc', text, desc)
  const b = el('button', `zn-btn${primary ? ' zn-btn-primary' : ''}`, row, button)
  b.setAttribute('aria-label', title)
  row.addEventListener('click', () => {
    run().catch((e: Error) => notice(e.message))
  })
  return row
}

// The vault chooser: recent vaults listed in `recentHost`, and Zenode's name,
// version and the ways to open a vault in `main`.
export async function renderVaultChoices(main: HTMLElement, recentHost: HTMLElement, a: VaultActions): Promise<void> {
  const brand = el('div', 'zn-starter-brand', main)
  brand.appendChild(logoMark(72))
  el('h1', 'zn-starter-name', brand, 'Zenode')
  const version = el('div', 'zn-starter-version', brand)
  void window.zenode.appInfo().then((info) => (version.textContent = `Version ${info.version}`), () => undefined)

  const actions = el('div', 'zn-vault-actions', main)
  action(
    actions,
    'Create a new vault',
    'A new, empty folder for your notes.',
    'Create',
    async () => {
      const name = await promptText('Create a new vault', 'Vault name', 'Choose a location…', fileNameProblem)
      if (name) await a.create(name)
    },
    a.notice,
    true
  )
  action(actions, 'Open folder as vault', 'Use a folder you already have, such as an Obsidian vault.', 'Open', () => a.openFolder(), a.notice)
  action(actions, 'Open the Zenode Help vault', 'A short tour with examples of every feature.', 'Open', () => a.openHelp(), a.notice)
  const restore = a.restore
  if (restore && (await window.zenode.accountState()).configured) {
    action(actions, 'Restore from your account', 'Sign in with Google to bring back vaults you synced.', 'Restore', async () => openRestoreDialog((v) => restore(v.id), a.notice), a.notice)
  }

  const settings = await window.zenode.getSettings()
  recentHost.classList.toggle('is-empty', !settings.recentVaults.length)
  if (!settings.recentVaults.length) return
  const list = el('div', 'zn-recent', recentHost)
  list.setAttribute('role', 'list')
  list.setAttribute('aria-label', 'Recent vaults')
  for (const root of settings.recentVaults) {
    const item = el('div', 'zn-recent-item', list)
    item.setAttribute('role', 'listitem')
    const row = el('button', `zn-recent-row${root === a.current ? ' is-current' : ''}`, item)
    el('span', 'zn-recent-name', row, nameOf(root) + (root === a.current ? ' (this window)' : ''))
    el('span', 'zn-recent-path', row, root)
    row.addEventListener('click', () => void a.open(root).catch((e: Error) => a.notice(`Could not open vault: ${e.message}`)))
    const forget = el('button', 'zn-icon-btn zn-recent-forget', item)
    forget.appendChild(icon('close', 16))
    forget.title = 'Remove from this list (the folder is not touched)'
    forget.setAttribute('aria-label', `Remove ${nameOf(root)} from recent vaults`)
    forget.addEventListener('click', async () => {
      await window.zenode.forgetVault(root)
      item.remove()
    })
  }
}

// The chooser's two columns inside `parent`; returns them.
export function starterLayout(parent: HTMLElement): { main: HTMLElement; recent: HTMLElement } {
  const starter = el('div', 'zn-starter', parent)
  const recent = el('div', 'zn-starter-recent', starter)
  const main = el('div', 'zn-starter-main', starter)
  return { main, recent }
}

let openModal: (() => void) | null = null

// The "Manage vaults" dialog (Ctrl+Shift+O).
export function openVaultManager(a: VaultActions): void {
  openModal?.()
  const bg = el('div', 'zn-modal-bg zn-dialog-bg', document.body)
  const box = el('div', 'zn-dialog zn-vault-manager', bg)
  box.setAttribute('role', 'dialog')
  box.setAttribute('aria-modal', 'true')
  box.setAttribute('aria-label', 'Vaults')
  const { main: body, recent } = starterLayout(box)
  const close = (): void => {
    window.removeEventListener('keydown', onKey, true)
    bg.remove()
    openModal = null
  }
  openModal = close
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && !document.querySelector('.zn-prompt')) {
      e.preventDefault()
      e.stopPropagation()
      close()
    }
  }
  window.addEventListener('keydown', onKey, true)
  bg.addEventListener('mousedown', (e) => {
    if (e.target === bg) close()
  })
  // Picking anything closes the dialog.
  const wrap = (run: (...args: never[]) => Promise<void>) => async (...args: never[]): Promise<void> => {
    await run(...args)
    close()
  }
  void renderVaultChoices(body, recent, {
    ...a,
    open: wrap(a.open as never) as VaultActions['open'],
    create: wrap(a.create as never) as VaultActions['create'],
    openFolder: wrap(a.openFolder),
    openHelp: wrap(a.openHelp)
  }).then(() => body.querySelector<HTMLElement>('button')?.focus())
}
