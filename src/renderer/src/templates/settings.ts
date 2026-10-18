// Settings for daily notes (.zenode/daily-notes.json) and templates
// (.zenode/templates.json). Hand-edited JSON is checked; bad values fall back.
import { DEFAULT_DATE_FORMAT, DEFAULT_TIME_FORMAT } from './format'

export interface DailyNoteSettings {
  // Vault folder for daily notes ('' = vault root).
  folder: string
  // Date format of the note name, e.g. YYYY-MM-DD.
  format: string
  // Template note path ('' = start empty).
  template: string
}

export interface TemplateSettings {
  // Folder holding the templates.
  folder: string
  // Formats used by {{date}} and {{time}}.
  dateFormat: string
  timeFormat: string
}

export const DEFAULT_DAILY: DailyNoteSettings = { folder: '', format: DEFAULT_DATE_FORMAT, template: '' }
export const DEFAULT_TEMPLATES: TemplateSettings = { folder: 'Templates', dateFormat: DEFAULT_DATE_FORMAT, timeFormat: DEFAULT_TIME_FORMAT }

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const text = (v: unknown, fallback: string): string => (typeof v === 'string' && v.trim() ? v.trim() : fallback)

// Vault-relative, forward slashes, no leading/trailing slash, no "..".
export function cleanVaultPath(value: unknown): string {
  if (typeof value !== 'string') return ''
  const parts = value.replace(/\\/g, '/').split('/').filter((p) => p && p !== '.')
  return parts.includes('..') ? '' : parts.join('/')
}

export function sanitizeDaily(raw: unknown): DailyNoteSettings {
  if (!isRecord(raw)) return { ...DEFAULT_DAILY }
  return {
    folder: cleanVaultPath(raw.folder),
    format: text(raw.format, DEFAULT_DAILY.format),
    template: cleanVaultPath(raw.template)
  }
}

export function sanitizeTemplates(raw: unknown): TemplateSettings {
  if (!isRecord(raw)) return { ...DEFAULT_TEMPLATES }
  return {
    folder: raw.folder === undefined ? DEFAULT_TEMPLATES.folder : cleanVaultPath(raw.folder),
    dateFormat: text(raw.dateFormat, DEFAULT_TEMPLATES.dateFormat),
    timeFormat: text(raw.timeFormat, DEFAULT_TEMPLATES.timeFormat)
  }
}

// A template setting may leave off ".md".
export function templatePath(path: string): string {
  return /\.md$/i.test(path) ? path : `${path}.md`
}
