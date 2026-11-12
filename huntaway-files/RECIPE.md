# Huntaway Files

A Files panel that is quick on big folders and reads every name right, including Chinese ones.
It follows your terminal's folder, shows Git status, and opens each file in a tab of its own,
where code, Markdown and images display and text files can be edited and saved.

![Huntaway Files](preview.png)

## What you see

The panel:
- A header: an open-folder icon, the folder's name with its Git branch in a small chip, the parent
  path under it, then two buttons: refresh (a spinner while loading) and open the folder in the
  system's file manager.
- A search field ("Search files").
- The tree, 26 px rows: folders first, then files, sorted by name with numbers in order. File
  icons are colored by type (code, config, text, image, archive). Git marks sit on the right:
  modified, added, deleted, renamed, untracked, conflict; ignored files are dimmed.
  `.git`, `.DS_Store`, `Thumbs.db` and `desktop.ini` are never shown.
- Right-click menu:
  - a file: Open, Open with its app, Show in File Explorer (Finder on macOS), Copy path,
    Copy relative path, Rename…, Delete…
  - a folder: New file…, New folder…, Show in File Explorer, Copy path, Copy relative path,
    Rename…, Delete…
  - empty space: New file…, New folder…, Show in File Explorer, Copy path.
- Rename and New open a small dialog with the name selected (without its extension); Delete asks
  first and moves the item to the Recycle Bin (Windows) or Trash (macOS, Linux).

A file tab (one per file; opening it again shows the same tab):
- A header with the folder (and the name, unless the layout's pane header already shows it), then
  the pencil (Edit) and Open with its app.
- For Markdown, a switch on the left of the header: Preview (rendered; links open other files in
  their own tabs), Split (the source beside the rendered result, which follows the editor as you
  type) and Code (the source). Its selection slides like the tab bar's; the choice is remembered.
  Edit from Preview switches to Split, and back after.
- Markdown images are drawn by the tab itself (Herdr's Markdown view draws none): Markdown and
  HTML `<img>` (with `width`, and links around them), `align="center"` blocks centered paragraph by
  paragraph, rows of badges side by side, and tables with images as a grid of equal columns.
  Local images are copied into the cache; web images (shields.io and the like) downloaded into it.
- Images: a zoom control on the left of the header (−, the scale, +). Fit shows the whole image;
  clicking the scale toggles fit and 100%; `Ctrl` + wheel, `Ctrl` `+` / `-` / `0` / `1` zoom too.
  Zoomed in, drag with the left button (or use the wheel, `Shift` for sideways) to move around;
  the image stops 12 px past its edges. A double-click switches between fit and 100%.
- Code with syntax colors, images,
  or "Binary file — no preview" with Open with its app and Show in folder.
- Editing: the header becomes Cancel (a crossed pencil, in the same place as Edit) and Save
  (a disk icon, tinted when there are changes). Cancel throws the changes away; Save or
  `Ctrl+S` (`Cmd+S`) writes the file. Line endings and a BOM are kept. If the file changed on
  disk meanwhile, the save is refused with a notice.

## How it behaves

- The tree follows the focused terminal's folder (in another machine's terminal, that machine's
  files) and refreshes itself when files change; F5 or the button refreshes by hand.
- Expanded folders are remembered per root.
- Keys in the tree: arrows, Page Up/Down, Home/End, Enter (open), Left/Right (fold), F2 (rename),
  Delete, `Ctrl+F` (search), Esc (clear the search), `Ctrl+C` (copy the path).
- Search matches file names under the root, using `git ls-files` when the folder is a repo.
- In the huntaway layout the panel is frosted glass; anywhere else it is solid.

## Built from

- `mods/huntaway-files/`: `mod.json` (`place: none`, `focusable`), `main.js` (picks a role from
  `props().role`: the panel, `menu`, `dialog` or `viewer`), `panel.js`, `menu.js`, `preview.js`,
  `open.js`, `markdown.js` (splits Markdown into text, HTML, image and table blocks), `system.js`,
  `paths.js`, `ui.js`, `icons/`.
- Put it in a layout as a block: `"content": { "mod": "huntaway-files" }` (Herdr's own layouts use
  the block id `files` in the stack `panel-body`).
- Files are opened with `tab.new {name, mod: "huntaway-files", props: {role: "viewer", file, on}}`;
  shared state `huntaway-files.tabs` maps files to their tabs, and `huntaway-files.request` carries
  changes from the menus and dialogs to the panel.
- Reading folders: `fs/promises` inside home; elsewhere one program call lists many folders at
  once: on this Windows machine cmd's `dir` (about 0.2 s, any language), its output written
  UTF-16 (`cmd /u`) to a file in `.cache/huntaway-files/` and read back as bytes; PowerShell
  (about 2 s) only for a folder cmd can't read or whose path has cmd's symbols in it; `sh` on
  macOS, Linux and other machines.
- Programs it runs: `git` (status, branch, file list), cmd, PowerShell or `sh`, `explorer.exe` /
  `open` / `xdg-open`. On Windows, "Open with its app" and the folder button use `explorer.exe`
  (after cmd's `if exist`, since Explorer opens Documents for a missing path) and links use
  `rundll32 url.dll,FileProtocolHandler`: at once, where PowerShell took two seconds. A path with
  a comma or cmd's symbols, or a link with spaces, still goes through PowerShell.

## Watch out

- Herdr's `fs.writeFile` writes binary data as 0 bytes and `fetch` has no binary body: copy and
  download images with PowerShell (`Copy-Item`, `curl.exe`) or `cp` / `curl`, in one batch.
- SVGs styled with CSS variables (`var(--bg)`) draw black: put the values in when caching
  (the dark-scheme ones on a dark theme). The runtime has no `TextDecoder` either.

- Windows PowerShell writes in the console's code page, which turns non-English names into
  garbage; every script sets `[Console]::OutputEncoding` to UTF-8 and is passed with
  `-EncodedCommand`. cmd run by Herdr has no console, so `chcp 65001` does nothing and its
  stdout garbles such names: `cmd /u` redirected to a file writes UTF-16, read with
  `fs.readFile` and decoded by hand (await the file's removal, or a closing view leaves it).
- In one cmd line, `if … ( … ) else …` takes in everything after it on the line: wrap the whole
  `if` in parentheses before chaining the next folder with `&`.
- `image()` only loads paths under the Herdr folder: previews are copied into
  `.cache/huntaway-files/` first and removed later.
- Use `v_virtual_list` for the tree (`uniform_list` ignores `track_scroll`).

## Done when

- `herdr-app check mods/huntaway-files` passes.
- A folder with Chinese names lists them correctly, on another drive too.
- Clicking a file opens a tab named after it; clicking it again shows that tab.
- Edit, change a line, Cancel: the text is back. Edit, change, `Ctrl+S`: the file on disk changed.
- Delete moves the file to the Recycle Bin or Trash, and the tree updates.
