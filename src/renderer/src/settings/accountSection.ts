// Settings > Account & sync: sign in with Google, this vault's sync, and the
// vaults in the account (any of which can be restored to this computer).
import type { VaultSyncStatus } from '../../../shared/sync'
import { describeSync, renderRemoteVaults, signInButton } from '../account/accountUi'
import { el } from '../component'
import { button, heading, settingRow, toggle } from './controls'
import type { SettingsSection } from './settingsModal'

const api = window.zenode

async function render(c: HTMLElement, notice: (m: string) => void): Promise<void> {
  c.replaceChildren()
  const again = (): void => void render(c, notice)
  const state = await api.accountState()
  heading(c, 'Account')
  if (!state.configured) {
    settingRow(c, 'Sync is not available', 'This build of Zenode was made without sync settings.')
    return
  }
  if (!state.account) {
    const { control } = settingRow(c, 'Sync with your Google account', 'Sign in to keep every vault in your account. On a new or reset computer, sign in again to get them all back.')
    signInButton(control, again, notice)
    return
  }
  const a = state.account
  button(c, `Signed in as ${a.name}`, a.email, 'Sign out', async () => {
    await api.signOut()
    again()
  })

  heading(c, 'This vault')
  const first = (await api.syncStatus()) as VaultSyncStatus
  toggle(c, 'Sync this vault', 'Keeps this vault in your account, and in step with your other computers.', first.enabled, (on) => {
    void api.setSyncEnabled(on).catch((e: Error) => notice(e.message))
  })
  const { row, control } = settingRow(c, 'Status', describeSync(first))
  const desc = row.querySelector<HTMLElement>('.zn-set-desc')!
  desc.classList.add('zn-sync-status')
  desc.setAttribute('aria-live', 'polite')
  const now = el('button', 'zn-btn zn-set-button', control, 'Sync now')
  now.addEventListener('click', () => void api.syncNow().catch((e: Error) => notice(e.message)))
  const skipped = el('p', 'zn-sync-skipped', c)
  const show = (s: VaultSyncStatus): void => {
    desc.textContent = describeSync(s)
    now.disabled = !s.enabled || s.state.status === 'syncing'
    skipped.hidden = s.skipped === 0
    skipped.textContent = `${s.skipped} ${s.skipped === 1 ? 'file is' : 'files are'} not synced yet: images, PDFs and other attachments, and text files over 900 KB. Notes, canvases and settings sync.`
  }
  show(first)
  const stop = api.onSyncStatus((s) => (desc.isConnected ? show(s) : stop()))

  heading(c, 'Vaults in your account')
  await renderRemoteVaults(
    c,
    async (v) => {
      await api.restoreVault(v.id)
      notice(`${v.name} restored. It opened in a new window.`)
      again()
    },
    notice
  )
}

export function accountSection(notice: (m: string) => void): SettingsSection {
  return { id: 'account', name: 'Account & sync', render: (c) => render(c, notice) }
}
