import type { CommandRegistry } from './commands'

// What the built-in commands need from the app.
export interface CoreActions {
  hasVault(): boolean
  chooseVault(): void
  openSwitcher(): void
  showSearch(): void
  openGraph(): void
  toggleLeftSidebar(): void
  toggleRightSidebar(): void
  newNote(): void
  newCanvas(): void
  // Only when a file is open.
  hasActiveFile(): boolean
  showHistory(): void
  // Only when a note (not a canvas or the graph) is active.
  hasActiveNote(): boolean
  toggleReading(): void
  toggleSource(): void
  save(): void
  closeTab(): void
  cycleTab(step: 1 | -1): void
}

// Registers the app's built-in commands. Returns a function that removes them.
export function registerCoreCommands(registry: CommandRegistry, a: CoreActions): () => void {
  // Most commands only make sense with a vault open.
  const inVault = (run: () => void) => (checking: boolean): boolean => {
    if (!a.hasVault()) return false
    if (!checking) run()
    return true
  }
  const disposers = [
    registry.register({
      id: 'app:open-vault',
      name: 'Open another vault',
      hotkeys: [{ modifiers: ['Mod', 'Shift'], key: 'o' }],
      callback: () => a.chooseVault()
    }),
    registry.register({
      id: 'switcher:open',
      name: 'Quick switcher: open a note',
      hotkeys: [{ modifiers: ['Mod'], key: 'o' }],
      // Without a vault, Ctrl+O picks one instead.
      callback: () => (a.hasVault() ? a.openSwitcher() : a.chooseVault())
    }),
    registry.register({
      id: 'search:open',
      name: 'Search: search the vault',
      hotkeys: [{ modifiers: ['Mod', 'Shift'], key: 'f' }],
      checkCallback: inVault(() => a.showSearch())
    }),
    registry.register({
      id: 'graph:open',
      name: 'Graph view: open',
      hotkeys: [{ modifiers: ['Mod'], key: 'g' }],
      checkCallback: inVault(() => a.openGraph())
    }),
    registry.register({
      id: 'app:toggle-left-sidebar',
      name: 'Toggle left sidebar',
      hotkeys: [{ modifiers: ['Mod'], key: '\\' }],
      checkCallback: inVault(() => a.toggleLeftSidebar())
    }),
    registry.register({
      id: 'app:toggle-right-sidebar',
      name: 'Toggle right sidebar',
      hotkeys: [{ modifiers: ['Mod', 'Shift'], key: 'b' }],
      checkCallback: inVault(() => a.toggleRightSidebar())
    }),
    registry.register({
      id: 'file:new-note',
      name: 'Create new note',
      hotkeys: [{ modifiers: ['Mod'], key: 'n' }],
      checkCallback: inVault(() => a.newNote())
    }),
    registry.register({
      id: 'file:new-canvas',
      name: 'Create new canvas',
      checkCallback: inVault(() => a.newCanvas())
    }),
    registry.register({
      id: 'file-recovery:open',
      name: 'File recovery: show history of the current file',
      checkCallback: (checking) => {
        if (!a.hasActiveFile()) return false
        if (!checking) a.showHistory()
        return true
      }
    }),
    registry.register({
      id: 'editor:toggle-reading',
      name: 'Toggle Reading view',
      hotkeys: [{ modifiers: ['Mod'], key: 'e' }],
      checkCallback: (checking) => {
        if (!a.hasActiveNote()) return false
        if (!checking) a.toggleReading()
        return true
      }
    }),
    registry.register({
      id: 'editor:toggle-source',
      name: 'Toggle Source mode (plain Markdown)',
      checkCallback: (checking) => {
        if (!a.hasActiveNote()) return false
        if (!checking) a.toggleSource()
        return true
      }
    }),
    registry.register({
      id: 'editor:save',
      name: 'Save current file',
      hotkeys: [{ modifiers: ['Mod'], key: 's' }],
      checkCallback: inVault(() => a.save())
    }),
    registry.register({
      id: 'workspace:close-tab',
      name: 'Close current tab',
      hotkeys: [{ modifiers: ['Mod'], key: 'w' }],
      checkCallback: inVault(() => a.closeTab())
    }),
    registry.register({
      id: 'workspace:next-tab',
      name: 'Go to next tab',
      hotkeys: [{ modifiers: ['Mod'], key: 'Tab' }],
      checkCallback: inVault(() => a.cycleTab(1))
    }),
    registry.register({
      id: 'workspace:previous-tab',
      name: 'Go to previous tab',
      hotkeys: [{ modifiers: ['Mod', 'Shift'], key: 'Tab' }],
      checkCallback: inVault(() => a.cycleTab(-1))
    })
  ]
  return () => {
    for (const dispose of disposers) dispose()
  }
}
