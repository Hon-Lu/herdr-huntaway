# Huntaway Files

A Files panel that is quick on big folders and reads every name right, including Chinese ones.
It follows your terminal's folder, shows Git status, and opens each file in a tab of its own,
where code, Markdown and images display and text files can be edited and saved.

![Huntaway Files](preview.png)

## What you see

The panel:
- A header, 50 px: an open-folder icon; the folder's name (13 px, 17 px line) and right under it,
  dim (11 px, 14 px line), the machine's name when it's another machine's folder and the Git
  branch, joined by " · ", each line cut short with "…" (with neither, the name alone, centered);
  the full path and branch are the tooltip. Then only two buttons: refresh (a spinner while
  loading) and open the folder in the system's file manager. Nothing else goes in the header, so
  the folder's name keeps its room; other options go in the ⋯ menu.
  After the branch, `↑N` (`ansi6`) and `↓N` (`ansi4`) when it is ahead of or behind its
  upstream; the tooltip adds "main → origin/main (3 ahead)".
- A change summary, only while the shown folder has changes (the files under it, not the whole
  repo): a 14 px line of 6 px dots and counts, "3 modified", "2 new" (added and untracked),
  "1 deleted", "1 conflict", 11 px muted, in the tree's mark colors; the lines added and removed
  (`+144 −65`, `ansi2` / `ansi1`) on the right; under it a 4 px bar split by those counts
  (2 px gaps, rounded, at least 4 px each). A clean folder shows nothing, so nothing to read.
- A search field ("Search files") and, right of it, a 28 px ⋯ button: a popup in the right-click
  menu's style, 240 px, each row with a 14 px muted icon:
  - Hide hidden items (a crossed eye) while they show, Show hidden items (an eye) while they are
    left out, with `Ctrl+Shift+.` (`⌘⇧.`) dim on the right. It says what choosing it does, as
    the old eye button did, so it needs no tick.
  - Collapse all folders (chevrons pointing together).
  New view options are added here, never as header buttons. The popup reports the choice through
  `huntaway-files.request`, and the panel acts on it a moment later (it arrives inside render).
- The tree, 26 px rows: folders first, then files, sorted by name with numbers in order.
  Icons are Lucide line icons (15 px), tinted with theme colors; `fileLook()` in `ui.js` picks
  them:
  - Folders, in the accent color: `src`/`lib`/`app`/`scripts`/`tools` code, `tests` a check,
    `.github`/`.git` git, `docs` a pen, `layouts`/`components`/`ui`/`views`/`pages` a board,
    `.vscode`/`config`/`.claude` a cog, `.ssh`/`keys`/`secrets` a key, `downloads` an arrow;
    made by tools and dimmed: `node_modules`/`dist`/`build`/`target`/`.venv` and the like an
    archive, `.cache`/`tmp`/`logs` a clock. Others the plain folder, open while expanded.
  - Files by name first: `package.json` a package, README a book, LICENSE scales, CHANGELOG a
    clock, `.env*` a key, `.*ignore` a crossed file, lock files a lock (dimmed), `*.test.*` /
    `*.spec.*` a check, `*.d.ts` type, `*.config.*` and `tsconfig.json` a cog, `Dockerfile` a
    box, `Makefile` a terminal.
  - Then by extension: source code one shape in its language's color (TypeScript, CSS, Python
    `ansi4`; JavaScript `ansi3`; HTML, Rust `ansi1`; …), JSON braces, Markdown and text,
    scripts a terminal, YAML/TOML/INI a cog, spreadsheets, databases, images, video, audio,
    archives, fonts, programs, diffs, keys, logs; anything else the plain file, muted.
  Git marks sit on the right: modified, added, deleted, renamed, untracked, conflict; ignored
  files are dimmed. A changed file shows, before its mark, the lines added and removed against
  the last commit (`+42 −8`, 11 px, 85% opacity, only the parts that aren't zero; new and binary
  files have none). Files without line counts show when they last changed, 11 px dim on the
  right: `14:05` today, `Nov 3` this year, `Nov 2025` before. The panel can't know its own
  width, so the date always shows; folders have none.
  `.git`, `.DS_Store`, `Thumbs.db` and `desktop.ini` are never shown. Hidden items (names that
  start with `.` or `$`, and `System Volume Information`) show with muted names until Hide hidden
  items is chosen, and are left out after that.
