// Commands that show the sidebar panels, and bookmarking the current file.
import type { CommandRegistry } from './commands'
import type { LeftPane, RightPane } from './sidebars'

export interface PanelActions {
  hasVault(): boolean
  activeFile(): string | null
  toggleBookmark(path: string): void
  showLeft(pane: LeftPane): void
  showRight(pane: RightPane): void
}

const LEFT: Array<[LeftPane, string, string]> = [
  ['files', 'file-explorer:open', 'Show files'],
  ['bookmarks', 'bookmarks:open', 'Show bookmarks'],
  ['tags', 'tag-pane:open', 'Show tags']
]

const RIGHT: Array<[RightPane, string, string]> = [
  ['backlinks', 'backlink:open', 'Show backlinks'],
  ['outgoing', 'outgoing-links:open', 'Show outgoing links'],
  ['outline', 'outline:open', 'Show outline'],
  ['localGraph', 'graph:open-local', 'Show local graph']
]

export function registerPanelCommands(registry: CommandRegistry, a: PanelActions): () => void {
  const inVault = (run: () => void) => (checking: boolean): boolean => {
    if (!a.hasVault()) return false
    if (!checking) run()
    return true
  }
  const disposers = [
    ...LEFT.map(([pane, id, name]) => registry.register({ id, name, checkCallback: inVault(() => a.showLeft(pane)) })),
    ...RIGHT.map(([pane, id, name]) => registry.register({ id, name, checkCallback: inVault(() => a.showRight(pane)) })),
    registry.register({
      id: 'bookmarks:bookmark-current-file',
      name: 'Bookmark current file (or remove the bookmark)',
      checkCallback: (checking) => {
        const path = a.activeFile()
        if (!a.hasVault() || !path) return false
        if (!checking) a.toggleBookmark(path)
        return true
      }
    })
  ]
  return () => disposers.forEach((d) => d())
}
