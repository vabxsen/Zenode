// Command palette (Ctrl+P): fuzzy-find any command that can run right now.
// Recently used commands come first; each row shows its shortcut.
import { hotkeyLabel, type CommandRegistry } from './commands'
import { el } from './component'
import { fuzzyMatch, highlight } from './fuzzy'
import { wireListbox } from './a11y/listbox'

const RECENT_KEY = 'zenode.recentCommands'
const MAX_RECENT = 8

function loadRecent(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as unknown
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function rememberRecent(id: string): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...loadRecent().filter((r) => r !== id)].slice(0, MAX_RECENT)))
  } catch {
    // Not remembered; the palette still works.
  }
}

interface Row {
  id: string
  name: string
  indices: number[]
  score: number
  recent: boolean
}

// The commands to show for a query, best first (exported for tests).
export function paletteRows(registry: CommandRegistry, query: string, recent: string[]): Row[] {
  const available = registry.list().filter((c) => registry.isAvailable(c.id))
  const q = query.trim()
  if (!q) {
    const recentRows = recent.map((id) => available.find((c) => c.id === id)).filter((c) => !!c)
    const rest = available.filter((c) => !recent.includes(c.id))
    return [...recentRows, ...rest].map((c) => ({ id: c.id, name: c.name, indices: [], score: 0, recent: recent.includes(c.id) }))
  }
  const rows: Row[] = []
  for (const c of available) {
    const m = fuzzyMatch(q, c.name)
    if (m) rows.push({ id: c.id, name: c.name, indices: m.indices, score: m.score + (recent.includes(c.id) ? 5 : 0), recent: recent.includes(c.id) })
  }
  return rows.sort((a, b) => b.score - a.score)
}

let current: { close(): void } | null = null

export function openCommandPalette(registry: CommandRegistry): void {
  current?.close()
  // Remember where focus was, so a command acts on the note that was active.
  const returnFocus = document.activeElement as HTMLElement | null
  const bg = el('div', 'zn-modal-bg', document.body)
  const modal = el('div', 'zn-switcher zn-palette', bg)
  modal.setAttribute('role', 'dialog')
  modal.setAttribute('aria-label', 'Command palette')
  const input = el('input', 'zn-switcher-input', modal)
  input.placeholder = 'Type a command...'
  input.spellcheck = false
  input.setAttribute('aria-label', 'Command')
  const list = el('div', 'zn-switcher-list', modal)
  wireListbox(input, list, 'Commands')
  const footer = el('div', 'zn-switcher-footer', modal)
  for (const [key, label] of [
    ['↑↓', 'navigate'],
    ['↵', 'run'],
    ['esc', 'close']
  ]) {
    const hint = el('span', 'zn-hint', footer)
    el('kbd', '', hint, key)
    el('span', '', hint, label)
  }

  let rows: Row[] = []
  let selected = 0

  const close = (): void => {
    bg.remove()
    current = null
  }

  const run = (): void => {
    const row = rows[selected]
    close()
    returnFocus?.focus({ preventScroll: true })
    if (!row) return
    rememberRecent(row.id)
    registry.execute(row.id)
  }

  const updateSelection = (): void => {
    list.querySelectorAll('.zn-switcher-row').forEach((r, i) => {
      r.classList.toggle('is-selected', i === selected)
      r.setAttribute('aria-selected', String(i === selected))
    })
    list.children[selected]?.scrollIntoView({ block: 'nearest' })
  }

  const render = (): void => {
    rows = paletteRows(registry, input.value, loadRecent())
    selected = 0
    list.replaceChildren()
    if (!rows.length) {
      el('div', 'zn-switcher-empty', list, 'No matching command.')
      return
    }
    rows.forEach((r, i) => {
      const row = el('div', `zn-switcher-row zn-palette-row${i === selected ? ' is-selected' : ''}`, list)
      row.setAttribute('role', 'option')
      const title = el('div', 'zn-switcher-title', row)
      highlight(title, r.name, r.indices)
      const keys = registry.hotkeysFor(r.id)
      if (keys.length || r.recent) {
        const meta = el('div', 'zn-palette-meta', row)
        if (r.recent && !input.value.trim()) el('span', 'zn-palette-recent', meta, 'recent')
        for (const k of keys) el('kbd', '', meta, hotkeyLabel(k))
      }
      row.addEventListener('mousemove', () => {
        if (selected !== i) {
          selected = i
          updateSelection()
        }
      })
      row.addEventListener('mousedown', (e) => {
        e.preventDefault()
        selected = i
        run()
      })
    })
  }

  input.addEventListener('input', render)
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || (e.key === 'n' && e.ctrlKey)) {
      e.preventDefault()
      selected = Math.min(selected + 1, rows.length - 1)
      updateSelection()
    } else if (e.key === 'ArrowUp' || (e.key === 'p' && e.ctrlKey)) {
      e.preventDefault()
      selected = Math.max(selected - 1, 0)
      updateSelection()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      run()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      close()
      returnFocus?.focus({ preventScroll: true })
    }
    e.stopPropagation()
  })
  bg.addEventListener('mousedown', (e) => {
    if (e.target === bg) close()
  })

  current = { close }
  render()
  input.focus()
}
