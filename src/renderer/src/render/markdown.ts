// Markdown -> HTML for Reading view, embeds and hover previews: CommonMark/GFM
// via markdown-it, plus Obsidian's additions as small plugins:
//   [[wikilinks]] and ![[embeds]], #tags, ==highlights==, %%comments%%,
//   > [!callouts], $math$ / $$math$$, - [ ] tasks, footnotes, front matter.
// The output is a string; render/reading.ts sanitises it and fills in the
// parts that need the DOM (embeds, diagrams, code highlighting).
import katex from 'katex'
import MarkdownIt, {
  type Env,
  type MarkdownIt as MarkdownItInstance,
  type MarkdownItOptions,
  type Renderer,
  type StateBlock,
  type StateCore,
  type StateInline,
  type Token
} from 'markdown-it'
import footnote from 'markdown-it-footnote'

// Passed through markdown-it's env to the rules below.
export interface RenderEnv extends Env {
  // The note being rendered (links resolve relative to it).
  sourcePath: string
  // Vault path a link points to, or null if it doesn't exist.
  resolve(link: string): string | null
  // A URL the page can load for a vault file (images).
  fileUrl(path: string): string
}

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// "target#sub|alias" -> parts.
export function splitWikiTarget(inner: string): { link: string; subpath: string; alias: string } {
  const pipe = inner.indexOf('|')
  const linkPart = (pipe === -1 ? inner : inner.slice(0, pipe)).trim()
  const alias = pipe === -1 ? '' : inner.slice(pipe + 1).trim()
  const hash = linkPart.indexOf('#')
  return { link: hash === -1 ? linkPart : linkPart.slice(0, hash), subpath: hash === -1 ? '' : linkPart.slice(hash), alias }
}

// ---------- [[wikilinks]] and ![[embeds]] ----------

function wikiRule(state: StateInline, silent: boolean): boolean {
  const src = state.src
  let pos = state.pos
  const embed = src.charCodeAt(pos) === 0x21 /* ! */
  if (embed) pos++
  if (src.charCodeAt(pos) !== 0x5b || src.charCodeAt(pos + 1) !== 0x5b) return false
  const start = pos + 2
  const end = src.indexOf(']]', start)
  if (end === -1 || end === start) return false
  const inner = src.slice(start, end)
  if (inner.includes('\n') || inner.includes('[[')) return false
  if (!silent) {
    const token = state.push(embed ? 'wiki_embed' : 'wikilink', '', 0)
    token.content = inner
  }
  state.pos = end + 2
  return true
}

