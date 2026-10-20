// Choosing a vault: create one, open a folder, open the Help vault, or pick a
// recent one (each removable from the list). Used by the welcome screen and by
// the "Manage vaults" dialog.
import { fileNameProblem } from '../../../shared/fileNames'
import { el } from '../component'
import { promptText } from '../dialog'
import { openRestoreDialog } from '../account/restoreDialog'
import { icon, type IconName } from '../icons'

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

function action(parent: HTMLElement, iconName: IconName, title: string, desc: string, run: () => Promise<void>, notice: (m: string) => void, primary = false): HTMLButtonElement {
  const b = el('button', `zn-vault-action${primary ? ' is-primary' : ''}`, parent)
  b.appendChild(icon(iconName, 18))
  const text = el('span', 'zn-vault-action-text', b)
  el('span', 'zn-vault-action-title', text, title)
  el('span', 'zn-vault-action-desc', text, desc)
  b.addEventListener('click', () => {
    run().catch((e: Error) => notice(e.message))
  })
  return b
}

export async function renderVaultChoices(container: HTMLElement, a: VaultActions): Promise<void> {
  const actions = el('div', 'zn-vault-actions', container)
  action(
    actions,
    'folderPlus',
    'Create a new vault',
    'A new, empty folder for your notes.',
    async () => {
      const name = await promptText('Create a new vault', 'Vault name', 'Choose a location…', fileNameProblem)
      if (name) await a.create(name)
    },
    a.notice,
    true
  )
  action(actions, 'folderOpen', 'Open folder as vault', 'Use a folder you already have, such as an Obsidian vault.', () => a.openFolder(), a.notice)
  action(actions, 'note', 'Open the Zenode Help vault', 'A short tour with examples of every feature.', () => a.openHelp(), a.notice)
  const restore = a.restore
  if (restore && (await window.zenode.accountState()).configured) {
    action(
      actions,
      'cloud',
      'Restore from your account',
      'Sign in with Google to bring back vaults you synced.',
      async () => openRestoreDialog((v) => restore(v.id), a.notice),
      a.notice
    )
  }

  const settings = await window.zenode.getSettings()
  if (!settings.recentVaults.length) return
  el('div', 'zn-welcome-section', container, 'Recent vaults')
  const list = el('div', 'zn-recent', container)
  list.setAttribute('role', 'list')
  for (const root of settings.recentVaults) {
    const item = el('div', 'zn-recent-item', list)
    item.setAttribute('role', 'listitem')
    const row = el('button', `zn-recent-row${root === a.current ? ' is-current' : ''}`, item)
    el('span', 'zn-recent-name', row, nameOf(root) + (root === a.current ? ' (this window)' : ''))
    el('span', 'zn-recent-path', row, root)
    row.addEventListener('click', () => void a.open(root).catch((e: Error) => a.notice(`Could not open vault: ${e.message}`)))
    const forget = el('button', 'zn-recent-forget', item, '×')
    forget.title = 'Remove from this list (the folder is not touched)'
    forget.setAttribute('aria-label', `Remove ${nameOf(root)} from recent vaults`)
    forget.addEventListener('click', async () => {
      await window.zenode.forgetVault(root)
      item.remove()
    })
  }
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
  el('div', 'zn-dialog-title', box, 'Vaults')
  const body = el('div', 'zn-dialog-body', box)
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
  void renderVaultChoices(body, {
    ...a,
    open: wrap(a.open as never) as VaultActions['open'],
    create: wrap(a.create as never) as VaultActions['create'],
    openFolder: wrap(a.openFolder),
    openHelp: wrap(a.openHelp)
  }).then(() => body.querySelector<HTMLElement>('button')?.focus())
}
