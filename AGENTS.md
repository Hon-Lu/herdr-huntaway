# Working on herdr-huntaway

A layout and mods for Herdr App. Read `README.md` for what ships and each folder's `RECIPE.md`
for how a piece looks and behaves. Herdr's own guide is `~/.config/herdr-app/AGENTS.md`; its type
files (`gpui-kit.d.ts`, `herdr.d.ts`) beside it are the truth for the mod API.

## Where to edit

- `huntaway/` is the source: the layout and every mod. `huntaway-files/` and `huntaway-newspace/`
  are copies for installing those mods alone. After changing either mod in `huntaway/mods/`, run
  `sync.ps1` so the copies match.
- Install by copying `huntaway/mods/*` to `~/.config/herdr-app/mods/` (and the layout files to
  `layouts/`). Never copy the installed `layouts/huntaway.json` back: `huntaway-chrome` rewrites it
  at run time (pane fill, rims, wallpaper per theme).
- Every change: `herdr-app check <mod folder>` on each changed mod, then `herdr-app status` shows
  no errors.
- Six mods started from Herdr's shipped mods (Apache 2.0; each says so on its first line):
  spaces, tabs, workspace-chrome, workspace-status, pane, changes. After a Herdr update, compare
  them with `~/.config/herdr-app/mods/<shipped name>/`.
- A change in behavior or look also updates that folder's `RECIPE.md` and, if users see it,
  `README.md`.

## Herdr runtime gotchas (all hit in practice)

- `fs.writeFile` writes binary data as 0 bytes; `fetch` responses have no `arrayBuffer()`. Copy
  and download with PowerShell (`Copy-Item`, `curl.exe`) or `cp` / `curl`, batched in one call
  (see `fill()` in `huntaway-files/system.js`). `fs.readFile` of bytes works.
- There is no `TextDecoder`.
- `image()` loads only paths under `~/.config/herdr-app`: copy pictures into
  `.cache/huntaway-files/` first. Herdr caches an image by its path: a changed picture needs a new
  file name (the wallpapers were renamed for this).
- Herdr's SVG renderer has no CSS `var()`: such SVGs draw black until the values are put in.
- `TextView.markdown` draws no images and centers nothing; `huntaway-files/markdown.js` splits
  Markdown into blocks the file tab draws itself.
- A layout node's `radius` doesn't clip its mod: card mods round themselves (`rounded(13)` inside a
  14 px node with a 1 px border). Layout files take plain colors only.
- A popup is as tall as its content: give its parts fixed heights.
- PowerShell output must be forced to UTF-8 (`[Console]::OutputEncoding`, `-EncodedCommand`) or
  non-English names turn to garbage.

## Editing files here

- Files are CRLF, UTF-8 without BOM, except `huntaway/layouts/huntaway.json` (LF). Git Bash
  `sed -i` turns CRLF into LF: restore with `perl -pi -e 's/\r?\n/\r\n/'`.
- Python one-liners in heredocs mangle JS regex escapes (`\b` became a backspace byte). Put patch
  scripts in a file, or use the Edit tool for regex lines; `grep -c $'\x08'` finds the damage.

## Testing what you can't click

- `herdr-app shot` saves the window. If it keeps returning the same frame (monitor asleep),
  toggle `herdr-app do window.maximize` twice.
- To open a dialog or popup with props, make a throwaway mod (`mods/zz-<name>/`, `mod.json` with an
  `overlay`) whose `init` calls `openOverlay(...)` or `setShared(...)`, open it with
  `herdr-app do mod.open '{"name":"zz-<name>"}'`, then delete the folder.
- A fake agent: `hc send <terminal> '...[Console]::Write(ESC + "]7501;state=blocked:app=claude-code" + ESC + "\")'`.
  Fields are separated by `:`, not `;`. A `done` agent turns `idle` once its space is seen.
- Clean up everything made for a test: tabs, spaces (`space.close` needs `"confirmed": true`),
  `zz-*` mods.

## Preview pictures (`preview.png`, shown on herdr.dev)

- Whole window, taken with `herdr-app shot`, never a crop.
- Never show the conversation with the person: switch to a quiet tab first.
- Show only this repository's own content: its Markdown files, a Files panel rooted here (make a
  temporary space in this folder), demo agents. Nothing from the person's other projects or home
  folder.
- `huntaway/preview.png` is embedded in `README.md`, so a shot of the README contains the current
  picture: replace it with a clean one before shooting.

## Publishing

- herdr.dev lists the repo by its topics `herdr-layout` and `herdr-mod`; each folder needs its
  `RECIPE.md` and `preview.png`.
- Commit messages are one line, `type: 內容` (feat / fix / chore / refactor / test). Push only
  when the person says so.
