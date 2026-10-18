// Reading-view renderer: Obsidian Markdown -> HTML (before sanitising).
import { renderMarkdown, splitWikiTarget, type RenderEnv } from '../src/renderer/src/render/markdown'
import { extractSection } from '../src/renderer/src/render/sections'
import { eq } from './harness'

const files = new Map([
  ['note b', 'Folder/Note B.md'],
  ['diagram.png', 'img/diagram.png'],
  ['folder/note c.md', 'Folder/Note C.md']
])
const env: RenderEnv = {
  sourcePath: 'Home.md',
  resolve: (link) => files.get(link.toLowerCase()) ?? files.get(`${link.toLowerCase()}.md`) ?? null,
  fileUrl: (path) => `vault://file/${encodeURI(path)}`
}
const html = (src: string): string => renderMarkdown(src, env).trim()
const has = (name: string, src: string, ...parts: string[]): void => {
  const out = html(src)
  eq(name, parts.filter((p) => !out.includes(p)), [])
}

eq('wiki target parts', splitWikiTarget('Note#Head|Shown'), { link: 'Note', subpath: '#Head', alias: 'Shown' })
has('wikilink resolved', 'See [[Note B]].', '<a class="zn-internal" data-zn-wikilink="Note B" href="#">Note B</a>')
has('wikilink alias and heading', '[[Note B#Plans|the plans]]', 'data-zn-wikilink="Note B#Plans"', '>the plans</a>')
has('wikilink unresolved', '[[Missing]]', 'class="zn-internal is-unresolved"')
has('wikilink heading display', '[[Note B#Plans]]', '>Note B &gt; Plans</a>')
has('embed placeholder', '![[diagram.png|300]]', '<span class="zn-embed-slot" data-zn-embed="diagram.png" data-zn-size="300"></span>')
has('tags', 'Tagged #work/launch and #2026x but not a#b or #123', 'data-zn-tag="#work/launch"', 'data-zn-tag="#2026x"')
eq('tags: not inside words or numbers only', [html('a#b').includes('zn-tag'), html('#123 x').includes('zn-tag')], [false, false])
has('highlight', 'An ==important **bold** bit== here', '<mark>important <strong>bold</strong> bit</mark>')
eq('highlight needs no spaces at the edges', html('a == b == c').includes('<mark>'), false)
eq('inline comment hidden', html('Visible %%secret%% text'), '<p>Visible  text</p>')
eq('block comment hidden', html('Before\n\n%%\nhidden\nlines\n%%\n\nAfter'), '<p>Before</p>\n<p>After</p>')
has('callout', '> [!warning] Careful\n> Body text', '<div class="callout" data-callout="warning">', 'callout-title-inner">Careful</span>', '<p>Body text</p>', '</div></div>')
has('callout default title', '> [!tip]\n> Hi', 'callout-title-inner">Tip</span>')
has('callout foldable', '> [!faq]- Why?\n> Because', '<details class="callout" data-callout="faq">', '<summary>', '</div></details>')
has('callout open by default', '> [!faq]+ Why?\n> Because', 'data-callout="faq" open>')
eq('plain quote untouched', html('> just a quote'), '<blockquote>\n<p>just a quote</p>\n</blockquote>')
has('inline math', 'Energy $E=mc^2$ here', 'class="katex"', 'mc')
has('block math', '$$\n\\int_0^1 x\\,dx\n$$', '<div class="zn-math-block">', 'katex-display')
eq('dollar amounts are not math', html('Costs $5 and $6 today').includes('katex'), false)
has('tasks', '- [ ] todo\n- [x] done', '<li class="zn-task"><input type="checkbox" class="zn-task-box" data-zn-line="0">todo</li>', 'class="zn-task is-done"', 'data-zn-line="1" checked>done')
has('footnotes', 'Claim[^1]\n\n[^1]: Source.', 'class="footnote-ref"', 'class="footnotes"', 'Source.')
has('front matter as properties', '---\ntags: [a, b]\ntitle: Hello\n---\n# Body', '<div class="zn-properties">', 'zn-prop-key">tags</span>', '<h1>Body</h1>')
eq('front matter only at the top', html('Text\n\n---\nnot: yaml\n---').includes('zn-properties'), false)
has('mermaid placeholder', '```mermaid\ngraph TD; A-->B\n```', '<div class="zn-mermaid">graph TD; A--&gt;B\n</div>')
has('code block language', '```js\nlet a = 1 < 2\n```', '<pre class="zn-code-block" data-zn-lang="js"><code class="language-js">let a = 1 &lt; 2')
has('external link', '[site](https://example.com)', 'data-zn-href="https://example.com"', 'class="zn-external"')
has('relative markdown link is internal', '[c](Folder/Note%20C.md)', 'data-zn-wikilink="Folder/Note C.md"', 'class="zn-internal"')
has('image path goes through the vault protocol', '![d](diagram.png)', 'src="vault://file/img/diagram.png"')
has('bare URLs become links', 'Visit https://zenode.app now', 'href="https://zenode.app"')
has('soft line breaks render as breaks', 'one\ntwo', 'one<br>')

// Sections for embeds.
const doc = '---\ntags: [x]\n---\n# Title\nIntro\n## Plans\nPlan text\n### Detail\nDeep\n## Other\nMore\n```\n# not a heading\n```\n- item one ^abc\n- item two\n\nPara line 1\npara line 2 ^p1\n'
eq('section: whole note drops front matter', extractSection(doc, '').startsWith('# Title'), true)
eq('section: heading with its subheadings', extractSection(doc, '#Plans'), '## Plans\nPlan text\n### Detail\nDeep')
eq('section: case and spacing insensitive', extractSection(doc, '#  plans '), '## Plans\nPlan text\n### Detail\nDeep')
eq('section: nested path uses the last heading', extractSection(doc, '#Plans#Detail'), '### Detail\nDeep')
eq('section: code fences are not headings', extractSection(doc, '#not a heading'), null)
eq('section: list item block', extractSection(doc, '#^abc'), '- item one')
eq('section: paragraph block', extractSection(doc, '#^p1'), 'Para line 1\npara line 2')
eq('section: missing', [extractSection(doc, '#Nope'), extractSection(doc, '#^zzz')], [null, null])
