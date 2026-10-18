// Command registry: every app action with an id, a name and optional hotkeys.
// The shape follows Obsidian's public plugin API (addCommand), so the command
// palette, the hotkey editor and plugins all share one list.

// "Mod" is Ctrl on Windows (Cmd on macOS), as in Obsidian.
export type Modifier = 'Mod' | 'Ctrl' | 'Shift' | 'Alt'

export interface Hotkey {
  modifiers: Modifier[]
  key: string
}

export interface Command {
  id: string
  name: string
  hotkeys?: Hotkey[]
  // Runs the command. Use checkCallback instead when it only sometimes applies.
  callback?: () => void
  // Called with checking=true to ask "can this run now?" (return true if so),
  // and with checking=false to run it.
  checkCallback?: (checking: boolean) => boolean | void
}

// The parts of a KeyboardEvent the registry needs (keeps it testable without a DOM).
export interface KeyLike {
  key: string
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  metaKey: boolean
}

export class CommandRegistry {
  private readonly commands = new Map<string, Command>()
  // User-chosen hotkeys replace a command's defaults; an empty list removes them.
  private custom: Record<string, Hotkey[]> = {}
  private readonly listeners = new Set<() => void>()

  register(command: Command): () => void {
    if (this.commands.has(command.id)) throw new Error(`Command "${command.id}" is already registered`)
    if (!command.callback && !command.checkCallback) throw new Error(`Command "${command.id}" has nothing to run`)
    this.commands.set(command.id, command)
    this.changed()
    return () => {
      if (this.commands.get(command.id) === command) {
        this.commands.delete(command.id)
        this.changed()
      }
    }
  }

  get(id: string): Command | undefined {
    return this.commands.get(id)
  }

  list(): Command[] {
    return [...this.commands.values()].sort((a, b) => a.name.localeCompare(b.name))
  }

  setCustomHotkeys(custom: Record<string, Hotkey[]>): void {
    this.custom = { ...custom }
    this.changed()
  }

  customHotkeys(): Record<string, Hotkey[]> {
    return { ...this.custom }
  }

  hotkeysFor(id: string): Hotkey[] {
    return this.custom[id] ?? this.commands.get(id)?.hotkeys ?? []
  }

  isAvailable(id: string): boolean {
    const cmd = this.commands.get(id)
    if (!cmd) return false
    if (cmd.checkCallback) return cmd.checkCallback(true) === true
    return true
  }

  // Runs a command if it can run now. Returns whether it ran.
  execute(id: string): boolean {
    const cmd = this.commands.get(id)
    if (!cmd || !this.isAvailable(id)) return false
    if (cmd.checkCallback) cmd.checkCallback(false)
    else cmd.callback?.()
    return true
  }

  // The available command bound to this key press, if any.
  match(e: KeyLike): Command | null {
    for (const cmd of this.commands.values()) {
      if (this.hotkeysFor(cmd.id).some((h) => hotkeyMatches(h, e)) && this.isAvailable(cmd.id)) return cmd
    }
    return null
  }

  // Commands that share a hotkey with another command, for conflict warnings.
  conflicts(hotkey: Hotkey, exceptId?: string): Command[] {
    const label = hotkeyLabel(hotkey)
    return this.list().filter((c) => c.id !== exceptId && this.hotkeysFor(c.id).some((h) => hotkeyLabel(h) === label))
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private changed(): void {
    for (const listener of this.listeners) listener()
  }
}

function normalizeKey(key: string): string {
  return key.length === 1 ? key.toLowerCase() : key
}

export function hotkeyMatches(h: Hotkey, e: KeyLike): boolean {
  const mods = new Set(h.modifiers)
  const wantCtrl = mods.has('Mod') || mods.has('Ctrl')
  return (
    normalizeKey(h.key) === normalizeKey(e.key) &&
    wantCtrl === (e.ctrlKey || e.metaKey) &&
    mods.has('Shift') === e.shiftKey &&
    mods.has('Alt') === e.altKey
  )
}

// The hotkey a key press makes, or null for a lone modifier key.
export function hotkeyFromEvent(e: KeyLike): Hotkey | null {
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return null
  const modifiers: Modifier[] = []
  if (e.ctrlKey || e.metaKey) modifiers.push('Mod')
  if (e.shiftKey) modifiers.push('Shift')
  if (e.altKey) modifiers.push('Alt')
  return { modifiers, key: normalizeKey(e.key) }
}

// "Ctrl+Shift+F", as shown in menus and settings.
export function hotkeyLabel(h: Hotkey): string {
  const order: Modifier[] = ['Mod', 'Ctrl', 'Alt', 'Shift']
  const mods = order.filter((m) => h.modifiers.includes(m)).map((m) => (m === 'Mod' ? 'Ctrl' : m))
  const key = h.key.length === 1 ? h.key.toUpperCase() : h.key
  return [...new Set(mods), key].join('+')
}
