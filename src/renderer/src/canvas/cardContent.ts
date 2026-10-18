// The DOM for one card and what it shows: a live editor for text cards, a note
// preview or image for file cards, a link summary, or a group label.
import { Compartment } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { el } from '../component'
import { createEditorState, fromDisk } from '../editor/editor'
import { icon } from '../icons'
import { baseName, isMarkdown, stripMd } from '../paths'
import { isImage, vaultUrl } from '../vaultUrl'
import type { CanvasHost } from './canvasView'
import { isFile, isGroup, isLink, isText, KNOWN_TYPES, type CanvasNode, type Side } from './model'

const SIDES: Side[] = ['top', 'right', 'bottom', 'left']

export interface NodeView {
  el: HTMLElement
  content: HTMLElement
  // What the content was built from; rebuilt only when this changes.
  key: string
  editor?: EditorView
  // Toggles a text card's editor between read-only and editable.
  editable?: Compartment
}

export interface CardContext {
  host: CanvasHost
  // The canvas file, for resolving links relative to it.
  path: string
  // A text card's editor changed (the user typed).
  onTextChange(id: string, view: NodeView): void
}

export function createNodeView(n: CanvasNode): NodeView {
  const kind = KNOWN_TYPES.has(n.type) ? n.type : 'unknown'
  const node = el('div', `zn-cnode zn-cnode-${kind}`)
  node.dataset.id = n.id
  const content = el('div', 'zn-cnode-content', node)
  el('div', 'zn-cnode-resize', node).dataset.handle = 'resize'
  for (const side of SIDES) {
    const port = el('div', `zn-cnode-port is-${side}`, node)
    port.dataset.port = side
  }
  return { el: node, content, key: '' }
}

export function contentKey(n: CanvasNode): string {
  if (isText(n)) return `text:${n.text}`
  if (isFile(n)) return `file:${n.file}:${n.subpath ?? ''}`
  if (isLink(n)) return `link:${n.url}`
  if (isGroup(n)) return `group:${n.label ?? ''}:${n.background ?? ''}:${n.backgroundStyle ?? ''}`
  return `other:${n.type}`
}

export function updateCardContent(n: CanvasNode, v: NodeView, key: string, ctx: CardContext): void {
  // A text card being edited keeps its live editor; only sync if the text changed underneath (undo).
  if (isText(n) && v.editor) {
    const current = v.editor.state.doc.toString()
    if (current !== n.text) {
      v.editor.dispatch({ changes: { from: 0, to: current.length, insert: n.text }, annotations: fromDisk.of(true) })
    }
    v.key = key
    return
  }
  v.editor?.destroy()
  v.editor = undefined
  v.content.empty()
  v.key = key

  if (isText(n)) renderText(n.id, n.text, v, ctx)
  else if (isFile(n)) renderFile(n.file, v, ctx)
  else if (isLink(n)) renderLink(n.url, v)
  else if (isGroup(n)) renderGroup(n.label ?? '', n.background, n.backgroundStyle, v, ctx)
  else el('div', 'zn-cnode-missing', v.content, `Unsupported card type "${n.type}" (kept as-is)`)
}

function renderText(id: string, text: string, v: NodeView, ctx: CardContext): void {
  const editable = new Compartment()
  const state = createEditorState(
    text,
    { ...ctx.host.editorCallbacks(ctx.path), onChange: () => ctx.onTextChange(id, v) },
    [editable.of(EditorView.editable.of(false))]
  )
  v.editable = editable
  v.editor = new EditorView({ state, parent: v.content })
}

function renderFile(file: string, v: NodeView, ctx: CardContext): void {
  const target = ctx.host.resolve(file, ctx.path) ?? file
  const note = isMarkdown(target)
  const header = el('div', 'zn-cnode-header', v.content)
  header.appendChild(icon(note ? 'note' : 'files', 13))
  el('span', '', header, note ? stripMd(baseName(target)) : baseName(target))
  const body = el('div', 'zn-cnode-body', v.content)
  if (isImage(target)) {
    const img = el('img', 'zn-cnode-image', body)
    img.src = vaultUrl(target)
    img.alt = baseName(target)
    img.draggable = false
  } else if (note) {
    const text = ctx.host.noteContent(target)
    if (text === null) {
      el('div', 'zn-cnode-missing', body, `"${file}" not found`)
    } else {
      const state = createEditorState(text, { ...ctx.host.editorCallbacks(target), onChange: () => {} }, [EditorView.editable.of(false)])
      v.editor = new EditorView({ state, parent: body })
    }
  } else {
    el('div', 'zn-cnode-missing', body, 'Double-click to open this file.')
  }
}

function renderLink(url: string, v: NodeView): void {
  let host = url
  try {
    host = new URL(url).host || url
  } catch {
    // Not a full URL; show it as typed.
  }
  const header = el('div', 'zn-cnode-header', v.content)
  header.appendChild(icon('link', 13))
  el('span', '', header, host)
  el('div', 'zn-cnode-url', v.content, url)
  el('div', 'zn-cnode-hint', v.content, 'Double-click to open in your browser')
}

function renderGroup(label: string, background: string | undefined, style: string | undefined, v: NodeView, ctx: CardContext): void {
  el('div', 'zn-cgroup-label', v.content, label)
  if (background && isImage(background)) {
    v.content.style.backgroundImage = `url("${vaultUrl(ctx.host.resolve(background, ctx.path) ?? background)}")`
    v.content.classList.add(`bg-${style ?? 'cover'}`)
  }
}
