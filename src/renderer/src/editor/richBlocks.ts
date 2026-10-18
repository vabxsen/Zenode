// Live Preview's rendered blocks: embeds, $$math$$, tables and Mermaid diagrams
// show rendered until the cursor moves onto them, then turn back into source.
// Block widgets must come from a state field (CodeMirror doesn't allow them from
// view plugins), so this decides "revealed" from the selection alone.
import { syntaxTree } from '@codemirror/language'
import { StateField, type EditorState, type Extension, type Range } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
import katex from 'katex'
import { renderMarkdown } from '../render/markdown'
import { renderEmbedSlot, renderMermaid, sanitize, type ReadingContext } from '../render/reading'
import { vaultUrl } from '../vaultUrl'
import { linksChanged, sourceMode } from './livePreview'

export type RenderContextGetter = () => ReadingContext | null

// Clicks on links and media controls inside a widget belong to the widget;
// anything else lets the editor place the cursor there (revealing the source).
function keepEvent(e: Event): boolean {
  const target = e.target as HTMLElement | null
  return !!target?.closest('a, button, audio, video, iframe, input, summary, [data-zn-wikilink], [data-zn-href], [data-zn-tag]')
}

// Advances when the whole index is rebuilt, so embeds drawn before the index
// was ready (showing "not found") draw again once it is.
let indexGeneration = 0

export function embedsNeedRedraw(): void {
  indexGeneration++
}

class EmbedWidget extends WidgetType {
  readonly generation = indexGeneration

  constructor(
    readonly target: string,
    readonly size: string,
    readonly block: boolean,
    readonly ctx: RenderContextGetter
  ) {
    super()
  }
  eq(other: EmbedWidget): boolean {
    return other.target === this.target && other.size === this.size && other.block === this.block && other.generation === this.generation
  }
  toDOM(): HTMLElement {
    const wrap = document.createElement(this.block ? 'div' : 'span')
    wrap.className = `zn-lp-embed zn-rendered${this.block ? '' : ' is-inline'}`
    const ctx = this.ctx()
    const slot = document.createElement('span')
    slot.className = 'zn-embed-slot'
    slot.dataset.znEmbed = this.target
    slot.dataset.znSize = this.size
    wrap.appendChild(slot)
    if (ctx) void renderEmbedSlot(wrap, slot, ctx)
    return wrap
  }
  ignoreEvent(e: Event): boolean {
    return keepEvent(e)
  }
}

class MathWidget extends WidgetType {
  constructor(readonly tex: string) {
    super()
  }
  eq(other: MathWidget): boolean {
    return other.tex === this.tex
  }
  toDOM(): HTMLElement {
    const div = document.createElement('div')
    div.className = 'zn-lp-math'
    katex.render(this.tex, div, { displayMode: true, throwOnError: false, strict: 'ignore' })
    return div
  }
  ignoreEvent(): boolean {
    return false
  }
}

class RenderedWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly kind: 'table' | 'mermaid',
    readonly ctx: RenderContextGetter
  ) {
    super()
  }
  eq(other: RenderedWidget): boolean {
    return other.source === this.source && other.kind === this.kind
  }
  toDOM(): HTMLElement {
    const div = document.createElement('div')
    div.className = `zn-lp-${this.kind} zn-rendered`
    if (this.kind === 'mermaid') {
      div.classList.add('zn-mermaid')
      void renderMermaid(div, this.source)
    } else {
      const ctx = this.ctx()
      const env = {
        sourcePath: ctx?.sourcePath ?? '',
        resolve: (link: string) => (ctx ? ctx.resolve(link, ctx.sourcePath) : null),
        fileUrl: vaultUrl
      }
      div.innerHTML = sanitize(renderMarkdown(this.source, env))
    }
    return div
  }
  ignoreEvent(e: Event): boolean {
    return keepEvent(e)
  }
}

// Whether any selection range touches the lines from..to.
function revealed(state: EditorState, from: number, to: number): boolean {
  const start = state.doc.lineAt(from).from
  const end = state.doc.lineAt(to).to
  return state.selection.ranges.some((r) => r.from <= end && r.to >= start)
}

function build(state: EditorState, ctx: RenderContextGetter): DecorationSet {
  if (state.field(sourceMode, false)) return Decoration.none
  const out: Range<Decoration>[] = []
  const doc = state.doc
  syntaxTree(state).iterate({
    enter: (node) => {
      const name = node.name
      if (name === 'WikiEmbed') {
        if (revealed(state, node.from, node.to)) return false
        const line = doc.lineAt(node.from)
        const inner = doc.sliceString(node.from + 3, node.to - 2)
        const pipe = inner.indexOf('|')
        const target = (pipe === -1 ? inner : inner.slice(0, pipe)).trim()
        const size = pipe === -1 ? '' : inner.slice(pipe + 1).trim()
        // An embed alone on its line becomes a block; inside text, an inline widget.
        const alone = line.text.trim() === doc.sliceString(node.from, node.to)
        const widget = new EmbedWidget(target, size, alone, ctx)
        out.push(
          alone
            ? Decoration.replace({ widget, block: true }).range(line.from, line.to)
            : Decoration.replace({ widget }).range(node.from, node.to)
        )
        return false
      }
      if (name === 'BlockMath') {
        if (revealed(state, node.from, node.to)) return false
        const text = doc.sliceString(node.from, node.to).trim()
        const tex = text.replace(/^\$\$/, '').replace(/\$\$$/, '').trim()
        out.push(Decoration.replace({ widget: new MathWidget(tex), block: true }).range(doc.lineAt(node.from).from, doc.lineAt(node.to).to))
        return false
      }
      if (name === 'Table') {
        if (revealed(state, node.from, node.to)) return false
        const from = doc.lineAt(node.from).from
        const to = doc.lineAt(node.to).to
        out.push(Decoration.replace({ widget: new RenderedWidget(doc.sliceString(from, to), 'table', ctx), block: true }).range(from, to))
        return false
      }
      if (name === 'FencedCode') {
        const info = node.node.getChild('CodeInfo')
        if (!info || doc.sliceString(info.from, info.to).trim().toLowerCase() !== 'mermaid') return false
        if (revealed(state, node.from, node.to)) return false
        const text = node.node.getChild('CodeText')
        const source = text ? doc.sliceString(text.from, text.to) : ''
        out.push(
          Decoration.replace({ widget: new RenderedWidget(source, 'mermaid', ctx), block: true }).range(
            doc.lineAt(node.from).from,
            doc.lineAt(node.to).to
          )
        )
        return false
      }
      return undefined
    }
  })
  return Decoration.set(out, true)
}

export function richBlocks(ctx: RenderContextGetter): Extension {
  return StateField.define<DecorationSet>({
    create: (state) => build(state, ctx),
    update(deco, tr) {
      const treeChanged = syntaxTree(tr.state) !== syntaxTree(tr.startState)
      const modeChanged = tr.state.field(sourceMode, false) !== tr.startState.field(sourceMode, false)
      const linksMoved = tr.effects.some((e) => e.is(linksChanged))
      if (!tr.docChanged && !tr.selection && !treeChanged && !modeChanged && !linksMoved) return deco
      return build(tr.state, ctx)
    },
    provide: (field) => EditorView.decorations.from(field)
  })
}
