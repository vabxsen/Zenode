// Settings > Hotkeys: every command with its hotkeys. Add one by pressing the
// keys, remove one, or go back to the default. Saved in .zenode/hotkeys.json.
import { hotkeyFromEvent, hotkeyLabel, type CommandRegistry, type Hotkey } from '../commands'
import { el } from '../component'
import type { SettingsSection } from './settingsModal'

const same = (a: Hotkey, b: Hotkey): boolean => hotkeyLabel(a) === hotkeyLabel(b)

export function hotkeysSection(registry: CommandRegistry, notice: (m: string) => void): SettingsSection {
  const save = (custom: Record<string, Hotkey[]>): void => {
    registry.setCustomHotkeys(custom)
    window.zenode.writeConfig('hotkeys', custom).catch((e: Error) => notice(`Could not save hotkeys: ${e.message}`))
  }
  const setFor = (id: string, hotkeys: Hotkey[] | null): void => {
    const custom = registry.customHotkeys()
    if (hotkeys === null) delete custom[id]
    else custom[id] = hotkeys
    save(custom)
  }

  return {
    id: 'hotkeys',
    name: 'Hotkeys',
    render: (c) => {
      const search = el('input', 'zn-set-text zn-hotkey-search', c)
      search.placeholder = 'Filter commands…'
      search.setAttribute('aria-label', 'Filter commands')
      const list = el('div', 'zn-hotkey-list', c)
      list.setAttribute('role', 'list')

      const draw = (): void => {
        const q = search.value.trim().toLowerCase()
        const custom = registry.customHotkeys()
        list.replaceChildren()
        for (const cmd of registry.list()) {
          if (q && !cmd.name.toLowerCase().includes(q) && !cmd.id.includes(q)) continue
          const row = el('div', 'zn-hotkey-row', list)
          row.setAttribute('role', 'listitem')
          const info = el('div', 'zn-hotkey-info', row)
          el('div', 'zn-set-name', info, cmd.name)
          const keys = el('div', 'zn-hotkey-keys', row)
          for (const hk of registry.hotkeysFor(cmd.id)) {
            const clash = registry.conflicts(hk, cmd.id)
            const chip = el('span', `zn-hotkey-chip${clash.length ? ' is-conflict' : ''}`, keys, hotkeyLabel(hk))
            if (clash.length) chip.title = `Also used by: ${clash.map((x) => x.name).join(', ')}`
            const x = el('button', 'zn-hotkey-remove', chip, '×')
            x.setAttribute('aria-label', `Remove ${hotkeyLabel(hk)} from ${cmd.name}`)
            x.addEventListener('click', () => {
              setFor(cmd.id, registry.hotkeysFor(cmd.id).filter((h) => !same(h, hk)))
              draw()
            })
          }
          if (custom[cmd.id]) {
            const reset = el('button', 'zn-hotkey-action', keys, '↺')
            reset.title = 'Back to the default'
            reset.setAttribute('aria-label', `Reset ${cmd.name} to its default hotkeys`)
            reset.addEventListener('click', () => {
              setFor(cmd.id, null)
              draw()
            })
          }
          const add = el('button', 'zn-hotkey-action', keys, '+')
          add.title = 'Add a hotkey'
          add.setAttribute('aria-label', `Add a hotkey for ${cmd.name}`)
          add.addEventListener('click', () => record(row, keys, cmd.id, cmd.name))
        }
        if (!list.children.length) el('div', 'zn-panel-empty', list, 'No matching commands.')
      }

      // Waits for the next key combination (Escape cancels).
      const record = (row: HTMLElement, keys: HTMLElement, id: string, name: string): void => {
        row.classList.add('zn-hotkey-recording')
        const prompt = el('span', 'zn-hotkey-prompt', keys, 'Press the keys… (Esc to cancel)')
        prompt.tabIndex = 0
        prompt.setAttribute('role', 'status')
        prompt.focus()
        const finish = (): void => {
          window.removeEventListener('keydown', onKey, true)
          row.classList.remove('zn-hotkey-recording')
          draw()
        }
        const onKey = (e: KeyboardEvent): void => {
          e.preventDefault()
          e.stopPropagation()
          if (e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.shiftKey) return finish()
          const hk = hotkeyFromEvent(e)
          if (!hk) return
          const clash = registry.conflicts(hk, id)
          if (!registry.hotkeysFor(id).some((h) => same(h, hk))) setFor(id, [...registry.hotkeysFor(id), hk])
          if (clash.length) notice(`${hotkeyLabel(hk)} is also used by ${clash.map((x) => x.name).join(', ')}. Remove it there if ${name} should win.`)
          finish()
        }
        window.addEventListener('keydown', onKey, true)
      }

      search.addEventListener('input', draw)
      draw()
      // After the page is on screen (sections are built off-screen first).
      requestAnimationFrame(() => search.focus())
    }
  }
}
