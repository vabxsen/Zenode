# Daily notes and templates

## Daily notes

**Ctrl+Shift+D** (or the calendar button on the left) opens today's note, creating it if needed. There are commands for yesterday's and tomorrow's notes too.

In **Settings → Daily notes** choose the folder, the name format (for example `YYYY-MM-DD`, or `YYYY/MM/YYYY-MM-DD` to make folders per year and month) and a template to start each day from.

## Templates

Put notes you want to reuse in a templates folder (set in **Settings → Templates**; `Templates` by default), then run **Insert template** from the command palette. The template's text goes in at the cursor; its properties are added to the note's own.

Templates can use:

| Variable | Becomes |
| --- | --- |
| `{{title}}` | the note's name |
| `{{date}}` | today, in the date format from settings |
| `{{time}}` | now, in the time format from settings |
| `{{date:dddd D MMMM}}` | today in any format |

This vault has an example: [[Meeting]].
