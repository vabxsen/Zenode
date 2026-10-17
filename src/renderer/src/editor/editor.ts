import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { HighlightStyle, indentOnInput, syntaxHighlighting } from '@codemirror/language'
import { Annotation, EditorState } from '@codemirror/state'
import { drawSelection, dropCursor, EditorView, highlightActiveLine, keymap } from '@codemirror/view'
import { tags as t } from '@lezer/highlight'
import { livePreview } from './livePreview'

// Marks transactions that load content from disk, so they don't count as edits.
export const fromDisk = Annotation.define<boolean>()

const highlight = HighlightStyle.define([
  { tag: t.heading, fontWeight: '700', color: 'var(--zn-text-strong)' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strong, fontWeight: '700', color: 'var(--zn-text-strong)' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.link, color: 'var(--zn-accent)' },
  { tag: t.url, color: 'var(--zn-accent-dim)' },
  { tag: t.monospace, fontFamily: 'var(--zn-font-mono)' },
  { tag: t.quote, color: 'var(--zn-text-muted)' },
  { tag: t.processingInstruction, color: 'var(--zn-text-faint)' },
  { tag: t.contentSeparator, color: 'var(--zn-text-faint)' },
  { tag: t.meta, color: 'var(--zn-text-faint)' },
  { tag: t.labelName, color: 'var(--zn-accent-dim)' }
])

const theme = EditorView.theme(
  {
    '&': { height: '100%', backgroundColor: 'transparent', color: 'var(--zn-text)' },
    '.cm-scroller': { fontFamily: 'var(--zn-font-text)', lineHeight: '1.7' },
    '.cm-content': { padding: '32px 0 40vh', caretColor: 'var(--zn-accent)' },
    '.cm-line': { padding: '0 max(32px, calc((100% - 760px) / 2))' },
    '&.cm-focused': { outline: 'none' },
    '.cm-cursor': { borderLeftColor: 'var(--zn-accent)', borderLeftWidth: '2px' },
    '.cm-activeLine': { backgroundColor: 'transparent' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
      backgroundColor: 'var(--zn-selection) !important'
    }
  },
  { dark: true }
)

export interface EditorCallbacks {
  onChange(): void
  onOpenLink(href: string): void
}

export function createEditorState(doc: string, cb: EditorCallbacks): EditorState {
  return EditorState.create({
    doc,
    extensions: [
      history(),
      drawSelection(),
      dropCursor(),
      indentOnInput(),
      highlightActiveLine(),
      EditorView.lineWrapping,
      keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
      markdown({ base: markdownLanguage }),
      syntaxHighlighting(highlight),
      theme,
      livePreview({ onOpenLink: cb.onOpenLink }),
      EditorView.contentAttributes.of({ spellcheck: 'true', autocorrect: 'on' }),
      EditorView.updateListener.of((u) => {
        if (u.docChanged && !u.transactions.some((tr) => tr.annotation(fromDisk))) cb.onChange()
      })
    ]
  })
}
