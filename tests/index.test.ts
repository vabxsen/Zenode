import { parseNote } from '../src/renderer/src/index/parser'
import { MetadataCache, applyEdits } from '../src/renderer/src/index/metadataCache'
import { matchNote, parseQuery } from '../src/renderer/src/search/query'
import { fuzzyMatch } from '../src/renderer/src/fuzzy'
import { buildGraph } from '../src/renderer/src/graph/graphData'

let fails = 0
const eq = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fails++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n      got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}`}`)
}

const text = `---
tags: [project, idea]
aliases:
  - Plan A
---
# Title #notatag
See [[Note B#Section|the section]] and ![[diagram.png]].
Also [md link](Folder/Note%20C.md) and [web](https://x.com).
\`[[not a link]]\` and #real-tag, #123 is not a tag.
\`\`\`
[[inside code]] #codetag
\`\`\`
`
const m = parseNote(text)
eq('links', m.links.map((l) => [l.kind, l.link, l.subpath, l.alias, l.embed]), [
  ['wiki', 'Note B', '#Section', 'the section', false],
  ['wiki', 'diagram.png', '', '', true],
  ['markdown', 'Folder/Note C.md', '', 'md link', false]
])
eq('headings', m.headings.map((h) => [h.level, h.text]), [[1, 'Title #notatag']])
eq('tags (Obsidian counts tags in headings)', m.tags.map((t) => t.tag), ['#notatag', '#real-tag'])
eq('frontmatter tags', m.frontmatterTags, ['#project', '#idea'])
eq('aliases', m.aliases, ['Plan A'])
eq('link line', m.links[0].line, 6)

// Resolver against a fake vault.
const files = ['Home.md', 'Note B.md', 'Folder/Note C.md', 'Folder/Dup.md', 'Other/Dup.md', 'img/diagram.png', 'Folder/Sub/Deep.md']
const contents: Record<string, string> = Object.fromEntries(files.filter((f) => f.endsWith('.md')).map((f) => [f, '']))
contents['Home.md'] = 'Go to [[Note B]] and [[Dup]] and [[Missing]] and [[Folder/Note C]].'
contents['Folder/Note C.md'] = 'Back [[Home]] and [[Dup]] and [[./Sub/Deep]].'
;(globalThis as any).window = { zenode: { readMany: async (ps: string[]) => Object.fromEntries(ps.map((p) => [p, contents[p] ?? null])) } }
const tree: any[] = []
for (const f of files) {
  const parts = f.split('/'); let level = tree; let acc = ''
  parts.forEach((part, i) => {
    acc = acc ? `${acc}/${part}` : part
    if (i === parts.length - 1) level.push({ name: part, path: acc, kind: 'file', ext: part.split('.').pop() })
    else { let d = level.find((e) => e.path === acc); if (!d) level.push(d = { name: part, path: acc, kind: 'folder', ext: '', children: [] }); level = d.children }
  })
}
const cache = new MetadataCache()
await cache.build(tree)
eq('resolve unique name', cache.resolve('Note B', 'Home.md'), 'Note B.md')
eq('resolve case-insensitive', cache.resolve('note b', 'Home.md'), 'Note B.md')
eq('resolve path', cache.resolve('Folder/Note C', 'Home.md'), 'Folder/Note C.md')
eq('resolve non-md', cache.resolve('diagram.png', 'Home.md'), 'img/diagram.png')
eq('resolve dup prefers own folder', cache.resolve('Dup', 'Folder/Note C.md'), 'Folder/Dup.md')
eq('resolve relative', cache.resolve('./Sub/Deep', 'Folder/Note C.md'), 'Folder/Sub/Deep.md')
eq('resolve missing', cache.resolve('Missing', 'Home.md'), null)
eq('unresolved recorded', cache.unresolvedLinks['Home.md'], { Missing: 1 })
eq('backlinks of Home', cache.getBacklinks('Home.md').map((b) => b.source), ['Folder/Note C.md'])
eq('linktext unique', cache.linktext('Note B.md', 'Home.md'), 'Note B')
eq('linktext ambiguous', cache.linktext('Other/Dup.md', 'Home.md'), 'Other/Dup')

