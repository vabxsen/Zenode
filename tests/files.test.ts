// Files: which viewer opens what.
import { fileKind } from '../src/renderer/src/views/fileKinds'
import { findUnusedAttachments } from '../src/renderer/src/files/unusedAttachments'
import { sanitizeEditorSettings } from '../src/renderer/src/config'
import { startsWithTitle } from '../src/renderer/src/export/title'
import { eq } from './harness'

eq('kind: media', ['a/b.PNG', 'x.svg', 'doc.pdf', 'song.mp3', 'clip.mp4', 'clip.webm'].map(fileKind), ['image', 'image', 'pdf', 'audio', 'video', 'video'])
eq('kind: text', ['data.csv', 'conf.yaml', 'script.ps1', '.gitignore', 'notes.txt'].map(fileKind), ['text', 'text', 'text', 'text', 'text'])
eq('kind: other', ['archive.zip', 'tool.exe', 'noext'].map(fileKind), ['other', 'other', 'other'])

// Export: skip the added title when the note already starts with it.
eq('title: first heading matches', startsWithTitle('---\na: 1\n---\n\n# Plan\ntext', 'Plan'), true)
eq('title: different heading', startsWithTitle('# Other\n', 'Plan'), false)
eq('title: h2 is not the title', startsWithTitle('## Plan\n', 'Plan'), false)

// Delete behaviour setting.
eq('trash: default is the Recycle Bin', sanitizeEditorSettings({}).trashOption, 'system')
eq('trash: vault folder', sanitizeEditorSettings({ trashOption: 'local' }).trashOption, 'local')
eq('trash: unknown falls back', sanitizeEditorSettings({ trashOption: 'none' }).trashOption, 'system')

// Unused attachments.
const files = ['img/used.png', 'img/linked by path.png', 'img/in yaml.jpg', 'img/encoded name.png', 'orphan.png', 'old.pdf', 'Note.md', 'Board.canvas', 'script.js', 'other/orphan.png']
const texts = [
  { path: 'Note.md', content: '---\ncover: in yaml.jpg\n---\n![[used.png]] ![x](img/encoded%20name.png)' },
  { path: 'Board.canvas', content: '{"nodes":[]}' }
]
const resolved = { 'Note.md': { 'img/used.png': 1 }, 'Board.canvas': { 'img/linked by path.png': 1 } }
eq('unused: only attachments nothing uses', findUnusedAttachments(files, texts, resolved), ['old.pdf', 'orphan.png', 'other/orphan.png'])
