// Puts rendered Markdown into the page: sanitises the HTML, wires up clicks,
// then fills in what needs the vault or heavy libraries (embeds, Mermaid
// diagrams, code highlighting). Used by Reading view, embeds and hover previews.
import DOMPurify from 'dompurify'
import { el } from '../component'
import { baseName, isMarkdown, stripExt } from '../paths'
import { mediaKind, vaultUrl } from '../vaultUrl'
import { highlightElement } from './highlight'
import { renderMarkdown, splitWikiTarget } from './markdown'
import { extractSection } from './sections'

export interface ReadingContext {
  // The note being shown.
  sourcePath: string
  resolve(link: string, from: string): string | null
  // A note's text (from the index), or null if unknown.
  readNote(path: string): Promise<string | null>
  onOpenWikiLink(target: string, from: string): void
  onOpenLink(href: string): void
  onOpenTag(tag: string): void
  // A task checkbox was clicked (0-based source line), when the view can edit.
  onToggleTask?(line: number, checked: boolean): void
}

// Embeds inside embeds stop here (and never loop back to a note already shown).
const MAX_EMBED_DEPTH = 4

const PURIFY_CONFIG = {
  USE_PROFILES: { html: true, svg: true, mathMl: true },
  ADD_ATTR: ['target', 'open'],
  FORBID_TAGS: ['style', 'iframe', 'object', 'embed', 'form', 'base', 'meta', 'link'],
  // http(s), mailto, the vault protocol, in-page anchors and relative paths only.
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|vault):|#|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i
}

export function sanitize(html: string): string {
  return DOMPurify.sanitize(html, PURIFY_CONFIG) as unknown as string
}

// Renders `src` into `container`, replacing what was there.
export async function renderInto(container: HTMLElement, src: string, ctx: ReadingContext, ancestors: string[] = []): Promise<void> {
  const env = {
    sourcePath: ctx.sourcePath,
    resolve: (link: string) => ctx.resolve(link, ctx.sourcePath),
    fileUrl: vaultUrl
  }
  container.innerHTML = sanitize(renderMarkdown(src, env))
  container.classList.add('zn-rendered')
  wireClicks(container, ctx)
  const chain = [...ancestors, ctx.sourcePath]
  await Promise.all([
    ...[...container.querySelectorAll<HTMLElement>('.zn-embed-slot')].map((slot) => fillEmbed(slot, ctx, chain)),
    renderDiagrams(container),
    highlightBlocks(container)
  ])
}

