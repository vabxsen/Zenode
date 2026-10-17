import { autocompletion, type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete'
import type { EditorView } from '@codemirror/view'

export interface LinkTarget {
  title: string
  folder: string
  linktext: string
}

// Suggests notes after "[[" and inserts the shortest unique link text.
export function wikiLinkCompletion(getTargets: () => LinkTarget[]) {
  const source = (ctx: CompletionContext): CompletionResult | null => {
    const before = ctx.matchBefore(/!?\[\[[^[\]|#\n]*$/)
    if (!before) return null
    const from = before.from + before.text.indexOf('[[') + 2
    const options: Completion[] = getTargets().map((t) => ({
      label: t.title,
      detail: t.folder || undefined,
      apply: (view: EditorView, _c: Completion, start: number, end: number) => {
        const closed = view.state.sliceDoc(end, end + 2) === ']]'
        const insert = closed ? t.linktext : `${t.linktext}]]`
        view.dispatch({
          changes: { from: start, to: end, insert },
          selection: { anchor: start + t.linktext.length + 2 }
        })
      }
    }))
    return { from, options, validFor: /^[^[\]|#\n]*$/ }
  }
  return autocompletion({ override: [source], icons: false, maxRenderedOptions: 50 })
}
