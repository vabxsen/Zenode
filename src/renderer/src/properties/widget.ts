// Live Preview shows a note's front matter as an editable Properties table.
// Each edit rewrites only the YAML, through an ordinary (undoable) editor change.
// YAML that can't be edited safely stays visible as text; Source mode shows it raw.
import { StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
import { sourceMode } from '../editor/livePreview'
import { showMenu } from '../menu'
import {
  coerce,
  frontMatterEdit,
  frontMatterRange,
  PROPERTY_TYPES,
  readProperties,
  removeProperty,
  renameProperty,
  setProperty,
  type Property,
  type PropertyType,
  type PropertyValue
} from './model'
import { propertyTypes, setPropertyType } from './types'

// Ask open editors to redraw their properties (after a type changed).
export const propertyTypesChanged = StateEffect.define<null>()

const TYPE_LABEL: Record<PropertyType, string> = {
  text: 'Text',
  number: 'Number',
  checkbox: 'Checkbox',
  date: 'Date',
  datetime: 'Date & time',
  list: 'List',
  tags: 'Tags'
}
const TYPE_MARK: Record<PropertyType, string> = { text: 'Aa', number: '#', checkbox: '☑', date: '▦', datetime: '◷', list: '≡', tags: '⌗' }

// Which field to focus after the redraw that follows an edit.
let pendingFocus: { key: string; part: 'key' | 'value' | 'add' } | null = null

function make<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  node.className = cls
  if (text !== undefined) node.textContent = text
  parent.appendChild(node)
  return node
}

// Replaces the YAML using the current document (it may have changed since drawing).
function commit(view: EditorView, change: (yaml: string) => string | null): void {
  const range = frontMatterRange(view.state.doc.toString())
  if (!range) return
  const yaml = change(range.yaml)
  if (yaml === null || yaml === range.yaml) return
  view.dispatch({ changes: frontMatterEdit(range, yaml), userEvent: 'input.properties' })
}

class PropertiesWidget extends WidgetType {
  constructor(
    readonly props: Property[],
    readonly signature: string
  ) {
    super()
  }

  eq(other: PropertiesWidget): boolean {
    return other.signature === this.signature
  }

  toDOM(view: EditorView): HTMLElement {
    const box = document.createElement('div')
    box.className = 'zn-props'
    box.setAttribute('role', 'group')
    box.setAttribute('aria-label', 'Properties')
    make('div', 'zn-props-title', box, 'Properties')
    for (const p of this.props) this.row(view, box, p)
    const add = make('button', 'zn-props-add', box, '+ Add property')
    add.addEventListener('click', () => this.addRow(view, box, add))
    if (pendingFocus) {
      const want = pendingFocus
      pendingFocus = null
      requestAnimationFrame(() => {
        const row = [...box.querySelectorAll<HTMLElement>('.zn-prop-row')].find((r) => r.dataset.key === want.key)
        const target = row?.querySelector<HTMLElement>(want.part === 'key' ? '.zn-prop-key' : want.part === 'add' ? '.zn-prop-chip-input' : '.zn-prop-input, .zn-prop-chip-input')
        target?.focus()
      })
    }
    return box
  }

