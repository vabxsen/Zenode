// What Zenode will hand to Windows: web links only, and files that can run
// code only after asking. Pure (used by main and tested in Node).

// Only these leave the app (opened in the browser or mail app).
const WEB_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

// The URL to open, or null when it must not be opened (other schemes such as
// file:, ms-settings:, javascript:, custom app protocols, or malformed text).
export function safeExternalUrl(url: unknown): string | null {
  if (typeof url !== 'string' || url.length > 8192) return null
  let parsed: URL
  try {
    parsed = new URL(url.trim())
  } catch {
    return null
  }
  if (!WEB_PROTOCOLS.has(parsed.protocol)) return null
  if (parsed.protocol !== 'mailto:' && !parsed.hostname) return null
  return parsed.href
}

// A link with a scheme (e.g. "ms-settings:"), as opposed to a path in the vault.
export function hasScheme(href: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(href) && !/^[a-z]:[\\/]/i.test(href)
}

// Files Windows would run rather than just open.
const RUNNABLE = new Set([
  'exe', 'com', 'scr', 'pif', 'bat', 'cmd', 'ps1', 'psm1', 'psd1', 'vbs', 'vbe', 'js', 'jse', 'wsf', 'wsh', 'msc',
  'msi', 'msp', 'mst', 'hta', 'cpl', 'jar', 'lnk', 'url', 'reg', 'inf', 'scf', 'appref-ms', 'application', 'gadget',
  'appx', 'appxbundle', 'msix', 'msixbundle', 'dll', 'sys', 'chm', 'iso', 'img', 'vhd', 'vhdx', 'library-ms', 'search-ms',
  'settingcontent-ms', 'diagcab', 'xll', 'xbap'
])

export function isRunnable(path: string): boolean {
  const name = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1).toLowerCase().replace(/[. ]+$/, '')
  const dot = name.lastIndexOf('.')
  return dot !== -1 && RUNNABLE.has(name.slice(dot + 1))
}
