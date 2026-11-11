# Huntaway New Space

A dialog for starting a space in the right folder without typing `cd`. Type a few letters to find
any folder under your home, or type a path to browse folder by folder, then press Enter: the new
space opens with a terminal there.

![Huntaway New Space](preview.png)

## What you see

A 520×454 card in the middle of the window, 16 px corners, the theme's `background`:
- A header: "New space", and on the right a hint ("Indexing N folders…" while it reads your
  folders, "⌫ up a folder" while browsing) and "Esc".
- A search field with a yellow (`ansi3`) rim, placeholder "Search folders, or type a path".
- Up to seven 40 px rows: a folder icon (a drive icon for a drive), the folder's name and its
  path under it (`~` for home). The highlighted row has a `hover` fill that slides (160 ms) with
  the arrow keys or the pointer, and says "Tab open · ↵ create" on the right.
- Empty, the list area only says "Type a folder name to search" and
  "or start with ~\ or C:\ to browse" (`~/ or /` on macOS and Linux).
- At the bottom, a Create button in yellow, dimmed while no folder is highlighted.

## How it behaves

- Words search every folder under home, read in the background the first time the dialog opens
  (six levels down, up to 40,000 folders; hidden folders, `node_modules`, build output and other
  tool folders are skipped). Every word must be in the path; a word in the folder's own name
  counts most, at its start more; shorter paths win ties.
- A path (`~\…`, `C:\…`, `D:\`, `/…`) lists that folder's subfolders, filtered by what follows the
  last slash. Ending in a slash, the folder itself comes first as "Use this folder".
- Keys: Up/Down and Page Up/Down move, `Tab` opens the highlighted folder, `Backspace` right after
  a slash goes up a folder, `Enter` creates, `Esc` closes. A click creates.
- The space is made with `space.new {machine: "", folder}` and starts a terminal there. If the
  folder is inside a Git repo but not its top, the space is named after the folder (Herdr would
  name it after the repo); otherwise it stays unnamed and follows its terminal.

## Built from

- `mods/huntaway-newspace/`: `mod.json` declares the overlay
  (`kind: "dialog"`, `frame: "none"`, 520×454), `main.js`, `newspace.js` (the dialog),
  `folders.js` (listing, drives, the index and the search).
- Open it with `mod.open {name: "huntaway-newspace"}`: from a key (`keys.json` here binds
  `Ctrl+Shift+N` in place of Herdr's `space.new`), the palette, or another mod's button.
- Listing: `fs/promises` inside home; outside it, PowerShell (UTF-8 output) on Windows or `sh`.
- Programs it runs: `git rev-parse --show-toplevel` (to name the space), PowerShell or `sh`.

## Watch out

- A trailing slash means "inside this folder": keep it when splitting the typed path.
- Terminals may report folders in other letter case; compare paths case-insensitively.
- The dialog's parts have fixed heights; keep `mod.json`'s overlay height in step
  (48 + 52 + 7 × 40 + 12 + 60 + 2 = 454).

## Done when

- `herdr-app check mods/huntaway-newspace` passes.
- `herdr-app do mod.open '{"name":"huntaway-newspace"}'` shows the empty dialog with its hint.
- Typing a folder's name lists it; typing `~\Desktop\` lists the Desktop's folders; `Tab` and
  `Backspace` go in and out.
- Enter on a folder makes a space whose terminal starts there.
