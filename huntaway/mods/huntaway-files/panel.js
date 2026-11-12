// The Files panel: a tree of the focused terminal's folder, with search, git
// marks and live refresh. Files open in a tab of their own.
import { div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, Scrollbar, VirtualListScrollHandle, v_virtual_list } from "gpui-base";
import { spaces, panes, focused, theme, watchFolder, shared, openOverlay, notify, run, window as appWindow } from "herdr";
import { norm, join, dirname, basename, key, contains, relative, display, homeDir, compareEntries, isRoot, isWindows } from "./paths.js";
import { listFolders, fileIndex, rank, gitTop, gitBranch, gitStatus, openDefault, MAX_PER_FOLDER } from "./system.js";
import { openInTab } from "./open.js";
import { menuHeight } from "./menu.js";
import { MOD, REQUEST, icon, iconButton, glass, rim, fileLook, markColor, MARK_LABEL } from "./ui.js";

const OPEN_LABEL = { windows: "Open in File Explorer", macos: "Open in Finder" };

const ROW = 26, INDENT = 14;
const NOISE = new Set([".git", ".DS_Store", "Thumbs.db", "desktop.ini"]);
// Hidden items, shown only when asked for: dot names (.ai, .vscode, .gitignore) and Windows' own
// `$` and System Volume Information folders. Windows' hidden attribute isn't read: the in-process
// reader doesn't report it, and asking cmd for it would slow every folder in home.
const isHidden = name => name.startsWith(".") || name.startsWith("$") || name.toLowerCase() === "system volume information";
const hiddenPath = rel => rel.split("/").some(isHidden);

/** A path quoted the way Herdr quotes a file dropped on a terminal: always, in single quotes. A
 *  quote inside is doubled on Windows (PowerShell) and written '\'' elsewhere (sh). */
