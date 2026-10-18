// Syntax highlighting for code blocks outside the editor (Reading view, embeds),
// using the same CodeMirror language parsers the editor loads, on demand.
import { LanguageDescription } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { classHighlighter, highlightCode } from '@lezer/highlight'

export function findLanguage(name: string): LanguageDescription | null {
  return LanguageDescription.matchLanguageName(languages, name, true)
}

// Replaces the text of `code` with highlighted spans (tok-* classes). Unknown
// languages are left as plain text.
export async function highlightElement(code: HTMLElement, lang: string): Promise<void> {
  const desc = findLanguage(lang)
  if (!desc) return
  const support = desc.support ?? (await desc.load())
  const text = code.textContent ?? ''
  const tree = support.language.parser.parse(text)
  const out = document.createDocumentFragment()
  highlightCode(
    text,
    tree,
    classHighlighter,
    (piece, classes) => {
      if (!classes) {
        out.appendChild(document.createTextNode(piece))
        return
      }
      const span = document.createElement('span')
      span.className = classes
      span.textContent = piece
      out.appendChild(span)
    },
    () => out.appendChild(document.createTextNode('\n'))
  )
  code.replaceChildren(out)
}
