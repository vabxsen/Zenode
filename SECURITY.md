# Security

## Reporting a problem

Please report security issues privately, not in a public issue: use GitHub's **Report a vulnerability** button on the repository's Security tab (private vulnerability reporting). Include the Zenode version (Settings → General → Copy diagnostics), what you did, and what happened.

You can expect an answer within a week. Once a fix is released, the issue will be described in the release notes, with credit if you'd like it.

## Supported versions

Only the latest release gets security fixes.

## How Zenode protects your notes and your computer

Zenode is a desktop app that reads and writes files in folders you choose. It has no server and no account, and it sends nothing anywhere: no telemetry, no analytics.

**The page is sandboxed.**
- The app's interface runs with Chromium's sandbox and context isolation, without Node.js.
- It can only use a small, fixed set of functions (`window.zenode`).
- The main process answers those only for the app's own page, in the main frame of its own windows.

**File access stays inside the vault.**
- Every path from the page is resolved inside the open vault.
- A path is refused if it would leave the vault, including through symbolic links or junctions.
- NTFS alternate data streams and Windows device names are refused.

**Notes can't run code.**
- Markdown is rendered through DOMPurify.
- Mermaid runs in strict mode.
- The app page's Content-Security-Policy allows scripts only from the app itself.
- Files served to the page through `vault://` are sent with a sandboxing CSP and `nosniff`, so a vault HTML or SVG file shown as a page can't run scripts.

**Links and files.**
- Only `http(s)` and `mailto` links are handed to Windows. Other schemes (`file:`, `ms-settings:`, custom app protocols) are refused.
- Opening a vault file that would run as a program (`.exe`, `.bat`, `.ps1`, `.lnk`, `.msi`, …) asks for confirmation first.

**No surprises from web content.**
- Pages get no permissions: no camera, microphone, location or notifications; only writing to the clipboard.
- Nothing can navigate the window, open new windows or embed webviews.

**The packaged app is locked down.** Electron fuses are set at build time:
- **Turned off:** running as Node (`ELECTRON_RUN_AS_NODE`), `NODE_OPTIONS`, and Node inspector flags.
- **Turned on:**
  - The app is loaded only from its `app.asar` archive, whose integrity is checked against a hash stored in the executable, so a modified `app.asar` is refused.
  - Cookie encryption.

  CI checks the fuses and the tamper refusal on every build (`npm run check:package`).

**Data safety.**
- Notes are written atomically and never overwritten silently when they changed outside Zenode.
- Deletes go to the Recycle Bin or the vault's `.trash` folder.

**Dependencies.**
- CI fails on high or critical advisories in shipped dependencies (`npm audit --omit=dev`).
- Dependabot proposes updates weekly.

## Known limits

- **Unsigned builds.** Releases are not code-signed yet, so Windows SmartScreen may warn on first install.
- **Not encrypted.** Zenode doesn't encrypt your vault. Use BitLocker, or an encrypted folder, if you need that.
- **Trusted themes and snippets.** CSS themes and snippets in `.zenode/` can change how the app looks, including hiding or restyling content. Only install themes you trust.
