// Editor grammar: the Obsidian syntax the Live Preview editor recognises.
import { markdownLanguage } from '@codemirror/lang-markdown'
import { commentSyntax, frontmatterSyntax, hashtagSyntax, highlightSyntax, mathSyntax, wikiLinkSyntax } from '../src/renderer/src/editor/wikilink'
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
