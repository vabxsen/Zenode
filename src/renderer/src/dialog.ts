// A small modal dialog: title, body, buttons. Resolves with the chosen button's
// value, or the cancel value on Escape / clicking outside.
import { el } from './component'

export interface DialogButton<T> {
  label: string
  value: T
  primary?: boolean
  danger?: boolean
}

export interface DialogOptions<T> {
  title: string
  // Plain text, or an element to show as the body.
  body: string | HTMLElement
  buttons: Array<DialogButton<T>>
  cancelValue: T
  // Extra class on the dialog box (for sizing).
  className?: string
}

export function openDialog<T>(opts: DialogOptions<T>): Promise<T> {
  return new Promise((resolve) => {
    const bg = el('div', 'zn-modal-bg zn-dialog-bg', document.body)
    const box = el('div', `zn-dialog${opts.className ? ` ${opts.className}` : ''}`, bg)
    box.setAttribute('role', 'dialog')
    box.setAttribute('aria-modal', 'true')
    el('div', 'zn-dialog-title', box, opts.title)
    const body = el('div', 'zn-dialog-body', box)
    if (typeof opts.body === 'string') body.textContent = opts.body
    else body.appendChild(opts.body)
    const footer = el('div', 'zn-dialog-footer', box)
    const finish = (value: T): void => {
      window.removeEventListener('keydown', onKey, true)
      bg.remove()
      resolve(value)
    }
    let first: HTMLButtonElement | null = null
    for (const b of opts.buttons) {
      const cls = `zn-btn${b.primary ? ' zn-btn-primary' : ''}${b.danger ? ' zn-btn-danger' : ''}`
      const button = el('button', cls, footer, b.label)
      button.addEventListener('click', () => finish(b.value))
      if (b.primary && !first) first = button
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        finish(opts.cancelValue)
      }
    }
    window.addEventListener('keydown', onKey, true)
    bg.addEventListener('mousedown', (e) => {
      if (e.target === bg) finish(opts.cancelValue)
    })
    requestAnimationFrame(() => first?.focus())
  })
}
