// Commands for panes and tabs: splitting, moving between panes, history, pinning.
import type { CommandRegistry, Hotkey } from './commands'
import type { Direction, Workspace } from './workspace'

export function registerWorkspaceCommands(registry: CommandRegistry, workspace: () => Workspace | null): () => void {
  // Each command only applies with a vault (and so a workspace) open.
  const add = (id: string, name: string, run: (ws: Workspace) => void, hotkeys?: Hotkey[], when?: (ws: Workspace) => boolean) =>
    registry.register({
      id,
      name,
      hotkeys,
      checkCallback: (checking) => {
        const ws = workspace()
        if (!ws || (when && !when(ws))) return false
        if (!checking) run(ws)
        return true
      }
    })
  const focus = (dir: Direction, key: string): (() => void) =>
    add(`workspace:focus-${dir}`, `Focus the pane ${dir === 'up' ? 'above' : dir === 'down' ? 'below' : `to the ${dir}`}`, (ws) => ws.focusPane(dir), [
      { modifiers: ['Mod', 'Alt'], key }
    ])
  const disposers = [
    add('workspace:split-right', 'Split right', (ws) => void ws.split('row', ws.activePath ?? undefined)),
    add('workspace:split-down', 'Split down', (ws) => void ws.split('column', ws.activePath ?? undefined)),
    add('workspace:close-pane', 'Close this pane', (ws) => void ws.closePane(), undefined, (ws) => ws.paneCount > 1),
    focus('left', 'ArrowLeft'),
    focus('right', 'ArrowRight'),
    focus('up', 'ArrowUp'),
    focus('down', 'ArrowDown'),
    add('workspace:back', 'Go back', (ws) => void ws.go(-1), [{ modifiers: ['Alt'], key: 'ArrowLeft' }]),
    add('workspace:forward', 'Go forward', (ws) => void ws.go(1), [{ modifiers: ['Alt'], key: 'ArrowRight' }]),
    add('workspace:toggle-pin', 'Pin or unpin this tab', (ws) => ws.togglePin()),
    add('workspace:close-others', 'Close other tabs', (ws) => void ws.closeOthers())
  ]
  return () => {
    for (const dispose of disposers) dispose()
  }
}
