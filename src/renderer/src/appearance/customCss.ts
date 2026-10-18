// CSS themes (.zenode/themes/<Name>/theme.css) and snippets (.zenode/snippets/*.css),
// added after the app's own styles. Obsidian community themes style
// body.theme-dark / body.theme-light and set Obsidian's public variables, so
// those classes are set and the common variables are mapped onto Zenode's.

// Obsidian variable -> Zenode token.
const OBSIDIAN_VARS: Array<[string, string]> = [
  ['--background-primary', '--zn-bg'],
  ['--background-secondary', '--zn-bg-panel'],
  ['--background-secondary-alt', '--zn-bg-raised'],
  ['--background-modifier-hover', '--zn-bg-hover'],
  ['--background-modifier-border', '--zn-border'],
  ['--background-modifier-border-hover', '--zn-border-strong'],
  ['--text-normal', '--zn-text'],
  ['--text-muted', '--zn-text-muted'],
  ['--text-faint', '--zn-text-faint'],
  ['--text-accent', '--zn-accent'],
  ['--interactive-accent', '--zn-accent-strong'],
  ['--text-on-accent', '--zn-on-accent'],
  ['--text-error', '--zn-danger'],
  ['--code-background', '--zn-bg-deep'],
  ['--text-highlight-bg', '--zn-highlight'],
  ['--font-text-theme', '--zn-font-text'],
  ['--font-monospace-theme', '--zn-font-mono']
]

const THEME_ID = 'zn-css-theme'
const SNIPPET_CLASS = 'zn-css-snippet'

function styleEl(id: string, css: string): HTMLStyleElement {
  const style = document.createElement('style')
  style.id = id
  style.textContent = css
  document.head.appendChild(style)
  return style
}

// Sets body.theme-dark / theme-light for themes written for Obsidian.
export function setThemeClass(theme: 'dark' | 'light'): void {
  document.body.classList.toggle('theme-dark', theme === 'dark')
  document.body.classList.toggle('theme-light', theme === 'light')
}

// Copies the Obsidian variables a theme sets onto Zenode's tokens (on <body>,
// so they win over the built-in themes). `keepAccent` leaves the user's accent alone.
export function mapObsidianVariables(keepAccent: boolean): void {
  const body = document.body
  for (const [, ours] of OBSIDIAN_VARS) body.style.removeProperty(ours)
  if (!document.getElementById(THEME_ID) && !document.querySelector(`.${SNIPPET_CLASS}`)) return
  const computed = getComputedStyle(body)
  for (const [theirs, ours] of OBSIDIAN_VARS) {
    if (keepAccent && (ours === '--zn-accent' || ours === '--zn-accent-strong')) continue
    const value = computed.getPropertyValue(theirs).trim()
    if (value) body.style.setProperty(ours, value)
  }
}

// Loads the chosen theme and snippets (replacing what was loaded before).
// Returns the names that could not be read, for a notice.
export async function loadCustomCss(cssTheme: string, snippets: string[]): Promise<string[]> {
  const failed: string[] = []
  document.getElementById(THEME_ID)?.remove()
  document.querySelectorAll(`.${SNIPPET_CLASS}`).forEach((n) => n.remove())
  if (cssTheme) {
    try {
      styleEl(THEME_ID, await window.zenode.readCss('theme', cssTheme))
    } catch {
      failed.push(`theme "${cssTheme}"`)
    }
  }
  for (const name of snippets) {
    try {
      styleEl(`zn-css-snippet-${name}`, await window.zenode.readCss('snippet', name)).classList.add(SNIPPET_CLASS)
    } catch {
      failed.push(`snippet "${name}"`)
    }
  }
  return failed
}
