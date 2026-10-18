// Light colours and print layout for exported notes, applied after the app's own CSS.
export const EXPORT_CSS = `
:root {
  color-scheme: light;
  --zn-bg: #ffffff;
  --zn-bg-panel: #f7f7f9;
  --zn-bg-raised: #f1f1f5;
  --zn-bg-hover: #ececf1;
  --zn-border: #dcdce4;
  --zn-text: #1d1d22;
  --zn-text-strong: #000000;
  --zn-text-muted: #4f4f5a;
  --zn-text-faint: #85858f;
  --zn-accent: #6d28d9;
  --zn-accent-strong: #5b21b6;
  --zn-accent-dim: #7c6bb5;
}
html, body.zn-export {
  height: auto;
  overflow: visible;
  background: #ffffff;
  color: var(--zn-text);
  font-family: var(--zn-font-text);
}
.zn-export .zn-reading-body {
  max-width: none;
  margin: 0;
  padding: 0;
}
.zn-export .zn-rendered :not(pre) > code {
  color: #6d28d9;
}
.zn-export .zn-rendered th,
.zn-export .zn-rendered td {
  border-color: #d4d4dc;
}
.zn-export .zn-export-title {
  margin: 0 0 0.6em;
  font-size: 2em;
}
.zn-export .zn-export-media {
  color: var(--zn-text-muted);
  font-style: italic;
}
.zn-export pre,
.zn-export table,
.zn-export img,
.zn-export .zn-callout,
.zn-export .zn-embed-note,
.zn-export .zn-mermaid {
  break-inside: avoid;
}
.zn-export h1,
.zn-export h2,
.zn-export h3,
.zn-export h4 {
  break-after: avoid;
}
.zn-export img {
  max-width: 100%;
}
`
