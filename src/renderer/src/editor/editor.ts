import { closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { codeFolding, foldGutter, foldKeymap, HighlightStyle, indentOnInput, syntaxHighlighting } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { highlightSelectionMatches, openSearchPanel, search, searchKeymap } from '@codemirror/search'
import { Annotation, Compartment, EditorSelection, EditorState, Prec, type Extension, type TransactionSpec } from '@codemirror/state'
import { drawSelection, dropCursor, EditorView, highlightActiveLine, keymap } from '@codemirror/view'
import { classHighlighter, tags as t } from '@lezer/highlight'
import { tableEditing } from './tables'
import { wikiLinkCompletion, type LinkTarget } from './linkCompletion'
import type { ReadingContext } from '../render/reading'
import { livePreview, sourceMode } from './livePreview'
import { propertiesEditor } from '../properties/widget'
import { richBlocks } from './richBlocks'
import { fileDropAndPaste } from './attachments'
import { commentSyntax, frontmatterSyntax, hashtagSyntax, highlightSyntax, mathSyntax, wikiLinkSyntax } from './wikilink'

// Spellcheck on/off (from settings); reconfigured on open editors when it changes.
export const spellcheckSetting = new Compartment()

export function spellcheckAttrs(on: boolean): Extension {
  return EditorView.contentAttributes.of({ spellcheck: on ? 'true' : 'false', autocorrect: on ? 'on' : 'off' })
}

// The default for new editors (the app sets it from .zenode/app.json).
let spellcheckDefault = true
export function setSpellcheckDefault(on: boolean): void {
  spellcheckDefault = on
}

// Marks transactions that load content from disk, so they don't count as edits.
export const fromDisk = Annotation.define<boolean>()

const highlight = HighlightStyle.define([
  { tag: t.heading, fontWeight: '700', color: 'var(--zn-text)' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strong, fontWeight: '600' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.link, color: 'var(--zn-accent)' },
  { tag: t.url, color: 'var(--zn-text-faint)' },
  { tag: t.monospace, fontFamily: 'var(--zn-font-mono)' },
  { tag: t.quote, color: 'var(--zn-text)' },
  { tag: t.processingInstruction, color: 'var(--zn-mark)' },
  { tag: t.contentSeparator, color: 'var(--zn-mark)' },
  { tag: t.meta, color: 'var(--zn-mark)' },
  { tag: t.labelName, color: 'var(--zn-mark)' }
])

const theme = EditorView.theme(
  {
    '&': { height: '100%', backgroundColor: 'transparent', color: 'var(--zn-text)' },
    '.cm-scroller': { fontFamily: 'var(--zn-font-text)', fontSize: 'var(--zn-text-size)', lineHeight: '1.5', position: 'relative' },
    // Room above the text for the note's inline title (see InlineTitle).
    '.cm-content': { padding: 'calc(32px + var(--zn-inline-title-h, 0px)) 0 50vh', caretColor: 'var(--zn-text)' },
    '.cm-line': { padding: '0 max(32px, calc((100% - var(--zn-line-width)) / 2))' },
    '&.cm-focused': { outline: 'none' },
    '.cm-cursor': { borderLeftColor: 'var(--zn-text)', borderLeftWidth: '1.5px' },
    '.cm-activeLine': { backgroundColor: 'transparent' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
      backgroundColor: 'var(--zn-selection) !important'
    },
    '.cm-tooltip.cm-tooltip-autocomplete': {
      background: 'var(--zn-bg)',
      border: '1px solid var(--zn-border-strong)',
      borderRadius: '8px',
      padding: '4px',
      boxShadow: 'var(--zn-shadow-s)'
    },
    '.cm-tooltip-autocomplete > ul': { fontFamily: 'var(--zn-font-ui)', fontSize: 'var(--zn-ui-small)', maxHeight: '18em' },
    '.cm-tooltip-autocomplete > ul > li': { padding: '6px 12px !important', borderRadius: '4px', color: 'var(--zn-text)' },
    '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
      background: 'var(--zn-bg-hover) !important',
      color: 'var(--zn-text) !important'
    },
    '.cm-completionDetail': { marginLeft: '10px', fontStyle: 'normal', color: 'var(--zn-text-faint)', fontSize: 'var(--zn-ui-smaller)' },
    '.cm-completionMatchedText': { textDecoration: 'none', fontWeight: '600', color: 'var(--zn-accent)' }
  },
  // Colours come from the theme tokens; whether CodeMirror treats the editor as
  // dark follows the app theme (themeMode below).
)

// CodeMirror's own dark/light base styles, kept in step with <html data-theme>.
const themeMode = new Compartment()
const isDarkTheme = (): boolean => document.documentElement.dataset.theme !== 'light'

