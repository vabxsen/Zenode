import './styles.css'
import { App } from './app'

// Anything that slips past local error handling goes to the app log.
const describe = (e: unknown): string => (e instanceof Error ? (e.stack ?? e.message) : String(e))
window.addEventListener('error', (e) => void window.zenode.log('error', describe(e.error ?? e.message)).catch(() => undefined))
window.addEventListener('unhandledrejection', (e) => void window.zenode.log('error', `(promise) ${describe(e.reason)}`).catch(() => undefined))

const root = document.getElementById('app')!
void new App(root).start()