// One delegated handler per container (re-renders replace it, never stack).
// An embedded note's body has its own handler, which stops the click once handled.
function wireClicks(container: HTMLElement, ctx: ReadingContext): void {
  container.onclick = (e) => {
    const target = e.target as HTMLElement
    const wiki = target.closest<HTMLElement>('[data-zn-wikilink]')
    const href = target.closest<HTMLElement>('[data-zn-href]')
    const tag = target.closest<HTMLElement>('[data-zn-tag]')
    const anchor = target.closest('a')
    if (wiki) ctx.onOpenWikiLink(wiki.dataset.znWikilink!, ctx.sourcePath)
    else if (href) ctx.onOpenLink(href.dataset.znHref!)
    else if (tag) ctx.onOpenTag(tag.dataset.znTag!)
    else if (anchor && anchor.getAttribute('href')?.startsWith('#')) {
      // Footnote and in-page anchors scroll within the view.
      const id = decodeURIComponent(anchor.getAttribute('href')!.slice(1))
      container.querySelector(`[id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'center' })
    } else return
    e.preventDefault()
    e.stopPropagation()
  }
  container.onchange = (e) => {
    const box = e.target as HTMLInputElement
    if (!box.classList.contains('zn-task-box')) return
    if (!ctx.onToggleTask) {
      box.checked = !box.checked
      return
    }
    ctx.onToggleTask(Number(box.dataset.znLine), box.checked)
  }
  for (const box of container.querySelectorAll<HTMLInputElement>('.zn-task-box')) box.disabled = !ctx.onToggleTask
}

// ---------- Embeds ----------

function sizeAttrs(media: HTMLImageElement | HTMLVideoElement, size: string): void {
  // "300" (width) or "300x200".
  const m = /^(\d+)(?:x(\d+))?$/.exec(size.trim())
  if (!m) {
    if (size) media.setAttribute('alt', size)
    return
  }
  media.width = Number(m[1])
  if (m[2]) media.height = Number(m[2])
}

async function fillEmbed(slot: HTMLElement, ctx: ReadingContext, ancestors: string[]): Promise<void> {
  const { link, subpath } = splitWikiTarget(slot.dataset.znEmbed ?? '')
  const size = slot.dataset.znSize ?? ''
  const path = ctx.resolve(link, ctx.sourcePath)
  if (!path) {
    const missing = el('span', 'zn-embed-missing', undefined, `“${link}” not found`)
    slot.replaceWith(missing)
    return
  }
  const url = vaultUrl(path)
  switch (mediaKind(path)) {
    case 'image': {
      const img = el('img', 'zn-embed-image')
      img.src = url
      img.alt = baseName(path)
      img.loading = 'lazy'
      sizeAttrs(img, size)
      slot.replaceWith(img)
      return
    }
    case 'audio': {
      const audio = el('audio', 'zn-embed-audio')
      audio.controls = true
      audio.src = url
      slot.replaceWith(audio)
      return
    }
    case 'video': {
      const video = el('video', 'zn-embed-video')
      video.controls = true
      video.src = url
      sizeAttrs(video, size)
      slot.replaceWith(video)
      return
    }
    case 'pdf': {
      const frame = el('iframe', 'zn-embed-pdf')
      frame.src = subpath.startsWith('#page=') ? `${url}${subpath}` : url
      frame.title = baseName(path)
      slot.replaceWith(frame)
      return
    }
  }
  if (!isMarkdown(path)) {
    const card = el('a', 'zn-embed-file', undefined, baseName(path))
    card.href = '#'
    card.dataset.znWikilink = path
    slot.replaceWith(card)
    return
  }
  const box = el('div', 'zn-embed-note')
  const header = el('div', 'zn-embed-header', box)
  const title = el('a', 'zn-internal', header, stripExt(baseName(path)) + (subpath ? ` › ${subpath.replace(/^#\^?/, '')}` : ''))
  title.href = '#'
  title.dataset.znWikilink = path + subpath
  const body = el('div', 'zn-embed-body', box)
  slot.replaceWith(box)
  if (ancestors.includes(path) || ancestors.length >= MAX_EMBED_DEPTH) {
    el('div', 'zn-embed-missing', body, 'Embedded here already (not repeated)')
    return
  }
  const text = await ctx.readNote(path)
  const part = text === null ? null : extractSection(text, subpath)
  if (part === null) {
    el('div', 'zn-embed-missing', body, text === null ? 'Could not read this note' : `“${subpath.slice(1)}” not found in this note`)
    return
  }
  await renderInto(body, part, { ...ctx, sourcePath: path, onToggleTask: undefined }, ancestors)
}

// ---------- Diagrams and code ----------

let mermaidReady: Promise<typeof import('mermaid').default> | null = null
let diagramId = 0

function loadMermaid(): Promise<typeof import('mermaid').default> {
  mermaidReady ??= import('mermaid').then(({ default: mermaid }) => {
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'dark', fontFamily: 'inherit' })
    return mermaid
  })
  return mermaidReady
}

export async function renderMermaid(target: HTMLElement, source: string): Promise<void> {
  try {
    const mermaid = await loadMermaid()
    const { svg } = await mermaid.render(`zn-mermaid-${++diagramId}`, source)
    // Mermaid (strict mode) already escapes labels; keep its scoped <style> and
    // <foreignObject> labels, which the general sanitiser would strip.
    target.innerHTML = DOMPurify.sanitize(svg, {
      USE_PROFILES: { svg: true, svgFilters: true, html: true },
      ADD_TAGS: ['style', 'foreignObject'],
      HTML_INTEGRATION_POINTS: { foreignobject: true }
    }) as unknown as string
  } catch (e) {
    target.replaceChildren(el('div', 'zn-diagram-error', undefined, `Diagram error: ${(e as Error).message}`))
  }
}

async function renderDiagrams(container: HTMLElement): Promise<void> {
  const blocks = [...container.querySelectorAll<HTMLElement>('.zn-mermaid')]
  for (const block of blocks) await renderMermaid(block, block.textContent ?? '')
}

async function highlightBlocks(container: HTMLElement): Promise<void> {
  for (const pre of container.querySelectorAll<HTMLElement>('pre.zn-code-block')) {
    const code = pre.querySelector('code')
    if (!code) continue
    addCopyButton(pre, code.textContent ?? '')
    const lang = pre.dataset.znLang
    if (lang) await highlightElement(code, lang).catch(() => undefined)
  }
}

function addCopyButton(pre: HTMLElement, text: string): void {
  const button = el('button', 'zn-copy-code', pre, 'Copy')
  button.addEventListener('click', (e) => {
    e.stopPropagation()
    void navigator.clipboard.writeText(text).then(() => {
      button.textContent = 'Copied'
      window.setTimeout(() => (button.textContent = 'Copy'), 1200)
    })
  })
}
