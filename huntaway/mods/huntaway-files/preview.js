// One file in its own tab: code, rendered Markdown, an image, or a note for
// binary files. Text files can be edited: Cancel restores the file, Save writes it.
// Markdown shows as Preview (rendered), Split (source beside the live result) or Code.
import { div, image, svg } from "gpui-kit";
import { v_flex, h_flex, Editor, EditorState, TextView } from "gpui-base";
import { theme, settings, notify } from "herdr";
import { basename, dirname, extname, join, norm } from "./paths.js";
import { readText, writeText, kindOf, cacheImage, cacheMarkdownImages, cachedImageSize, dropCached, openDefault, reveal, openUrl } from "./system.js";
import { parseMarkdown, imageSources } from "./markdown.js";
import { iconButton, icon } from "./ui.js";

const LANG = { ts: "js", tsx: "js", mts: "js", cts: "js", jsx: "js", mjs: "js", cjs: "js", toml: "yaml", yml: "yaml", jsonc: "json",
  json5: "json", jsonl: "json", svelte: "html", vue: "html", htm: "html", xml: "html", svg: "html", markdown: "md", mdx: "md" };
const NAMED = { dockerfile: "dockerfile", makefile: "make", ".gitignore": "gitignore", ".env": "sh" };

const MD_VIEWS = ["preview", "split", "code"];
const MD_LABEL = { preview: "Preview", split: "Split", code: "Code" };
const SEG = 62, INSET = 2;
// Image zoom steps; null means fit to the tab.
const ZOOMS = [0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6, 8];

