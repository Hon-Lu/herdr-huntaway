# Huntaway

A layout for [Herdr App](https://herdr.dev) where every panel is a rounded card, with a fast file browser built in.

- **Card layout**: the sidebar, tab bar, panes and status bar are frosted cards over a soft wallpaper, in a dark and a light version. The selection slides when you switch tabs or spaces. Colors follow whatever theme you pick.
- **Files**: a quick file tree that follows your terminal's folder. Search, Git status, rename, delete to the Recycle Bin or Trash, and Chinese or other non-English names shown correctly.
- **File tabs**: click a file to open it in its own tab. Code, Markdown, images, and simple editing with Save (`Ctrl+S`).
- **Spaces**: `+` opens a New space dialog: type to search every folder in your home, or type a path to browse folder by folder. Each space lists its agents underneath.
- **Agent inbox** (optional): a bell in the tab bar that lights up when an agent is waiting on you.

Works on Windows and macOS. Linux should work but is untested.

## Install

Install [Herdr App](https://herdr.dev/download/) and open it once. Then:

**Windows (PowerShell)**

```powershell
git clone https://github.com/Hon-Lu/herdr-huntaway "$HOME\herdr-huntaway"
Copy-Item -Recurse -Force "$HOME\herdr-huntaway\mods\*" "$HOME\.config\herdr-app\mods\"
Copy-Item -Force "$HOME\herdr-huntaway\layouts\*" "$HOME\.config\herdr-app\layouts\"
herdr-app do layout.switch --name huntaway
```

**macOS / Linux**

```sh
git clone https://github.com/Hon-Lu/herdr-huntaway ~/herdr-huntaway
cp -R ~/herdr-huntaway/mods/* ~/.config/herdr-app/mods/
cp ~/herdr-huntaway/layouts/* ~/.config/herdr-app/layouts/
herdr-app do layout.switch --name huntaway
```

You can also pick it in Settings > Look. `Ctrl+Shift+L` cycles back to Herdr's own layouts.

Don't want the agent inbox? Skip or delete `mods/huntaway-inbox`, and the bell goes away.

## Update

Run `git pull` in the cloned folder, then copy the files again the same way.

## What's included

| Folder | What it is |
| --- | --- |
| `layouts/huntaway.json` | The layout |
| `mods/huntaway-files` | The Files panel and the file tabs |
| `mods/huntaway-tabs` | The tab bar |
| `mods/huntaway-inbox` | The agent inbox popup (optional, needs `huntaway-tabs`) |
| `mods/huntaway-spaces`, `huntaway-chrome`, `huntaway-status`, `huntaway-pane`, `huntaway-changes` | Herdr's own sidebar, status bar, pane header and Changes panel, restyled as cards. Agents are listed under their space |

## Good to know

- The wallpaper and card edges follow your theme: a dark or a light version is picked by itself. To use your own picture or a plain color instead, edit `background` at the bottom of `layouts/huntaway.json` (an image path inside `~/.config/herdr-app`, or a theme color such as `"canvas"`).
- Git is optional. Without it, Files still browses and searches, just without Git status.
- Restyled Herdr mods don't update with Herdr. If something looks off after a Herdr update, update this repo too.
