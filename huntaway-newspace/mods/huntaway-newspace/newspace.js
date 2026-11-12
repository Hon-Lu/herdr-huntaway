// The New space dialog: where the new space starts and what runs in it, all inside Herdr.
// The field holds the folder the space starts in; the list under it suggests folders. Empty, it
// offers the open spaces' folders, home and the drives; a path lists that folder's subfolders;
// words search the folder index. Up/Down put the highlighted folder in the field without
// changing the list, Tab goes into it, Enter creates. The space starts with a terminal there.
import { div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { run, exec, theme, props, closeOverlay, home, spaces, panes } from "herdr";
import { norm, isWin, listDirs, drives, folderIndex, searchFolders } from "./folders.js";

const W = 520, ROW = 40, ROWS = 7, SLIDE = { duration: 160, easing: "ease-out" };
const isDark = c => { const m = /^#(..)(..)(..)/i.exec(c ?? ""); return !m || parseInt(m[1], 16) + parseInt(m[2], 16) + parseInt(m[3], 16) < 384; };

// The dialog is 48 + 52 + ROWS * ROW + 12 + 60 + 2 = 454 px tall: keep mod.json's overlay in step.
const key = p => norm(p).toLowerCase();
const sep = () => (isWin() ? "\\" : "/");
const show = p => { const n = norm(p), h = norm(home()); const f = n === h ? "~" : n.toLowerCase().startsWith(h.toLowerCase() + "/") ? "~" + n.slice(h.length) : n; return isWin() ? f.replace(/\//g, "\\") : f; };
const base = p => { const n = norm(p); return /^[a-z]:$/i.test(n) ? n.toUpperCase() + "\\" : n.split("/").pop() || n; };
const join = (dir, name) => (dir.endsWith("/") ? dir : dir + "/") + name;
const expand = q => { const t = q.trim(); return t === "~" || t.startsWith("~/") || t.startsWith("~\\") ? norm(home()) + norm(t.slice(1)) : norm(t); };
const looksLikePath = q => /^(~([\\/]|$)|\/|[a-z]:([\\/]|$))/i.test(q.trim());
const isRoot = p => /^[a-z]:$|^\/$/i.test(norm(p));
/** How a folder is written in the field: a drive or the root with its slash ("C:\"). */
const field = f => { const p = show(f); return isRoot(f) && !p.endsWith(sep()) ? p + sep() : p; };
/** A folder written to browse into it: ending in a slash. */
const inside = f => { const p = show(f); return p.endsWith(sep()) ? p : p + sep(); };

export class NewSpace {
  init(cx, handle) {
    this.handle = handle; this.at = -1; this.top = 0;
    this.browse = { dir: null, names: [] };
    this.lists = new Map();
    this.drives = [];
    // `query` is what was typed: the list follows it. The field can differ from it while a row
    // is highlighted (its path is shown there); `shown` is that text, so its change is ignored.
    this.query = props()?.query ?? ""; this.shown = null;
    // props.query: start with something typed (a path to browse, or words to search).
    this.input = InputState.new({ value: this.query, placeholder: "Type a path, or words to search" });
    this.input.on("change", (_e, cx) => {
      const v = this.input.value();
      if (v === this.shown) return;
      this.shown = null; this.query = v; this.at = -1; this.top = 0;
      this.load(cx); cx.notify();
    });
    this.input.on("submit", (_e, cx) => this.create(this.target(), cx));
    this.load(cx);
    this.input.focus();
    cx.timer.after(250, () => this.input?.focus());
    cx.spawn(async cx => { this.drives = await drives(); cx.notify(); });
    // The index fills in while the dialog is open; results follow it.
    this.index = folderIndex(this.spaceFolders());
    cx.timer.every(300, cx => { if (!this.index.done || !this.indexShown) { this.indexShown = this.index.done; cx.notify(); } });
  }

  close() { this.input?.release(); this.input = null; }

  /** Folders in use on this computer, each once: where the terminals are now, then where the
   *  spaces start new ones. */
  spaceFolders() {
    const seen = new Set(), out = [];
    const local = f => (isWin() ? /^[a-z]:/i : /^\//).test(f);
    const found = [...(panes() ?? []).map(p => p.cwd), ...(spaces() ?? []).filter(s => !s.machine).map(s => s.folder)];
    for (const raw of found) {
      const f = norm(raw ?? "");
      if (f && local(f) && !seen.has(key(f))) { seen.add(key(f)); out.push(f); }
    }
    return out;
  }

  /** A typed path split into the folder to list and the start of a name to filter by. */
  typed(q = this.query) {
    const full = expand(q);
    // Ending in a slash (or a bare drive or ~): list that folder itself.
    if (/^[a-z]:$/i.test(full) || /[\\/]\s*$/.test(q) || q.trim() === "~") return { dir: full, rest: "" };
    const cut = full.lastIndexOf("/");
    return { dir: cut <= 0 ? "/" : full.slice(0, cut), rest: full.slice(cut + 1) };
  }

  /**
   * A folder's subfolder names, read once while the dialog is open: a Promise until read, then
   * the list. Going back up, or into a folder read ahead, shows at once.
   */
  list(dir, hidden) {
    const k = key(dir) + (hidden ? "|hidden" : "");
    if (!this.lists.has(k)) {
      const reading = listDirs(dir, { hidden }).then(names => { this.lists.set(k, names); return names; });
      this.lists.set(k, reading);
    }
    return this.lists.get(k);
  }

  /** For a typed path: list its folder (once per folder; typing a name only filters). */
  load(cx) {
    if (!looksLikePath(this.query)) return;
    const { dir, rest } = this.typed(), hidden = rest.startsWith(".");
    if (key(dir) === key(this.browse.dir ?? "") && this.browse.names && this.browse.hidden === hidden) return;
    const token = (this.token ?? 0) + 1; this.token = token;
    const known = this.list(dir, hidden);
    if (Array.isArray(known)) { this.browse = { dir, hidden, names: known }; return; }
    this.browse = { dir, hidden, names: null };
    cx.spawn(async cx => {
      const names = await known;
      if (token !== this.token) return;
      this.browse = { dir, hidden, names };
      cx.notify();
    });
  }

  items() {
    const q = this.query;
    const row = f => ({ kind: "folder", folder: f });
    if (looksLikePath(q)) {
      const { dir, rest } = this.typed(), low = rest.toLowerCase();
      const names = key(dir) === key(this.browse.dir ?? "") ? this.browse.names : null;
      const subs = (names ?? []).filter(n => n.toLowerCase().startsWith(low)).map(n => row(join(dir, n)));
      if (names === null) return [{ kind: "empty", text: "Reading…" }];
      if (!subs.length) return [{ kind: "empty", text: rest === "" ? "No folders inside" : "No folders here" }];
      return subs;
    }
    if (q.trim()) {
      const found = searchFolders(this.index.folders, q, 80).map(row);
      return found.length ? found : [{ kind: "empty", text: this.index.done ? "No folders match" : "Searching…" }];
    }
    // Nothing typed: places to start from.
    const seen = new Set(), list = [];
    for (const f of [...this.spaceFolders(), norm(home()), ...this.drives]) {
      if (!seen.has(key(f))) { seen.add(key(f)); list.push(row(f)); }
    }
    return list;
  }

  /**
   * The folder the space would start in: the highlighted row; else the typed path when it ends
   * at a folder ("C:\Code\"); else the first row (the best match).
   */
  target() {
    const items = this.items(), at = items[this.at];
    if (at?.folder) return at.folder;
    if (looksLikePath(this.query) && this.typed().rest === "") return this.typed().dir;
    return this.query.trim() ? items.find(it => it.folder)?.folder ?? null : null;
  }

  /** Highlight a row and show its path in the field; the list stays as it is. */
  select(i, cx) {
    const it = this.items()[i];
    if (!it?.folder) return;
    this.at = i;
    if (this.at < this.top) this.top = this.at;
    if (this.at >= this.top + ROWS) this.top = this.at - ROWS + 1;
    this.shown = field(it.folder);
    this.input.set_value(this.shown);
    // Read what is inside ahead, so Tab into it shows at once.
    const ahead = this.list(it.folder, false);
    if (!Array.isArray(ahead)) cx?.spawn(async () => { await ahead; });
    cx?.notify();
  }

  /** Back to what was typed, nothing highlighted. */
  unselect() {
    this.at = -1;
    if (this.shown !== null) { this.shown = this.query; this.input.set_value(this.query); }
  }

  /** Browse into a folder: the field becomes its path, listing what is inside. */
  enter(folder, cx) {
    if (!folder) return;
    this.query = inside(folder); this.shown = this.query;
    this.input.set_value(this.query);
    this.at = -1; this.top = 0; this.load(cx);
  }

  /** One folder up when browsing; with a name being typed, back to the folder it is in. */
  up(cx) {
    if (!looksLikePath(this.query)) return;
    const { dir, rest } = this.typed();
    if (rest !== "") { this.enter(dir, cx); return; }
    if (isRoot(dir)) return;
    const cut = dir.lastIndexOf("/");
    if (cut < 0) return;
    this.enter(cut === 0 ? "/" : dir.slice(0, cut), cx);
  }

  // Herdr calls an unnamed space after its repo, so a folder deep inside one would be named
  // after the repo. A space made for such a folder is named after the folder itself; at a repo's
  // top (or outside any repo) it stays unnamed and keeps following where its terminal goes.
  create(folder, cx) {
    if (!folder || this.creating) return;
    this.creating = true;
    const fsFolder = isWin() ? (/^[a-z]:$/i.test(folder) ? folder + "/" : folder).replace(/\//g, "\\") : folder;
    cx.spawn(async () => {
      let name = null;
      try {
        const r = await exec("git", ["rev-parse", "--show-toplevel"], { cwd: fsFolder, timeout: 3000 });
        const top = r.code === 0 ? r.stdout.trim() : "";
        if (top && key(top) !== key(folder)) name = base(folder);
      } catch {}
      run("space.new", { machine: "", folder: fsFolder, ...(name ? { name } : {}) });
      this.done();
    });
  }

  done() { closeOverlay(props().overlay); }

  /** Move the highlight by `by` rows: from nothing, Down starts at the first and Up at the last;
   *  a single step wraps around, a page stops at the ends. */
  move(by, cx) {
    const items = this.items(), n = items.length;
    if (!n || !items[0].folder) return;
    let to;
    if (this.at < 0) to = by > 0 ? 0 : n - 1;
    else if (Math.abs(by) === 1) to = (this.at + by + n) % n;
    else to = Math.max(0, Math.min(n - 1, this.at + by));
    this.select(to, cx);
  }

  key(e, cx) {
    const q = this.input?.value() ?? "", previewing = this.at >= 0 && q === this.shown;
    if (e.key === "down") this.move(1, cx);
    else if (e.key === "up") this.move(-1, cx);
    else if (e.key === "pagedown") this.move(ROWS, cx);
    else if (e.key === "pageup") this.move(-ROWS, cx);
    else if (e.key === "tab" && e.modifiers?.shift) this.up(cx);
    // Tab goes into the highlighted folder, or with none, the first (completing a typed name).
    else if (e.key === "tab") this.enter((this.items()[this.at] ?? this.items().find(it => it.folder))?.folder, cx);
    // Right on a highlighted row (its path is in the field, the caret at its end) goes into it.
    else if (e.key === "right" && previewing) this.enter(this.items()[this.at]?.folder, cx);
    // Backspace right after a slash goes up a whole folder rather than one letter.
    else if (e.key === "backspace" && !previewing && looksLikePath(q) && /[\\/]$/.test(q) && !isRoot(expand(q))) this.up(cx);
    else if (e.key === "escape") { if (previewing) this.unselect(); else { this.done(); return; } }
    else return;
    cx.stop_propagation(); cx.notify();
  }

  render() {
    const t = theme(), lit = t.ansi3, dark = isDark(t.background), rim = dark ? "#ffffff1f" : "#0000001a";
    const soft = dark ? "#ffffff0d" : "#0000000a";
    const items = this.items();
    if (this.at >= items.length || (this.at >= 0 && !items[this.at].folder)) { this.at = -1; this.top = 0; }
    if (this.top > Math.max(0, items.length - ROWS)) this.top = Math.max(0, items.length - ROWS);
    const shown = items.slice(this.top, this.top + ROWS);
    const icon = (name, color) => svg(`mods/workspace-chrome/${name}.svg`).size(15).flex_none().text_color(color);
    const q = this.input?.value() ?? "", target = this.target();
    const rowEl = (it, k) => {
      const i = this.top + k, on = i === this.at;
      if (it.kind === "empty") return h_flex().id(`ns-row-${i}`).h(ROW).flex_none().px(12).items_center().text_size(12.5).text_color(t.dim).child(it.text);
      // A click highlights (and fills the field); a double click goes into the folder.
      return h_flex().id(`ns-row-${i}`).h(ROW).flex_none().px(10).gap(10).items_center().rounded(10).cursor_pointer()
        .when(!on, el => el.hover(s => s.bg(soft)))
        .on_click((e, cx) => { if (e.click_count >= 2) { this.enter(it.folder, cx); cx.notify(); } else this.select(i, cx); })
        .child(icon(isRoot(it.folder) ? "server" : "folder", on ? lit : t.dim))
        .child(v_flex().flex_1().min_w(0)
          .child(div().truncate().text_size(13).font_medium().text_color(t.foreground).child(base(it.folder)))
          .child(div().truncate().text_size(11).text_color(t.dim).child(field(it.folder))))
        .when(on, el => el.child(div().flex_none().text_size(10.5).text_color(t.dim).child("Tab open · ↵ create")));
    };
    const hint = looksLikePath(this.query) ? "⇧Tab up a folder" : !this.index.done ? `Indexing ${this.index.folders.length.toLocaleString()} folders…` : "";

    return v_flex().id("new-space").size_full().rounded(16).overflow_hidden().border_1().border_color(rim).bg(t.background).text_color(t.foreground)
      .track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .child(h_flex().h(48).flex_none().px(18).gap(12).items_center()
        .child(div().flex_1().text_size(14).font_semibold().child("New space"))
        .when(Boolean(hint), el => el.child(div().text_size(11).text_color(t.dim).child(hint)))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(h_flex().h(40).mx(12).mb(12).px(12).gap(8).flex_none().items_center().rounded(10).border_1().border_color(lit + "59").bg(t.surface)
        .child(icon(looksLikePath(q) || !q.trim() ? "folder" : "search", t.dim))
        .child(Input.new(this.input).flex_1().min_w(0).h(36).text_size(13).text_color(t.foreground)))
      .child(div().id("ns-list").relative().h(ROWS * ROW).flex_none().mx(6)
        // The highlight slides to the row under the keys or the click.
        .when(this.at >= 0, el => el.child(div().id("ns-highlight").absolute().left(0).right(0).top((this.at - this.top) * ROW).h(ROW).rounded(10).bg(t.hover).transition("top", SLIDE)))
        .child(v_flex().children(shown.map(rowEl))))
      .child(div().h(12).flex_none())
      .child(h_flex().h(60).flex_none().px(12).gap(10).items_center().border_t(1).border_color(rim)
        // Where Enter or Create would start the space.
        .child(div().flex_1().min_w(0).px(6).truncate().text_size(11.5).text_color(t.dim).child(target ? `Starts in ${show(target)}` : ""))
        .child(h_flex().id("ns-create").h(34).px(16).flex_none().items_center().rounded(10).cursor_pointer()
          .bg(lit + "26").border(1).border_color(lit + "59").text_size(12.5).font_semibold().text_color(lit)
          .hover(s => s.bg(lit + "3d")).active(s => s.opacity(0.75))
          .when(!target, el => el.opacity(0.45))
          .on_click((_e, cx) => this.create(this.target(), cx)).child("Create")));
  }
}