- Right-click menu:
  - a file: Open, Open with its app, Insert into terminal, Show in File Explorer (Finder on
    macOS), Copy path, Copy relative path, Rename…, Delete…
  - a folder: New file…, New folder…, Insert into terminal, Show in File Explorer, Copy path,
    Copy relative path, Rename…, Delete…
  - empty space: New file…, New folder…, Insert into terminal, Show in File Explorer, Copy path.
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
- Expanded folders are remembered per root. Hidden items show at first; hiding them is remembered
  for every folder.
- Keys in the tree: arrows, Page Up/Down, Home/End, Enter (open), Left/Right (fold), F2 (rename),
  Delete, `Ctrl+F` (search), Esc (clear the search), `Ctrl+C` (copy the path),
  `Ctrl+Shift+.` (`Cmd+Shift+.`, as in Finder: show or hide hidden items).
- Search matches file names under the root, using `git ls-files` when the folder is a repo. While
  hidden items are hidden, files inside them are left out too, unless a word starts with `.`
  (`.env` finds `.env`).
- Insert into terminal (the menu item, which shows "Alt+Click" / "⌥ Click" dim on its right, or
  `Alt`/`Option` + click on a row) puts the path where the focused terminal is typing, the way
  dropping a file there would, without pressing Enter: relative to the terminal's folder when
  inside it, always in single quotes as Herdr quotes a dropped file (whatever the program),
  nothing after it; then the terminal has the keyboard again. Herdr gives mods no drag into a
  terminal nor a way to type into one, so it goes through the clipboard and `terminal.paste`;
  the clipboard's text comes back 0.6 s later (an image on it is lost). The menu hands it to the
  panel through `huntaway-files.request`, since the menu closes at once.
- `line_height` takes a bare number as a multiplier: give pixels as a string (`"17px"`).
- The menu's Open with its app goes to the panel the same way: on Windows it waits on cmd's
  `if exist` before starting Explorer, and a closing menu would drop that second step.
- A row's click (`on_item_click`) carries no keys: Alt is read from the press, which reaches the
  element around the list first.
- Windows' hidden attribute isn't read (home is read in-process, which doesn't report it), so
  `AppData` or `NTUSER.DAT` in home still show.
- In the huntaway layout the panel is frosted glass; anywhere else it is solid.

## Built from

- `mods/huntaway-files/`: `mod.json` (`place: none`, `focusable`), `main.js` (picks a role from
  `props().role`: the panel, `menu`, `dialog` or `viewer`), `panel.js`, `menu.js`, `preview.js`,
  `open.js`, `markdown.js` (splits Markdown into text, HTML, image and table blocks), `system.js`,
  `paths.js`, `ui.js`, `icons/` (Lucide, ISC licence in `icons/LICENSE-lucide.txt`; new ones are
  written on one line like the rest, CRLF).
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
- Modified times come apart from the listing, which stays fast: Herdr's `fs` has no `stat` and
  cmd's `dir` writes dates in the system's language, so one PowerShell call on Windows
  (`LastWriteTimeUtc`) or `stat` (GNU `-c %Y`, BSD `-f %m`) elsewhere reads them for every folder
  that asked, at most once every 3 s. The names show at once; the dates follow.
- Programs it runs: `git` (`status --branch` for marks and ahead/behind, `branch --show-current`,
  `diff HEAD --numstat` for line counts, `ls-files` for search), cmd, PowerShell or `sh`, `explorer.exe` /
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
- In a repo with changes, edited files show `+N −N`, the summary counts them under the header,
  and committing everything makes the summary go away.
