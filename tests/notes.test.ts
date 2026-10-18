// Daily notes and templates: date formats, template variables, settings.
import { applyTemplate, formatDate, invalidNameChars } from '../src/renderer/src/templates/format'
import { applyTextEdit, templateEdit } from '../src/renderer/src/templates/insert'
import { cleanVaultPath, sanitizeDaily, sanitizeTemplates, templatePath } from '../src/renderer/src/templates/settings'
import { eq } from './harness'

// Tuesday 3 March 2026, 14:05:09 local time.
const when = new Date(2026, 2, 3, 14, 5, 9)

eq('date: default format', formatDate(when, 'YYYY-MM-DD'), '2026-03-03')
eq('date: names', formatDate(when, 'dddd, MMMM Do YYYY'), 'Tuesday, March 3rd 2026')
eq('date: short names and no padding', formatDate(when, 'ddd D MMM YY'), 'Tue 3 Mar 26')
eq('date: 12-hour time', formatDate(when, 'h:mm A'), '2:05 PM')
eq('date: 24-hour time with seconds', formatDate(when, 'HH:mm:ss'), '14:05:09')
eq('date: [literal] text is kept', formatDate(when, '[Week] WW, [day] d'), 'Week 10, day 2')
eq('date: folders in the format', formatDate(when, 'YYYY/MM/YYYY-MM-DD'), '2026/03/2026-03-03')
eq('date: ordinals 11th-13th', [11, 12, 13, 21, 22].map((d) => formatDate(new Date(2026, 0, d), 'Do')), ['11th', '12th', '13th', '21st', '22nd'])
eq('date: ISO week at year start', formatDate(new Date(2027, 0, 1), 'W'), '53')
eq('date: midnight is 12 AM', formatDate(new Date(2026, 0, 1, 0, 30), 'h:mm a'), '12:30 am')

const ctx = { title: 'Weekly sync', date: when }
eq('template: title, date, time', applyTemplate('# {{title}}\n{{date}} at {{time}}', ctx), '# Weekly sync\n2026-03-03 at 14:05')
eq('template: custom formats', applyTemplate('{{date:dddd}} {{ time : h A }}', ctx), 'Tuesday 2 PM')
eq('template: configured default formats', applyTemplate('{{date}} {{time}}', { ...ctx, dateFormat: 'D MMM', timeFormat: 'HH' }), '3 Mar 14')
eq('template: case-insensitive names', applyTemplate('{{Title}}', ctx), 'Weekly sync')
eq('template: unknown variables stay', applyTemplate('{{author}} {{date', ctx), '{{author}} {{date')

eq('name: characters Windows rejects', invalidNameChars('2026-03-03 10:30?'), [':', '?'])
eq('name: folders are fine', invalidNameChars('2026/03/03'), [])

eq('settings: daily defaults', sanitizeDaily(null), { folder: '', format: 'YYYY-MM-DD', template: '' })
eq('settings: daily cleaned', sanitizeDaily({ folder: '\\Journal\\Daily\\', format: '  ', template: 'Templates/Day' }), { folder: 'Journal/Daily', format: 'YYYY-MM-DD', template: 'Templates/Day' })
eq('settings: templates default folder', sanitizeTemplates({}).folder, 'Templates')
eq('settings: templates folder can be the root', sanitizeTemplates({ folder: '' }).folder, '')
eq('settings: paths cannot leave the vault', cleanVaultPath('../outside'), '')
eq('settings: template path gets .md', [templatePath('Templates/Day'), templatePath('T.md')], ['Templates/Day.md', 'T.md'])

// Inserting templates: body at the cursor, properties at the top.
const insert = (doc: string, cursor: number, tpl: string): [string, number] => {
  const edit = templateEdit(doc, cursor, tpl)
  return [applyTextEdit(doc, edit), edit.cursor]
}
eq('insert: plain template at the cursor', insert('ab', 1, 'XY'), ['aXYb', 3])
eq('insert: properties become front matter', insert('Body', 4, '---\ntags: [x]\n---\nHello'), ['---\ntags: [x]\n---\nBodyHello', 27])
eq('insert: only missing properties are added', insert('---\ntags: [a]\n---\nText', 22, '---\ntags: [b]\nstatus: draft\nlist:\n  - one\n---\n- [ ] todo'), [
  '---\ntags: [a]\nstatus: draft\nlist:\n  - one\n---\nText- [ ] todo',
  60
])
eq('insert: never inside the front matter', insert('---\na: 1\n---\nB', 5, 'Z'), ['---\na: 1\n---\nZB', 14])
eq('insert: nothing new when properties exist', templateEdit('---\na: 1\n---\n', 12, '---\nA: 2\n---\nx').changes.length, 1)