const darkTheme = () => { const m = /^#(..)(..)(..)/i.exec(theme().background ?? ""); return !m || parseInt(m[1], 16) + parseInt(m[2], 16) + parseInt(m[3], 16) < 384; };
const fail = (title, e) => notify({ title, body: String(e?.message ?? e), level: "error" });

export class Preview {
  constructor() {
    this.path = null; this.on = null; this.token = 0; this.rev = 0;
    try { this.mdView = MD_VIEWS.includes(localStorage.getItem("mdView")) ? localStorage.getItem("mdView") : "preview"; } catch { this.mdView = "preview"; }
  }

  get textual() { return this.kind === "text" || this.kind === "markdown"; }
  get canEdit() { return this.textual && !this.on && !this.lossy && typeof this.text === "string"; }
  get dirty() { return Boolean(this.editing && this.state && this.normalize(this.state.value()) !== this.text); }

  release() {
    this.state?.release(); this.state = null;
    if (this.image) { dropCached(this.image); this.image = null; }
    for (const img of this.mdImages?.values() ?? []) if (img.rel) dropCached(img.rel);
    this.mdImages = new Map();
  }

  /** Loads the images a Markdown file shows (once each, all new ones in one batch), then redraws. */
  loadImages(blocks, cx) {
    this.mdImages ??= new Map();
    const fresh = imageSources(blocks).filter(src => !this.mdImages.has(src));
    if (!fresh.length) return;
    const token = this.token, dir = dirname(this.path);
    for (const src of fresh) this.mdImages.set(src, { state: "loading" });
    cx.spawn(async cx => {
      let found = new Map();
      try { found = await cacheMarkdownImages(fresh, dir, this.on, darkTheme()); } catch {}
      if (token !== this.token) { for (const r of found.values()) if (r.rel) dropCached(r.rel); return; }
      for (const src of fresh) {
        const r = found.get(src) ?? { error: "Could not load the image" };
        this.mdImages.set(src, r.rel ? { state: "ok", rel: r.rel, size: r.size } : { state: "error", error: r.error });
      }
      cx.notify();
    });
  }


  open(path, on, cx) {
    this.release();
    Object.assign(this, { path, on, zoom: null, imageSize: null, kind: kindOf(path), text: null, error: null, loading: true, editing: false, stale: false, notice: null, token: this.token + 1 });
    this.load(cx);
  }

  close() { this.release(); this.path = null; }

  /** Keeps the file's line endings and BOM when saving editor text. */
  normalize(value) {
    let out = value;
    if (this.crlf && !out.includes("\r\n")) out = out.replace(/\n/g, "\r\n");
    if (this.bom && !out.startsWith("﻿")) out = "﻿" + out;
    return out;
  }

  makeState() {
    this.state?.release(); this.state = null;
    if (typeof this.text !== "string") return;
    const t = theme(), ext = extname(this.path), name = basename(this.path).toLowerCase();
    this.state = EditorState.new({
      language: NAMED[name] ?? LANG[ext] ?? (ext || "txt"), value: this.text, readonly: !this.editing, soft_wrap: false,
      font_family: settings().font_family, font_size: 12.5,
      syntax: { keyword: t.ansi5, string: t.ansi2, comment: t.dim, function: t.ansi4, type: t.ansi3, number: t.ansi1, constant: t.ansi6, boolean: t.ansi6 },
    });
    this.state.on("change", (_e, cx) => {
      if (!this.editing) return;
      this.rev++;
      if (this.kind === "markdown") this.loadImages(parseMarkdown(this.state.value()), cx);
      cx.notify();
    });
  }

  load(cx) {
    const token = this.token, { path, on, kind } = this;
    this.loading = true;
    cx.spawn(async cx => {
      try {
        if (kind === "binary") return;
        if (kind === "image") {
          const rel = await cacheImage(path, on, darkTheme());
          if (token !== this.token) { dropCached(rel); return; }
          const old = this.image; this.image = rel; if (old) dropCached(old);
          this.imageSize = await cachedImageSize(rel);
          return;
        }
        const text = await readText(path, on);
        if (token !== this.token) return;
        if (text === null) { this.error = "This file no longer exists"; return; }
        if (text.includes("\0")) { this.kind = "binary"; return; }
        this.text = text; this.error = null; this.stale = false;
        this.crlf = text.includes("\r\n"); this.bom = text.startsWith("﻿"); this.lossy = text.includes("�");
        this.makeState();
        if (this.kind === "markdown") this.loadImages(parseMarkdown(text), cx);
      } catch (e) {
        if (token === this.token) this.error = String(e?.message ?? e);
      } finally {
        if (token === this.token) { this.loading = false; cx.notify(); }
      }
    });
  }

  /** The file changed on disk: reload, unless the person is editing it. */
  changed(cx) {
    if (!this.path || this.loading) return;
    if (this.editing) { this.stale = true; cx.notify(); return; }
    this.load(cx);
  }

  edit(cx) {
    if (!this.canEdit) return;
    // Editing Markdown from the preview shows the source beside it, and goes back after.
    if (this.kind === "markdown" && this.mdView === "preview") { this.viewBeforeEdit = "preview"; this.mdView = "split"; }
    this.editing = true; this.makeState(); cx.notify();
  }

  leaveEdit() {
    this.editing = false;
    if (this.viewBeforeEdit) { this.mdView = this.viewBeforeEdit; this.viewBeforeEdit = null; }
  }

  /** Markdown's view: Preview, Split or Code, remembered for the next file. */
  view(v, cx) {
    this.mdView = v; this.viewBeforeEdit = null;
    try { localStorage.setItem("mdView", v); } catch {}
    cx.notify();
  }

  /** Leaves editing and puts the file's text back. */
  cancel(cx) {
    this.leaveEdit();
    if (this.stale) this.load(cx); else this.makeState();
    cx.notify();
  }

  save(cx) {
    if (!this.editing || !this.state || this.saving) return;
    const out = this.normalize(this.state.value()), token = this.token;
    if (out === this.text) { this.cancel(cx); return; }
    this.saving = true; cx.notify();
    cx.spawn(async cx => {
      try {
        await writeText(this.path, out, this.text);
        if (token !== this.token) return;
        this.text = out; this.leaveEdit(); this.stale = false; this.makeState();
        this.notice = "Saved";
        cx.timer.after(1500, cx => { if (this.notice === "Saved") { this.notice = null; cx.notify(); } });
      } catch (e) {
        const m = String(e?.message ?? e);
        if (/stale|expected|changed|match/i.test(m)) { this.stale = true; notify({ title: "Not saved: the file changed on disk", body: "Cancel to load the new version, then edit again.", level: "warning" }); }
        else fail("Could not save", e);
      } finally { this.saving = false; cx.notify(); }
    });
  }

  link(url, cx, openFile) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(url) && !/^file:/i.test(url)) { openUrl(url).catch(() => {}); return; }
    let target = decodeURIComponent(url.replace(/^file:\/\/\/?/i, "").replace(/[#?].*$/, ""));
    if (!target) return;
    target = /^([a-z]:)?[\\/]/i.test(target) ? norm(target) : norm(join(dirname(this.path), target));
    const parts = [];
    for (const part of target.split("/")) { if (part === "..") parts.pop(); else if (part !== ".") parts.push(part); }
    openFile(parts.join("/") || target, this.on, cx);
  }

  key(e, cx) {
    if ((e.keystroke === "cmd-s" || e.keystroke === "ctrl-s") && this.editing) { this.save(cx); return true; }
    if (this.kind === "image" && this.image) {
      const k = e.keystroke.replace(/^cmd-/, "ctrl-");
      if (k === "ctrl-=" || k === "ctrl-+" || k === "ctrl-shift-=") { this.zoomStep(1, cx); return true; }
      if (k === "ctrl--") { this.zoomStep(-1, cx); return true; }
      if (k === "ctrl-0") { this.zoom = null; cx.notify(); return true; }
      if (k === "ctrl-1") { this.zoom = 1; cx.notify(); return true; }
    }
    return false;
  }

  /** The image's scale now: the chosen zoom, or what fitting it in the tab comes to (never above 1). */
  scale() {
    if (this.zoom) return this.zoom;
    const n = this.imageSize, box = this.imageBox;
    if (!n || !box) return 1;
    return Math.min(1, (box.w - 24) / n.w, (box.h - 24) / n.h);
  }

  /** One zoom step in (dir 1) or out (-1), from wherever the image is now. */
  zoomStep(dir, cx) {
    const now = this.scale();
    this.zoom = dir > 0 ? ZOOMS.find(z => z > now + 0.001) ?? ZOOMS[ZOOMS.length - 1] : [...ZOOMS].reverse().find(z => z < now - 0.001) ?? ZOOMS[0];
    cx.notify();
  }

  /** For an image: zoom out, the scale (click: fit or 100%), zoom in. */
  zoomControls(t) {
    if (this.kind !== "image" || !this.image || !this.imageSize) return null;
    const btn = (id, label, tip, action) => h_flex().id(id).size(24).flex_none().items_center().justify_center().rounded(6).cursor_pointer()
      .text_size(14).text_color(t.muted).hover(s => s.bg(t.hover).text_color(t.foreground)).active(s => s.opacity(0.7))
      .tooltip(tip).on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click(action).child(label);
    return h_flex().id("pv-zoom").h(26).px(2).gap(2).flex_none().items_center().rounded(8).bg(t.surface).border_1().border_color(t.border)
      .child(btn("pv-zoom-out", "−", "Zoom out (Ctrl+-)", (_e, cx) => this.zoomStep(-1, cx)))
      .child(h_flex().id("pv-zoom-level").h(22).w(52).flex_none().items_center().justify_center().rounded(6).cursor_pointer()
        .text_size(11.5).text_color(this.zoom ? t.foreground : t.muted).hover(s => s.bg(t.hover))
        .tooltip(this.zoom ? "Fit to the tab (Ctrl+0)" : "Actual size (Ctrl+1)")
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click((_e, cx) => { this.zoom = this.zoom ? null : 1; cx.notify(); })
        .child(this.zoom ? `${Math.round(this.zoom * 100)}%` : `Fit ${Math.round(this.scale() * 100)}%`))
      .child(btn("pv-zoom-in", "+", "Zoom in (Ctrl++)", (_e, cx) => this.zoomStep(1, cx)));
  }

  /** For Markdown: the Preview / Split / Code switch; its selection slides like the tab bar's. */
  modes(t) {
    if (this.kind !== "markdown" || typeof this.text !== "string" || this.error) return null;
    const at = MD_VIEWS.indexOf(this.mdView), lit = t.ansi3;
    return h_flex().id("pv-modes").relative().h(26).p(INSET).flex_none().items_center().rounded(8).bg(t.surface).border_1().border_color(t.border)
      .child(div().id("pv-modes-selection").absolute().top(INSET).bottom(INSET).left(INSET + at * SEG).w(SEG).rounded(6)
        .bg(t.raised).border(1).border_color(lit + "59").transition("left", { duration: 160, easing: "ease-out" }))
      .children(MD_VIEWS.map((v, i) => h_flex().id(`pv-mode-${v}`).h_full().w(SEG).flex_none().items_center().justify_center().rounded(6).cursor_pointer()
        .text_size(11.5).text_color(i === at ? lit : t.muted).when(i === at, el => el.font_medium())
        .when(i !== at, el => el.hover(s => s.text_color(t.foreground))).active(s => s.opacity(0.75))
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click((_e, cx) => this.view(v, cx)).child(MD_LABEL[v])));
  }

  /** Header buttons. Editing: Cancel and Save only, in the places of Edit and Open with its app. */
  tools(t) {
    if (this.editing) {
      const ready = this.dirty && !this.saving;
      return [
        iconButton("pv-cancel", "pencil-off", "Cancel editing (discards changes)", (_e, cx) => this.cancel(cx), t, true),
        h_flex().id("pv-save").size(24).flex_none().items_center().justify_center().rounded(6).cursor_pointer()
          .when(ready, el => el.bg(t.accent + "26")).hover(s => s.bg(ready ? t.accent + "40" : t.hover)).active(s => s.opacity(0.7))
          .tooltip(this.dirty ? "Save (Ctrl+S)" : "Save (Ctrl+S): no changes yet").on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .on_click((_e, cx) => this.save(cx))
          .child(this.saving ? svg(icon("spinner")).size(14).text_color(t.muted).spin(800)
            : svg(icon("save")).size(14).text_color(ready ? t.accent : t.dim)),
      ];
    }
    const out = [];
    if (this.canEdit) out.push(iconButton("pv-edit", "pencil", "Edit", (_e, cx) => this.edit(cx), t));
    if (!this.on) out.push(iconButton("pv-open", "external", "Open with its app", () => openDefault(this.path, this.on).catch(e => fail("Could not open", e)), t));
    return out;
  }

  body(t, openFile) {
    if (!this.path) return div();
    const note = (text, extra) => v_flex().flex_1().min_h(0).items_center().justify_center().gap(10).p(20).text_color(t.dim).text_size(12.5)
      .child(div().text_center().child(text)).when(Boolean(extra), el => el.child(extra));
    const buttons = this.on ? null : h_flex().gap(8).text_size(12)
      .child(h_flex().id("pv-ext").px(10).h(26).items_center().rounded(6).bg(t.raised).hover(s => s.bg(t.hover)).cursor_pointer()
        .on_click(() => openDefault(this.path, this.on).catch(e => fail("Could not open", e))).child("Open with its app"))
      .child(h_flex().id("pv-reveal").px(10).h(26).items_center().rounded(6).bg(t.raised).hover(s => s.bg(t.hover)).cursor_pointer()
        .on_click(() => reveal(this.path, this.on).catch(() => {})).child("Show in folder"));

    let content;
    if (this.error) content = note(this.error, buttons);
    else if (this.kind === "binary") content = note("Binary file — no preview", buttons);
    else if (this.kind === "image") {
      if (!this.image) content = note(this.loading ? "Loading image…" : "No preview");
      else {
        // Fit: the whole image in the tab. Zoomed: its size times the zoom, scrolling both ways.
        // Ctrl (Cmd) and the wheel zoom too.
        const n = this.imageSize, s = this.scale();
        const pic = n ? image(this.image).w(n.w * s).h(n.h * s).flex_none() : image(this.image).size_full();
        content = div().id("pv-image").flex_1().min_h(0).bg(t.surface)
          .when(Boolean(this.zoom), el => el.overflow_scrollbar())
          .on_size_change((sz, cx) => { const w = Math.round(sz.width), h = Math.round(sz.height); if (w !== this.imageBox?.w || h !== this.imageBox?.h) { this.imageBox = { w, h }; cx.notify(); } })
          .on_scroll_wheel((e, cx) => { if ((e.modifiers?.control || e.modifiers?.platform) && Math.abs(e.delta.y) >= 1) { this.zoomStep(e.delta.y > 0 ? 1 : -1, cx); cx.stop_propagation(); } })
          .child(h_flex().min_w_full().min_h_full().p(12).items_center().justify_center().child(pic));
      }
    } else if (this.loading && !this.state) content = note("Loading…");
    else if (this.kind === "markdown" && typeof this.text === "string" && this.mdView !== "code" && (this.mdView === "preview" || Boolean(this.state))) {
      // While editing, the rendered side follows the editor as you type.
      const source = (this.editing && this.state ? this.state.value() : this.text).replace(/^﻿/, "");
      const rendered = v_flex().id("pv-markdown").flex_1().min_w(0).min_h(0).overflow_y_scrollbar().px(20).py(14).gap(6).text_size(13.5).text_color(t.foreground)
        .on_size_change((sz, cx) => { const w = Math.round(sz.width); if (Math.abs(w - (this.mdWidth ?? 0)) > 4) { this.mdWidth = w; cx.notify(); } })
        .children(this.markdownBlocks(t, source, openFile));
      content = this.mdView === "split"
        ? h_flex().flex_1().min_h(0).child(Editor.new(this.state).flex_1().min_w(0).min_h(0)).child(div().w(1).h_full().flex_none().bg(t.border)).child(rendered)
        : rendered;
    } else if (this.state) content = Editor.new(this.state).flex_1().min_h(0);
    else content = note("No preview");

    return v_flex().flex_1().min_h(0)
      .when(Boolean(this.lossy && !this.error), el => el.child(div().flex_none().px(10).py(4).text_size(11.5).text_color(t.dim).bg(t.surface).border_b(1).border_color(t.border).child("Not UTF-8: shown with replacement characters, read-only")))
      .child(content);
  }

  /** Markdown drawn block by block: text by TextView, images and image tables by this file tab. */
  markdownBlocks(t, source, openFile) {
    const avail = Math.max(120, (this.mdWidth ?? 900) - 40), id = `md-${this.token}-${this.editing ? this.rev : 0}`;
    const onLink = (url, cx) => this.link(url, cx, openFile);
    // One image, as wide as it is (or as its width attribute says), never wider than `max`.
    const img = (it, max, k) => {
      const e = this.mdImages?.get(it.src);
      const box = (text, w) => div().w(Math.min(max, w)).h(28).flex().items_center().px(8).rounded(6).border_1().border_color(t.border)
        .text_size(11.5).text_color(t.dim).truncate().child(text);
      if (!e || e.state === "loading") return box("Loading image…", 200);
      if (e.state === "error" || !e.rel) return box(`Image not shown: ${it.alt || it.src}`, 260).id(`${id}-bad-${k}`).tooltip(e.error ?? it.src);
      const nat = e.size ?? { w: 320, h: 180 };
      const want = it.width ?? nat.w, w = Math.max(8, Math.min(want, max)), h = w * nat.h / nat.w;
      const el = image(e.rel).w(w).h(h).flex_none().rounded(4);
      return it.href
        ? div().id(`${id}-img-${k}`).flex_none().cursor_pointer().hover(s => s.opacity(0.85)).on_click((_e, cx) => onLink(it.href, cx)).child(el)
        : el;
    };
    // A row shares the width: everything shrinks together when the row is too wide.
    const row = (items, max, k) => {
      const widths = items.map(it => { const e = this.mdImages?.get(it.src); return it.width ?? e?.size?.w ?? 200; });
      const total = widths.reduce((a, b) => a + b, 0) + (items.length - 1) * 8;
      const scale = total > max ? max / total : 1;
      return items.map((it, j) => img(it, Math.max(24, widths[j] * scale), `${k}-${j}`));
    };
    return parseMarkdown(source).map((b, i) => {
      if (b.kind === "md") return TextView.markdown(`${id}-${i}`, b.text).selectable(true).on_link_click(onLink);
      if (b.kind === "html") {
        const view = TextView.html(`${id}-${i}`, b.html).selectable(true).on_link_click(onLink);
        // Centered, but never wider than the column, so long lines wrap instead of running off.
        return b.center ? h_flex().w_full().min_w(0).justify_center().child(view.max_w_full().min_w(0)) : view;
      }
      if (b.kind === "images") return h_flex().w_full().flex_wrap().gap(8).items_center().py(4).when(b.center, el => el.justify_center()).children(row(b.items, avail, i));
      // A table with images: a grid of equal columns, each image fitted to its cell.
      const cols = Math.max(b.head.length, ...b.rows.map(r => r.length)), cellW = avail / cols - 17;
      const cellEl = (c, k, head) => v_flex().flex_1().min_w(0).p(8).gap(6).items_center().border_r(1).border_color(t.border)
        .when(Boolean(c?.text), el => el.child(head ? div().text_size(12.5).font_semibold().child(c.text) : TextView.markdown(`${id}-${k}`, c.text).on_link_click(onLink)))
        .children(row(c?.items ?? [], cellW, k));
      const line = (r, k, head) => h_flex().w_full().items_start().border_b(1).border_color(t.border).when(head, el => el.bg(t.surface))
        .children(Array.from({ length: cols }, (_x, j) => cellEl(r[j], `${k}-${j}`, head)));
      return v_flex().w_full().my(6).rounded(6).overflow_hidden().border_1().border_color(t.border)
        .when(b.head.some(c => c.text || c.items.length), el => el.child(line(b.head, `${i}-h`, true)))
        .children(b.rows.map((r, k) => line(r, `${i}-${k}`, false)));
    });
  }

  /** A short status beside the file name. */
  status() {
    if (this.saving) return "Saving…";
    if (this.notice) return this.notice;
    if (this.editing && this.stale) return "Changed on disk";
    if (this.editing) return this.dirty ? "Editing · unsaved changes" : "Editing";
    return "";
  }
}
