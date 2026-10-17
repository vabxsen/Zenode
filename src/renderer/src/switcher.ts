import { el } from './component'
import { fuzzyMatch, highlight } from './fuzzy'
import { baseName, parentDir, stripMd } from './paths'

export interface SwitcherItem {
  path: string
  aliases: string[]
}

export interface SwitcherOptions {
  items: SwitcherItem[]
  recent: string[]
  onOpen(path: string, newTab: boolean): void
  onCreate(name: string): void
}

const MAX_RESULTS = 50

interface Result {
  path: string
  title: string
  folder: string
  alias?: string
  indices: number[]
  score: number
}

let current: { close(): void } | null = null

// Quick switcher: fuzzy-find a note by name, path or alias.
export function openSwitcher(opts: SwitcherOptions): void {
  current?.close()
  const bg = el('div', 'zn-modal-bg', document.body)
  const modal = el('div', 'zn-switcher', bg)
  const input = el('input', 'zn-switcher-input', modal)
  input.placeholder = 'Find or create a note...'
  input.spellcheck = false
  const list = el('div', 'zn-switcher-list', modal)
  const footer = el('div', 'zn-switcher-footer', modal)
  for (const [key, label] of [
    ['↑↓', 'navigate'],
    ['↵', 'open'],
    ['shift ↵', 'create'],
    ['esc', 'close']
  ]) {
    const hint = el('span', 'zn-hint', footer)
    el('kbd', '', hint, key)
    el('span', '', hint, label)
  }

  let results: Result[] = []
  let selected = 0

  const compute = (): void => {
    const q = input.value.trim()
    if (!q) {
      const recent = opts.recent.filter((p) => opts.items.some((i) => i.path === p))
      const rest = opts.items.map((i) => i.path).filter((p) => !recent.includes(p)).sort((a, b) => a.localeCompare(b))
      results = [...recent, ...rest].slice(0, MAX_RESULTS).map((path) => ({
        path,
        title: stripMd(baseName(path)),
        folder: parentDir(path),
        indices: [],
        score: 0
      }))
    } else {
      const scored: Result[] = []
      for (const item of opts.items) {
        const title = stripMd(baseName(item.path))
        const folder = parentDir(item.path)
        const byTitle = fuzzyMatch(q, title)
        const byPath = byTitle ? null : fuzzyMatch(q, stripMd(item.path))
        let best: Result | null = null
        if (byTitle) best = { path: item.path, title, folder, indices: byTitle.indices, score: byTitle.score + 20 }
        else if (byPath) best = { path: item.path, title, folder, indices: [], score: byPath.score }
        for (const alias of item.aliases) {
          const m = fuzzyMatch(q, alias)
          if (m && (!best || m.score + 15 > best.score)) {
            best = { path: item.path, title, folder, alias, indices: m.indices, score: m.score + 15 }
          }
        }
        if (best) scored.push(best)
      }
      results = scored.sort((a, b) => b.score - a.score).slice(0, MAX_RESULTS)
    }
    selected = 0
    render()
  }

  const render = (): void => {
    list.empty()
    if (!results.length) {
      const empty = el('div', 'zn-switcher-empty', list)
      empty.textContent = input.value.trim() ? `No note found. Press Enter to create "${input.value.trim()}".` : 'No notes yet.'
      return
    }
    results.forEach((r, i) => {
      const row = el('div', `zn-switcher-row${i === selected ? ' is-selected' : ''}`, list)
      const title = el('div', 'zn-switcher-title', row)
      if (r.alias) {
        highlight(title, r.alias, r.indices)
        el('span', 'zn-switcher-alias', title, ` → ${r.title}`)
      } else {
        highlight(title, r.title, r.indices)
      }
      if (r.folder) el('div', 'zn-switcher-folder', row, r.folder)
      row.addEventListener('mousemove', () => {
        if (selected !== i) {
          selected = i
          updateSelection()
        }
      })
      row.addEventListener('mousedown', (e) => {
        e.preventDefault()
        choose(e.ctrlKey)
      })
    })
  }

  const updateSelection = (): void => {
    list.querySelectorAll('.zn-switcher-row').forEach((row, i) => row.classList.toggle('is-selected', i === selected))
    list.children[selected]?.scrollIntoView({ block: 'nearest' })
  }

  const close = (): void => {
    bg.remove()
    current = null
  }

  const choose = (newTab: boolean): void => {
    const r = results[selected]
    close()
    if (r) opts.onOpen(r.path, newTab)
    else if (input.value.trim()) opts.onCreate(input.value.trim())
  }

  input.addEventListener('input', compute)
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || (e.key === 'n' && e.ctrlKey)) {
      e.preventDefault()
      selected = Math.min(selected + 1, results.length - 1)
      updateSelection()
    } else if (e.key === 'ArrowUp' || (e.key === 'p' && e.ctrlKey)) {
      e.preventDefault()
      selected = Math.max(selected - 1, 0)
      updateSelection()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (e.shiftKey && input.value.trim()) {
        close()
        opts.onCreate(input.value.trim())
      } else {
        choose(e.ctrlKey)
      }
    } else if (e.key === 'Escape') {
      e.preventDefault()
      close()
    }
    e.stopPropagation()
  })
  bg.addEventListener('mousedown', (e) => {
    if (e.target === bg) close()
  })

  current = { close }
  compute()
  input.focus()
}
