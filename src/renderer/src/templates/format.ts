// Date formats (the common Moment.js tokens, which Obsidian vaults already use
// for daily-note names) and template variables: {{title}}, {{date}}, {{time}},
// {{date:FORMAT}} and {{time:FORMAT}}.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export const DEFAULT_DATE_FORMAT = 'YYYY-MM-DD'
export const DEFAULT_TIME_FORMAT = 'HH:mm'

const pad = (n: number, width = 2): string => String(n).padStart(width, '0')

function ordinal(n: number): string {
  const tens = n % 100
  if (tens >= 11 && tens <= 13) return `${n}th`
  return n + (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')
}

// ISO week number (weeks start on Monday; week 1 holds the first Thursday).
function isoWeek(d: Date): number {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const day = t.getUTCDay() || 7
  t.setUTCDate(t.getUTCDate() + 4 - day)
  const yearStart = Date.UTC(t.getUTCFullYear(), 0, 1)
  return Math.ceil(((t.getTime() - yearStart) / 86400000 + 1) / 7)
}

// Longest tokens first so "MMMM" wins over "MM"; [text] is copied as-is.
const TOKEN = /\[([^\]]*)\]|YYYY|YY|MMMM|MMM|MM|M|Do|DD|D|dddd|ddd|dd|d|WW|W|HH|H|hh|h|mm|m|ss|s|A|a/g

export function formatDate(d: Date, format: string): string {
  const h12 = d.getHours() % 12 || 12
  return format.replace(TOKEN, (token: string, literal?: string) => {
    if (literal !== undefined) return literal
    switch (token) {
      case 'YYYY': return String(d.getFullYear())
      case 'YY': return pad(d.getFullYear() % 100)
      case 'MMMM': return MONTHS[d.getMonth()]
      case 'MMM': return MONTHS[d.getMonth()].slice(0, 3)
      case 'MM': return pad(d.getMonth() + 1)
      case 'M': return String(d.getMonth() + 1)
      case 'Do': return ordinal(d.getDate())
      case 'DD': return pad(d.getDate())
      case 'D': return String(d.getDate())
      case 'dddd': return DAYS[d.getDay()]
      case 'ddd': return DAYS[d.getDay()].slice(0, 3)
      case 'dd': return DAYS[d.getDay()].slice(0, 2)
      case 'd': return String(d.getDay())
      case 'WW': return pad(isoWeek(d))
      case 'W': return String(isoWeek(d))
      case 'HH': return pad(d.getHours())
      case 'H': return String(d.getHours())
      case 'hh': return pad(h12)
      case 'h': return String(h12)
      case 'mm': return pad(d.getMinutes())
      case 'm': return String(d.getMinutes())
      case 'ss': return pad(d.getSeconds())
      case 's': return String(d.getSeconds())
      case 'A': return d.getHours() < 12 ? 'AM' : 'PM'
      case 'a': return d.getHours() < 12 ? 'am' : 'pm'
      default: return token
    }
  })
}

export interface TemplateContext {
  title: string
  date: Date
  dateFormat?: string
  timeFormat?: string
}

// Fills in template variables. Unknown {{names}} are left untouched.
export function applyTemplate(text: string, ctx: TemplateContext): string {
  return text.replace(/\{\{\s*(title|date|time)\s*(?::([^}]*))?\}\}/gi, (_m, name: string, format?: string) => {
    const key = name.toLowerCase()
    if (key === 'title') return ctx.title
    const fallback = key === 'date' ? (ctx.dateFormat ?? DEFAULT_DATE_FORMAT) : (ctx.timeFormat ?? DEFAULT_TIME_FORMAT)
    return formatDate(ctx.date, format?.trim() || fallback)
  })
}

// Characters a daily-note format may produce that Windows can't use in a file
// name. "/" is allowed: it makes folders (e.g. YYYY/MM/YYYY-MM-DD).
export function invalidNameChars(name: string): string[] {
  return [...new Set(name.match(/[<>:"\\|?*]/g) ?? [])]
}
