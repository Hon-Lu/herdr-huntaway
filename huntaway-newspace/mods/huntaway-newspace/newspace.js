// The New space dialog: where the new space starts and what runs in it, all inside Herdr.
// It opens empty. Typing searches every folder under home (indexed in the background);
// typing a path, or Tab on a row, browses into that folder, and Backspace goes back up.
// The space starts with a terminal there.
import { div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { run, exec, theme, props, closeOverlay, home } from "herdr";
import { norm, isWin, listDirs, folderIndex, searchFolders } from "./folders.js";

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

export class NewSpace {
  init(cx, handle) {
    this.handle = handle; this.at = 0; this.top = 0;
    this.browse = { dir: null, names: [] };
    // props.query: start with something typed (a path to browse, or words to search).
    this.input = InputState.new({ value: props()?.query ?? "", placeholder: "Search folders, or type a path" });
    this.input.on("change", (_e, cx) => { this.at = 0; this.top = 0; this.load(cx); cx.notify(); });
    this.input.on("submit", (_e, cx) => this.choose(this.items()[this.at], cx));
    this.load(cx);
    this.input.focus();
    cx.timer.after(250, () => this.input?.focus());
    // The index fills in while the dialog is open; results follow it.
    this.index = folderIndex();
    cx.timer.every(300, cx => { if (!this.index.done || !this.indexShown) { this.indexShown = this.index.done; cx.notify(); } });
  }

  close() { this.input?.release(); this.input = null; }

  /** The typed path split into the folder to list and the start of a name to filter by. */
  typed() {
    const q = this.input?.value() ?? "", full = expand(q);
    // Ending in a slash (or a bare drive or ~): list that folder itself.
    if (/^[a-z]:$/i.test(full) || /[\\/]\s*$/.test(q) || q.trim() === "~") return { dir: full, rest: "" };
    const cut = full.lastIndexOf("/");
    return { dir: cut <= 0 ? "/" : full.slice(0, cut), rest: full.slice(cut + 1) };
  }

  /** For a typed path: list its folder (once per folder; typing a name only filters). */
  load(cx) {
    if (!looksLikePath(this.input.value())) return;
    const { dir, rest } = this.typed();
    if (key(dir) === key(this.browse.dir ?? "") && this.browse.names) return;
    const token = (this.token ?? 0) + 1; this.token = token;
    this.browse = { dir, names: null };
    cx.spawn(async cx => {
      const names = await listDirs(dir, { hidden: rest.startsWith(".") });
      if (token !== this.token) return;
      this.browse = { dir, names };
      cx.notify();
    });
  }

  items() {
    const q = this.input?.value() ?? "";
    const row = (f, extra = {}) => ({ kind: "folder", folder: f, ...extra });
    if (looksLikePath(q)) {
      const { dir, rest } = this.typed(), low = rest.toLowerCase();
      const names = key(dir) === key(this.browse.dir ?? "") ? this.browse.names : null;
      const subs = (names ?? []).filter(n => n.toLowerCase().startsWith(low)).map(n => row(join(dir, n)));
      // The folder typed so far comes first when the path ends at it ("C:\Code\" or "~").
      const list = [...(rest === "" ? [row(dir, { here: true })] : []), ...subs];
      if (names === null) list.push({ kind: "empty", text: "Reading…" });
      else if (!subs.length && rest !== "") list.push({ kind: "empty", text: "No folders here" });
      return list;
    }
    if (q.trim()) {
      const found = searchFolders(this.index.folders, q, 80).map(f => row(f));
      return found.length ? found : [{ kind: "empty", text: this.index.done ? "No folders match" : "Searching…" }];
    }
    return []; // empty until something is typed
  }

  choose(item, cx) {
    if (!item || item.kind === "empty") return;
    this.create(item.folder, cx);
  }

  /** Browse into a folder: the field becomes its path, listing what is inside. */
  enter(item, cx) {
    if (!item?.folder) return;
    const p = show(item.folder);
    this.input.set_value(p.endsWith(sep()) ? p : p + sep());
    this.at = 0; this.top = 0; this.load(cx);
  }

  /** One folder up, when browsing. */
  up(cx) {
    const full = expand(this.input.value()).replace(/(.)\/$/, "$1");
    if (isRoot(full)) return;
    const cut = full.lastIndexOf("/");
    if (cut < 0) return;
    const parent = cut === 0 ? "/" : full.slice(0, cut);
    const p = show(parent);
    this.input.set_value(p.endsWith(sep()) ? p : p + sep());
    this.at = 0; this.top = 0; this.load(cx);
  }

  // Herdr calls an unnamed space after its repo, so a folder deep inside one would be named
  // after the repo. A space made for such a folder is named after the folder itself; at a repo's
  // top (or outside any repo) it stays unnamed and keeps following where its terminal goes.
  create(folder, cx) {
    if (this.creating) return;
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

  move(to) {
    const n = this.items().length;
    if (!n) return;
    this.at = (to + n) % n;
    if (this.at < this.top) this.top = this.at;
    if (this.at >= this.top + ROWS) this.top = this.at - ROWS + 1;
  }

  key(e, cx) {
    const items = this.items(), q = this.input?.value() ?? "";
    if (e.key === "down") this.move(this.at + 1);
    else if (e.key === "up") this.move(this.at - 1);
    else if (e.key === "pagedown") this.move(Math.min(items.length - 1, this.at + ROWS));
    else if (e.key === "pageup") this.move(Math.max(0, this.at - ROWS));
    else if (e.key === "tab") this.enter(items[this.at], cx);
    // Backspace right after a slash goes up a whole folder rather than one letter.
    else if (e.key === "backspace" && looksLikePath(q) && /[\\/]$/.test(q) && !isRoot(expand(q))) this.up(cx);
    else if (e.key === "escape") { this.done(); return; }
    else return;
    cx.stop_propagation(); cx.notify();
  }

  render() {
    const t = theme(), lit = t.ansi3, dark = isDark(t.background), rim = dark ? "#ffffff1f" : "#0000001a";
    const items = this.items();
    if (this.at >= items.length) { this.at = 0; this.top = 0; }
    const shown = items.slice(this.top, this.top + ROWS);
    const icon = (name, color) => svg(`mods/workspace-chrome/${name}.svg`).size(15).flex_none().text_color(color);
    const q = this.input?.value() ?? "";
    const rowEl = (it, k) => {
      const i = this.top + k, on = i === this.at;
      if (it.kind === "empty") return h_flex().id(`ns-row-${i}`).h(ROW).flex_none().px(12).items_center().text_size(12.5).text_color(t.dim).child(it.text);
      return h_flex().id(`ns-row-${i}`).h(ROW).flex_none().px(10).gap(10).items_center().rounded(10).cursor_pointer()
        .on_mouse_move((_e, cx) => { if (this.at !== i) { this.at = i; cx.notify(); } })
        .on_click((_e, cx) => this.choose(it, cx))
        .active(s => s.opacity(0.8))
        .child(icon(isRoot(it.folder) ? "server" : "folder", on ? lit : t.dim))
        .child(v_flex().flex_1().min_w(0)
          .child(div().truncate().text_size(13).font_medium().text_color(t.foreground).child(it.here ? "Use this folder" : base(it.folder)))
          .child(div().truncate().text_size(11).text_color(t.dim).child(show(it.folder))))
        .when(on, el => el.child(div().flex_none().text_size(10.5).text_color(t.dim).child("Tab open · ↵ create")));
    };
    const hint = looksLikePath(q) ? "⌫ up a folder" : !this.index.done ? `Indexing ${this.index.folders.length.toLocaleString()} folders…` : "";

    return v_flex().id("new-space").size_full().rounded(16).overflow_hidden().border_1().border_color(rim).bg(t.background).text_color(t.foreground)
      .track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .child(h_flex().h(48).flex_none().px(18).gap(12).items_center()
        .child(div().flex_1().text_size(14).font_semibold().child("New space"))
        .when(Boolean(hint), el => el.child(div().text_size(11).text_color(t.dim).child(hint)))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(h_flex().h(40).mx(12).mb(12).px(12).gap(8).flex_none().items_center().rounded(10).border_1().border_color(lit + "59").bg(t.surface)
        .child(icon(looksLikePath(q) ? "folder" : "search", t.dim))
        .child(Input.new(this.input).flex_1().min_w(0).h(36).text_size(13).text_color(t.foreground)))
      .child(div().id("ns-list").relative().h(ROWS * ROW).flex_none().mx(6)
        // The highlight slides to the row under the keys or the pointer.
        .when(items[this.at] && items[this.at].kind !== "empty", el => el.child(div().id("ns-highlight").absolute().left(0).right(0).top((this.at - this.top) * ROW).h(ROW).rounded(10).bg(t.hover).transition("top", SLIDE)))
        .child(v_flex().children(shown.map(rowEl)))
        // Nothing typed: a quiet hint, nothing else.
        .when(!q.trim(), el => el.child(v_flex().absolute().top(0).left(0).right(0).bottom(0).items_center().justify_center().gap(6).text_color(t.dim)
          .child(div().text_size(12.5).child("Type a folder name to search"))
          .child(div().text_size(11.5).child(isWin() ? "or start with ~\\ or C:\\ to browse" : "or start with ~/ or / to browse")))))
      .child(div().h(12).flex_none())
      .child(h_flex().h(60).flex_none().px(12).gap(10).items_center().border_t(1).border_color(rim)
        .child(div().flex_1())
        .child(h_flex().id("ns-create").h(34).px(16).flex_none().items_center().rounded(10).cursor_pointer()
          .bg(lit + "26").border(1).border_color(lit + "59").text_size(12.5).font_semibold().text_color(lit)
          .hover(s => s.bg(lit + "3d")).active(s => s.opacity(0.75))
          .when(!items[this.at] || items[this.at].kind === "empty", el => el.opacity(0.45))
          .on_click((_e, cx) => this.choose(items[this.at], cx)).child("Create")));
  }
}
