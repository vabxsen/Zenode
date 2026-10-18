// Editor grammar: the Obsidian syntax the Live Preview editor recognises.
import { markdownLanguage } from '@codemirror/lang-markdown'
import { commentSyntax, frontmatterSyntax, hashtagSyntax, highlightSyntax, mathSyntax, wikiLinkSyntax } from '../src/renderer/src/editor/wikilink'
import { formatTable, splitRow } from '../src/renderer/src/editor/tables'
import { relativeLinkTarget, subpathPosition } from '../src/renderer/src/links'
import { findUnlinkedMentions, mentionLink } from '../src/renderer/src/panels/mentions'
import { countTags } from '../src/renderer/src/panels/tagCount'
import { eq } from './harness'

const parser = markdownLanguage.parser.configure([frontmatterSyntax, wikiLinkSyntax, hashtagSyntax, highlightSyntax, commentSyntax, mathSyntax])

// Node names with their text, in document order.
function nodes(text: string, wanted: string[]): Array<[string, string]> {
  const out: Array<[string, string]> = []
  parser.parse(text).iterate({
    enter: (n) => {
      if (wanted.includes(n.name)) out.push([n.name, text.slice(n.from, n.to)])
    }
  })
  return out
}

// Tables.
eq('table: split row', splitRow('| a | b \\| c | d |'), ['a', 'b \\| c', 'd'])
eq('table: split row without outer pipes', splitRow('a | b'), ['a', 'b'])
eq('table: format pads columns and keeps alignment', formatTable('|Name|Qty|\n|:-|--:|\n|Apple|3|\n|Kiwi|12|').split('\n'), [
  '| Name  | Qty |',
  '| :---- | --: |',
  '| Apple | 3   |',
  '| Kiwi  | 12  |'
])
eq('table: ragged rows get empty cells', formatTable('|a|b|\n|-|-|\n|1|').split('\n')[2], '| 1   |     |')

// Link targets.
eq('relative link: up and decoded', relativeLinkTarget('../Other%20note.md#Plans', 'Folder/Note.md'), { path: 'Other note.md', subpath: '#Plans' })
eq('relative link: no extension means a note', relativeLinkTarget('Sub/Page', 'A/n.md'), { path: 'A/Sub/Page.md', subpath: '' })
eq('relative link: vault-absolute', relativeLinkTarget('/Top.md', 'A/B/n.md'), { path: 'Top.md', subpath: '' })
eq('relative link: cannot leave the vault', relativeLinkTarget('../../x.md', 'A/n.md'), null)
const linkMeta = { links: [], tags: [], frontmatterTags: [], aliases: [], headings: [{ level: 1, text: 'Title', line: 0 }, { level: 2, text: 'Plans', line: 2 }] }
eq('subpath: heading offset', subpathPosition('# Title\nx\n## Plans\ny', linkMeta, '#plans'), { from: 10 })
eq('subpath: block offset', subpathPosition('a\nsome text ^b1\n', linkMeta, '#^b1'), { from: 2 })
eq('subpath: missing', subpathPosition('a', linkMeta, '#nope'), undefined)

// Unlinked mentions and tag counts.
const mentionNotes = [
  { path: 'A.md', content: 'I met Project Atlas today. project atlas again!' },
  { path: 'B.md', content: 'Linked [[Project Atlas]] and `Project Atlas` in code.' },
  { path: 'C.md', content: '---\ntitle: Project Atlas\n---\nNothing else. Atlas alone.' },
  { path: 'D.md', content: 'The ProjectAtlases page and https://x.com/Project Atlas' },
  { path: 'E.md', content: 'Already links: see Project Atlas.' }
]
const mentions = findUnlinkedMentions('Project Atlas.md', ['Project Atlas', 'PA'], mentionNotes, (s) => s === 'E.md')
eq('mentions: plain text matches, any case', mentions.map((m) => [m.source, m.text]), [['A.md', 'Project Atlas'], ['A.md', 'project atlas']])
eq('mentions: line context', mentions[0].line, 'I met Project Atlas today. project atlas again!')
eq('mentions: link text', [mentionLink('Project Atlas', 'Project Atlas'), mentionLink('Project Atlas', 'project atlas')], ['[[Project Atlas]]', '[[Project Atlas|project atlas]]'])
const tagCounts = countTags([
  { meta: { tags: [{ tag: '#work/launch' }, { tag: '#work' }], frontmatterTags: ['#idea'] } },
  { meta: { tags: [{ tag: '#Work/launch' }], frontmatterTags: [] } }
])
eq('tags: counted with nested parents', tagCounts.map((t) => [t.tag, t.count, t.depth]), [['#idea', 1, 0], ['#work', 1, 0], ['#work/launch', 2, 1]])

const KINDS = ['Highlight', 'Comment', 'CommentBlock', 'InlineMath', 'BlockMath', 'WikiEmbed', 'Hashtag']
eq('lezer: highlight', nodes('a ==b c== d', KINDS), [['Highlight', '==b c==']])
eq('lezer: highlight needs tight edges', nodes('a == b == c', KINDS), [])
eq('lezer: inline comment', nodes('x %%hide%% y', KINDS), [['Comment', '%%hide%%']])
eq('lezer: block comment', nodes('a\n\n%%\nsecret\n%%\n\nb', KINDS), [['CommentBlock', '%%\nsecret\n%%']])
eq('lezer: inline math', nodes('so $x^2$ ok', KINDS), [['InlineMath', '$x^2$']])
eq('lezer: money is not math', nodes('$5 and $6', KINDS), [])
eq('lezer: block math', nodes('$$\na+b\n$$\n\nafter', KINDS), [['BlockMath', '$$\na+b\n$$']])
eq('lezer: one-line block math', nodes('$$ x $$', KINDS), [['BlockMath', '$$ x $$']])
eq('lezer: unclosed $$ is not a block', nodes('$$\nnever closed', KINDS), [])
eq('lezer: embeds and tags still parse', nodes('![[a.png]] #tag', KINDS), [['WikiEmbed', '![[a.png]]'], ['Hashtag', '#tag']])
