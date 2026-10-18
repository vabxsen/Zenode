import { eq } from './harness'
import { parseNote } from '../src/renderer/src/index/parser'
import { MetadataCache, applyEdits } from '../src/renderer/src/index/metadataCache'
import { matchNote, parseQuery } from '../src/renderer/src/search/query'
import { fuzzyMatch } from '../src/renderer/src/fuzzy'
import { buildGraph } from '../src/renderer/src/graph/graphData'
import { CanvasParseError, canvasRefs, contains, facingSide, parseCanvas, serializeCanvas, stackOrder } from '../src/renderer/src/canvas/model'
import { CommandRegistry, hotkeyFromEvent, hotkeyLabel } from '../src/renderer/src/commands'
import { registerCoreCommands } from '../src/renderer/src/coreCommands'
import { parseCanvasMeta } from '../src/renderer/src/index/canvasMeta'
import { sanitizeHotkeys, sanitizeWorkspace } from '../src/renderer/src/config'
import { CanvasDocument } from '../src/renderer/src/canvas/canvasDocument'
import { configPath, readConfig, writeConfig } from '../src/main/config'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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

// Canvas model (JSON Canvas 1.0, Obsidian-style output).
const board = `{
	"nodes":[
		{"id":"a1","type":"text","text":"See [[Home]] #plan","x":0,"y":0,"width":250,"height":60},
		{"id":"b2","type":"file","file":"Folder/Sub/Deep.md","x":400.4,"y":0,"width":400,"height":400,"color":"3"},
		{"id":"c3","type":"widget","x":0,"y":300,"width":100,"height":100,"custom":{"k":1}},
		{"id":"g4","type":"group","label":"Area","x":-50,"y":-50,"width":900,"height":600}
	],
	"edges":[
		{"id":"e1","fromNode":"a1","fromSide":"right","toNode":"b2","toSide":"left","toEnd":"arrow"},
		{"id":"e2","fromNode":"a1","toNode":"gone"}
	]
}`
const parsed = parseCanvas(board)
eq('canvas: unknown node types are kept', parsed.nodes.map((n) => n.type), ['text', 'file', 'widget', 'group'])
eq('canvas: unknown keys are kept', (parsed.nodes[2] as any).custom, { k: 1 })
eq('canvas: coordinates rounded', parsed.nodes[1].x, 400)
eq('canvas: edges to missing nodes dropped', parsed.edges.map((e) => e.id), ['e1'])
const out = serializeCanvas(parsed)
eq('canvas: one line per node', out.split('\n').filter((l) => l.includes('"id"')).length, 5)
eq('canvas: round-trip is stable', serializeCanvas(parseCanvas(out)), out)
eq('canvas: empty file is an empty canvas', parseCanvas('  '), { nodes: [], edges: [] })
let threw = false
try { parseCanvas('{nope') } catch (e) { threw = e instanceof CanvasParseError }
eq('canvas: invalid JSON throws', threw, true)
const r = (x: number, y: number) => ({ x, y, width: 100, height: 100 })
eq('canvas: facing sides', [r(300, 0), r(0, 300), r(-300, 0), r(0, -300)].map((t) => facingSide(r(0, 0), t)), ['right', 'bottom', 'left', 'top'])
eq('canvas: refs', canvasRefs(parsed).files.map((f) => f.file), ['Folder/Sub/Deep.md'])
const nested = parseCanvas('{"nodes":[{"id":"t","type":"text","text":"","x":0,"y":0,"width":10,"height":10},{"id":"small","type":"group","x":0,"y":0,"width":100,"height":100},{"id":"big","type":"group","x":0,"y":0,"width":500,"height":500}]}')
eq('canvas: stacking puts big groups behind small ones, cards on top', stackOrder(nested.nodes).map((n) => n.id), ['big', 'small', 't'])
eq('canvas: group contains card', contains(parsed.nodes[3], parsed.nodes[0]), true)

