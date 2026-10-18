// Building blocks for the settings screen: a labelled row with a control.
// Controls save as soon as they change (there is no "Save" button).
import { el } from '../component'

let nextId = 0

// A setting: name and description on the left, the control on the right.
// Returns the control area.
export function settingRow(parent: HTMLElement, name: string, desc = ''): { row: HTMLElement; control: HTMLElement; labelId: string } {
  const row = el('div', 'zn-set-row', parent)
  const info = el('div', 'zn-set-info', row)
  const labelId = `zn-set-${++nextId}`
  const label = el('div', 'zn-set-name', info, name)
  label.id = labelId
  if (desc) el('div', 'zn-set-desc', info, desc)
  return { row, control: el('div', 'zn-set-control', row), labelId }
}

export function heading(parent: HTMLElement, text: string): void {
  el('h3', 'zn-set-heading', parent, text)
}

export function toggle(parent: HTMLElement, name: string, desc: string, value: boolean, onChange: (v: boolean) => void): HTMLInputElement {
  const { control, labelId } = settingRow(parent, name, desc)
  const box = el('input', 'zn-switch', control)
  box.type = 'checkbox'
  box.role = 'switch'
  box.checked = value
  box.setAttribute('aria-labelledby', labelId)
  box.addEventListener('change', () => onChange(box.checked))
  return box
}

export function dropdown<T extends string>(parent: HTMLElement, name: string, desc: string, options: Array<[T, string]>, value: T, onChange: (v: T) => void): HTMLSelectElement {
  const { control, labelId } = settingRow(parent, name, desc)
  const sel = el('select', 'zn-set-select', control)
  sel.setAttribute('aria-labelledby', labelId)
  for (const [v, text] of options) {
    const opt = el('option', '', sel, text)
    opt.value = v
    opt.selected = v === value
  }
  sel.addEventListener('change', () => onChange(sel.value as T))
  return sel
}

// Text saved when the field is left or Enter is pressed.
export function textField(parent: HTMLElement, name: string, desc: string, value: string, placeholder: string, onChange: (v: string) => void): HTMLInputElement {
  const { control, labelId } = settingRow(parent, name, desc)
  const input = el('input', 'zn-set-text', control)
  input.value = value
  input.placeholder = placeholder
  input.spellcheck = false
  input.setAttribute('aria-labelledby', labelId)
  input.addEventListener('change', () => onChange(input.value.trim()))
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur()
  })
  return input
}

// A slider with its value shown beside it.
export function slider(
  parent: HTMLElement,
  name: string,
  desc: string,
  range: { min: number; max: number; step: number },
  value: number,
  format: (v: number) => string,
  onChange: (v: number) => void
): HTMLInputElement {
  const { control, labelId } = settingRow(parent, name, desc)
  const input = el('input', 'zn-set-slider', control)
  input.type = 'range'
  input.min = String(range.min)
  input.max = String(range.max)
  input.step = String(range.step)
  input.value = String(value)
  input.setAttribute('aria-labelledby', labelId)
  const shown = el('span', 'zn-set-value', control, format(value))
  input.addEventListener('input', () => (shown.textContent = format(Number(input.value))))
  input.addEventListener('change', () => onChange(Number(input.value)))
  return input
}

// A colour, with a button back to the default ('' = default).
export function colorPicker(parent: HTMLElement, name: string, desc: string, value: string, fallback: string, onChange: (v: string) => void): void {
  const { control, labelId } = settingRow(parent, name, desc)
  const input = el('input', 'zn-set-color', control)
  input.type = 'color'
  input.value = value || fallback
  input.setAttribute('aria-labelledby', labelId)
  const reset = el('button', 'zn-btn zn-set-button', control, 'Default')
  reset.disabled = !value
  input.addEventListener('change', () => {
    reset.disabled = false
    onChange(input.value)
  })
  reset.addEventListener('click', () => {
    input.value = fallback
    reset.disabled = true
    onChange('')
  })
}

export function button(parent: HTMLElement, name: string, desc: string, label: string, action: () => void | Promise<void>): HTMLButtonElement {
  const { control } = settingRow(parent, name, desc)
  const b = el('button', 'zn-btn zn-set-button', control, label)
  b.addEventListener('click', () => void action())
  return b
}
