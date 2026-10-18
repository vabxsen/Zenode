# Performance

How Zenode behaves in big vaults, how it's measured, and what was done (milestone M5).

## How to measure

```bash
npm run bench -- 10000   # generated vault with 10,000 notes: start-up, index, search, graph, memory
npm run soak -- 500      # open/close notes, canvases, graph and files 500 times; checks for leaks
```

- `scripts/gen-vault.mjs` writes a synthetic vault (same vault every run for a given size): notes in 100 folders with front matter, headings, `#tags`, `[[links]]` (5% to missing notes), tasks, code blocks, and a canvas per 1,000 notes.
- `scripts/bench.mjs` drives the E2E build with Playwright. *Cold* is a first launch (no saved index); *warm* is the next launch with the same settings folder. Times are from launching the process, so they include Electron's own start-up (about 0.7 s on this machine).
- `scripts/soak.mjs` compares heap snapshots (after garbage collection) taken after a warm-up and after the run. It judges the JavaScript heap (what app code can leak) and reports detached DOM nodes, Blink's native memory and compiled code separately. `--diff` lists what grew, `--retainers` prints what keeps detached editor lines alive, and `--skip=typing,reading,...` leaves parts out.

## Results

Windows 11, AMD Ryzen 7 5800H (16 threads), 17 GB RAM, NVMe disk. Release build of 2026-10-19.

| | 10,000 notes | 50,000 notes | Target |
|---|---|---|---|
| File tree shown (cold / warm) | 0.9 s / 0.8 s | 2.2 s / 1.4 s | |
| Index ready, cold | 2.5 s | 9.2 s | 10k: < 5 s ✓ |
| Index ready, warm | 1.0–1.2 s (indexing itself 0.26 s) | 2.9 s | 10k: < 1 s (indexing ✓; with Electron start-up, just over) |
| Search: words / `tag:` / regex | 45 / 20 / 35 ms | 166 / 74 / 130 ms | < 200 ms ✓ |
| Graph while laying out: fps, longest frame | 165 fps, 7 ms | 83 fps, 36 ms | smooth |
| Memory, all processes | 0.8 GB | 1.6 GB | |

Before M5, for comparison:

| | 10,000 notes | 50,000 notes |
|---|---|---|
| Index ready, cold / warm | 3.4 s / 2.1 s | 14.4 s / 7.2 s |
| Graph while laying out | 118 fps, 24 ms | 6 fps, 230 ms |
| Memory, all processes | 0.9 GB | 2.3 GB (with the graph open) |

Soak, 500 cycles (3.7 minutes): JavaScript heap 4,496 → 4,502 KB (+0.1%), detached DOM nodes 64 → 64. Compiled code grows by about 2.5 MB as V8 optimises, and Blink's native memory by about 1 MB (performance-timeline and style caches); neither keeps growing with app objects.

## What changed

- **Saved index.** The parsed index is kept in IndexedDB per vault. A warm start reuses every note whose mtime and size are unchanged and reads only the rest. Only notes read while their stats were known are saved, so text the watcher re-read or the app saved is read again next time instead of being trusted. It is a cache: anything missing or from an older format means a normal full build.
- **One build at start-up.** A file-watcher refresh arriving during the first build used to queue a second full build. Build-or-sync is now decided inside the index queue.
- **Long lists.**
  - The file tree draws only the rows in view once more than 300 rows are visible.
  - Backlinks show 100 linking notes at a time, and redraw only for changes that affect the note.
  - Unlinked mentions scan the vault only when opened, when the note changes, when a listed note changes, or on refresh.
- **Graph.**
  - Frames fill reusable typed arrays instead of creating an object per node and edge.
  - At most 300 labels are drawn, the most-linked first.
  - Graphs over 10,000 nodes settle in fewer steps.
- **Canvas.**
  - Cards build their content (and editors) only when they come into view.
  - Below 25% zoom, cards are drawn as plain shapes.
  - The camera is placed before the first render.
- **Typing leak.** Chromium keeps undo steps of its own for edits in an editable element, holding the old lines they touched. CodeMirror never uses them, but in one long-lived editor they piled up across every note it showed: about 3.6 DOM nodes and 1.8 KB of JavaScript objects per edit-and-switch, with no limit. The editor's content element is now briefly detached and re-attached when a pane changes note, which makes Chromium drop those steps.
- **Bugs found along the way.**
  - A redraw read the scroll position of an emptied list, so refreshes jumped long trees back to the top.
  - The rename box was refocused a frame late after a redraw, so keystrokes could be lost.

## Known limits

- Everything is kept in memory (each note's text is needed for search), so memory grows with vault size: about 1.6 GB for all processes together at 50,000 notes (around 33 KB per note).
- A warm start still lists every file (about 0.15 s for 10,000 files) and loads the whole saved index.
- Within a single open note, the browser's undo steps still collect while you type, until you switch notes or close the tab.
