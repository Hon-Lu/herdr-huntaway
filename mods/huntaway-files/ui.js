import { div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { extname } from "./paths.js";

export const MOD = "huntaway-files";
/** Requests from this mod's menus and dialogs to the panel. */
export const REQUEST = "huntaway-files.request";
/** Frosted glass on dark themes; nearly solid on light ones, so text keeps its contrast. */
export const glass = c => !/^#[0-9a-f]{6}$/i.test(c) ? c : c + (parseInt(c.slice(1, 3), 16) + parseInt(c.slice(3, 5), 16) + parseInt(c.slice(5, 7), 16) < 384 ? "cc" : "f5");
/** Glass edges (dark themes): a faint light rim. */
const darkTheme = t => { const m = /^#(..)(..)(..)/i.exec(t.background ?? ""); return !m || parseInt(m[1], 16) + parseInt(m[2], 16) + parseInt(m[3], 16) < 384; };
export const rim = t => darkTheme(t) ? "#ffffff1f" : "#0000001a";
export const icon = name => `mods/${MOD}/icons/${name}.svg`;

const stop = (_e, cx) => cx.stop_propagation();
export function iconButton(id, name, tooltip, onClick, t, active = false, size = 24) {
  return h_flex().id(id).size(size).flex_none().items_center().justify_center().rounded(6).cursor_pointer()
    .when(active, el => el.bg(t.selected)).hover(s => s.bg(t.hover)).tooltip(tooltip)
    .on_mouse_down("left", stop).on_click(onClick)
    .child(svg(icon(name)).size(14).text_color(active ? t.foreground : t.muted));
}

const CODE = new Set(["js", "mjs", "cjs", "jsx", "ts", "tsx", "mts", "cts", "py", "rs", "go", "java", "kt", "kts", "c", "h", "cc", "cpp", "hpp", "cs",
  "rb", "php", "swift", "m", "mm", "scala", "lua", "dart", "vue", "svelte", "html", "htm", "css", "scss", "sass", "less", "sh", "bash", "zsh",
  "fish", "ps1", "psm1", "bat", "cmd", "sql", "r", "pl", "ex", "exs", "erl", "hs", "clj", "zig", "nim", "v", "sol", "gd", "astro"]);
const CONFIG = new Set(["json", "jsonc", "json5", "yaml", "yml", "toml", "ini", "cfg", "conf", "env", "xml", "lock", "properties", "editorconfig", "gitignore", "gitattributes", "npmrc"]);
const TEXT = new Set(["md", "markdown", "mdx", "txt", "rst", "log", "csv", "tsv", "adoc", "org", "tex"]);
const IMAGES = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "ico", "tif", "tiff", "avif", "heic"]);
const ARCHIVE = new Set(["zip", "7z", "rar", "gz", "tgz", "bz2", "xz", "zst", "tar", "jar", "war", "iso", "dmg", "msi", "pkg", "deb", "rpm", "nupkg"]);

/** Colors by extension, using theme ANSI colors so light and dark themes both work. */
const COLOR = {
  ts: "ansi4", tsx: "ansi4", mts: "ansi4", cts: "ansi4", js: "ansi3", mjs: "ansi3", cjs: "ansi3", jsx: "ansi3",
  py: "ansi4", rs: "ansi1", go: "ansi6", java: "ansi1", kt: "ansi5", cs: "ansi5", c: "ansi4", cpp: "ansi4", h: "ansi5", rb: "ansi1",
  php: "ansi5", swift: "ansi1", html: "ansi1", htm: "ansi1", css: "ansi4", scss: "ansi5", vue: "ansi2", svelte: "ansi1",
  sh: "ansi2", bash: "ansi2", zsh: "ansi2", ps1: "ansi4", bat: "ansi2", cmd: "ansi2", sql: "ansi3",
  json: "ansi3", jsonc: "ansi3", yaml: "ansi5", yml: "ansi5", toml: "ansi5", xml: "ansi1", lock: null,
  md: "ansi4", markdown: "ansi4", mdx: "ansi4",
};

export function fileLook(name, t) {
  const lower = name.toLowerCase(), ext = extname(lower) || (lower.startsWith(".") ? lower.slice(1) : "");
  const kind = IMAGES.has(ext) ? "file-image" : ARCHIVE.has(ext) ? "file-archive" : CODE.has(ext) ? "file-code"
    : CONFIG.has(ext) || lower.startsWith(".") ? "file-config" : TEXT.has(ext) ? "file-text" : "file";
  const color = IMAGES.has(ext) ? t.ansi5 : ARCHIVE.has(ext) ? t.ansi1 : COLOR[ext] ? t[COLOR[ext]] : t.muted;
  return { icon: icon(kind), color };
}

export const MARK_LABEL = { M: "M", A: "A", D: "D", R: "R", U: "U", C: "!", I: "" };
export function markColor(mark, t) {
  return mark === "A" || mark === "U" ? t.ansi2 : mark === "D" || mark === "C" ? t.ansi1 : mark === "R" ? t.ansi4 : mark === "M" ? t.ansi3 : null;
}
export const MARK_TITLE = { M: "Modified", A: "Added", D: "Deleted", R: "Renamed", U: "Untracked", C: "Conflict", I: "Ignored" };

export { div, svg };
