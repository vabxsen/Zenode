import 'katex/dist/katex.min.css'
import './styles/themes.css'
import './styles.css'
import './styles/reading.css'
import './styles/livepreview.css'
import './styles/editor-tools.css'
import './styles/workspace.css'
import './styles/panels.css'
import './styles/properties.css'
import './styles/fileviews.css'
import './styles/settings.css'
import './styles/vaults.css'
import './styles/a11y.css'
import { App } from './app'

// Anything that slips past local error handling goes to the app log.
const describe = (e: unknown): string => (e instanceof Error ? (e.stack ?? e.message) : String(e))
window.addEventListener('error', (e) => void window.zenode.log('error', describe(e.error ?? e.message)).catch(() => undefined))
window.addEventListener('unhandledrejection', (e) => void window.zenode.log('error', `(promise) ${describe(e.reason)}`).catch(() => undefined))

const root = document.getElementById('app')!
void new App(root).start()