// Canvases in the link index.
const cm = parseCanvasMeta(board)
eq('canvas meta: links', cm.meta.links.map((l) => [l.kind, l.link, l.canvasNode]), [['wiki', 'Home', 'a1'], ['canvas', 'Folder/Sub/Deep.md', 'b2']])
eq('canvas meta: tags', cm.meta.tags.map((t) => t.tag), ['#plan'])
eq('canvas meta: search text', cm.searchText, 'See [[Home]] #plan')
await cache.setContent('Board.canvas', board)
eq('canvas: backlinks from a canvas', cache.getBacklinks('Folder/Sub/Deep.md').map((b) => b.source).includes('Board.canvas'), true)
eq('canvas: graph node label', buildGraph(cache, base).nodes.find((n) => n.id === 'Board.canvas')?.label, 'Board')
const canvasPending = cache.collectRenameRefs('Folder/Sub/Deep.md', false)
const canvasEdits = cache.buildCanvasRenames(canvasPending, 'Folder/Sub/Deep.md', 'Folder/Sub/Deeper.md')
const renamedBoard = parseCanvas(canvasEdits.get('Board.canvas') ?? '{}')
eq('canvas rename: file card updated', (renamedBoard.nodes[1] as any).file, 'Folder/Sub/Deeper.md')
eq('canvas rename: markdown edits skip canvases', cache.buildRenameEdits(canvasPending, 'Folder/Sub/Deep.md', 'Folder/Sub/Deeper.md').has('Board.canvas'), false)

// Command registry.
const reg = new CommandRegistry()
const ran: string[] = []
let vaultOpen = false
reg.register({ id: 'a:save', name: 'Save', hotkeys: [{ modifiers: ['Mod'], key: 's' }], callback: () => ran.push('save') })
reg.register({ id: 'a:search', name: 'Search', hotkeys: [{ modifiers: ['Mod', 'Shift'], key: 'f' }], checkCallback: (checking) => { if (!vaultOpen) return false; if (!checking) ran.push('search'); return true } })
const key = (k: string, mods: { ctrl?: boolean; shift?: boolean; alt?: boolean } = {}) => ({ key: k, ctrlKey: !!mods.ctrl, shiftKey: !!mods.shift, altKey: !!mods.alt, metaKey: false })
eq('commands: hotkey matches', reg.match(key('s', { ctrl: true }))?.id, 'a:save')
eq('commands: shift changes the match', reg.match(key('S', { ctrl: true, shift: true }))?.id, undefined)
eq('commands: unavailable command does not match', reg.match(key('F', { ctrl: true, shift: true })), null)
vaultOpen = true
eq('commands: available once checkCallback allows', reg.match(key('F', { ctrl: true, shift: true }))?.id, 'a:search')
eq('commands: execute runs', [reg.execute('a:search'), reg.execute('a:save'), ran], [true, true, ['search', 'save']])
reg.setCustomHotkeys({ 'a:save': [{ modifiers: ['Mod', 'Alt'], key: 's' }] })
eq('commands: custom hotkey replaces default', [reg.match(key('s', { ctrl: true }))?.id, reg.match(key('s', { ctrl: true, alt: true }))?.id], [undefined, 'a:save'])
eq('commands: label', hotkeyLabel({ modifiers: ['Shift', 'Mod'], key: 'f' }), 'Ctrl+Shift+F')
eq('commands: from event', hotkeyFromEvent(key('K', { ctrl: true, shift: true })), { modifiers: ['Mod', 'Shift'], key: 'k' })
eq('commands: lone modifier is not a hotkey', hotkeyFromEvent(key('Shift', { shift: true })), null)
eq('commands: conflicts', reg.conflicts({ modifiers: ['Mod', 'Shift'], key: 'F' }).map((c) => c.id), ['a:search'])
let dup = false
try { reg.register({ id: 'a:save', name: 'x', callback: () => {} }) } catch { dup = true }
eq('commands: duplicate id rejected', dup, true)
const core = new CommandRegistry()
const calls: string[] = []
const noop = (n: string) => () => { calls.push(n) }
const dispose = registerCoreCommands(core, { hasVault: () => false, chooseVault: noop('choose'), openSwitcher: noop('switcher'), showSearch: noop('search'), openGraph: noop('graph'), toggleLeftSidebar: noop('left'), toggleRightSidebar: noop('right'), newNote: noop('note'), newCanvas: noop('canvas'), save: noop('save'), closeTab: noop('close'), cycleTab: noop('cycle') })
core.execute(core.match(key('o', { ctrl: true }))!.id)
eq('core commands: Ctrl+O without a vault picks one', [calls, core.match(key('n', { ctrl: true }))], [['choose'], null])
dispose()
eq('core commands: dispose removes all', core.list().length, 0)

