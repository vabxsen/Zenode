// Focus that arrives late (a tab restored or opened in the background) must not
// pull the keyboard out of a dialog the user is typing in, such as the
// command palette opened right after start-up.
export function dialogHasFocus(): boolean {
  const active = document.activeElement
  return active instanceof HTMLElement && !!active.closest('.zn-modal-bg, [role="dialog"]')
}
