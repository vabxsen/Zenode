# Appearance and themes

Open **Settings → Appearance** (Ctrl+,):

- **Theme**: Light, Dark, or System (follows Windows, and switches when Windows does).
- **Accent colour** for links, buttons and highlights.
- **Text font**, **code font** and **text size**.
- **Zoom** makes everything bigger or smaller (also Ctrl+= and Ctrl+-).
- **Readable line length** (in Settings → Editor) keeps lines to a comfortable width.

## CSS themes

A theme is a folder in `.zenode/themes` inside your vault with a `theme.css` file. Pick it under **CSS theme**. Many themes written for other Markdown apps that use the same common variables (`--background-primary`, `--text-normal`, …) work too.

## CSS snippets

Small `.css` files in `.zenode/snippets` can change any detail. Turn each one on or off in Appearance, and use **Reload** after editing one. For example, a snippet with

```css
.zn-statusbar { display: none; }
```

hides the status bar.
