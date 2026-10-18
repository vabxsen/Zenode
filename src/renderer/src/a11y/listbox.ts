// Screen-reader wiring for the type-to-filter lists (quick switcher, command
// palette, pickers): the input is a combobox that controls a listbox, and the
// highlighted row is announced through aria-activedescendant. The pickers mark
// the highlighted row with .is-selected; this keeps the ARIA state in step.

let seq = 0

export function wireListbox(input: HTMLInputElement, list: HTMLElement, label: string): void {
  const id = `zn-listbox-${++seq}`
  list.id = id
  list.setAttribute('role', 'listbox')
  list.setAttribute('aria-label', label)
  // The list scrolls, so it must be reachable by keyboard; focus goes straight
  // back to the input, which handles the arrow keys.
  list.tabIndex = 0
  list.addEventListener('focus', () => input.focus())
  input.setAttribute('role', 'combobox')
  input.setAttribute('aria-expanded', 'true')
  input.setAttribute('aria-controls', id)
  input.setAttribute('aria-autocomplete', 'list')
  if (!input.hasAttribute('aria-label')) input.setAttribute('aria-label', label)

  const sync = (): void => {
    let active: string | null = null
    list.querySelectorAll<HTMLElement>('.zn-switcher-row').forEach((row, i) => {
      row.setAttribute('role', 'option')
      if (!row.id) row.id = `${id}-${i}-${Math.random().toString(36).slice(2, 7)}`
      const on = row.classList.contains('is-selected')
      row.setAttribute('aria-selected', String(on))
      if (on) active = row.id
    })
    if (active) input.setAttribute('aria-activedescendant', active)
    else input.removeAttribute('aria-activedescendant')
  }
  new MutationObserver(sync).observe(list, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] })
  sync()
}
