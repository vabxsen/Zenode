// Tells the user when a new version is ready (installed copies) or out
// (portable and zip copies), once per version.
import { showNotice } from './notices'

const api = window.zenode

export function watchUpdates(): () => void {
  const told = new Set<string>()
  return api.onUpdateStatus((s) => {
    const st = s.state
    if (st.status === 'ready' && !told.has(`ready ${st.version}`)) {
      told.add(`ready ${st.version}`)
      showNotice(`Zenode ${st.version} is ready. It installs when you restart.`, { label: 'Restart now', run: () => void api.installUpdate() })
    } else if (st.status === 'available' && s.kind !== 'installed' && !told.has(`out ${st.version}`)) {
      told.add(`out ${st.version}`)
      showNotice(`Zenode ${st.version} is out.`, { label: 'Download', run: () => void api.installUpdate() })
    }
  })
}
