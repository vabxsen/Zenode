import { syntaxTree } from '@codemirror/language'
import { StateEffect, StateField, type EditorState, type Range } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate
} from '@codemirror/view'
import type { SyntaxNode } from '@lezer/common'

// Live Preview: Markdown syntax is hidden unless the cursor or selection
// touches the element it belongs to. Inline styles reveal per element;
// headings, quotes, list markers and rules reveal per line. When the editor
// is not focused nothing counts as touched, so the note renders fully.

const hidden = Decoration.replace({})

class BulletWidget extends WidgetType {
  eq(): boolean {
    return true
  }
  toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.className = 'zn-bullet'
    span.textContent = '•'
    return span
  }
}

class RuleWidget extends WidgetType {
  eq(): boolean {
    return true
  }
  toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.className = 'zn-hr'
    return span
  }
}

class FenceLabel extends WidgetType {
  constructor(readonly lang: string) {
    super()
  }
  eq(other: FenceLabel): boolean {
    return other.lang === this.lang
  }
  toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.className = 'zn-fence-label'
    span.textContent = this.lang
    return span
  }
}

class CheckboxWidget extends WidgetType {
  constructor(
    readonly checked: boolean,
    readonly markerFrom: number
  ) {
    super()
  }
  eq(other: CheckboxWidget): boolean {
    return other.checked === this.checked && other.markerFrom === this.markerFrom
  }
  toDOM(view: EditorView): HTMLElement {
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.className = 'zn-task-box'
    box.checked = this.checked
    box.addEventListener('mousedown', (e) => {
      e.preventDefault()
      // "[ ]" <-> "[x]": the state character sits one past the bracket.
      const pos = this.markerFrom + 1
      view.dispatch({ changes: { from: pos, to: pos + 1, insert: this.checked ? ' ' : 'x' } })
    })
    return box
  }
}

export interface LivePreviewOptions {
  onOpenLink(href: string): void
  onOpenWikiLink(target: string): void
  onOpenTag(tag: string): void
  // Whether a wikilink target (without subpath) resolves to an existing file.
  isResolved(link: string): boolean
}

// Dispatch this when the vault's links change, so resolved/unresolved styling refreshes.
export const linksChanged = StateEffect.define<null>()

// Source mode: plain Markdown with syntax colouring, nothing hidden or rendered.
export const setSourceMode = StateEffect.define<boolean>()
export const sourceMode = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setSourceMode)) value = e.value
    return value
  }
})

function touches(state: EditorState, focused: boolean, from: number, to: number): boolean {
  if (!focused) return false
  for (const r of state.selection.ranges) {
    if (r.from <= to && r.to >= from) return true
  }
  return false
}

function lineTouched(state: EditorState, focused: boolean, pos: number): boolean {
  const line = state.doc.lineAt(pos)
  return touches(state, focused, line.from, line.to)
}

function children(node: SyntaxNode): SyntaxNode[] {
  const out: SyntaxNode[] = []
  for (let c = node.firstChild; c; c = c.nextSibling) out.push(c)
  return out
}

function addLineClass(out: Range<Decoration>[], state: EditorState, from: number, to: number, cls: string): void {
  const deco = Decoration.line({ class: cls })
  for (let pos = from; pos <= to; ) {
    const line = state.doc.lineAt(pos)
    out.push(deco.range(line.from))
    pos = line.to + 1
  }
}

const INLINE_STYLE: Record<string, { cls: string; mark: string }> = {
  Emphasis: { cls: 'zn-em', mark: 'EmphasisMark' },
  StrongEmphasis: { cls: 'zn-strong', mark: 'EmphasisMark' },
  Strikethrough: { cls: 'zn-strike', mark: 'StrikethroughMark' },
  InlineCode: { cls: 'zn-code', mark: 'CodeMark' }
}

function wikiDecorations(
  out: Range<Decoration>[],
  state: EditorState,
  focused: boolean,
  node: SyntaxNode,
  options: LivePreviewOptions
): void {
  const doc = state.doc
  const target = node.getChild('WikiLinkTarget')
  if (!target) return
  const inner = doc.sliceString(target.from, target.to)
  const pipe = inner.indexOf('|')
  const linkPart = pipe === -1 ? inner : inner.slice(0, pipe)
  const hash = linkPart.indexOf('#')
  const link = (hash === -1 ? linkPart : linkPart.slice(0, hash)).trim()
  const resolved = link === '' || options.isResolved(link)
  const embed = node.name === 'WikiEmbed'
  const cls = `zn-link zn-internal${resolved ? '' : ' is-unresolved'}${embed ? ' zn-embed' : ''}`
  const revealed = touches(state, focused, node.from, node.to)

  if (revealed) {
    out.push(Decoration.mark({ class: `${cls} is-raw` }).range(target.from, target.to))
    return
  }
  // Hide "[[" / "![[" and "]]"; with an alias, also hide "target|".
  const textFrom = pipe === -1 ? target.from : target.from + pipe + 1
  out.push(hidden.range(node.from, textFrom))
  out.push(hidden.range(target.to, node.to))
  if (target.to > textFrom) {
    out.push(
      Decoration.mark({ class: cls, attributes: { 'data-zn-wikilink': linkPart.trim() } }).range(textFrom, target.to)
    )
  }
}