// Brings one editor in line with the current theme (a stored tab state may be older).
export function syncEditorTheme(view: EditorView): void {
  const dark = isDarkTheme()
  if (view.state.facet(EditorView.darkTheme) !== dark) view.dispatch({ effects: themeMode.reconfigure(EditorView.darkTheme.of(dark)) })
}

// After a theme change: every editor on the page (notes, canvas cards).
export function syncAllEditorThemes(): void {
  for (const dom of document.querySelectorAll<HTMLElement>('.cm-editor')) {
    const view = EditorView.findFromDOM(dom)
    if (view) syncEditorTheme(view)
  }
}

export interface EditorCallbacks {
  onChange(): void
  onOpenLink(href: string): void
  onOpenWikiLink(target: string): void
  onOpenTag(tag: string): void
  isResolved(link: string): boolean
  linkTargets(): LinkTarget[]
  // For rendering embeds, tables and diagrams in Live Preview (optional).
  renderContext?(): ReadingContext | null
  // Files pasted or dropped into the note (optional; otherwise ignored).
  onFiles?(files: File[], pos: number): void
}

// A file whose every line break is CRLF (typical of Windows editors).
// The browser keeps undo steps of its own for edits made in an editor, which
// CodeMirror never uses (Ctrl+Z is CodeMirror's history). Each step holds the
// old lines it touched, so in one long-lived editor they pile up across every
// note it shows. Chromium drops an editable element's steps when the element
// leaves the document: detach and re-attach it when the editor changes note.
export function dropNativeUndo(view: EditorView): void {
  const content = view.contentDOM
  const parent = content.parentNode
  if (!parent) return
  const next = content.nextSibling
  parent.removeChild(content)
  parent.insertBefore(content, next)
}

// Selects from..to (clamped to the note) and scrolls it to the middle of the view.
export function revealRange(view: EditorView, from: number, to = from): void {
  const len = view.state.doc.length
  view.dispatch({
    selection: EditorSelection.range(Math.min(from, len), Math.min(to, len)),
    effects: EditorView.scrollIntoView(Math.min(from, len), { y: 'center' })
  })
  requestAnimationFrame(() => view.focus())
}

// The change that ticks (or unticks) the task box on 0-based `line`, or null
// when that line has none.
export function taskToggle(state: EditorState, line: number, checked: boolean): TransactionSpec | null {
  if (line < 0 || line >= state.doc.lines) return null
  const text = state.doc.line(line + 1)
  const m = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])\]/.exec(text.text)
  if (!m) return null
  const at = text.from + m[1].length
  return { changes: { from: at, to: at + 1, insert: checked ? 'x' : ' ' } }
}

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
      Prec.high(tableEditing()),
      // Ctrl+H opens find & replace, as in Obsidian (Ctrl+F opens the same panel).
      keymap.of([{ key: 'Mod-h', run: openSearchPanel }]),
      keymap.of([...closeBracketsKeymap, ...completionKeymap, ...searchKeymap, ...foldKeymap, ...defaultKeymap, ...historyKeymap, indentWithTab]),
      search({ top: true }),
      highlightSelectionMatches(),
      codeFolding({ placeholderText: '…' }),
      foldGutter({ openText: '⌄', closedText: '›' }),
      // Code blocks get their language's highlighting (parsers load on demand).
      markdown({
        base: markdownLanguage,
        codeLanguages: languages,
        extensions: [frontmatterSyntax, wikiLinkSyntax, hashtagSyntax, highlightSyntax, commentSyntax, mathSyntax]
      }),
      syntaxHighlighting(classHighlighter),
      EditorState.languageData.of(() => [{ closeBrackets: { brackets: ['(', '[', '{', '"'] } }]),
      syntaxHighlighting(highlight),
      theme,
      themeMode.of(EditorView.darkTheme.of(isDarkTheme())),
      // The text area's name for screen readers.
      EditorView.contentAttributes.of({ 'aria-label': 'Note text' }),
      sourceMode,
      livePreview({
        onOpenLink: cb.onOpenLink,
        onOpenWikiLink: cb.onOpenWikiLink,
        onOpenTag: cb.onOpenTag,
        isResolved: cb.isResolved
      }),
      richBlocks(() => cb.renderContext?.() ?? null),
      propertiesEditor(),
      cb.onFiles ? fileDropAndPaste(cb.onFiles) : [],
      wikiLinkCompletion(cb.linkTargets),
      spellcheckSetting.of(spellcheckAttrs(spellcheckDefault)),
      EditorView.updateListener.of((u) => {
        if (u.docChanged && !u.transactions.some((tr) => tr.annotation(fromDisk))) cb.onChange()
      }),
      ...extra
    ]
  })
}