// Canvas editing operations and undo.
const cdoc = new CanvasDocument()
cdoc.load(parseCanvas(board))
const before1 = cdoc.snapshot()
const card = cdoc.addText({ x: 1000, y: 1000 })
eq('canvas doc: new card snaps to grid and is selected', [card.x % 20, card.y % 20, [...cdoc.selected]], [0, 0, [card.id]])
eq('canvas doc: commit records a change', cdoc.commit(before1), true)
eq('canvas doc: commit without change is ignored', cdoc.commit(cdoc.snapshot()), false)
eq('canvas doc: undo removes the card', [cdoc.undo(), cdoc.node(card.id)], [true, undefined])
eq('canvas doc: redo restores it', [cdoc.redo(), !!cdoc.node(card.id)], [true, true])
eq('canvas doc: nothing more to redo', cdoc.redo(), false)
cdoc.selectOnly('g4')
eq('canvas doc: moving a group carries the cards inside it', [...cdoc.moveSet().keys()].sort(), ['a1', 'b2', 'c3', 'g4'])
cdoc.selectOnly('a1')
cdoc.setColor('4')
eq('canvas doc: set color', cdoc.node('a1')?.color, '4')
cdoc.setColor('')
eq('canvas doc: clear color', 'color' in cdoc.node('a1')!, false)
const toId = cdoc.connect('a1', 'right', { at: { x: 2000, y: 0 } })
eq('canvas doc: connecting to empty space makes a card', [!!toId && cdoc.node(toId)?.type, cdoc.data.edges.some((e) => e.toNode === toId)], ['text', true])
cdoc.selectOnly('a1')
cdoc.deleteSelection()
eq('canvas doc: deleting a card removes its edges', cdoc.data.edges.some((e) => e.fromNode === 'a1' || e.toNode === 'a1'), false)
eq('canvas doc: topmost card under a point', cdoc.nodeAt({ x: 410, y: 10 })?.id, 'b2')
cdoc.clearSelection()
const newGroup = cdoc.groupSelection({ x: 0, y: 0 })
eq('canvas doc: grouping with nothing selected makes an empty group at the centre', [newGroup.type, newGroup.width, newGroup.height], ['group', 480, 380])

// Per-vault config (.zenode/*.json).
eq('config: workspace sanitized', sanitizeWorkspace({ openFiles: ['a.md', 3, null], activeFile: 7 }), { openFiles: ['a.md'], activeFile: null })
eq('config: workspace rejects non-objects', [sanitizeWorkspace(null), sanitizeWorkspace([1])], [null, null])
eq('config: hotkeys sanitized', sanitizeHotkeys({
  'a:ok': [{ modifiers: ['Mod', 'Shift'], key: 'k' }],
  'a:bad-mod': [{ modifiers: ['Hyper'], key: 'k' }],
  'a:none': [],
  'a:junk': 'x'
}), { 'a:ok': [{ modifiers: ['Mod', 'Shift'], key: 'k' }], 'a:bad-mod': [], 'a:none': [] })
let badName = 0
for (const name of ['../evil', 'a/b', 'A', '', 'x.json']) { try { configPath('C:/v', name) } catch { badName++ } }
eq('config: names cannot escape .zenode', badName, 5)
const vaultDir = mkdtempSync(join(tmpdir(), 'zenode-test-'))
eq('config: missing file reads as null', await readConfig(vaultDir, 'workspace'), null)
await writeConfig(vaultDir, 'workspace', { openFiles: ['x.md'], activeFile: 'x.md' })
eq('config: round-trip', await readConfig(vaultDir, 'workspace'), { openFiles: ['x.md'], activeFile: 'x.md' })
eq('config: no temp files left behind', readdirSync(join(vaultDir, '.zenode')), ['workspace.json'])
rmSync(vaultDir, { recursive: true, force: true })

cache.dispose()
