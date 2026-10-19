import { defineConfig } from 'electron-vite'

// Entry points follow electron-vite defaults:
// src/main/index.ts, src/preload/index.ts, src/renderer/index.html
// main and preload keep package dependencies external by default
// (build.externalizeDeps, on since electron-vite 5).
export default defineConfig({
  main: {},
  preload: {},
  renderer: {}
})
