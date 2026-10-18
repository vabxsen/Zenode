// The canvas toolbar (bottom) and the color bar shown for a selection (top).
import { el } from '../component'
import { icon, type IconName } from '../icons'
import { PRESET_COLORS } from './model'

export interface ToolbarActions {
  addCard(): void
  addNote(): void
  group(): void
  zoomOut(): void
  fit(): void
  zoomIn(): void
}

// Toolbar buttons never take focus, so canvas shortcuts (undo, delete) keep
// working after a click: focus goes back to `focusTarget`.
function chromeClick(button: HTMLElement, focusTarget: HTMLElement, action: () => void): void {
  button.addEventListener('mousedown', (e) => e.preventDefault())
  button.addEventListener('click', () => {
    focusTarget.focus({ preventScroll: true })
    action()
  })
}

export function buildToolbar(parent: HTMLElement, focusTarget: HTMLElement, a: ToolbarActions): HTMLElement {
  const bar = el('div', 'zn-canvas-toolbar', parent)
  bar.setAttribute('role', 'toolbar')
  bar.setAttribute('aria-label', 'Canvas')
  const button = (name: IconName, label: string, action: () => void): void => {
    const b = el('button', 'zn-canvas-btn', bar)
    b.title = label
    b.setAttribute('aria-label', label)
    b.appendChild(icon(name, 16))
    chromeClick(b, focusTarget, action)
  }
  button('filePlus', 'Add card (double-click the canvas)', a.addCard)
  button('note', 'Add note from vault', a.addNote)
  button('folderPlus', 'Group selection', a.group)
  el('div', 'zn-canvas-sep', bar)
  button('minus', 'Zoom out (Ctrl+scroll)', a.zoomOut)
  button('fit', 'Zoom to fit', a.fit)
  button('plus', 'Zoom in (Ctrl+scroll)', a.zoomIn)
  return bar
}

// A floating text box over `anchorEl`. Calls `done` once with the trimmed text
// (Enter or blur) or null (Escape).
export function editLabelInPlace(anchorEl: HTMLElement, value: string, done: (next: string | null) => void): void {
  const rect = anchorEl.getBoundingClientRect()
  const input = el('input', 'zn-canvas-label-input', document.body)
  input.value = value
  input.style.left = `${rect.left}px`
  input.style.top = `${rect.top}px`
  input.style.minWidth = `${Math.max(rect.width, 160)}px`
  let finished = false
  const finish = (commit: boolean): void => {
    if (finished) return
    finished = true
    const next = input.value.trim()
    input.remove()
    done(commit ? next : null)
  }
  input.addEventListener('keydown', (e) => {
    e.stopPropagation()
    if (e.key === 'Enter') finish(true)
    if (e.key === 'Escape') finish(false)
  })
  input.addEventListener('blur', () => finish(true))
  requestAnimationFrame(() => {
    input.focus()
    input.select()
  })
}

// Fills the color bar with swatches and a delete button, or hides it.
export function renderColorBar(
  bar: HTMLElement,
  focusTarget: HTMLElement,
  visible: boolean,
  onColor: (color: string) => void,
  onDelete: () => void
): void {
  bar.replaceChildren()
  bar.style.display = visible ? '' : 'none'
  if (!visible) return
  const swatch = (value: string, css: string | null, title: string): void => {
    const b = el('button', 'zn-canvas-swatch', bar)
    b.title = title
    b.setAttribute('aria-label', title)
    if (css) b.style.background = css
    else b.classList.add('is-clear')
    chromeClick(b, focusTarget, () => onColor(value))
  }
  swatch('', null, 'No color')
  for (const [k, css] of Object.entries(PRESET_COLORS)) swatch(k, css, `Color ${k}`)
  const del = el('button', 'zn-canvas-btn is-danger', bar)
  del.title = 'Delete (Del)'
  del.setAttribute('aria-label', 'Delete selected')
  del.appendChild(icon('close', 14))
  chromeClick(del, focusTarget, onDelete)
}