// Rename Note B -> Projects/Note B2
const pending = cache.collectRenameRefs('Note B.md', false)
contents['Projects/Note B2.md'] = contents['Note B.md']; delete contents['Note B.md']
const tree2 = tree.filter((e) => e.path !== 'Note B.md'); tree2.push({ name: 'Projects', path: 'Projects', kind: 'folder', ext: '', children: [{ name: 'Note B2.md', path: 'Projects/Note B2.md', kind: 'file', ext: 'md' }] })
await cache.sync(tree2)
const edits = cache.buildRenameEdits(pending, 'Note B.md', 'Projects/Note B2.md')
const renamedHome = applyEdits(contents['Home.md'], edits.get('Home.md') ?? [])
await cache.setContent('Home.md', renamedHome)
eq('rename edit text', renamedHome, 'Go to [[Note B2]] and [[Dup]] and [[Missing]] and [[Folder/Note C]].')

// Search query language.
const note = { path: 'Projects/Launch plan.md', content: 'We ship the beta on Friday.\nThe Beta has bugs.', tags: ['#work/launch'] }
const hits = (q: string) => { const r = parseQuery(q); return r.error ? r.error : matchNote(r.terms, note)?.length ?? null }
eq('search word (case-insensitive)', hits('beta'), 2)
eq('search AND', hits('beta friday'), 3)
eq('search AND miss', hits('beta monday'), null)
eq('search phrase', hits('"ship the beta"'), 1)
eq('search exclude', hits('beta -bugs'), null)
eq('search regex', hits('/[Bb]eta/'), 2)
eq('search path:', hits('path:projects'), 0)
eq('search file:', hits('file:launch'), 0)
eq('search tag: parent matches child', hits('tag:#work'), 0)
eq('search tag: miss', hits('tag:home'), null)
eq('search filename matches plain word', hits('plan'), 0)
eq('search bad regex', typeof hits('/(/'), 'string')

// Fuzzy matching.
eq('fuzzy subsequence', fuzzyMatch('lp', 'Launch plan')?.indices, [0, 7])
eq('fuzzy miss', fuzzyMatch('xz', 'Launch plan'), null)
eq('fuzzy fallback when word-start jump would strand', fuzzyMatch('ay', 'xay a')?.indices, [1, 2])
const tight = fuzzyMatch('plan', 'Plan')!.score > fuzzyMatch('plan', 'Pale lantern')!.score
eq('fuzzy ranks a tight match above a scattered one', tight, true)
const initials = fuzzyMatch('pl', 'people list')!.score > fuzzyMatch('pl', 'apple')!.score
eq('fuzzy ranks word initials above mid-word letters', initials, true)

// Graph builder (vault state after the rename above).
const base = { showTags: false, showAttachments: false, showOrphans: true, showUnresolved: false, search: '' }
const g = buildGraph(cache, base)
const name = (i: number) => g.nodes[i].id
const edges = g.links.map(([a, b]) => [name(a), name(b)].sort().join(' <-> ')).sort()
eq('graph: one node per note', g.nodes.length, 6)
eq('graph: resolved links become edges', edges, [
  'Folder/Dup.md <-> Folder/Note C.md',
  'Folder/Note C.md <-> Folder/Sub/Deep.md',
  'Folder/Note C.md <-> Home.md',
  'Home.md <-> Other/Dup.md',
  'Home.md <-> Projects/Note B2.md'
])
eq('graph: degree counts', g.nodes.find((n) => n.id === 'Folder/Note C.md')?.degree, 3)
eq('graph: unresolved nodes', buildGraph(cache, { ...base, showUnresolved: true }).nodes.filter((n) => n.kind === 'unresolved').map((n) => n.label), ['Missing'])
eq('graph: attachments', buildGraph(cache, { ...base, showAttachments: true }).nodes.filter((n) => n.kind === 'attachment').length, 1)
const local1 = buildGraph(cache, base, { center: 'Folder/Sub/Deep.md', depth: 1 })
eq('graph: local depth 1', local1.nodes.map((n) => n.id).sort(), ['Folder/Note C.md', 'Folder/Sub/Deep.md'])
const local2 = buildGraph(cache, base, { center: 'Folder/Sub/Deep.md', depth: 2 })
eq('graph: local depth 2', local2.nodes.length, 4)
await cache.setContent('Lonely.md', 'no links here')
eq('graph: orphans shown by default', buildGraph(cache, base).nodes.some((n) => n.id === 'Lonely.md'), true)
eq('graph: hide orphans', buildGraph(cache, { ...base, showOrphans: false }).nodes.some((n) => n.id === 'Lonely.md'), false)
eq('graph: search filter', buildGraph(cache, { ...base, search: 'path:Folder' }).nodes.length, 3)

cache.dispose()
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED')
process.exit(fails ? 1 : 0)
