// Note properties (YAML front matter): reading them with a type for each, and
// changing one property while leaving the rest of the YAML (comments, quoting,
// order) as it was.
import { isMap, isScalar, isSeq, parseDocument, type Document } from 'yaml'

export type PropertyType = 'text' | 'number' | 'checkbox' | 'date' | 'datetime' | 'list' | 'tags'
export const PROPERTY_TYPES: PropertyType[] = ['text', 'number', 'checkbox', 'date', 'datetime', 'list', 'tags']

export type PropertyValue = string | number | boolean | string[] | null

export interface Property {
  key: string
  value: PropertyValue
  type: PropertyType
}

// Vault-wide property types (.zenode/types.json), keyed by lower-case name.
export type TypeRegistry = Record<string, PropertyType>

const DATE = /^\d{4}-\d{2}-\d{2}$/
const DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/
const FRONT_MATTER = /^---\r?\n([\s\S]*?)(?:\r?\n)?---[ \t]*(?:\r?\n|$)/

export interface FrontMatterRange {
  // The YAML text between the --- lines is [from, to).
  from: number
  to: number
  yaml: string
  // Where the closing --- line starts, and where the block ends (before its line break).
  close: number
  end: number
}

export function frontMatterRange(doc: string): FrontMatterRange | null {
  const m = FRONT_MATTER.exec(doc)
  if (!m) return null
  const from = doc.indexOf('\n') + 1
  const close = m[0].lastIndexOf('---')
  const end = close + /^---[ \t]*/.exec(m[0].slice(close))![0].length
  return { from, to: from + m[1].length, yaml: m[1], close, end }
}

// The edit that puts `yaml` in as the front matter's text.
export function frontMatterEdit(range: FrontMatterRange, yaml: string): { from: number; to: number; insert: string } {
  return { from: range.from, to: range.close, insert: yaml ? `${yaml}\n` : '' }
}

function parse(yaml: string): Document | null {
  const doc = parseDocument(yaml, { keepSourceTokens: false })
  if (doc.errors.length) return null
  // Empty front matter is an empty map; anything else must be a map.
  if (doc.contents !== null && !isMap(doc.contents)) return null
  return doc
}

function plain(value: unknown): PropertyValue {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (Array.isArray(value)) return value.filter((v) => v !== null && v !== undefined).map((v) => String(v))
  return JSON.stringify(value)
}

export function inferType(key: string, value: PropertyValue, registry: TypeRegistry): PropertyType {
  const known = registry[key.toLowerCase()]
  if (known) return known
  const k = key.toLowerCase()
  if (k === 'tags' || k === 'tag') return 'tags'
  if (k === 'aliases' || k === 'alias' || k === 'cssclasses') return 'list'
  if (Array.isArray(value)) return 'list'
  if (typeof value === 'boolean') return 'checkbox'
  if (typeof value === 'number') return 'number'
  if (typeof value === 'string' && DATE.test(value)) return 'date'
  if (typeof value === 'string' && DATETIME.test(value)) return 'datetime'
  return 'text'
}

// The note's properties, or null when the YAML can't be edited safely (bad
// syntax, or not a list of key: value pairs). Then the raw YAML is shown instead.
export function readProperties(yaml: string, registry: TypeRegistry): Property[] | null {
  const doc = parse(yaml)
  if (!doc) return null
  const json = (doc.toJS() ?? {}) as Record<string, unknown>
  return Object.entries(json).map(([key, raw]) => {
    const value = plain(raw)
    return { key, value, type: inferType(key, value, registry) }
  })
}

// Turns what was typed into the value for a property type.
export function coerce(type: PropertyType, input: PropertyValue): PropertyValue {
  const asList = (v: PropertyValue): string[] =>
    Array.isArray(v) ? v : v === null || v === '' ? [] : String(v).split(',').map((s) => s.trim()).filter(Boolean)
  switch (type) {
    case 'number': {
      const n = typeof input === 'number' ? input : Number(String(input ?? '').trim())
      return input === null || input === '' || !Number.isFinite(n) ? null : n
    }
    case 'checkbox':
      return input === true || input === 'true'
    case 'list':
      return asList(input)
    case 'tags':
      return asList(input).map((t) => t.replace(/^#/, '')).filter(Boolean)
    case 'date':
    case 'datetime':
    case 'text':
      return input === null ? null : Array.isArray(input) ? input.join(', ') : String(input)
  }
}

// The YAML after setting `key` (added at the end if new). Other entries keep their text.
export function setProperty(yaml: string, key: string, value: PropertyValue): string {
  const doc = parse(yaml) ?? parseDocument('')
  const existing = doc.get(key, true)
  if (isScalar(existing) && !Array.isArray(value)) {
    existing.value = value
  } else {
    const node = doc.createNode(value)
    if (isSeq(node)) node.flow = isFlowList(doc, key)
    doc.set(key, node)
  }
  return serialize(doc)
}

export function removeProperty(yaml: string, key: string): string {
  const doc = parse(yaml)
  if (!doc) return yaml
  doc.delete(key)
  return serialize(doc)
}

// Renames a property in place (same position). False if the new name is taken.
export function renameProperty(yaml: string, from: string, to: string): string | null {
  const doc = parse(yaml)
  if (!doc || !isMap(doc.contents)) return null
  const name = to.trim()
  if (!name) return null
  if (name !== from && doc.has(name)) return null
  for (const pair of doc.contents.items) {
    if (isScalar(pair.key) && pair.key.value === from) pair.key.value = name
  }
  return serialize(doc)
}

// Lists written inline ("tags: [a, b]") stay inline; new lists are block style.
function isFlowList(doc: Document, key: string): boolean {
  const node = doc.get(key, true) as { flow?: boolean } | undefined
  return !!node?.flow
}

function serialize(doc: Document): string {
  if (!isMap(doc.contents) || doc.contents.items.length === 0) return ''
  return doc.toString({ lineWidth: 0, flowCollectionPadding: false, nullStr: '' }).replace(/\n$/, '')
}

export function sanitizeTypes(raw: unknown): TypeRegistry {
  const out: TypeRegistry = {}
  const types = raw && typeof raw === 'object' ? (raw as { types?: unknown }).types : null
  if (!types || typeof types !== 'object' || Array.isArray(types)) return out
  for (const [k, v] of Object.entries(types as Record<string, unknown>)) {
    if (PROPERTY_TYPES.includes(v as PropertyType)) out[k.toLowerCase()] = v as PropertyType
  }
  return out
}
