import { div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { layout } from "herdr";
import { extname } from "./paths.js";

export const MOD = "huntaway-files";
/** Requests from this mod's menus and dialogs to the panel. */
export const REQUEST = "huntaway-files.request";
/** In the huntaway layout (its wallpaper is ours), the panel is glass; anywhere else it is solid. */
const huntaway = () => /^mods\/huntaway-chrome\//.test(layout()?.background?.image ?? "");
/** Frosted glass on dark themes; nearly solid on light ones, so text keeps its contrast. */
export const glass = c => !huntaway() || !/^#[0-9a-f]{6}$/i.test(c) ? c : c + (parseInt(c.slice(1, 3), 16) + parseInt(c.slice(3, 5), 16) + parseInt(c.slice(5, 7), 16) < 384 ? "cc" : "f5");
/** Glass edges (dark themes): a faint light rim. */
const darkTheme = t => { const m = /^#(..)(..)(..)/i.exec(t.background ?? ""); return !m || parseInt(m[1], 16) + parseInt(m[2], 16) + parseInt(m[3], 16) < 384; };
export const rim = t => !huntaway() ? t.border : darkTheme(t) ? "#ffffff1f" : "#0000001a";
export const icon = name => `mods/${MOD}/icons/${name}.svg`;

const stop = (_e, cx) => cx.stop_propagation();
export function iconButton(id, name, tooltip, onClick, t, active = false, size = 24) {
  return h_flex().id(id).size(size).flex_none().items_center().justify_center().rounded(6).cursor_pointer()
    .when(active, el => el.bg(t.selected)).hover(s => s.bg(t.hover)).tooltip(tooltip)
    .on_mouse_down("left", stop).on_click(onClick)
    .child(svg(icon(name)).size(14).text_color(active ? t.foreground : t.muted));
}

// File and folder icons: Lucide line icons (icons/, ISC licence in LICENSE-lucide.txt) tinted
// with the theme's ANSI colors, so light and dark themes both work. A kind of file gets its own
// shape; a language its color. Each entry is [icon, theme color].
const words = s => new Set(s.split(" "));
const FOLDERS = [
  [words("src lib app source scripts tools"), "folder-code"],
  [words("tests test __tests__ spec specs e2e"), "folder-check"],
  [words(".github .git .gitlab .husky"), "folder-git-2"],
  [words("docs doc documentation"), "folder-pen"],
  [words("layouts components ui views pages"), "folder-kanban"],
  [words(".vscode .idea .config config configs settings .claude"), "folder-cog"],
  [words(".ssh keys secrets certs"), "folder-key"],
  [words("downloads"), "folder-down"],
  // Made by tools, not by hand: dimmed.
  [words("node_modules vendor .venv venv target dist build out bin obj"), "folder-archive", "dim"],
  [words(".cache cache tmp temp logs"), "folder-clock", "dim"],
];
const NAMES = {
  "package.json": ["package", "ansi2"], "tsconfig.json": ["file-cog", "ansi4"], "jsconfig.json": ["file-cog", "ansi3"],
  "dockerfile": ["file-box", "ansi4"], "makefile": ["file-terminal", "ansi3"], "justfile": ["file-terminal", "ansi3"],
  ".gitkeep": ["file-minus", "dim"], ".gitattributes": ["file-cog", "muted"], ".gitmodules": ["file-cog", "muted"],
};
/** Source code: one shape, the language's color. */
const CODE = {
  ts: "ansi4", tsx: "ansi4", mts: "ansi4", cts: "ansi4", js: "ansi3", mjs: "ansi3", cjs: "ansi3", jsx: "ansi3",
  py: "ansi4", rs: "ansi1", go: "ansi6", java: "ansi1", kt: "ansi5", kts: "ansi5", cs: "ansi5", c: "ansi4", h: "ansi5", cc: "ansi4", cpp: "ansi4", hpp: "ansi5",
  rb: "ansi1", php: "ansi5", swift: "ansi1", scala: "ansi1", lua: "ansi4", dart: "ansi6", vue: "ansi2", svelte: "ansi1", astro: "ansi5",
  html: "ansi1", htm: "ansi1", css: "ansi4", scss: "ansi5", sass: "ansi5", less: "ansi4", xml: "ansi1", sql: "ansi3", zig: "ansi3", r: "ansi4", pl: "ansi4",
  ex: "ansi5", exs: "ansi5", erl: "ansi1", hs: "ansi5", clj: "ansi2", nim: "ansi3", sol: "ansi4", gd: "ansi6",
};
const KINDS = [
  [words("json jsonc json5 jsonl"), "file-braces", "ansi3"],
  [words("md markdown mdx"), "file-text", "ansi4"],
  [words("txt rst adoc org tex"), "file-text", "muted"],
  [words("pdf"), "file-text", "ansi1"],
  [words("sh bash zsh fish ps1 psm1 psd1 bat cmd"), "file-terminal", "ansi2"],
  [words("yaml yml toml ini cfg conf properties editorconfig env"), "file-cog", "ansi5"],
  [words("csv tsv xlsx xls ods"), "file-spreadsheet", "ansi2"],
  [words("db sqlite sqlite3"), "file-database", "ansi3"],
  [words("png jpg jpeg gif webp bmp svg ico tif tiff avif heic"), "file-image", "ansi5"],
  [words("mp4 mov mkv webm avi"), "file-video-camera", "ansi5"],
  [words("mp3 wav flac ogg m4a"), "file-music", "ansi5"],
  [words("zip 7z rar gz tgz bz2 xz zst tar jar war iso dmg nupkg deb rpm"), "file-archive", "ansi1"],
  [words("ttf otf woff woff2"), "file-type", "muted"],
  [words("exe dll msi so dylib bin app"), "file-box", "muted"],
  [words("diff patch"), "file-diff", "ansi3"],
  [words("pem key crt cer"), "file-key", "ansi3"],
  [words("lock lockb"), "file-lock", "dim"],
  [words("log"), "file-clock", "dim"],
];

/** A file's or folder's icon and its color, by name: special names first, then the extension. */
export function fileLook(name, dir, open, t) {
  const n = name.toLowerCase(), ext = extname(n);
  const pick = ([id, color]) => ({ icon: icon(id), color: t[color] ?? t.muted });
  if (dir) {
    const f = FOLDERS.find(([s]) => s.has(n));
    return f ? pick([f[1], f[2] ?? "accent"]) : pick([open ? "folder-open" : "folder", "accent"]);
  }
  if (NAMES[n]) return pick(NAMES[n]);
  if (/^readme(\.|$)/.test(n)) return pick(["book-open", "ansi4"]);
  if (/^(license|licence|copying|unlicense)([.-]|$)/.test(n)) return pick(["scale", "ansi3"]);
  if (/^(changelog|changes|history)(\.|$)/.test(n)) return pick(["file-clock", "ansi4"]);
  if (/^\.env(\.|$)/.test(n)) return pick(["file-key", "ansi3"]);
  if (n.startsWith(".") && n.endsWith("ignore")) return pick(["file-x", "muted"]);
  if (/[-_.]lock\.(json|yaml)$/.test(n)) return pick(["file-lock", "dim"]);
  if (/\.(test|spec)\.[a-z]+$/.test(n)) return pick(["file-check", "ansi2"]);
  if (/\.d\.[cm]?ts$/.test(n)) return pick(["file-type", "ansi4"]);
  if (/\.config\.[a-z]+$/.test(n)) return pick(["file-cog", CODE[ext] ?? "ansi5"]);
  if (CODE[ext]) return pick(["file-code", CODE[ext]]);
  const k = KINDS.find(([s]) => s.has(ext));
  return pick(k ? [k[1], k[2]] : ["file", "muted"]);
}

export const MARK_LABEL = { M: "M", A: "A", D: "D", R: "R", U: "U", C: "!", I: "" };
export function markColor(mark, t) {
  return mark === "A" || mark === "U" ? t.ansi2 : mark === "D" || mark === "C" ? t.ansi1 : mark === "R" ? t.ansi4 : mark === "M" ? t.ansi3 : null;
}
export const MARK_TITLE = { M: "Modified", A: "Added", D: "Deleted", R: "Renamed", U: "Untracked", C: "Conflict", I: "Ignored" };

export { div, svg };
