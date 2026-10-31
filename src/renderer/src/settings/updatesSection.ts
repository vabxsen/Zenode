// Settings > General > Updates: status, "Check now", automatic checks and the channel.
import { describeUpdate, type UpdateChannel, type UpdateStatus } from '../../../shared/updates'
import { el } from '../component'
import { dropdown, heading, settingRow, toggle } from './controls'

const api = window.zenode

// The button's job in each state (development and Store copies have no button).
function action(s: UpdateStatus): { label: string; run: () => Promise<unknown> } {
  const st = s.state.status
  if (st === 'ready') return { label: 'Restart to update', run: () => api.installUpdate() }
  if (st === 'available' && s.kind !== 'installed') return { label: 'Download', run: () => api.installUpdate() }
  return { label: 'Check now', run: () => api.checkForUpdates() }
}

export async function renderUpdates(c: HTMLElement): Promise<void> {
  heading(c, 'Updates')
  const first = await api.updateStatus()
  const { row, control } = settingRow(c, 'Status', describeUpdate(first))
  const desc = row.querySelector<HTMLElement>('.zn-set-desc')!
  desc.setAttribute('aria-live', 'polite')
  desc.classList.add('zn-update-status')
  // Development copies don't update, and the Store updates its own.
  const managed = first.kind === 'dev' || first.kind === 'store'
  const btn = managed ? null : el('button', 'zn-btn zn-set-button', control)
  let current = first
  btn?.addEventListener('click', () => void action(current).run())

  const show = (s: UpdateStatus): void => {
    current = s
    desc.textContent = describeUpdate(s)
    if (!btn) return
    btn.textContent = action(s).label
    btn.disabled = s.state.status === 'checking' || s.state.status === 'downloading'
  }
  show(first)
  // Follows the updater while this page is showing.
  const stop = api.onUpdateStatus((s) => (desc.isConnected ? show(s) : stop()))

  if (managed) return
  toggle(c, 'Check automatically', 'Asks GitHub for new versions when Zenode starts and every few hours. Nothing else is sent.', first.prefs.autoCheck, (v) => void api.setUpdatePrefs({ autoCheck: v }))
  dropdown<UpdateChannel>(
    c,
    'Update channel',
    'Beta gets new features first, and may have more bugs.',
    [['stable', 'Stable'], ['beta', 'Beta']],
    first.prefs.channel,
    (v) => void api.setUpdatePrefs({ channel: v })
  )
  if (first.kind !== 'installed') settingRow(c, 'Portable copy', 'This copy of Zenode does not update itself. New versions are downloaded from GitHub.')
}
