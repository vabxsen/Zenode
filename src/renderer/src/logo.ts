// The Zenode mark, the Ribbon Z: two orange strips joined by a darker diagonal,
// the fold. The same shapes as the app icon (scripts/make-icons.cjs), without
// its dark tile so it sits on light and dark themes.
const NS = 'http://www.w3.org/2000/svg'

export function logoMark(size: number): SVGSVGElement {
  const svg = document.createElementNS(NS, 'svg')
  svg.setAttribute('viewBox', '15 15 34 34')
  svg.setAttribute('width', String(size))
  svg.setAttribute('height', String(size))
  svg.setAttribute('aria-hidden', 'true')
  svg.classList.add('zn-logo')
  const fold = document.createElementNS(NS, 'path')
  fold.setAttribute('d', 'M38 24H48L26 40H16Z')
  fold.setAttribute('fill', '#c2410c')
  svg.appendChild(fold)
  for (const y of [16, 40]) {
    const bar = document.createElementNS(NS, 'rect')
    for (const [k, v] of Object.entries({ x: 16, y, width: 32, height: 8, rx: 2, fill: '#fb923c' })) bar.setAttribute(k, String(v))
    svg.appendChild(bar)
  }
  return svg
}
