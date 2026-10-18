// Commands for daily notes and templates.
import type { CommandRegistry } from '../commands'
import type { NoteTemplates } from './noteTemplates'

export function registerTemplateCommands(registry: CommandRegistry, hasVault: () => boolean, hasActiveNote: () => boolean, t: NoteTemplates): () => void {
  const when = (ok: () => boolean, run: () => void) => (checking: boolean): boolean => {
    if (!ok()) return false
    if (!checking) run()
    return true
  }
  const disposers = [
    registry.register({
      id: 'daily-notes:open-today',
      name: "Open today's daily note",
      hotkeys: [{ modifiers: ['Mod', 'Shift'], key: 'd' }],
      checkCallback: when(hasVault, () => void t.openDaily(0))
    }),
    registry.register({ id: 'daily-notes:open-yesterday', name: "Open yesterday's daily note", checkCallback: when(hasVault, () => void t.openDaily(-1)) }),
    registry.register({ id: 'daily-notes:open-tomorrow', name: "Open tomorrow's daily note", checkCallback: when(hasVault, () => void t.openDaily(1)) }),
    registry.register({ id: 'templates:insert', name: 'Insert template', checkCallback: when(hasActiveNote, () => void t.insert()) })
  ]
  return () => disposers.forEach((d) => d())
}
