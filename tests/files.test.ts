// Files: which viewer opens what.
import { fileKind } from '../src/renderer/src/views/fileKinds'
import { eq } from './harness'

eq('kind: media', ['a/b.PNG', 'x.svg', 'doc.pdf', 'song.mp3', 'clip.mp4', 'clip.webm'].map(fileKind), ['image', 'image', 'pdf', 'audio', 'video', 'video'])
eq('kind: text', ['data.csv', 'conf.yaml', 'script.ps1', '.gitignore', 'notes.txt'].map(fileKind), ['text', 'text', 'text', 'text', 'text'])
eq('kind: other', ['archive.zip', 'tool.exe', 'noext'].map(fileKind), ['other', 'other', 'other'])