function buildDecorations(view: EditorView, options: LivePreviewOptions): DecorationSet {
  const { state } = view
  if (state.field(sourceMode, false)) return Decoration.none
  const focused = view.hasFocus
  const out: Range<Decoration>[] = []
  const doc = state.doc

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (ref) => {
        const node = ref.node
        const name = ref.name

        const heading = /^ATXHeading(\d)$/.exec(name) ?? /^SetextHeading(\d)$/.exec(name)
        if (heading) {
          out.push(Decoration.line({ class: `zn-h zn-h${heading[1]}` }).range(doc.lineAt(ref.from).from))
          if (name.startsWith('ATX') && !lineTouched(state, focused, ref.from)) {
            for (const mark of children(node).filter((c) => c.name === 'HeaderMark')) {
              const line = doc.lineAt(mark.from)
              const opening = doc.sliceString(line.from, mark.from).trim() === ''
              if (opening) {
                const end = doc.sliceString(mark.to, mark.to + 1) === ' ' ? mark.to + 1 : mark.to
                out.push(hidden.range(mark.from, end))
              } else {
                const start = doc.sliceString(mark.from - 1, mark.from) === ' ' ? mark.from - 1 : mark.from
                out.push(hidden.range(start, mark.to))
              }
            }
          }
          return
        }

        const style = INLINE_STYLE[name]
        if (style) {
          out.push(Decoration.mark({ class: style.cls }).range(ref.from, ref.to))
          if (!touches(state, focused, ref.from, ref.to)) {
            for (const c of children(node)) if (c.name === style.mark) out.push(hidden.range(c.from, c.to))
          }
          return
        }

        if (name === 'Frontmatter') {
          addLineClass(out, state, ref.from, ref.to, 'zn-frontmatter')
          out.push(Decoration.line({ class: 'zn-frontmatter-first' }).range(doc.lineAt(ref.from).from))
          out.push(Decoration.line({ class: 'zn-frontmatter-last' }).range(doc.lineAt(ref.to).from))
          return false
        }

        if (name === 'Hashtag') {
          const tag = doc.sliceString(ref.from, ref.to)
          out.push(Decoration.mark({ class: 'zn-tag', attributes: { 'data-zn-tag': tag } }).range(ref.from, ref.to))
          return
        }

        if (name === 'WikiLink' || name === 'WikiEmbed') {
          wikiDecorations(out, state, focused, node, options)
          return false
        }

        if (name === 'Link' || name === 'Autolink') {
          const url = node.getChild('URL')
          const href = url ? doc.sliceString(url.from, url.to) : ''
          const marks = children(node).filter((c) => c.name === 'LinkMark')
          const revealed = touches(state, focused, ref.from, ref.to)
          if (name === 'Link' && href && marks.length >= 2) {
            const textFrom = marks[0].to
            const textTo = marks[1].from
            if (!revealed && textTo > textFrom) {
              out.push(hidden.range(ref.from, textFrom))
              out.push(linkMark(href).range(textFrom, textTo))
              out.push(hidden.range(textTo, ref.to))
            } else {
              out.push(Decoration.mark({ class: 'zn-link is-raw' }).range(ref.from, ref.to))
            }
          } else if (name === 'Autolink' && url) {
            if (!revealed) for (const m of marks) out.push(hidden.range(m.from, m.to))
            out.push((revealed ? Decoration.mark({ class: 'zn-link' }) : linkMark(href)).range(url.from, url.to))
          }
          return false
        }

        // Bare URLs (GFM autolink extension) outside of a link.
        if (name === 'URL') {
          const parent = node.parent?.name
          if (parent !== 'Link' && parent !== 'Image' && parent !== 'Autolink') {
            const href = doc.sliceString(ref.from, ref.to)
            const revealed = touches(state, focused, ref.from, ref.to)
            out.push((revealed ? Decoration.mark({ class: 'zn-link' }) : linkMark(href)).range(ref.from, ref.to))
          }
          return
        }

        if (name === 'Blockquote') {
          addLineClass(out, state, ref.from, ref.to, 'zn-quote')
          return
        }
        if (name === 'QuoteMark') {
          if (!lineTouched(state, focused, ref.from)) {
            const end = doc.sliceString(ref.to, ref.to + 1) === ' ' ? ref.to + 1 : ref.to
            out.push(hidden.range(ref.from, end))
          }
          return
        }

        if (name === 'ListMark') {
          const isBullet = node.parent?.parent?.name === 'BulletList'
          const task = node.nextSibling?.name === 'Task' ? node.nextSibling : null
          if (lineTouched(state, focused, ref.from)) return
          const end = doc.sliceString(ref.to, ref.to + 1) === ' ' ? ref.to + 1 : ref.to
          if (task && isBullet) out.push(hidden.range(ref.from, end))
          else if (isBullet) out.push(Decoration.replace({ widget: new BulletWidget() }).range(ref.from, ref.to))
          return
        }

        if (name === 'TaskMarker') {
          const text = doc.sliceString(ref.from, ref.to)
          const checked = /\[[xX]\]/.test(text)
          if (checked) out.push(Decoration.line({ class: 'zn-task-done' }).range(doc.lineAt(ref.from).from))
          if (!lineTouched(state, focused, ref.from)) {
            out.push(Decoration.replace({ widget: new CheckboxWidget(checked, ref.from) }).range(ref.from, ref.to))
          }
          return
        }

        if (name === 'HorizontalRule') {
          if (!lineTouched(state, focused, ref.from)) {
            out.push(Decoration.replace({ widget: new RuleWidget() }).range(ref.from, ref.to))
          }
          return
        }

        if (name === 'FencedCode' || name === 'CodeBlock') {
          addLineClass(out, state, ref.from, ref.to, 'zn-codeblock')
          const first = doc.lineAt(ref.from)
          const last = doc.lineAt(ref.to)
          out.push(Decoration.line({ class: 'zn-codeblock-first' }).range(first.from))
          out.push(Decoration.line({ class: 'zn-codeblock-last' }).range(last.from))
          // Hide the ``` fences (and language name) until the cursor enters the block.
          if (name === 'FencedCode' && !touches(state, focused, ref.from, ref.to)) {
            const lang = node.getChild('CodeInfo')
            if (first.to > first.from) {
              out.push(
                Decoration.replace({
                  widget: new FenceLabel(lang ? doc.sliceString(lang.from, lang.to) : '')
                }).range(first.from, first.to)
              )
            }
            if (last.number !== first.number && /^\s*(`{3,}|~{3,})\s*$/.test(last.text) && last.to > last.from) {
              out.push(hidden.range(last.from, last.to))
            }
          }
          return false
        }
        return
      }
    })
  }
  return Decoration.set(out, true)
}

function linkMark(href: string): Decoration {
  return Decoration.mark({ class: 'zn-link', attributes: { 'data-zn-href': href } })
}

export function livePreview(options: LivePreviewOptions) {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      constructor(view: EditorView) {
        this.decorations = buildDecorations(view, options)
      }
      update(u: ViewUpdate): void {
        if (
          u.docChanged ||
          u.viewportChanged ||
          u.selectionSet ||
          u.focusChanged ||
          syntaxTree(u.state) !== syntaxTree(u.startState) ||
          u.state.field(sourceMode, false) !== u.startState.field(sourceMode, false) ||
          u.transactions.some((tr) => tr.effects.some((e) => e.is(linksChanged)))
        ) {
          this.decorations = buildDecorations(u.view, options)
        }
      }
    },
    { decorations: (v) => v.decorations }
  )

  const clicks = EditorView.domEventHandlers({
    mousedown(e, view) {
      if (e.button !== 0) return false
      const el = e.target as HTMLElement
      const tag = el.closest<HTMLElement>('[data-zn-tag]')
      if (tag && !touches(view.state, view.hasFocus, view.posAtDOM(tag), view.posAtDOM(tag) + tag.textContent!.length)) {
        e.preventDefault()
        options.onOpenTag(tag.dataset.znTag!)
        return true
      }
      const wiki = el.closest<HTMLElement>('[data-zn-wikilink]')
      if (wiki) {
        e.preventDefault()
        options.onOpenWikiLink(wiki.dataset.znWikilink!)
        return true
      }
      const target = el.closest<HTMLElement>('[data-zn-href]')
      if (!target) return false
      e.preventDefault()
      options.onOpenLink(target.dataset.znHref!)
      return true
    }
  })

  return [plugin, clicks]
}
