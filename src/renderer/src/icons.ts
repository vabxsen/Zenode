// Stroke icons from Lucide (ISC licence, lucide.dev), drawn on a 24x24 viewBox.
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpNarrowWide,
  ArrowUpRight,
  Bookmark,
  BookOpen,
  Calendar,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  CircleHelp,
  CircleUser,
  Clipboard,
  Cloud,
  Columns2,
  Command,
  EllipsisVertical,
  File,
  Files,
  FileSearch,
  FolderClosed,
  FolderInput,
  FolderOpen,
  FolderPlus,
  GitFork,
  History,
  LayoutDashboard,
  Link,
  List,
  Maximize,
  Minus,
  Palette,
  PanelLeft,
  PanelRight,
  Pencil,
  PenLine,
  Pin,
  Plus,
  Rows2,
  Search,
  Settings,
  SquarePen,
  SquareTerminal,
  Tags,
  Trash2,
  X,
  type IconNode
} from 'lucide'

const ICONS = {
  files: FolderClosed,
  filePlus: SquarePen,
  folderPlus: FolderPlus,
  folderOpen: FolderOpen,
  chevron: ChevronRight,
  chevronDown: ChevronDown,
  chevronsUpDown: ChevronsUpDown,
  close: X,
  sidebar: PanelLeft,
  sidebarRight: PanelRight,
  note: File,
  search: Search,
  link: Link,
  switcher: FileSearch,
  graph: GitFork,
  fit: Maximize,
  plus: Plus,
  minus: Minus,
  canvas: LayoutDashboard,
  settings: Settings,
  help: CircleHelp,
  pin: Pin,
  sort: ArrowUpNarrowWide,
  collapse: ChevronsDownUp,
  splitRight: Columns2,
  splitDown: Rows2,
  back: ChevronLeft,
  arrowLeft: ArrowLeft,
  arrowRight: ArrowRight,
  calendar: Calendar,
  bookmark: Bookmark,
  tag: Tags,
  outline: List,
  outgoing: ArrowUpRight,
  cloud: Cloud,
  reading: BookOpen,
  editing: PenLine,
  more: EllipsisVertical,
  palette: SquareTerminal,
  templates: Files,
  user: CircleUser,
  appearance: Palette,
  command: Command,
  rename: Pencil,
  moveTo: FolderInput,
  copy: Clipboard,
  history: History,
  trash: Trash2
} satisfies Record<string, IconNode>

export type IconName = keyof typeof ICONS

export function icon(name: IconName, size = 16): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(ns, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('width', String(size))
  svg.setAttribute('height', String(size))
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  // Thinner lines on the larger sizes, so every size looks equally heavy.
  svg.setAttribute('stroke-width', size > 16 ? '1.75' : '2')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')
  svg.classList.add('zn-icon')
  for (const [tag, attrs] of ICONS[name]) {
    const part = document.createElementNS(ns, tag)
    for (const [k, v] of Object.entries(attrs)) if (v !== undefined) part.setAttribute(k, String(v))
    svg.appendChild(part)
  }
  return svg
}
