// "Move to…": fuzzy-pick a folder (the vault root is listed as "/").
import type { TreeEntry } from '../../shared/api'
import { el } from './component'
import { fuzzyMatch, highlight } from './fuzzy'

const MAX_RESULTS = 60

export function allFolders(tree: TreeEntry[]): string[] {
  const out: string[] = []
  const walk = (entries: TreeEntry[]): void => {
    for (const e of entries) {
      if (e.kind !== 'folder') continue
      out.push(e.path)
      walk(e.children ?? [])
    }
  }
  walk(tree)
  return out
}

// Resolves with the chosen folder ('' = vault root), or null if cancelled.
export function pickFolder(folders: string[], title: string): Promise<string | null> {
  return new Promise((resolve) => {
    const bg = el('div', 'zn-modal-bg', document.body)
    const modal = el('div', 'zn-switcher', bg)
    modal.setAttribute('role', 'dialog')
    modal.setAttribute('aria-label', title)
    const input = el('input', 'zn-switcher-input', modal)
    input.placeholder = title
    input.spellcheck = false
    const list = el('div', 'zn-switcher-list', modal)
    list.setAttribute('role', 'listbox')
    const choices = ['', ...folders]
    let rows: Array<{ path: string; indices: number[] }> = []
    let selected = 0

    const finish = (value: string | null): void => {
      bg.remove()
      resolve(value)
    }

    const render = (): void => {
      const q = input.value.trim()
      rows = q
        ? choices
            .map((path) => ({ path, m: fuzzyMatch(q, path || '/') }))
            .filter((r) => r.m)
            .sort((a, b) => b.m!.score - a.m!.score)
            .map((r) => ({ path: r.path, indices: r.m!.indices }))
        : choices.map((path) => ({ path, indices: [] }))
      rows = rows.slice(0, MAX_RESULTS)
      selected = 0
      list.replaceChildren()
      if (!rows.length) {
        el('div', 'zn-switcher-empty', list, 'No matching folder.')
        return
      }
      rows.forEach((r, i) => {
        const row = el('div', `zn-switcher-row${i === 0 ? ' is-selected' : ''}`, list)
        row.setAttribute('role', 'option')
        highlight(el('div', 'zn-switcher-title', row), r.path || '/', r.indices)
        row.addEventListener('mousedown', (e) => {
          e.preventDefault()
          finish(r.path)
        })
      })
    }

    const move = (step: number): void => {
      selected = Math.max(0, Math.min(rows.length - 1, selected + step))
      list.querySelectorAll('.zn-switcher-row').forEach((r, i) => r.classList.toggle('is-selected', i === selected))
      list.children[selected]?.scrollIntoView({ block: 'nearest' })
    }

    input.addEventListener('input', render)
    input.addEventListener('keydown', (e) => {
      e.stopPropagation()
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        move(1)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        move(-1)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (rows[selected]) finish(rows[selected].path)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        finish(null)
      }
    })
    bg.addEventListener('mousedown', (e) => {
      if (e.target === bg) finish(null)
    })
    render()
    input.focus()
  })
}
