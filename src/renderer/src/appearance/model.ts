// Appearance settings: their shape, defaults and validation, and the accent
// colour family. Pure (no DOM), so unit tests can load it.

export type ThemeChoice = 'system' | 'dark' | 'light'


export interface AppearanceSettings {
  theme: ThemeChoice
  // '#rrggbb', or '' for the theme's own violet.
  accent: string
  // CSS font-family lists; '' = the default.
  fontText: string
  fontMono: string
  // Note text size in px.
  fontSize: number
  // Keep note text to a readable width (px) instead of the full pane.
  readableLineLength: boolean
  lineWidth: number
  // Whole-interface zoom (1 = 100%).
  zoom: number
  // Installed theme (folder in .zenode/themes) and enabled CSS snippets (.zenode/snippets).
  cssTheme: string
  snippets: string[]
}

export const DEFAULT_APPEARANCE: AppearanceSettings = {
  theme: 'system',
  accent: '',
  fontText: '',
  fontMono: '',
  fontSize: 16,
  readableLineLength: true,
  lineWidth: 760,
  zoom: 1,
  cssTheme: '',
  snippets: []
}

export const FONT_SIZE = { min: 10, max: 30 }
export const LINE_WIDTH = { min: 480, max: 1600 }
export const ZOOM = { min: 0.5, max: 2, step: 0.1 }

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const clamp = (v: unknown, lo: number, hi: number, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d)
// Font lists are put straight into CSS, so only plain font-name characters pass.
const cleanFont = (v: unknown): string => (typeof v === 'string' && /^[\w\s,'"-]{0,200}$/.test(v) ? v.trim() : '')
const isName = (v: unknown): v is string => typeof v === 'string' && /^[^/\\:*?"<>|]{1,100}$/.test(v) && !v.startsWith('.')

export function sanitizeAppearance(raw: unknown): AppearanceSettings {
  const d = DEFAULT_APPEARANCE
  if (!isRecord(raw)) return { ...d, snippets: [] }
  return {
    theme: raw.theme === 'dark' || raw.theme === 'light' || raw.theme === 'system' ? raw.theme : d.theme,
    accent: typeof raw.accent === 'string' && /^#[0-9a-f]{6}$/i.test(raw.accent) ? raw.accent.toLowerCase() : '',
    fontText: cleanFont(raw.fontText),
    fontMono: cleanFont(raw.fontMono),
    fontSize: Math.round(clamp(raw.fontSize, FONT_SIZE.min, FONT_SIZE.max, d.fontSize)),
    readableLineLength: typeof raw.readableLineLength === 'boolean' ? raw.readableLineLength : d.readableLineLength,
    lineWidth: Math.round(clamp(raw.lineWidth, LINE_WIDTH.min, LINE_WIDTH.max, d.lineWidth)),
    zoom: Math.round(clamp(raw.zoom, ZOOM.min, ZOOM.max, d.zoom) * 10) / 10,
    cssTheme: isName(raw.cssTheme) ? raw.cssTheme : '',
    snippets: Array.isArray(raw.snippets) ? [...new Set(raw.snippets.filter(isName))] : []
  }
}

// The accent family for a theme, derived from one colour.
export function accentVars(accent: string, dark: boolean): Record<string, string> {
  if (!accent) return {}
  const mix = (other: string, pct: number): string => `color-mix(in srgb, ${accent} ${pct}%, ${other})`
  return dark
    ? { '--zn-accent-strong': accent, '--zn-accent': mix('white', 72), '--zn-accent-dim': mix('#55555f', 60), '--zn-accent-soft': mix('white', 45), '--zn-accent-deep': mix('black', 88) }
    : { '--zn-accent-strong': accent, '--zn-accent': mix('black', 85), '--zn-accent-dim': mix('white', 70), '--zn-accent-soft': mix('black', 85), '--zn-accent-deep': mix('black', 80) }
}
