// The left sidebar (files, search, bookmarks, tags) and the right sidebar
// (backlinks, outgoing links, outline, local graph), with their panels.
import { BacklinksPanel } from './backlinks'
import { el, type Component } from './component'
import { FileTree, type FileTreeHandlers } from './fileTree'
import { icon, type IconName } from './icons'
import { GraphView } from './graph/graphView'
import type { MetadataCache } from './index/metadataCache'
import { BookmarksPanel } from './panels/bookmarks'
import type { Mention } from './panels/mentions'
import { OutgoingPanel } from './panels/outgoing'
import { OutlinePanel } from './panels/outline'
import { TagsPanel } from './panels/tags'
import { SearchPane } from './search/searchPane'
import { Sidebar } from './sidebar'
import type { OpenPosition } from './workspace'

export type LeftPane = 'files' | 'search' | 'bookmarks' | 'tags'
export type RightPane = 'backlinks' | 'outgoing' | 'outline' | 'localGraph'

export interface SidebarDeps {
  root: HTMLElement
  shell: Component
  cache: MetadataCache
  vaultName: string
  // File tree actions, minus the bookmark ones the sidebars supply.
  tree: Omit<FileTreeHandlers, 'isBookmarked' | 'onToggleBookmark'>
  openPath(path: string, pos?: OpenPosition): void
  createNote(name: string): void
  showSearch(query: string): void
  recent(): string[]
  activePath(): string | null
  linkMention(mention: Mention, target: string): Promise<void>
  notice(message: string): void
  // The buttons at the foot of the left sidebar.
  openVaults(): void
  openHelp(): void
  openSettings(): void
}

export class LeftSidebar {
  readonly bar: Sidebar
  readonly tree: FileTree
  readonly search: SearchPane
  readonly bookmarks: BookmarksPanel

  constructor(parent: HTMLElement, d: SidebarDeps) {
    this.bar = new Sidebar(parent, 'zn-sidebar', 'zenode.leftPane', () => !d.root.classList.contains('is-sidebar-hidden'))
    const files = this.bar.add('files', 'files', 'Files')
    const search = this.bar.add('search', 'search', 'Search', 'zn-pane-search')
    const bookmarks = this.bar.add('bookmarks', 'bookmark', 'Bookmarks', 'zn-pane-scroll')
    const tags = this.bar.add('tags', 'tag', 'Tags', 'zn-pane-scroll')

    this.bookmarks = d.shell.addChild(
      new BookmarksPanel(bookmarks, {
        openFile: (path) => d.openPath(path),
        search: (query) => d.showSearch(query),
        recent: () => d.recent(),
        notice: (m) => d.notice(m)
      })
    )
    this.tree = d.shell.addChild(
      new FileTree(files, d.vaultName, {
        ...d.tree,
        isBookmarked: (path) => this.bookmarks.isBookmarked(path),
        onToggleBookmark: (path) => this.bookmarks.toggle(path)
      })
    )
    this.search = d.shell.addChild(
      new SearchPane(search, d.cache, (path, pos) => d.openPath(path, pos), (query) => {
        this.bookmarks.addSearch(query)
        d.notice(`Bookmarked the search "${query}".`)
      })
    )
    d.shell.addChild(new TagsPanel(tags, d.cache, (tag) => d.showSearch(`tag:${tag}`)))
    this.bar.restore('files')
    vaultProfile(this.bar.el, d)
  }

  show(pane: LeftPane): void {
    this.bar.show(pane)
  }
}

// The vault's name (click to switch vaults), then Help and Settings.
function vaultProfile(parent: HTMLElement, d: SidebarDeps): void {
  const row = el('div', 'zn-vault-profile', parent)
  const switcher = el('button', 'zn-vault-switcher', row)
  switcher.title = 'Manage vaults (Ctrl+Shift+O)'
  switcher.setAttribute('aria-label', `Vault: ${d.vaultName}. Manage vaults`)
  switcher.appendChild(icon('chevronsUpDown', 16))
  el('span', 'zn-vault-name', switcher, d.vaultName)
  switcher.addEventListener('click', () => d.openVaults())
  const button = (name: IconName, label: string, action: () => void): void => {
    const b = el('button', 'zn-icon-btn', row)
    b.title = label
    b.setAttribute('aria-label', label)
    b.appendChild(icon(name, 16))
    b.addEventListener('click', action)
  }
  button('help', 'Help', () => d.openHelp())
  button('settings', 'Settings (Ctrl+,)', () => d.openSettings())
}

export class RightSidebar {
  readonly bar: Sidebar
  private readonly backlinks: BacklinksPanel
  private readonly outgoing: OutgoingPanel
  private readonly outline: OutlinePanel
  readonly localGraph: GraphView

  constructor(parent: HTMLElement, d: SidebarDeps) {
    this.bar = new Sidebar(parent, 'zn-rightbar', 'zenode.rightPane', () => !d.root.classList.contains('is-rightbar-hidden'))
    const backlinks = this.bar.add('backlinks', 'link', 'Backlinks', 'zn-pane-scroll')
    const outgoing = this.bar.add('outgoing', 'outgoing', 'Outgoing links', 'zn-pane-scroll')
    const outline = this.bar.add('outline', 'outline', 'Outline', 'zn-pane-scroll')
    const graph = this.bar.add('localGraph', 'graph', 'Local graph', 'zn-pane-graph', (visible) => this.localGraph?.setVisible(visible))

    this.backlinks = d.shell.addChild(new BacklinksPanel(backlinks, d.cache, (path, pos) => d.openPath(path, pos), (m, t) => d.linkMention(m, t)))
    this.outgoing = d.shell.addChild(new OutgoingPanel(outgoing, d.cache, (path) => d.openPath(path), (link) => d.createNote(link)))
    this.outline = d.shell.addChild(new OutlinePanel(outline, d.cache, (path, pos) => d.openPath(path, pos)))
    this.localGraph = d.shell.addChild(
      new GraphView(graph, {
        cache: d.cache,
        mode: 'local',
        getActive: () => d.activePath() ?? d.recent()[0] ?? null,
        onOpen: (path) => d.openPath(path)
      })
    )
    this.bar.restore('backlinks')
  }

  show(pane: RightPane): void {
    this.bar.show(pane)
  }

  // The note the panels describe.
  setTarget(path: string | null): void {
    this.backlinks.setTarget(path)
    this.outgoing.setTarget(path)
    this.outline.setTarget(path)
    this.localGraph.setActive(path)
  }
}
