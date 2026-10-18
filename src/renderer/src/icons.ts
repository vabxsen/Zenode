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
  search: 'M11 4a7 7 0 1 0 0 14a7 7 0 0 0 0-14zM20 20l-4.2-4.2',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  switcher: 'M4 6h16M4 12h10M4 18h7M17 15l3 3-3 3',
  graph:
    'M3.5 6a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0M15.5 8a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0M9.5 18a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0M8.4 6.4l7.2 1.2M7 8.2l4 7.6M16.8 10.2l-3.8 5.8',
  fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  canvas: 'M3 3h7v7H3zM14 14h7v7h-7zM10 6.5h4.5a2 2 0 0 1 2 2V14',
  settings:
    'M9 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1',
  pin: 'M9 3h6l-1 6 3 3H7l3-3zM12 12v9',
  splitRight: 'M3 4h18v16H3zM12 4v16',
  splitDown: 'M3 4h18v16H3zM3 12h18',
  back: 'M15 6l-6 6 6 6',
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
