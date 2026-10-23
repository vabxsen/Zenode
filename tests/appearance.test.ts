// Appearance settings: validation and the accent colour family.
import { accentVars, sanitizeAppearance } from '../src/renderer/src/appearance/model'
import { eq } from './harness'

eq('appearance: defaults', sanitizeAppearance(null), {
  theme: 'system', accent: '', fontText: '', fontMono: '', fontSize: 16, readableLineLength: true, lineWidth: 700, zoom: 1, cssTheme: '', snippets: []
})
eq('appearance: values kept', sanitizeAppearance({ theme: 'light', accent: '#10B981', fontSize: 18, zoom: 1.25, snippets: ['a', 'a', 'b'] }), {
  theme: 'light', accent: '#10b981', fontText: '', fontMono: '', fontSize: 18, readableLineLength: true, lineWidth: 700, zoom: 1.3, cssTheme: '', snippets: ['a', 'b']
})
eq('appearance: out of range clamps', [sanitizeAppearance({ fontSize: 99 }).fontSize, sanitizeAppearance({ zoom: 0.1 }).zoom, sanitizeAppearance({ lineWidth: 5 }).lineWidth], [30, 0.5, 480])
eq('appearance: fonts that could break CSS are dropped', [sanitizeAppearance({ fontText: 'Georgia, serif' }).fontText, sanitizeAppearance({ fontText: 'x; } body { display: none' }).fontText], ['Georgia, serif', ''])
eq('appearance: bad colours and names dropped', [sanitizeAppearance({ accent: 'red' }).accent, sanitizeAppearance({ cssTheme: '../evil' }).cssTheme, sanitizeAppearance({ snippets: ['.hidden', 'ok'] }).snippets], ['', '', ['ok']])
eq('accent: none set means theme defaults', accentVars('', true), {})
const dark = accentVars('#10b981', true)
eq('accent: strong is the colour itself', dark['--zn-accent-strong'], '#10b981')
eq('accent: text tone is lighter on dark', dark['--zn-accent'], 'color-mix(in srgb, #10b981 72%, white)')
eq('accent: text tone is darker on light', accentVars('#10b981', false)['--zn-accent'], 'color-mix(in srgb, #10b981 85%, black)')
