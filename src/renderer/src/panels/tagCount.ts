// Counting tags across notes (kept free of the DOM so it can be tested in Node).
export interface TagCount {
  tag: string
  // Uses of exactly this tag.
  count: number
  depth: number
}

// Counts tags (in text and front matter), adding parents of nested tags, sorted by name.
export function countTags(notes: Array<{ meta: { tags: Array<{ tag: string }>; frontmatterTags: string[] } }>): TagCount[] {
  const counts = new Map<string, { tag: string; count: number }>()
  const add = (tag: string, n: number): void => {
    const key = tag.toLowerCase()
    const hit = counts.get(key)
    if (hit) hit.count += n
    else counts.set(key, { tag, count: n })
  }
  for (const note of notes) {
    for (const t of [...note.meta.tags.map((x) => x.tag), ...note.meta.frontmatterTags]) {
      add(t, 1)
      // #a/b/c also lists #a and #a/b (with no uses of their own unless used directly).
      const parts = t.split('/')
      for (let i = 1; i < parts.length; i++) add(parts.slice(0, i).join('/'), 0)
    }
  }
  return [...counts.values()]
    .sort((a, b) => a.tag.localeCompare(b.tag, undefined, { sensitivity: 'base' }))
    .map((t) => ({ ...t, depth: t.tag.split('/').length - 1 }))
}
