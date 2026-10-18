// UI for a file that changed (or vanished) on disk while it had unsaved edits:
// a bar with the choices, and a side-by-side compare dialog.
import { MergeView } from '@codemirror/merge'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { el } from './component'

export interface ConflictActions {
  // Compare side by side (notes only).
  compare?: () => void
  keepMine: () => void
  useDisk: () => void
  closeTab: () => void
}

// Fills `bar` for a conflict; `disk` is null when the file was deleted or moved.
export function renderConflictBar(bar: HTMLElement, disk: string | null, kind: 'note' | 'canvas', a: ConflictActions): void {
  bar.replaceChildren()
  bar.style.display = ''
  const text = el('div', 'zn-conflict-text', bar)
  if (disk === null) {
    el('strong', '', text, `This ${kind} was deleted or moved outside Zenode.`)
    text.appendChild(document.createTextNode(' Your unsaved changes are still here.'))
  } else {
    el('strong', '', text, `This ${kind} changed outside Zenode`)
    text.appendChild(document.createTextNode(' while you had unsaved changes. Nothing has been overwritten.'))
  }
  const buttons = el('div', 'zn-conflict-actions', bar)
  const button = (label: string, action: () => void, primary = false): void => {
    const b = el('button', `zn-btn${primary ? ' zn-btn-primary' : ''}`, buttons, label)
    b.addEventListener('click', action)
  }
  if (disk === null) {
    button('Save it again', a.keepMine, true)
    button('Close without saving', a.closeTab)
    return
  }
  if (a.compare) button('Compare…', a.compare, true)
  button('Keep my version', a.keepMine, !a.compare)
  button('Use the version on disk', a.useDisk)
}

export function hideConflictBar(bar: HTMLElement): void {
  bar.style.display = 'none'
  bar.replaceChildren()
}

// Side-by-side compare: the disk version on the left (read-only), the user's
// version on the right (editable; arrows copy changes across). Resolves with the
// merged text to save, or null if cancelled.
export function openCompareDialog(title: string, disk: string, mine: string): Promise<string | null> {
  return new Promise((resolve) => {
    const bg = el('div', 'zn-modal-bg', document.body)
    const modal = el('div', 'zn-merge', bg)
    const header = el('div', 'zn-merge-header', modal)
    el('div', 'zn-merge-title', header, `Compare: ${title}`)
    const labels = el('div', 'zn-merge-labels', modal)
    el('div', '', labels, 'On disk (changed outside Zenode)')
    el('div', '', labels, 'Your version (edit this; arrows copy changes across)')
    const host = el('div', 'zn-merge-body', modal)
    const theme = EditorView.theme({ '&': { height: '100%' } })
    const view = new MergeView({
      a: { doc: disk, extensions: [EditorView.lineWrapping, EditorState.readOnly.of(true), EditorView.editable.of(false), theme] },
      b: { doc: mine, extensions: [EditorView.lineWrapping, theme] },
      parent: host,
      revertControls: 'a-to-b',
      highlightChanges: true,
      gutter: true
    })
    const footer = el('div', 'zn-merge-footer', modal)
    const finish = (result: string | null): void => {
      view.destroy()
      bg.remove()
      window.removeEventListener('keydown', onKey, true)
      resolve(result)
    }
    const cancel = el('button', 'zn-btn', footer, 'Cancel')
    cancel.addEventListener('click', () => finish(null))
    const save = el('button', 'zn-btn zn-btn-primary', footer, 'Save my version')
    save.addEventListener('click', () => finish(view.b.state.doc.toString()))
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        finish(null)
      }
    }
    window.addEventListener('keydown', onKey, true)
    bg.addEventListener('mousedown', (e) => {
      if (e.target === bg) finish(null)
    })
    requestAnimationFrame(() => view.b.focus())
  })
}
