// Minimal stroke icons (24x24 viewBox), drawn for Zenode.
const PATHS = {
  files: 'M4 4h7l2 2h7v13H4z',
  filePlus: 'M14 3H6v18h12V7zM14 3v4h4M12 11v6M9 14h6',
  folderPlus: 'M3 6h7l2 2h9v11H3zM12 11v6M9 14h6',
  folderOpen: 'M3 7h6l2 2h10l-2 10H3zM3 7v12',
  chevron: 'M9 6l6 6-6 6',
  close: 'M6 6l12 12M18 6L6 18',
  sidebar: 'M3 4h18v16H3zM9 4v16',
  note: 'M6 3h9l3 3v15H6zM9 10h6M9 14h6M9 18h4',
  logo: 'M5 5h14L5 19h14'
} as const

export type IconName = keyof typeof PATHS

export function icon(name: IconName, size = 16): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(ns, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('width', String(size))
  svg.setAttribute('height', String(size))
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '1.8')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.classList.add('zn-icon')
  const path = document.createElementNS(ns, 'path')
  path.setAttribute('d', PATHS[name])
  svg.appendChild(path)
  return svg
}
