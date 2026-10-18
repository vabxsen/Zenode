import { closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { HighlightStyle, indentOnInput, syntaxHighlighting } from '@codemirror/language'
import { Annotation, EditorState, type Extension } from '@codemirror/state'
import { drawSelection, dropCursor, EditorView, highlightActiveLine, keymap } from '@codemirror/view'
import { tags as t } from '@lezer/highlight'
import { wikiLinkCompletion, type LinkTarget } from './linkCompletion'
import { livePreview, sourceMode } from './livePreview'
import { frontmatterSyntax, hashtagSyntax, wikiLinkSyntax } from './wikilink'

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
    },
    '.cm-tooltip.cm-tooltip-autocomplete': {
      background: '#13131a',
      border: '1px solid #262632',
      borderRadius: '9px',
      padding: '4px',
      boxShadow: '0 12px 32px rgba(0,0,0,.5)'
    },
    '.cm-tooltip-autocomplete > ul': { fontFamily: 'var(--zn-font-ui)', maxHeight: '18em' },
    '.cm-tooltip-autocomplete > ul > li': { padding: '5px 10px !important', borderRadius: '6px' },
    '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
      background: 'rgba(139, 92, 246, 0.22) !important',
      color: 'var(--zn-text-strong) !important'
    },
    '.cm-completionDetail': { marginLeft: '10px', fontStyle: 'normal', color: 'var(--zn-text-faint)', fontSize: '12px' },
    '.cm-completionMatchedText': { textDecoration: 'none', color: 'var(--zn-accent)' }
  },
  { dark: true }
)

export interface EditorCallbacks {
  onChange(): void
  onOpenLink(href: string): void
  onOpenWikiLink(target: string): void
  onOpenTag(tag: string): void
  isResolved(link: string): boolean
  linkTargets(): LinkTarget[]
}

// A file whose every line break is CRLF (typical of Windows editors).
export function usesCrlf(text: string): boolean {
  return text.includes('\r\n') && !/(^|[^\r])\n/.test(text)
}

export function createEditorState(doc: string, cb: EditorCallbacks, extra: Extension[] = []): EditorState {
  return EditorState.create({
    doc,
    extensions: [
      // Keep a CRLF file CRLF when it's saved (CodeMirror would otherwise write LF).
      usesCrlf(doc) ? EditorState.lineSeparator.of('\r\n') : [],
      history(),
      drawSelection(),
      dropCursor(),
      indentOnInput(),
      highlightActiveLine(),
      closeBrackets(),
      EditorView.lineWrapping,
      keymap.of([...closeBracketsKeymap, ...completionKeymap, ...defaultKeymap, ...historyKeymap, indentWithTab]),
      markdown({ base: markdownLanguage, extensions: [frontmatterSyntax, wikiLinkSyntax, hashtagSyntax] }),
      EditorState.languageData.of(() => [{ closeBrackets: { brackets: ['(', '[', '{', '"'] } }]),
      syntaxHighlighting(highlight),
      theme,
      sourceMode,
      livePreview({
        onOpenLink: cb.onOpenLink,
        onOpenWikiLink: cb.onOpenWikiLink,
        onOpenTag: cb.onOpenTag,
        isResolved: cb.isResolved
      }),
      wikiLinkCompletion(cb.linkTargets),
      EditorView.contentAttributes.of({ spellcheck: 'true', autocorrect: 'on' }),
      EditorView.updateListener.of((u) => {
        if (u.docChanged && !u.transactions.some((tr) => tr.annotation(fromDisk))) cb.onChange()
      }),
      ...extra
    ]
  })
}