  private row(view: EditorView, box: HTMLElement, p: Property): void {
    const row = make('div', 'zn-prop-row', box)
    row.dataset.key = p.key
    const typeBtn = make('button', 'zn-prop-type', row, TYPE_MARK[p.type])
    typeBtn.title = `${TYPE_LABEL[p.type]} (click to change)`
    typeBtn.setAttribute('aria-label', `Property type: ${TYPE_LABEL[p.type]}`)
    typeBtn.addEventListener('click', (e) => {
      const r = typeBtn.getBoundingClientRect()
      e.stopPropagation()
      showMenu(r.left, r.bottom + 2, [
        ...PROPERTY_TYPES.map((t) => ({
          label: `${t === p.type ? '✓ ' : ''}${TYPE_LABEL[t]}`,
          action: () => {
            setPropertyType(p.key, t)
            commit(view, (yaml) => setProperty(yaml, p.key, coerce(t, p.value)))
            view.dispatch({ effects: propertyTypesChanged.of(null) })
          }
        })),
        'separator',
        { label: 'Remove property', danger: true, action: () => commit(view, (yaml) => removeProperty(yaml, p.key)) }
      ])
    })

    const key = make('input', 'zn-prop-key', row)
    key.value = p.key
    key.spellcheck = false
    key.setAttribute('aria-label', 'Property name')
    key.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') key.blur()
      if (e.key === 'Escape') {
        key.value = p.key
        key.blur()
      }
    })
    key.addEventListener('change', () => {
      const name = key.value.trim()
      if (!name || name === p.key) {
        key.value = p.key
        return
      }
      commit(view, (yaml) => {
        const renamed = renameProperty(yaml, p.key, name)
        if (renamed === null) key.value = p.key
        return renamed
      })
    })

    const value = make('div', 'zn-prop-value', row)
    this.valueEditor(view, value, p)
  }

  private valueEditor(view: EditorView, parent: HTMLElement, p: Property): void {
    const save = (v: PropertyValue): void => commit(view, (yaml) => setProperty(yaml, p.key, coerce(p.type, v)))
    if (p.type === 'checkbox') {
      const box = make('input', 'zn-prop-input zn-prop-check', parent)
      box.type = 'checkbox'
      box.checked = p.value === true
      box.setAttribute('aria-label', p.key)
      box.addEventListener('change', () => save(box.checked))
      return
    }
    if (p.type === 'list' || p.type === 'tags') {
      this.chips(view, parent, p)
      return
    }
    const input = make('input', 'zn-prop-input', parent)
    input.type = p.type === 'number' ? 'number' : p.type === 'date' ? 'date' : p.type === 'datetime' ? 'datetime-local' : 'text'
    input.value = p.value === null ? '' : String(p.value)
    input.placeholder = 'Empty'
    input.setAttribute('aria-label', p.key)
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') input.blur()
      if (e.key === 'Escape') {
        input.value = p.value === null ? '' : String(p.value)
        input.blur()
      }
    })
    input.addEventListener('change', () => save(input.value === '' ? null : input.value))
  }

  private chips(view: EditorView, parent: HTMLElement, p: Property): void {
    const items = Array.isArray(p.value) ? p.value : p.value === null ? [] : [String(p.value)]
    const save = (list: string[], focusAdd: boolean): void => {
      if (focusAdd) pendingFocus = { key: p.key, part: 'add' }
      commit(view, (yaml) => setProperty(yaml, p.key, coerce(p.type, list)))
    }
    items.forEach((item, i) => {
      const chip = make('span', `zn-prop-chip${p.type === 'tags' ? ' is-tag' : ''}`, parent)
      make('span', 'zn-prop-chip-text', chip, p.type === 'tags' ? `#${item}` : item)
      const x = make('button', 'zn-prop-chip-remove', chip, '×')
      x.setAttribute('aria-label', `Remove ${item}`)
      x.addEventListener('click', () => save(items.filter((_, j) => j !== i), false))
    })
    const input = make('input', 'zn-prop-chip-input', parent)
    input.placeholder = items.length ? '' : 'Empty'
    input.spellcheck = false
    input.setAttribute('aria-label', `Add to ${p.key}`)
    const addTyped = (focusAdd: boolean): void => {
      const typed = input.value.split(',').map((s) => s.trim()).filter(Boolean)
      if (typed.length) save([...items, ...typed], focusAdd)
    }
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault()
        addTyped(true)
      } else if (e.key === 'Backspace' && !input.value && items.length) {
        save(items.slice(0, -1), true)
      } else if (e.key === 'Escape') {
        input.value = ''
        input.blur()
      }
    })
    input.addEventListener('blur', () => addTyped(false))
  }

  // A new, not yet saved row: the property is written once it has a name.
  private addRow(view: EditorView, box: HTMLElement, add: HTMLElement): void {
    const row = document.createElement('div')
    row.className = 'zn-prop-row is-new'
    box.insertBefore(row, add)
    make('span', 'zn-prop-type', row, TYPE_MARK.text)
    const key = make('input', 'zn-prop-key', row)
    key.placeholder = 'Property name'
    key.setAttribute('aria-label', 'New property name')
    let done = false
    const finish = (): void => {
      if (done) return
      done = true
      const name = key.value.trim()
      if (!name || this.props.some((p) => p.key === name)) {
        row.remove()
        return
      }
      pendingFocus = { key: name, part: 'value' }
      commit(view, (yaml) => setProperty(yaml, name, null))
    }
    key.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') finish()
      if (e.key === 'Escape') {
        done = true
        row.remove()
      }
    })
    key.addEventListener('blur', finish)
    key.focus()
  }

  // Typing and clicking inside the table belong to the table, not the editor.
  ignoreEvent(): boolean {
    return true
  }
}

// Front matter is near the top; don't stringify a huge note on every keystroke.
const SCAN_LIMIT = 200_000

interface FieldValue {
  deco: DecorationSet
  // End of the front matter block, or -1 when there is none.
  end: number
}

function build(state: EditorState): FieldValue {
  const none = { deco: Decoration.none, end: -1 }
  const range = frontMatterRange(state.doc.sliceString(0, Math.min(state.doc.length, SCAN_LIMIT)))
  if (!range) return none
  const props = state.field(sourceMode, false) ? null : readProperties(range.yaml, propertyTypes())
  if (!props) return { deco: Decoration.none, end: range.end }
  const widget = Decoration.replace({ widget: new PropertiesWidget(props, JSON.stringify(props)), block: true })
  return { deco: Decoration.set([widget.range(0, range.end)]), end: range.end }
}

export function propertiesEditor(): Extension {
  return StateField.define<FieldValue>({
    create: build,
    update(value, tr) {
      const modeChanged = tr.state.field(sourceMode, false) !== tr.startState.field(sourceMode, false)
      if (modeChanged || tr.effects.some((e) => e.is(propertyTypesChanged))) return build(tr.state)
      if (!tr.docChanged) return value
      // Only edits in (or making) the front matter matter; others just shift nothing above them.
      let touched = false
      const limit = value.end >= 0 ? value.end + 1 : 0
      tr.changes.iterChangedRanges((fromA) => {
        if (fromA <= limit) touched = true
      })
      if (touched || (value.end < 0 && tr.state.doc.line(1).text.startsWith('---'))) return build(tr.state)
      return { deco: value.deco.map(tr.changes), end: value.end }
    },
    provide: (f) => [EditorView.decorations.from(f, (v) => v.deco), EditorView.atomicRanges.of((view) => view.state.field(f).deco)]
  })
}