function renderWikilink(tokens: Token[], idx: number, _o: unknown, env: Env | undefined): string {
  const { link, subpath, alias } = splitWikiTarget(tokens[idx].content)
  const resolved = link === '' || (env as RenderEnv).resolve(link) !== null
  const text = alias || (link ? link + subpath.replace(/^#\^?/, ' > ') : subpath.slice(1))
  const cls = `zn-internal${resolved ? '' : ' is-unresolved'}`
  return `<a class="${cls}" data-zn-wikilink="${escapeHtml(link + subpath)}" href="#">${escapeHtml(text)}</a>`
}

// Embeds are filled in later (they need the vault); this leaves a placeholder.
function renderEmbed(tokens: Token[], idx: number): string {
  const { link, subpath, alias } = splitWikiTarget(tokens[idx].content)
  return `<span class="zn-embed-slot" data-zn-embed="${escapeHtml(link + subpath)}" data-zn-size="${escapeHtml(alias)}"></span>`
}

// ---------- #tags ----------

const TAG_CHAR = /[\p{L}\p{N}_\-/]/u

function tagRule(state: StateInline, silent: boolean): boolean {
  const src = state.src
  const pos = state.pos
  if (src.charCodeAt(pos) !== 0x23 /* # */) return false
  if (pos > 0 && !/[\s(,;]/.test(src[pos - 1])) return false
  let end = pos + 1
  while (end < state.posMax && TAG_CHAR.test(src[end])) end++
  const body = src.slice(pos + 1, end)
  if (!body || /^[\d/]+$/.test(body)) return false
  if (!silent) state.push('zn_tag', '', 0).content = src.slice(pos, end)
  state.pos = end
  return true
}

// ---------- ==highlight== ----------

function highlightRule(state: StateInline, silent: boolean): boolean {
  const src = state.src
  const start = state.pos
  if (src.charCodeAt(start) !== 0x3d || src.charCodeAt(start + 1) !== 0x3d) return false
  const close = src.indexOf('==', start + 2)
  if (close === -1 || close > state.posMax) return false
  const inner = src.slice(start + 2, close)
  if (!inner.trim() || /^\s|\s$/.test(inner)) return false
  if (!silent) {
    state.push('mark_open', 'mark', 1)
    const max = state.posMax
    state.pos = start + 2
    state.posMax = close
    state.md.inline.tokenize(state)
    state.posMax = max
    state.push('mark_close', 'mark', -1)
  }
  state.pos = close + 2
  return true
}

// ---------- %%comments%% (hidden when rendered) ----------

function commentInlineRule(state: StateInline): boolean {
  const src = state.src
  if (src.charCodeAt(state.pos) !== 0x25 || src.charCodeAt(state.pos + 1) !== 0x25) return false
  const close = src.indexOf('%%', state.pos + 2)
  // An unclosed %% hides the rest of the paragraph, as in Obsidian.
  state.pos = close === -1 ? state.posMax : close + 2
  return true
}

function commentBlockRule(state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean {
  const first = state.src.slice(state.bMarks[startLine] + state.tShift[startLine], state.eMarks[startLine])
  if (!first.startsWith('%%')) return false
  // A single-line %%comment%% that isn't the whole line is left to the inline rule.
  if (first.length > 2 && first.indexOf('%%', 2) !== -1 && !first.trimEnd().endsWith('%%')) return false
  let line = startLine
  let closed = first.length > 2 && first.trimEnd().endsWith('%%') && first.trim() !== '%%'
  while (!closed && ++line < endLine) {
    const text = state.src.slice(state.bMarks[line] + state.tShift[line], state.eMarks[line])
    if (text.includes('%%')) closed = true
  }
  if (silent) return true
  state.line = Math.min(line + 1, endLine)
  return true
}

// ---------- $math$ and $$math$$ ----------

function mathInlineRule(state: StateInline, silent: boolean): boolean {
  const src = state.src
  const start = state.pos
  if (src.charCodeAt(start) !== 0x24 || src.charCodeAt(start + 1) === 0x24) return false
  let close = start + 1
  while ((close = src.indexOf('$', close)) !== -1 && src.charCodeAt(close - 1) === 0x5c) close++
  if (close === -1 || close > state.posMax) return false
  const inner = src.slice(start + 1, close)
  // "$5 and $6" is money, not math.
  if (!inner || /^\s|\s$/.test(inner) || /\d/.test(src[close + 1] ?? '')) return false
  if (!silent) state.push('math_inline', 'span', 0).content = inner
  state.pos = close + 1
  return true
}

function mathBlockRule(state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean {
  const lineText = (n: number): string => state.src.slice(state.bMarks[n] + state.tShift[n], state.eMarks[n])
  const first = lineText(startLine)
  if (!first.startsWith('$$')) return false
  const rest = first.slice(2)
  let content: string
  let last = startLine
  if (rest.trimEnd().endsWith('$$') && rest.trim().length > 2) {
    content = rest.trimEnd().slice(0, -2)
  } else {
    const lines = [rest]
    let found = false
    while (++last < endLine) {
      const text = lineText(last)
      if (text.trimEnd().endsWith('$$')) {
        lines.push(text.trimEnd().slice(0, -2))
        found = true
        break
      }
      lines.push(text)
    }
    if (!found) return false
    content = lines.join('\n')
  }
  if (silent) return true
  const token = state.push('math_block', 'div', 0)
  token.content = content.trim()
  token.map = [startLine, last + 1]
  state.line = last + 1
  return true
}

function renderMath(content: string, display: boolean): string {
  return katex.renderToString(content, { displayMode: display, throwOnError: false, output: 'htmlAndMathml', strict: 'ignore' })
}

// ---------- Front matter ----------

function frontmatterRule(state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean {
  if (startLine !== 0) return false
  const lineText = (n: number): string => state.src.slice(state.bMarks[n], state.eMarks[n])
  if (lineText(0).trimEnd() !== '---') return false
  let close = 1
  while (close < endLine && !/^(---|\.\.\.)\s*$/.test(lineText(close))) close++
  if (close >= endLine) return false
  if (silent) return true
  const token = state.push('frontmatter', '', 0)
  token.content = state.getLines(1, close, 0, false)
  token.map = [0, close + 1]
  state.line = close + 1
  return true
}

function renderFrontmatter(tokens: Token[], idx: number): string {
  const rows = tokens[idx].content
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => {
      const m = /^([^:#\s][^:]*):\s*(.*)$/.exec(l)
      return m
        ? `<div class="zn-prop"><span class="zn-prop-key">${escapeHtml(m[1])}</span><span class="zn-prop-value">${escapeHtml(m[2])}</span></div>`
        : `<div class="zn-prop zn-prop-cont">${escapeHtml(l)}</div>`
    })
  return `<div class="zn-properties">${rows.join('')}</div>`
}

// ---------- > [!callouts] ----------

// Turns a blockquote whose first line is "[!type] Title" into a callout box.
// "[!type]-" starts folded and "[!type]+" starts open (both can be toggled).
function calloutRule(state: StateCore): void {
  const tokens = state.tokens
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type !== 'blockquote_open') continue
    const inline = tokens[i + 2]
    if (tokens[i + 1]?.type !== 'paragraph_open' || inline?.type !== 'inline') continue
    const m = /^\[!([\w-]+)\]([+-]?)[ \t]*(.*)(?:\n|$)/.exec(inline.content)
    if (!m) continue
    const type = m[1].toLowerCase()
    const title = m[3].trim() || type.charAt(0).toUpperCase() + type.slice(1)
    tokens[i].meta = { callout: type, fold: m[2], title }
    inline.content = inline.content.slice(m[0].length)
    // A callout with only a title line: drop the empty paragraph.
    if (!inline.content.trim()) {
      tokens[i + 1].hidden = true
      tokens[i + 3].hidden = true
      inline.content = ''
    }
    // Find the matching close.
    let depth = 0
    for (let j = i; j < tokens.length; j++) {
      if (tokens[j].type === 'blockquote_open') depth++
      if (tokens[j].type === 'blockquote_close' && --depth === 0) {
        tokens[j].meta = { callout: type, fold: m[2] }
        break
      }
    }
  }
}

function renderBlockquoteOpen(tokens: Token[], idx: number, options: Required<MarkdownItOptions>, _env: unknown, self: Renderer): string {
  const meta = tokens[idx].meta as { callout?: string; fold?: string; title?: string } | null
  if (!meta?.callout) return self.renderToken(tokens, idx, options)
  const type = escapeHtml(meta.callout)
  const title = `<div class="callout-title"><span class="callout-icon"></span><span class="callout-title-inner">${escapeHtml(meta.title ?? '')}</span></div>`
  if (meta.fold) {
    return `<details class="callout" data-callout="${type}"${meta.fold === '+' ? ' open' : ''}><summary>${title}</summary><div class="callout-content">`
  }
  return `<div class="callout" data-callout="${type}">${title}<div class="callout-content">`
}

function renderBlockquoteClose(tokens: Token[], idx: number, options: Required<MarkdownItOptions>, _env: unknown, self: Renderer): string {
  const meta = tokens[idx].meta as { callout?: string; fold?: string } | null
  if (!meta?.callout) return self.renderToken(tokens, idx, options)
  return meta.fold ? '</div></details>' : '</div></div>'
}

// ---------- - [ ] tasks ----------

function taskRule(state: StateCore): void {
  const tokens = state.tokens
  for (let i = 2; i < tokens.length; i++) {
    const inline = tokens[i]
    if (inline.type !== 'inline' || tokens[i - 1].type !== 'paragraph_open' || tokens[i - 2].type !== 'list_item_open') continue
    const first = inline.children?.[0]
    const m = first?.type === 'text' ? /^\[([ xX])\][ \t]/.exec(first.content) : null
    if (!first || !m) continue
    const item = tokens[i - 2]
    const line = item.map?.[0] ?? -1
    const checked = m[1] !== ' '
    first.content = first.content.slice(m[0].length)
    const box = new state.Token('html_inline', '', 0)
    box.content = `<input type="checkbox" class="zn-task-box" aria-label="Task done" data-zn-line="${line}"${checked ? ' checked' : ''}>`
    inline.children!.unshift(box)
    item.attrJoin('class', `zn-task${checked ? ' is-done' : ''}`)
  }
}

// ---------- Links, images, code ----------

const EXTERNAL = /^[a-z][a-z0-9+.-]*:/i

function setupLinks(md: MarkdownItInstance): void {
  const defaultLinkOpen = md.renderer.rules.link_open ?? ((t, i, o, _e, self) => self.renderToken(t, i, o))
  md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    const token = tokens[idx]
    const href = String(token.attrGet('href') ?? '')
    if (EXTERNAL.test(href)) {
      token.attrSet('data-zn-href', href)
      token.attrJoin('class', 'zn-external')
    } else if (href && !href.startsWith('#')) {
      // A relative Markdown link to a note in the vault.
      const target = decodeURI(href)
      token.attrSet('data-zn-wikilink', target)
      token.attrJoin('class', `zn-internal${(env as RenderEnv).resolve(target) ? '' : ' is-unresolved'}`)
      token.attrSet('href', '#')
    }
    return defaultLinkOpen(tokens, idx, options, env, self)
  }
  const defaultImage = md.renderer.rules.image!
  md.renderer.rules.image = (tokens, idx, options, env, self) => {
    const token = tokens[idx]
    const src = String(token.attrGet('src') ?? '')
    if (src && !EXTERNAL.test(src)) {
      const renderEnv = env as RenderEnv
      const path = renderEnv.resolve(decodeURI(src))
      if (path) token.attrSet('src', renderEnv.fileUrl(path))
    }
    return defaultImage(tokens, idx, options, env, self)
  }
  // Code blocks are highlighted later; Mermaid diagrams are drawn later.
  md.renderer.rules.fence = (tokens, idx) => {
    const token = tokens[idx]
    const lang = token.info.trim().split(/\s+/)[0] ?? ''
    const code = escapeHtml(token.content)
    // The diagram source travels as text (an attribute holding "-->" would be stripped by the sanitiser).
    if (lang.toLowerCase() === 'mermaid') return `<div class="zn-mermaid">${code}</div>`
    const cls = lang ? ` class="language-${escapeHtml(lang)}"` : ''
    return `<pre class="zn-code-block"${lang ? ` data-zn-lang="${escapeHtml(lang)}"` : ''}><code${cls}>${code}</code></pre>`
  }
}

export function createMarkdown(): MarkdownItInstance {
  const md = new MarkdownIt({ html: true, linkify: true, breaks: true, typographer: false })
  md.use(footnote)
  md.block.ruler.before('table', 'zn_frontmatter', frontmatterRule)
  md.block.ruler.before('fence', 'zn_math_block', mathBlockRule, { alt: ['paragraph', 'reference', 'blockquote', 'list'] })
  md.block.ruler.before('paragraph', 'zn_comment_block', commentBlockRule, { alt: ['paragraph', 'reference', 'blockquote', 'list'] })
  md.inline.ruler.before('image', 'zn_wikilink', wikiRule)
  md.inline.ruler.before('emphasis', 'zn_highlight', highlightRule)
  md.inline.ruler.before('emphasis', 'zn_comment', commentInlineRule)
  md.inline.ruler.after('escape', 'zn_math', mathInlineRule)
  md.inline.ruler.push('zn_tag', tagRule)
  md.core.ruler.after('block', 'zn_callouts', calloutRule)
  md.core.ruler.after('inline', 'zn_tasks', taskRule)

  const rules = md.renderer.rules
  rules.wikilink = renderWikilink
  rules.wiki_embed = renderEmbed
  rules.zn_tag = (tokens, idx) => {
    const tag = escapeHtml(tokens[idx].content)
    return `<a class="zn-tag" data-zn-tag="${tag}" href="#">${tag}</a>`
  }
  rules.math_inline = (tokens, idx) => renderMath(tokens[idx].content, false)
  rules.math_block = (tokens, idx) => `<div class="zn-math-block">${renderMath(tokens[idx].content, true)}</div>`
  rules.frontmatter = renderFrontmatter
  rules.blockquote_open = renderBlockquoteOpen
  rules.blockquote_close = renderBlockquoteClose
  setupLinks(md)
  return md
}

let shared: MarkdownItInstance | null = null

export function renderMarkdown(src: string, env: RenderEnv): string {
  shared ??= createMarkdown()
  return shared.render(src, env)
}
