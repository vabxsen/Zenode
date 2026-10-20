// The status bar's sync state for this vault ("Synced", "Syncing…",
// "Sync problem"); hidden when signed out or sync is off. Opens Account settings.
import type { VaultSyncStatus } from '../../../shared/sync'
import { Component, el } from '../component'
import { describeSync } from './accountUi'

const api = window.zenode

function label(s: VaultSyncStatus): string {
  if (s.state.status === 'syncing') return 'Syncing…'
  if (s.state.status === 'error') return 'Sync problem'
  return 'Synced'
}

export class CloudStatus extends Component {
  private readonly button: HTMLButtonElement

  constructor(parent: HTMLElement, private readonly openSettings: () => void) {
    super()
    this.button = el('button', 'zn-status-cloud', parent)
    this.button.hidden = true
    this.button.addEventListener('click', () => this.openSettings())
  }

  onload(): void {
    this.register(api.onSyncStatus((s) => this.show(s)))
    void api.syncStatus().then((s) => s && this.show(s))
  }

  private show(s: VaultSyncStatus): void {
    const b = this.button
    b.hidden = !s.signedIn || !s.enabled || (s.state.status === 'idle' && !s.state.lastSync)
    b.textContent = label(s)
    b.title = describeSync(s)
    b.setAttribute('aria-label', `Sync: ${describeSync(s)}`)
    b.classList.toggle('is-error', s.state.status === 'error')
  }
}
