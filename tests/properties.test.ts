// Properties: reading typed values from front matter and editing it in place.
import { coerce, frontMatterEdit, frontMatterRange, inferType, readProperties, removeProperty, renameProperty, sanitizeTypes, setProperty } from '../src/renderer/src/properties/model'
import { eq } from './harness'

const yaml = '# a comment\ntitle: "Plan"\ntags: [work, idea]\ndue: 2026-03-03\ndone: false\ncount: 3\naliases:\n  - P\nwhen: 2026-03-03T10:30'
const props = readProperties(yaml, {})
eq('read: keys and types', props?.map((p) => [p.key, p.type]), [
  ['title', 'text'], ['tags', 'tags'], ['due', 'date'], ['done', 'checkbox'], ['count', 'number'], ['aliases', 'list'], ['when', 'datetime']
])
eq('read: values', props?.map((p) => p.value), ['Plan', ['work', 'idea'], '2026-03-03', false, 3, ['P'], '2026-03-03T10:30'])
eq('read: registry wins', readProperties('due: soon', { due: 'date' })?.[0].type, 'date')
eq('read: empty front matter', readProperties('', {}), [])
eq('read: bad YAML is not editable', readProperties('a: [unclosed', {}), null)
eq('read: a plain list is not editable', readProperties('- a\n- b', {}), null)
eq('infer: tag key', inferType('Tags', 'x', {}), 'tags')

eq('set: changes one value, keeps comments and quoting', setProperty(yaml, 'count', 4), yaml.replace('count: 3', 'count: 4'))
eq('set: keeps a quoted string quoted', setProperty('title: "Plan"\nx: 1', 'title', 'Big plan'), 'title: "Big plan"\nx: 1')
eq('set: inline lists stay inline', setProperty('tags: [a]', 'tags', ['a', 'b']), 'tags: [a, b]')
eq('set: new list is block style', setProperty('x: 1', 'list', ['a', 'b']), 'x: 1\nlist:\n  - a\n  - b')
eq('set: adds to empty front matter', setProperty('', 'status', 'draft'), 'status: draft')
eq('set: checkbox', setProperty('done: false', 'done', true), 'done: true')
eq('remove: one property', removeProperty('a: 1\nb: 2', 'a'), 'b: 2')
eq('remove: last property leaves it empty', removeProperty('a: 1', 'a'), '')
eq('rename: keeps position', renameProperty('a: 1\nb: 2', 'a', 'c'), 'c: 1\nb: 2')
eq('rename: refuses a taken name', renameProperty('a: 1\nb: 2', 'a', 'b'), null)

eq('coerce: number', [coerce('number', '4.5'), coerce('number', 'x'), coerce('number', '')], [4.5, null, null])
eq('coerce: tags drop #', coerce('tags', '#a, b'), ['a', 'b'])
eq('coerce: list from text', coerce('list', 'one, two'), ['one', 'two'])
eq('coerce: text from list', coerce('text', ['a', 'b']), 'a, b')
eq('coerce: checkbox', [coerce('checkbox', 'true'), coerce('checkbox', null)], [true, false])

eq('range: yaml between the fences', frontMatterRange('---\na: 1\n---\nBody'), { from: 4, to: 8, yaml: 'a: 1', close: 9, end: 12 })
eq('range: empty front matter', frontMatterRange('---\n---\nBody'), { from: 4, to: 4, yaml: '', close: 4, end: 7 })
eq('range: closing line with spaces, no body', frontMatterRange('---\na: 1\n---  '), { from: 4, to: 8, yaml: 'a: 1', close: 9, end: 14 })
const fmDoc = '---\na: 1\n---\nBody'
const fmEdit = (yaml: string): string => {
  const e = frontMatterEdit(frontMatterRange(fmDoc)!, yaml)
  return fmDoc.slice(0, e.from) + e.insert + fmDoc.slice(e.to)
}
eq('edit: new yaml', fmEdit('a: 2\nb: 3'), '---\na: 2\nb: 3\n---\nBody')
eq('edit: emptied', fmEdit(''), '---\n---\nBody')
eq('set: empty value is written bare', setProperty('a: 1', 'b', null), 'a: 1\nb:')
eq('range: none', frontMatterRange('Body\n---\n'), null)
eq('types: sanitised', sanitizeTypes({ types: { Due: 'date', bad: 'color', n: 'number' } }), { due: 'date', n: 'number' })