function quoted(p) {
  return isWindows() ? `'${p.replace(/'/g, "''")}'` : `'${p.replace(/'/g, `'\\''`)}'`;
}
const PRIORITY = { C: 6, D: 5, M: 4, R: 3, A: 2, U: 1 };

function read(name, fallback) { try { const v = localStorage.getItem(name); return v === null ? fallback : JSON.parse(v); } catch { return fallback; } }
function write(name, value) { try { localStorage.setItem(name, JSON.stringify(value)); } catch {} }

/** The folder the panel shows: the focused terminal's, else the space's. */
function followed(previous) {
  const space = spaces().find(s => s.active), f = focused();
  if (!space) return null;
  const pane = f?.pane ? panes().find(p => p.pane === f.pane) : null;
  const on = f?.pane === null && f?.terminal ? (f.terminal.includes("/") ? f.terminal.split("/")[0] : null) : space.machine ?? null;
  let cwd = pane?.cwd || (f?.pane === null ? f?.cwd : null);
  // A mod pane (an open file) has no folder: keep what this space showed.
  if (!cwd && pane?.mod && previous?.space === space.id) return previous;
  cwd = cwd || space.folder || (on ? null : homeDir());
  return cwd ? { space: space.id, root: norm(cwd), on } : null;
}

export class Panel {
  init(cx, handle) {
    this.handle = handle;
    this.dirs = new Map(); this.open = new Set(); this.sel = null;
    this.git = null; this.marks = new Map(); this.inherit = new Map(); this.folderMarks = new Map();
    this.query = ""; this.results = []; this.index = null;
    this.scroll = VirtualListScrollHandle.new();
    this.range = { start: 0, end: 0 };
    this.version = 0; this.rowsCache = null;
    this.showHidden = read("showHidden", true);
    this.lastRequest = shared(REQUEST)?.n ?? null;
    this.search = InputState.new({ placeholder: "Search files" });
    this.search.on("change", (_e, cx) => this.queryChanged(cx));
    this.search.on("submit", (_e, cx) => { const r = this.rows().find(r => r.kind === "result"); if (r) this.activate(r, cx); });
    this.search.on("focus", (_e, cx) => { this.searchFocused = true; cx.notify(); });
    this.search.on("blur", (_e, cx) => { this.searchFocused = false; cx.notify(); });
    this.sync(cx);
    cx.timer.every(10000, cx => { if (this.ctx?.on || this.watchFailed) this.refresh(cx, { quiet: true }); });
  }

  close() { this.ctx = null; }

  // ---- where we are ----------------------------------------------------------

  sync(cx) {
    const next = followed(this.followedLast);
    if (next) this.followedLast = next;
    const k = next ? JSON.stringify([next.root, next.on]) : null;
    if (k === this.ctx?.key) { if (next) this.ctx.space = next.space; return; }
    this.remember();
    this.ctx = next ? { key: k, root: next.root, on: next.on, space: next.space } : null;
    this.dirs = new Map(); this.sel = null; this.git = null; this.marks = new Map(); this.inherit = new Map(); this.folderMarks = new Map();
    this.index = null; this.results = []; this.watchFailed = false; this.changed();
    const saved = next ? read("open", {})[key(next.root, next.on)] : null;
    this.open = new Set((saved ?? []).map(rel => join(next.root, rel)));
    if (!next) return;
    this.load([next.root, ...this.open], cx);
    this.refreshGit(cx);
    this.watch(cx);
    if (this.query) this.runSearch(cx);
  }

  /** Expanded folders survive switching folders and restarts (the 40 most recent roots). */
  remember() {
    if (!this.ctx) return;
    const all = read("open", {}), k = key(this.ctx.root, this.ctx.on);
    delete all[k];
    all[k] = [...this.open].map(p => relative(this.ctx.root, p, this.ctx.on)).filter(Boolean).slice(0, 300);
    const keys = Object.keys(all);
    for (const old of keys.slice(0, Math.max(0, keys.length - 40))) delete all[old];
    write("open", all);
  }

  changed() { this.version++; }

  // ---- loading -------------------------------------------------------------------

  load(paths, cx, { quiet = false } = {}) {
    const ctx = this.ctx;
    if (!ctx || !paths.length) return;
    const unique = [...new Set(paths)];
    for (const p of unique) { const d = this.dirs.get(p); if (d) d.loading = true; else if (!quiet) this.dirs.set(p, { entries: null, loading: true }); }
    this.changed();
    cx.spawn(async cx => {
      let result;
      try { result = await listFolders(unique, ctx.on); }
      catch (e) { result = new Map(unique.map(p => [p, { entries: [], error: String(e?.message ?? e) }])); }
      if (this.ctx !== ctx) return;
      for (const [p, v] of result) {
        if (p !== ctx.root && !this.open.has(p)) { this.dirs.delete(p); continue; }
        if (v.error && p !== ctx.root && /no longer exists/.test(v.error)) { this.open.delete(p); this.dirs.delete(p); continue; }
        const entries = v.entries.sort(compareEntries);
        this.dirs.set(p, { entries: entries.slice(0, MAX_PER_FOLDER), more: entries.length > MAX_PER_FOLDER, error: v.error ?? null, loading: false });
      }
      this.changed(); cx.notify();
    });
  }

  refresh(cx, { quiet = false } = {}) {
    if (!this.ctx) return;
    this.load([this.ctx.root, ...[...this.open].filter(p => this.dirs.has(p))], cx, { quiet });
    this.refreshGit(cx);
    if (this.index) this.index.stale = true;
    if (this.query) this.runSearch(cx);
    if (!quiet) { this.spinUntil = Date.now() + 500; cx.timer.after(520, cx => cx.notify()); }
  }

  watch(cx) {
    const ctx = this.ctx;
    if (!ctx || ctx.on) return;
    cx.spawn(async cx => {
      while (this.ctx === ctx) {
        let paths;
        try { paths = await watchFolder(ctx.root); }
        catch { if (this.ctx === ctx) this.watchFailed = true; return; }
        if (this.ctx !== ctx) return;
        for (const p of paths) (this.pending ??= new Set()).add(norm(p));
        if (!this.flushing) {
          this.flushing = true;
          cx.timer.after(150, cx => { this.flushing = false; this.flush(ctx, cx); });
        }
      }
    });
  }

  /** Reloads only the folders that changed. */
  flush(ctx, cx) {
    const paths = [...(this.pending ?? [])]; this.pending = null;
    if (this.ctx !== ctx || !paths.length) return;
    const reload = new Set();
    let git = false, everything = false, files = false;
    for (const p of paths) {
      if (key(p, ctx.on) === key(ctx.root, ctx.on)) { everything = true; continue; }
      const rel = relative(ctx.root, p, ctx.on);
      if (/(^|\/)\.git(\/|$)/.test(rel)) { if (!/\/(objects|logs)\//.test(rel)) git = true; continue; }
      git = true; files = true;
      const parent = dirname(p);
      if (this.dirs.has(parent)) reload.add(parent);
    }
    if (everything) { this.refresh(cx, { quiet: true }); return; }
    if (reload.size) this.load([...reload], cx, { quiet: true });
    if (files && this.index) this.index.stale = true;
    if (git) this.refreshGit(cx);
  }

  refreshGit(cx) {
    const ctx = this.ctx;
    if (!ctx) return;
    if (this.gitBusy) { this.gitAgain = true; return; }
    this.gitBusy = true;
    cx.spawn(async cx => {
      try {
        const top = this.git?.root === ctx.root ? this.git.top : await gitTop(ctx.root, ctx.on);
        if (this.ctx !== ctx) return;
        if (!top) { this.git = { root: ctx.root, top: null }; this.marks = new Map(); this.inherit = new Map(); this.folderMarks = new Map(); return; }
        const [files, branch] = await Promise.all([gitStatus(top, ctx.on), gitBranch(top, ctx.on)]);
        if (this.ctx !== ctx) return;
        const marks = new Map(), inherit = new Map(), folders = new Map();
        for (const [rel, mark] of files ?? []) {
          const dir = rel.endsWith("/"), abs = join(top, dir ? rel.slice(0, -1) : rel), k = key(abs, ctx.on);
          if (dir) inherit.set(k, mark); else marks.set(k, mark);
          if (mark === "I") continue;
          for (let d = dirname(abs); contains(top, d, ctx.on) && d !== abs; d = dirname(d)) {
            const dk = key(d, ctx.on), was = folders.get(dk);
            if (!was || PRIORITY[mark] > PRIORITY[was]) folders.set(dk, mark);
            if (dk === key(top, ctx.on) || isRoot(d)) break;
          }
        }
        this.git = { root: ctx.root, top, branch };
        this.marks = marks; this.inherit = inherit; this.folderMarks = folders;
      } catch {} finally {
        this.gitBusy = false; this.changed(); cx.notify();
        if (this.gitAgain) { this.gitAgain = false; cx.timer.after(400, cx => this.refreshGit(cx)); }
      }
    });
  }

  markFor(path, dir) {
    const on = this.ctx?.on, k = key(path, on);
    const own = this.marks.get(k) ?? this.inherit.get(k);
    if (own) return own;
    if (this.inherit.size && this.git?.top) {
      for (let d = dirname(path); contains(this.git.top, d, on); d = dirname(d)) {
        const m = this.inherit.get(key(d, on));
        if (m) return m;
        if (key(d, on) === key(this.git.top, on) || isRoot(d)) break;
      }
    }
    return dir ? this.folderMarks.get(k) ?? null : null;
  }

  // ---- tree ------------------------------------------------------------------------

  rows() {
    const sig = `${this.version}|${this.query}|${this.results.length}|${this.searching}`;
    if (this.rowsCache?.sig === sig) return this.rowsCache.rows;
    const out = [], ctx = this.ctx;
    if (!ctx) out.push({ key: "status:none", kind: "status", text: "No folder", depth: 0 });
    else if (this.query) {
      for (const rel of this.results) out.push({ key: `result:${rel}`, kind: "result", path: join(ctx.root, rel), rel, name: basename(rel), depth: 0, dir: false });
      if (!this.results.length) out.push({ key: "status:search", kind: "status", text: this.searching ? "Searching…" : "No matching files", depth: 0 });
      else if (this.index?.limited) out.push({ key: "status:limited", kind: "status", text: "Search covers the first 50,000 files", depth: 0 });
    } else {
      const walk = (dir, depth) => {
        const d = this.dirs.get(dir);
        if (!d || d.entries === null) { out.push({ key: `status:${dir}`, kind: "status", text: "Loading…", depth, spin: true }); return; }
        if (d.error) out.push({ key: `status:${dir}`, kind: "status", text: d.error, depth, error: true });
        const list = d.entries.filter(e => !NOISE.has(e.name) && (this.showHidden || !isHidden(e.name)));
        if (!list.length && !d.error) out.push({ key: `status:${dir}`, kind: "status", text: depth ? "Empty folder" : "This folder is empty", depth });
        for (const e of list) {
          const path = join(dir, e.name), open = e.dir && this.open.has(path);
          out.push({ key: path, kind: e.dir ? "dir" : "file", path, name: e.name, depth, dir: e.dir, open });
          if (open && depth < 40) walk(path, depth + 1);
        }
        if (d.more) out.push({ key: `status:more:${dir}`, kind: "status", text: `Showing the first ${MAX_PER_FOLDER.toLocaleString()} entries`, depth });
      };
      walk(ctx.root, 0);
    }
    this.rowsCache = { sig, rows: out };
    return out;
  }

  toggle(path, cx, force) {
    const open = force ?? !this.open.has(path);
    if (!open) {
      for (const p of [...this.open]) if (contains(path, p, this.ctx?.on)) { this.open.delete(p); this.dirs.delete(p); }
    } else if (!this.open.has(path)) {
      this.open.add(path);
      if (!this.dirs.has(path)) this.load([path], cx);
    }
    this.changed(); this.remember(); cx.notify();
  }

  activate(row, cx) {
    if (row.kind === "status") return;
    this.sel = row.path; this.changed();
    if (row.kind === "dir") this.toggle(row.path, cx);
    else { const on = this.ctx?.on ?? null; cx.spawn(async cx => openInTab(row.path, on, cx)); }
    cx.notify();
  }

  // ---- search ------------------------------------------------------------------------

  queryChanged(cx) {
    const value = this.search.value();
    if (value === this.query) return;
    this.query = value.trim() ? value : "";
    this.changed();
    const token = this.searchToken = (this.searchToken ?? 0) + 1;
    cx.timer.after(90, cx => { if (token === this.searchToken) this.runSearch(cx); });
    cx.notify();
  }

  runSearch(cx) {
    const ctx = this.ctx, query = this.query;
    if (!ctx || !query) { this.results = []; this.changed(); cx.notify(); return; }
    const pick = () => { this.results = rank(this.searchable(), this.query); this.sel = this.results[0] ? join(ctx.root, this.results[0]) : null; };
    if (this.index && this.index.root === ctx.root && !this.index.stale) { pick(); this.changed(); cx.notify(); return; }
    if (this.indexing) return;
    this.indexing = true; this.searching = true; this.changed(); cx.notify();
    cx.spawn(async cx => {
      try {
        const top = this.git?.root === ctx.root ? this.git.top : await gitTop(ctx.root, ctx.on);
        const idx = await fileIndex(ctx.root, ctx.on, top);
        if (this.ctx === ctx) this.index = { root: ctx.root, files: idx.files, limited: idx.limited, stale: false };
      } catch {
        if (this.ctx === ctx) this.index = { root: ctx.root, files: [], limited: false, stale: false };
      } finally {
        this.indexing = false; this.searching = false;
        if (this.ctx === ctx && this.query) pick();
        this.changed(); cx.notify();
      }
    });
  }

  /** The indexed files search looks through: hidden ones too when shown, or when the words
   *  themselves start a name with a dot (".env"). */
  searchable() {
    const files = this.index?.files ?? [];
    if (this.showHidden || /(^|[\s\\/])\./.test(this.query)) return files;
    return files.filter(rel => !hiddenPath(rel));
  }

  /**
   * Puts a path where the focused terminal is typing, as dropping a file there would, without
   * pressing Enter: relative to the terminal's folder when inside it. Mods can't drag into a
   * terminal or type into one, so it goes through the clipboard and `terminal.paste`; the text
   * that was on the clipboard comes back after (an image on it can't).
   */
  insert(path, on, cx) {
    const f = focused();
    if (!f?.terminal) { notify({ title: "No terminal to insert into", body: "Click a terminal first, then try again.", level: "error" }); return; }
    const cwd = f.cwd ? norm(f.cwd) : null;
    const inside = cwd && key(cwd, on) !== key(path, on) && contains(cwd, path, on);
    const text = quoted(display(inside ? relative(cwd, path, on) : path, on));
    const before = cx.read_from_clipboard();
    cx.write_to_clipboard(text);
    run("terminal.paste");
    // Back to the terminal, to keep typing after the path.
    run("pane.focus", f.pane ? { pane: f.pane } : { terminal: f.terminal });
    if (before !== undefined) cx.timer.after(600, cx => { if (cx.read_from_clipboard() === text) cx.write_to_clipboard(before); });
  }

  /** Show or hide hidden items, remembered for every folder. */
  toggleHidden(cx) {
    this.showHidden = !this.showHidden;
    write("showHidden", this.showHidden);
    this.changed();
    if (this.query) this.runSearch(cx);
    cx.notify();
  }

  clearSearch(cx) { this.search.set_value(""); this.query = ""; this.results = []; this.changed(); this.handle.focus(); cx.notify(); }

  // ---- menus and requests ------------------------------------------------------------

  entryTarget(path, dir) {
    const ctx = this.ctx;
    return { path, dir, root: ctx.root, on: ctx.on, space: ctx.space, isRoot: key(path, ctx.on) === key(ctx.root, ctx.on) };
  }

  menu(target) {
    openOverlay({ mod: MOD, kind: "popup", width: 220, height: menuHeight(target), props: { role: "menu", target } });
  }

  dialog(action, row) {
    openOverlay({ mod: MOD, kind: "dialog", width: 400, height: action === "delete" ? 176 : 186, props: { role: "dialog", action, target: this.entryTarget(row.path, row.dir) } });
  }

  /** Reports from this mod's dialogs: a file or folder was created, renamed or deleted. */
  request(cx) {
    const r = shared(REQUEST);
    if (!r || r.n === this.lastRequest) return;
    this.lastRequest = r.n;
    // The menu's Insert into terminal and Open with its app: done here, since the menu closes at
    // once and would drop what is still waiting (the clipboard's return, cmd's check).
    if (r.action === "insert") { this.insert(r.path, r.on ?? null, cx); return; }
    if (r.action === "open-default") {
      openDefault(r.path, r.on ?? null).catch(e => notify({ title: "Could not open", body: String(e?.message ?? e), level: "error" }));
      return;
    }
    const ctx = this.ctx;
    if (!ctx || r.action !== "changed" || key(r.root, r.on) !== key(ctx.root, ctx.on)) return;
    const dirs = (r.dirs ?? []).filter(d => d === ctx.root || this.open.has(d));
    if (r.removed) for (const p of [...this.open]) if (contains(r.removed, p, ctx.on)) { this.open.delete(p); this.dirs.delete(p); }
    if (r.expand && !this.open.has(r.expand) && r.expand !== ctx.root) { this.open.add(r.expand); dirs.push(r.expand); }
    this.load(dirs.length ? dirs : [ctx.root], cx, { quiet: true });
    this.refreshGit(cx);
    if (this.index) this.index.stale = true;
    if (r.select) { this.sel = r.select; this.pendingScroll = r.select; }
    this.changed(); this.remember();
  }

  // ---- keyboard ----------------------------------------------------------------------

  key(e, cx) {
    const k = e.keystroke;
    const rows = this.rows().filter(r => r.kind !== "status");
    const at = rows.findIndex(r => r.path === this.sel), row = rows[at];
    const select = i => { const r = rows[Math.max(0, Math.min(rows.length - 1, i))]; if (r) { this.sel = r.path; this.pendingScroll = r.path; this.changed(); } };
    const ctx = this.ctx;
    switch (k) {
      case "down": select(at < 0 ? 0 : at + 1); break;
      case "up": select(at < 0 ? 0 : at - 1); break;
      case "pagedown": select(at + 15); break;
      case "pageup": select(at - 15); break;
      case "home": select(0); break;
      case "end": select(rows.length - 1); break;
      case "right": if (row?.kind === "dir") { if (!row.open) this.toggle(row.path, cx, true); else select(at + 1); } break;
      case "left":
        if (row?.kind === "dir" && row.open) this.toggle(row.path, cx, false);
        else if (row && ctx && !this.query && key(dirname(row.path), ctx.on) !== key(ctx.root, ctx.on)) { this.sel = dirname(row.path); this.pendingScroll = this.sel; this.changed(); }
        break;
      case "enter": if (row) this.activate(row, cx); break;      case "f2": if (row) this.dialog("rename", row); break;
      case "delete": if (row) this.dialog("delete", row); break;
      case "f5": this.refresh(cx); break;
      case "ctrl-f": case "cmd-f": this.search.focus(); break;
      // As in Finder (Cmd+Shift+.); GPUI may spell Shift+. as ">".
      case "ctrl-shift-.": case "cmd-shift-.": case "ctrl->": case "cmd->": this.toggleHidden(cx); break;
      case "escape": if (this.query) this.clearSearch(cx); else return; break;
      case "ctrl-c": case "cmd-c": if (row) { cx.write_to_clipboard(display(row.path, ctx?.on)); notify({ title: "Copied path", body: display(row.path, ctx?.on), level: "success", timeout: 2000 }); } break;
      default: return;
    }
    cx.stop_propagation(); cx.notify();
  }

  // ---- drawing -----------------------------------------------------------------------

  rowElement(row, t) {
    const pad = 6 + row.depth * INDENT;
    if (row.kind === "status") {
      return h_flex().h(ROW).w_full().pl(pad + 18).pr(8).gap(6).items_center().text_size(12).text_color(row.error ? t.ansi1 : t.dim)
        .when(Boolean(row.spin), el => el.child(svg(icon("spinner")).size(12).flex_none().text_color(t.dim).spin(900)))
        .child(div().flex_1().min_w(0).truncate().child(row.text));
    }
    const selected = this.sel && row.path === this.sel;
    const mark = this.markFor(row.path, row.dir), ignored = mark === "I";
    const look = row.dir ? { icon: icon(row.open ? "folder-open" : "folder"), color: t.accent } : fileLook(row.name, t);
    const nameColor = ignored ? t.dim : markColor(mark, t) ?? (row.name.startsWith(".") ? t.muted : t.foreground);
    const el = h_flex().h(ROW).w_full().pl(pad).pr(8).gap(5).items_center().rounded(6)
      .when(Boolean(selected), el => el.bg(this.focusedList ? t.selected : t.hover))
      .child(row.dir ? svg(icon(row.open ? "chevron-down" : "chevron-right")).size(12).flex_none().text_color(t.dim) : div().w(12).flex_none())
      .child(svg(look.icon).size(15).flex_none().text_color(ignored ? t.dim : look.color));
    if (row.kind === "result") {
      const parent = row.rel.includes("/") ? row.rel.slice(0, row.rel.lastIndexOf("/")) : "";
      return el.child(div().flex_none().max_w(200).truncate().text_color(nameColor).child(row.name))
        .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(parent))
        .when(Boolean(MARK_LABEL[mark]), el => el.child(div().flex_none().text_size(11).font_semibold().text_color(markColor(mark, t)).child(MARK_LABEL[mark])));
    }
    return el.child(div().flex_1().min_w(0).truncate().text_color(nameColor).child(row.name))
      .when(Boolean(mark) && mark !== "I", el => row.dir
        ? el.child(div().size(6).flex_none().rounded(3).bg(markColor(mark, t)))
        : el.child(div().flex_none().w(12).text_size(11).font_semibold().text_right().text_color(markColor(mark, t)).child(MARK_LABEL[mark])));
  }

  header(t) {
    const ctx = this.ctx, root = ctx?.root;
    const loading = Boolean([...this.dirs.values()].some(d => d.loading) || this.gitBusy || (this.spinUntil && Date.now() < this.spinUntil));
    const name = root ? (isRoot(root) ? display(root, ctx.on) : basename(root)) : "Files";
    // The name, and under it, dim, the machine (another one's folder) and the Git branch, each
    // line the full width; neither when there's nothing to say. Tight line heights keep the two
    // together, and 50 px leaves about 10 px above and below them. The full path is the tooltip
    // (the terminal's own header shows it too).
    const under = [ctx?.on, this.git?.branch].filter(Boolean).join(" · ");
    return v_flex().flex_none().border_b(1).border_color(t.border)
      .child(h_flex().h(50).px(10).gap(8).items_center()
        .child(svg(icon("folder-open")).size(16).flex_none().text_color(t.accent))
        .child(v_flex().id("hlf-root").flex_1().min_w(0)
          .tooltip(root ? (ctx.on ? `${ctx.on}: ` : "") + display(root, ctx.on) + (this.git?.branch ? `\n${this.git.branch}` : "") : "")
          .child(div().min_w(0).truncate().font_semibold().text_size(13).line_height("17px").child(name))
          .when(Boolean(under), el => el.child(div().min_w(0).truncate().text_size(11).line_height("14px").text_color(t.muted).child(under))))
        .child(h_flex().id("hlf-refresh").size(24).flex_none().items_center().justify_center().rounded(6).cursor_pointer().hover(s => s.bg(t.hover)).tooltip("Refresh (F5)")
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click((_e, cx) => this.refresh(cx))
          .child(loading ? svg(icon("spinner")).size(14).text_color(t.muted).spin(800) : svg(icon("refresh")).size(14).text_color(t.muted)))
        // Hidden items (dot names): the open eye while they show.
        .child(iconButton("hlf-hidden", this.showHidden ? "eye" : "eye-off", this.showHidden ? "Hide hidden items" : "Show hidden items",
          (_e, cx) => this.toggleHidden(cx), t))
        // Opens the folder itself in the system's file manager (local folders only).
        .when(Boolean(root && !ctx.on), el => el.child(iconButton("hlf-open", "external", OPEN_LABEL[appWindow()?.platform] ?? "Open in file manager",
          () => openDefault(root, null).catch(e => notify({ title: "Could not open the folder", body: String(e?.message ?? e), level: "error" })), t))))
      .child(h_flex().h(30).mx(8).mb(8).px(8).gap(6).items_center().rounded(7).bg(t.background).border_1().border_color(this.searchFocused ? t.accent : t.border)
        .child(svg(icon("search")).size(13).flex_none().text_color(t.dim))
        .child(Input.new(this.search).flex_1().min_w(0).h(28).text_size(12.5).text_color(t.foreground))
        .when(Boolean(this.query), el => el.child(iconButton("hlf-clear", "x", "Clear (Esc)", (_e, cx) => this.clearSearch(cx), t, false, 20))));
  }

  render(cx) {
    this.request(cx);
    this.sync(cx);
    const t = theme(), rows = this.rows();
    if (this.pendingScroll) {
      const i = rows.findIndex(r => r.path === this.pendingScroll);
      if (i >= 0 && (i < this.range.start || i >= this.range.end - 1)) this.scroll.scroll_to_item(i, "center");
      this.pendingScroll = null;
    }
    this.focusedList = this.handle.is_focused();
    return v_flex().id("hlf").size_full().min_h(0).overflow_hidden().bg(glass(t.background)).text_color(t.foreground).text_size(13)
      .rounded(14).border_1().border_color(rim(t))
      .track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .child(this.header(t))
      .child(div().relative().flex_1().min_h(0).px(4).pt(2)
        // A row's click doesn't carry its keys: the press, which reaches here first, says whether
        // Alt (Option) was held, and then the click inserts the path instead of opening it.
        .on_mouse_down("left", e => { this.altPress = Boolean(e.modifiers?.alt); })
        .on_mouse_down("right", () => {
          if (this.itemMenu) { this.itemMenu = false; return; }
          if (this.ctx) this.menu(this.entryTarget(this.ctx.root, true));
        })
        .child(v_virtual_list("hlf-tree", rows.length, ROW, i => rows[i].key, (range) => {
          this.range = range;
          return rows.slice(range.start, range.end).map(r => this.rowElement(r, t));
        }).size_full().track_scroll(this.scroll)
          .on_item_click((k, cx) => {
            const r = this.rows().find(r => r.key === k), alt = this.altPress;
            this.altPress = false;
            if (alt && r && r.kind !== "status") { this.sel = r.path; this.changed(); this.insert(r.path, this.ctx?.on ?? null, cx); cx.notify(); return; }
            this.handle.focus(); if (r) this.activate(r, cx);
          })
          .on_item_secondary_click((k, _e, cx) => {
            const r = this.rows().find(r => r.key === k);
            if (!r || r.kind === "status") return;
            this.itemMenu = true; this.sel = r.path; this.changed(); cx.notify();
            this.menu(this.entryTarget(r.path, r.dir));
          }))
        .child(Scrollbar.vertical("hlf-tree").absolute().inset_0()));
  }

  focusCommand() { this.handle.focus(); }
}
