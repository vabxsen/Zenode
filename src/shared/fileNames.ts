// Windows file-name rules, checked before creating or renaming anything so the
// user gets a clear message instead of an OS error.

const INVALID_CHARS = /[<>:"/\\|?*\u0000-\u001f]/
// Reserved device names, with or without an extension (CON, CON.md, ...).
const RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i
const MAX_NAME = 255

// Returns why `name` can't be used as a file or folder name, or null if it's fine.
export function fileNameProblem(name: string): string | null {
  if (!name.trim()) return 'The name is empty.'
  if (name === '.' || name === '..') return `"${name}" is not a valid name.`
  const bad = INVALID_CHARS.exec(name)
  if (bad) {
    const ch = bad[0].charCodeAt(0) < 32 ? 'control characters' : `"${bad[0]}"`
    return `Names can't contain ${ch}. Avoid < > : " / \\ | ? *`
  }
  if (/[. ]$/.test(name)) return "Names can't end with a dot or a space on Windows."
  if (RESERVED.test(name)) return `"${name.split('.')[0].toUpperCase()}" is a reserved name on Windows.`
  if (name.length > MAX_NAME) return `The name is too long (${name.length} characters; the limit is ${MAX_NAME}).`
  return null
}
