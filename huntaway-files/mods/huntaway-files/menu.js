// The right-click menu and the name / delete dialogs. Both open as overlays
// of this same mod and report back to the panel through shared state.
import { div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { props, theme, closeOverlay, openOverlay, setShared, notify, window as appWindow } from "herdr";
import { join, dirname, basename, display, relative, validName, isWindows } from "./paths.js";
import { createFile, createFolder, rename, remove, reveal } from "./system.js";
import { openInTab } from "./open.js";
import { MOD, REQUEST } from "./ui.js";

const tell = request => setShared(REQUEST, { ...request, n: `${Date.now()}-${Math.random()}` });
const fail = (title, e) => notify({ title, body: String(e?.message ?? e), level: "error" });

function items(target) {
  const local = !target.on, platform = appWindow().platform;
  const revealLabel = platform === "macos" ? "Reveal in Finder" : platform === "windows" ? "Show in File Explorer" : "Show in file manager";
  const list = [];
  if (!target.dir) list.push({ id: "open", label: "Open" });
  if (!target.dir && local) list.push({ id: "default", label: "Open with its app" });
  if (target.dir) list.push({ id: "new-file", label: "New file…" }, { id: "new-folder", label: "New folder…" });
  list.push({ id: "insert", label: "Insert into terminal", hint: platform === "macos" ? "⌥ Click" : "Alt+Click" });
  if (local) list.push({ id: "reveal", label: revealLabel });
  list.push({ id: "copy", label: "Copy path", group: true });
  if (!target.isRoot) list.push({ id: "copy-rel", label: "Copy relative path" });
  if (!target.isRoot) list.push({ id: "rename", label: "Rename…", group: true }, { id: "delete", label: "Delete…", danger: true });
  return list;
}

/** The popup's height for a target, so it fits its items exactly. */
export function menuHeight(target) {
  const list = items(target);
  return 10 + list.length * 28 + list.filter(i => i.group).length * 9;
}

export class Menu {
  init(cx, handle) {
    this.handle = handle; this.target = props().target; this.items = items(this.target); this.at = -1;
    handle.focus();
  }

  choose(item, cx) {
    const t = this.target, overlay = props().overlay;
    const dialog = action => { closeOverlay(overlay); openOverlay({ mod: MOD, kind: "dialog", width: 400, height: action === "delete" ? 176 : 186, props: { role: "dialog", action, target: t } }); };
    switch (item.id) {
      case "open": cx.spawn(async cx => { await openInTab(t.path, t.on, cx); }); break;
      // The panel opens it: on Windows that waits on cmd first, and this menu closes at once.
      case "default": tell({ action: "open-default", path: t.path, on: t.on }); break;
      case "reveal": reveal(t.path, t.on).catch(e => fail("Could not show the file", e)); break;
      // The panel inserts it: this menu closes now, and the clipboard is put back a moment later.
      case "insert": tell({ action: "insert", path: t.path, on: t.on }); break;
      case "copy": cx.write_to_clipboard(display(t.path, t.on)); break;
      case "copy-rel": cx.write_to_clipboard(display(relative(t.root, t.path, t.on), t.on)); break;
      case "new-file": case "new-folder": case "rename": case "delete": dialog(item.id); return;
    }
    closeOverlay(overlay);
  }

  key(e, cx) {
    const n = this.items.length;
    if (e.key === "down") this.at = (this.at + 1) % n;
    else if (e.key === "up") this.at = (this.at - 1 + n) % n;
    else if (e.key === "enter" && this.at >= 0) { this.choose(this.items[this.at], cx); return; }
    else if (e.key === "escape") { closeOverlay(props().overlay); return; }
    else return;
    cx.stop_propagation(); cx.notify();
  }

  render() {
    const t = theme();
    return v_flex().id("hlf-menu").size_full().p(5).bg(t.popover).text_size(12.5).text_color(t.foreground)
      .track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .children(this.items.flatMap((item, i) => [
        ...(item.group && i > 0 ? [div().h(1).mx(6).my(4).bg(t.border)] : []),
        h_flex().id(`hlf-menu-${item.id}`).h(28).px(9).items_center().rounded(6).cursor_pointer()
          .when(i === this.at, el => el.bg(t.hover)).hover(s => s.bg(t.hover))
          .text_color(item.danger ? t.ansi1 : t.foreground)
          .on_click((_e, cx) => this.choose(item, cx))
          .child(div().flex_1().truncate().child(item.label))
          // The same thing without the menu, dim on the right.
          .when(Boolean(item.hint), el => el.child(div().flex_none().pl(8).text_size(11).text_color(t.dim).child(item.hint))),
      ]));
  }
}

const TITLES = { "new-file": "New file", "new-folder": "New folder", rename: "Rename", delete: "Delete" };

export class Dialog {
  init(cx, handle) {
    const p = props();
    this.handle = handle; this.action = p.action; this.target = p.target; this.error = null; this.busy = false;
    if (this.action !== "delete") {
      const value = this.action === "rename" ? basename(this.target.path) : "";
      this.input = InputState.new({ value, placeholder: this.action === "new-folder" ? "Folder name" : "File name" });
      if (value) {
        const dot = this.target.dir ? -1 : value.lastIndexOf(".");
        this.input.set_selected_range({ start: 0, end: dot > 0 ? dot : value.length });
      }
      this.input.on("change", (_e, cx) => { this.error = null; cx.notify(); });
      this.input.on("submit", (_e, cx) => this.submit(cx));
      this.input.focus();
      cx.timer.after(300, () => this.input?.focus());
    } else handle.focus();
  }

  folder() { return this.target.dir ? this.target.path : dirname(this.target.path); }

  submit(cx) {
    if (this.busy) return;
    const t = this.target, overlay = props().overlay;
    let dest = null;
    if (this.input) {
      const name = this.input.value().trim();
      this.error = validName(name);
      if (this.error) { cx.notify(); return; }
      dest = this.action === "rename" ? join(dirname(t.path), name) : join(this.folder(), name);
      if (this.action === "rename" && dest === t.path) { closeOverlay(overlay); return; }
    }
    this.busy = true; cx.notify();
    cx.spawn(async cx => {
      try {
        if (this.action === "new-file") {
          await createFile(dest, t.on);
          tell({ action: "changed", root: t.root, on: t.on, dirs: [this.folder()], expand: this.folder(), select: dest });
          await openInTab(dest, t.on, cx);
        } else if (this.action === "new-folder") {
          await createFolder(dest, t.on);
          tell({ action: "changed", root: t.root, on: t.on, dirs: [this.folder()], expand: this.folder(), select: dest });
        } else if (this.action === "rename") {
          await rename(t.path, dest, t.on);
          tell({ action: "changed", root: t.root, on: t.on, dirs: [dirname(t.path)], removed: t.dir ? t.path : null, select: dest });
        } else if (this.action === "delete") {
          const how = await remove(t.path, t.dir, t.on);
          tell({ action: "changed", root: t.root, on: t.on, dirs: [dirname(t.path)], removed: t.path });
          notify({ title: how === "trash" ? (isWindows() ? "Moved to the Recycle Bin" : "Moved to the Trash") : "Deleted", body: basename(t.path), level: "success", timeout: 2500 });
        }
        closeOverlay(overlay);
      } catch (e) {
        this.error = String(e?.message ?? e); this.busy = false; cx.notify();
      }
    });
  }

  render() {
    const t = theme(), local = !this.target.on, del = this.action === "delete";
    const button = (id, text, primary, action) => h_flex().id(id).h(30).px(14).items_center().rounded(8)
      .border_1().border_color(primary ? (del ? t.ansi1 : t.solid) : t.input)
      .bg(primary ? (del ? t.ansi1 : t.solid) : t.raised)
      .text_color(primary ? t.solid_foreground : t.foreground).text_size(12.5).font_medium().cursor_pointer()
      .when(this.busy && primary, el => el.opacity(0.6)).hover(s => s.opacity(0.88)).on_click(action).child(text);
    const where = display(this.action === "rename" || del ? dirname(this.target.path) : this.folder(), this.target.on);
    const what = del
      ? (local ? `${basename(this.target.path)} will be moved to the ${isWindows() ? "Recycle Bin" : "Trash"}.` : `${basename(this.target.path)} will be deleted permanently${this.target.dir ? ", with everything in it" : ""}.`)
      : null;
    return v_flex().id("hlf-dialog").size_full().p(18).bg(t.popover).text_color(t.foreground)
      .track_focus(this.handle).on_key_down((e, cx) => {
        if (e.key === "escape") closeOverlay(props().overlay);
        else if (e.key === "enter" && del) this.submit(cx);
        else return;
        cx.stop_propagation();
      })
      .child(h_flex().items_center().child(div().flex_1().text_size(15).font_semibold().child(TITLES[this.action] + (del && this.target.dir ? " folder" : "")))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(div().pt(4).text_size(11.5).text_color(t.dim).truncate().child(where))
      .when(Boolean(this.input), el => el.child(Input.new(this.input).mt(14).h(34).px(10).rounded(8).border_1().border_color(this.error ? t.ansi1 : t.accent).bg(t.background).text_size(13)))
      .when(Boolean(what), el => el.child(div().pt(14).text_size(13).child(what)))
      .child(div().h(18).pt(4).text_size(11.5).text_color(t.ansi1).truncate().child(this.error ?? ""))
      .child(div().flex_1())
      .child(h_flex().gap(8).justify_end()
        .child(button("hlf-cancel", "Cancel", false, () => closeOverlay(props().overlay)))
        .child(button("hlf-ok", del ? (local ? "Move" : "Delete") : this.action === "rename" ? "Rename" : "Create", true, (_e, cx) => this.submit(cx))));
  }

  close() { this.input?.release(); }
}
