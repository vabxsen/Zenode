// "Restore from your account" on the welcome screen: sign in with Google if
// needed, then pick a vault from the account to download to this computer.
import type { RemoteVault } from '../../../shared/sync'
import { el } from '../component'
import { renderRemoteVaults, signInButton } from './accountUi'

const api = window.zenode

export function openRestoreDialog(restore: (v: RemoteVault) => Promise<void>, notice: (m: string) => void): void {
  const bg = el('div', 'zn-modal-bg zn-dialog-bg', document.body)
  const box = el('div', 'zn-dialog zn-restore', bg)
  box.setAttribute('role', 'dialog')
  box.setAttribute('aria-modal', 'true')
  box.setAttribute('aria-labelledby', 'zn-restore-title')
  el('h2', 'zn-dialog-title', box, 'Restore from your account').id = 'zn-restore-title'
  const body = el('div', 'zn-dialog-body zn-restore-body', box)
  const footer = el('div', 'zn-dialog-footer', box)
  const close = (): void => {
    window.removeEventListener('keydown', onKey, true)
    bg.remove()
  }
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
    }
  }
  window.addEventListener('keydown', onKey, true)
  el('button', 'zn-btn', footer, 'Close').addEventListener('click', close)
  bg.addEventListener('mousedown', (e) => {
    if (e.target === bg) close()
  })

  const show = async (): Promise<void> => {
    body.replaceChildren()
    const state = await api.accountState()
    if (!state.configured) {
      el('p', 'zn-restore-text', body, 'Sync is not available in this build of Zenode.')
      return
    }
    if (!state.account) {
      el('p', 'zn-restore-text', body, 'Sign in with the Google account you used before, and pick a vault to bring back.')
      signInButton(body, () => void show(), notice)
      body.querySelector<HTMLButtonElement>('button')?.focus()
      return
    }
    el('p', 'zn-restore-text', body, `Signed in as ${state.account.email}. Pick a vault, then a folder to put it in.`)
    await renderRemoteVaults(
      body,
      async (v) => {
        await restore(v)
        close()
      },
      notice
    )
    body.querySelector<HTMLButtonElement>('button')?.focus()
  }
  void show()
}
