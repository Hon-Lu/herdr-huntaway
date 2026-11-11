// One file in its own tab: code, rendered Markdown, an image, or a note for
// binary files. Text files can be edited: Cancel restores the file, Save writes it.
import { div, image, svg } from "gpui-kit";
import { v_flex, h_flex, Editor, EditorState, TextView } from "gpui-base";
import { theme, settings, notify } from "herdr";
import { basename, dirname, extname, join, norm } from "./paths.js";
import { readText, writeText, kindOf, cacheImage, dropCached, openDefault, reveal, openUrl } from "./system.js";
import { iconButton, icon } from "./ui.js";

const LANG = { ts: "js", tsx: "js", mts: "js", cts: "js", jsx: "js", mjs: "js", cjs: "js", toml: "yaml", yml: "yaml", jsonc: "json",
  json5: "json", jsonl: "json", svelte: "html", vue: "html", htm: "html", xml: "html", svg: "html", markdown: "md", mdx: "md" };
const NAMED = { dockerfile: "dockerfile", makefile: "make", ".gitignore": "gitignore", ".env": "sh" };

const fail = (title, e) => notify({ title, body: String(e?.message ?? e), level: "error" });

export class Preview {
  constructor() { this.path = null; this.on = null; this.token = 0; }

  get textual() { return this.kind === "text" || this.kind === "markdown"; }
  get canEdit() { return this.textual && !this.on && !this.lossy && typeof this.text === "string"; }
  get dirty() { return Boolean(this.editing && this.state && this.normalize(this.state.value()) !== this.text); }

  release() {
    this.state?.release(); this.state = null;
    if (this.image) { dropCached(this.image); this.image = null; }
  }

  open(path, on, cx) {
    this.release();
    Object.assign(this, { path, on, kind: kindOf(path), text: null, error: null, loading: true, editing: false, stale: false, notice: null, token: this.token + 1 });
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
    this.state.on("change", (_e, cx) => { if (this.editing) cx.notify(); });
  }

  load(cx) {
    const token = this.token, { path, on, kind } = this;
    this.loading = true;
    cx.spawn(async cx => {
      try {
        if (kind === "binary") return;
        if (kind === "image") {
          const rel = await cacheImage(path, on);
          if (token !== this.token) { dropCached(rel); return; }
          const old = this.image; this.image = rel; if (old) dropCached(old);
          return;
        }
        const text = await readText(path, on);
        if (token !== this.token) return;
        if (text === null) { this.error = "This file no longer exists"; return; }
        if (text.includes("\0")) { this.kind = "binary"; return; }
        this.text = text; this.error = null; this.stale = false;
        this.crlf = text.includes("\r\n"); this.bom = text.startsWith("﻿"); this.lossy = text.includes("�");
        this.makeState();
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
    this.editing = true; this.makeState(); cx.notify();
  }

  /** Leaves editing and puts the file's text back. */
  cancel(cx) {
    this.editing = false;
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
        this.text = out; this.editing = false; this.stale = false; this.makeState();
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
    return false;
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
      content = this.image
        ? v_flex().flex_1().min_h(0).p(12).items_center().justify_center().bg(t.surface).child(image(this.image).size_full())
        : note(this.loading ? "Loading image…" : "No preview");
    } else if (this.loading && !this.state) content = note("Loading…");
    else if (this.kind === "markdown" && !this.editing && typeof this.text === "string") {
      content = v_flex().id("pv-markdown").flex_1().min_h(0).overflow_y_scrollbar().px(20).py(14).text_size(13.5).text_color(t.foreground)
        .child(TextView.markdown(`md-${this.token}`, this.text.replace(/^﻿/, "")).selectable(true).on_link_click((url, cx) => this.link(url, cx, openFile)));
    } else if (this.state) content = Editor.new(this.state).flex_1().min_h(0);
    else content = note("No preview");

    return v_flex().flex_1().min_h(0)
      .when(Boolean(this.lossy && !this.error), el => el.child(div().flex_none().px(10).py(4).text_size(11.5).text_color(t.dim).bg(t.surface).border_b(1).border_color(t.border).child("Not UTF-8: shown with replacement characters, read-only")))
      .child(content);
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
