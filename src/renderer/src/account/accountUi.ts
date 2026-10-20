// Pieces of the account UI shared by Settings and the welcome screen: the
// "Sign in with Google" button (with a way to cancel while the browser is
// open), the list of vaults in the account, and how sync status reads.
import type { RemoteVault, VaultSyncStatus } from '../../../shared/sync'
import { el } from '../component'

const api = window.zenode

export function timeAgo(ms: number, now = Date.now()): string {
  const s = Math.round((now - ms) / 1000)
  if (s < 45) return 'just now'
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  if (s < 3600) return rtf.format(-Math.round(s / 60), 'minute')
  if (s < 86400) return rtf.format(-Math.round(s / 3600), 'hour')
  return rtf.format(-Math.round(s / 86400), 'day')
}

export function describeSync(s: VaultSyncStatus): string {
  if (!s.signedIn) return 'Sign in to sync your vaults.'
  if (!s.enabled) return 'Sync is off for this vault.'
  const st = s.state
  if (st.status === 'syncing') return 'Syncing…'
  if (st.status === 'error') return `Could not sync: ${st.message}`
  if (st.status === 'idle') return st.lastSync ? `Synced ${timeAgo(st.lastSync)}.` : 'Waiting to sync.'
  return 'Sync is off for this vault.'
}

// "Sign in with Google": while the browser is open, the button becomes a
// waiting message with Cancel. Calls done() once signed in.
export function signInButton(parent: HTMLElement, done: () => void, notice: (m: string) => void): HTMLElement {
  const wrap = el('div', 'zn-signin', parent)
  const button = el('button', 'zn-btn zn-signin-button', wrap, 'Sign in with Google')
  const waiting = el('div', 'zn-signin-waiting', wrap)
  waiting.hidden = true
  el('span', '', waiting, 'Finish signing in in your browser…')
  const cancel = el('button', 'zn-btn', waiting, 'Cancel')
  button.addEventListener('click', async () => {
    button.hidden = true
    waiting.hidden = false
    try {
      const s = await api.signIn()
      if (s.account) done()
    } catch (e) {
      const message = (e as Error).message
      if (!/cancelled/i.test(message)) notice(message)
    } finally {
      button.hidden = false
      waiting.hidden = true
    }
  })
  cancel.addEventListener('click', () => void api.cancelSignIn())
  return wrap
}

// The vaults in the account, newest first, each with Restore (or a note that
// it is already on this computer).
export async function renderRemoteVaults(parent: HTMLElement, restore: (v: RemoteVault) => Promise<void>, notice: (m: string) => void): Promise<void> {
  const list = el('div', 'zn-remote-vaults', parent)
  list.setAttribute('role', 'list')
  let vaults: RemoteVault[]
  try {
    vaults = await api.remoteVaults()
  } catch (e) {
    el('div', 'zn-remote-empty', list, `Could not load your vaults: ${(e as Error).message}`)
    return
  }
  if (!vaults.length) {
    el('div', 'zn-remote-empty', list, 'No vaults in your account yet. Open a vault and it syncs here.')
    return
  }
  for (const v of vaults) {
    const row = el('div', 'zn-remote-vault', list)
    row.setAttribute('role', 'listitem')
    const text = el('div', 'zn-remote-text', row)
    el('div', 'zn-remote-name', text, v.name)
    el('div', 'zn-remote-meta', text, v.localRoot ? `On this computer: ${v.localRoot}` : `Changed ${timeAgo(v.updatedAt)}`)
    if (v.localRoot) continue
    const b = el('button', 'zn-btn', row, 'Restore')
    b.setAttribute('aria-label', `Restore ${v.name}`)
    b.addEventListener('click', async () => {
      b.disabled = true
      b.textContent = 'Restoring…'
      try {
        await restore(v)
      } catch (e) {
        notice(`Could not restore ${v.name}: ${(e as Error).message}`)
      } finally {
        b.disabled = false
        b.textContent = 'Restore'
      }
    })
  }
}
