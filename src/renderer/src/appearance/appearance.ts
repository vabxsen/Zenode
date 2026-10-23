// Appearance settings (.zenode/appearance.json): colour theme, accent, fonts,
// text size, readable line width and interface zoom, applied as CSS variables
// on <html>. Hand-edited values are checked; anything odd falls back.
import { syncAllEditorThemes } from '../editor/editor'
import { loadCustomCss, mapObsidianVariables, setThemeClass } from './customCss'
import { accentVars, DEFAULT_APPEARANCE, sanitizeAppearance, type AppearanceSettings } from './model'

declare global {
  interface WindowEventMap {
    // Fired after appearance settings are applied (theme, accent, fonts...).
    'zenode-appearance': CustomEvent
  }
}

export { accentVars, DEFAULT_APPEARANCE, FONT_SIZE, LINE_WIDTH, sanitizeAppearance, ZOOM } from './model'
export type { AppearanceSettings, ThemeChoice } from './model'
// (Absent outside a browser, e.g. in unit tests.)
const systemDark = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null
let current: AppearanceSettings = DEFAULT_APPEARANCE
let applied = new Set<string>()

export function resolvedTheme(s: AppearanceSettings = current): 'dark' | 'light' {
  return s.theme === 'system' ? (systemDark?.matches === false ? 'light' : 'dark') : s.theme
}

export function applyAppearance(s: AppearanceSettings): void {
  current = s
  const root = document.documentElement
  const theme = resolvedTheme(s)
  const changedTheme = root.dataset.theme !== theme
  root.dataset.theme = theme
  setThemeClass(theme)
  const vars: Record<string, string> = {
    ...accentVars(s.accent, theme === 'dark'),
    '--zn-text-size': `${s.fontSize}px`,
    // "Off" lets text use the whole pane (the 32px side margins remain).
    '--zn-line-width': s.readableLineLength ? `${s.lineWidth}px` : '100000px'
  }
  if (s.fontText) vars['--zn-font-text'] = s.fontText
  if (s.fontMono) vars['--zn-font-mono'] = s.fontMono
  for (const name of applied) if (!(name in vars)) root.style.removeProperty(name)
  for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value)
  applied = new Set(Object.keys(vars))
  // A CSS theme's Obsidian variables, after the built-in ones (the user's accent wins).
  mapObsidianVariables(!!s.accent)
  window.zenode.setZoom(s.zoom)
  void window.zenode.setTitleBarColors(themeColor('--zn-bg-panel'), themeColor('--zn-text-muted')).catch(() => undefined)
  if (changedTheme) syncAllEditorThemes()
  window.dispatchEvent(new CustomEvent('zenode-appearance'))
}

// A token's current value (e.g. for the window frame or the graph's WebGL colours).
export function themeColor(token: string): string {
  // Read on <body>: a CSS theme's mapped variables live there.
  return getComputedStyle(document.body).getPropertyValue(token).trim()
}

// "System" follows Windows switching between light and dark while the app runs.
systemDark?.addEventListener('change', () => {
  if (current.theme === 'system') applyAppearance(current)
})

export function appearance(): AppearanceSettings {
  return current
}

// The open vault's appearance (defaults outside a vault). Returns the CSS theme
// or snippets that could not be loaded.
export async function loadAppearance(): Promise<string[]> {
  const s = sanitizeAppearance(await window.zenode.readConfig('appearance').catch(() => null))
  const failed = await loadCustomCss(s.cssTheme, s.snippets)
  applyAppearance(s)
  return failed
}

// Reads the CSS theme and snippets again (after editing them outside Zenode).
export async function reloadCustomCss(): Promise<string[]> {
  const failed = await loadCustomCss(current.cssTheme, current.snippets)
  applyAppearance(current)
  return failed
}

// Applies a change at once and saves it to .zenode/appearance.json.
export async function updateAppearance(change: Partial<AppearanceSettings>): Promise<void> {
  const next = sanitizeAppearance({ ...current, ...change })
  if ('cssTheme' in change || 'snippets' in change) await loadCustomCss(next.cssTheme, next.snippets)
  applyAppearance(next)
  await window.zenode.writeConfig('appearance', next)
}
