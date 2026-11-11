// huntaway-files: a file browser for the Files panel, plus the tab a file
// opens in, the right-click menu and dialogs (one mod, chosen by props().role).
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { props, theme, nextCommand, watchFolder, layout } from "herdr";
import { Panel } from "./panel.js";
import { Menu, Dialog } from "./menu.js";
import { Preview } from "./preview.js";
import { openInTab } from "./open.js";
import { basename, dirname, display, friendly, norm } from "./paths.js";

/** A file in its own tab. */
// The huntaway pane header already names a file tab after its file.
function paneHeaderMod(node) {
  if (!node) return null;
  if (node.content?.tab && node.content.pane) return node.content.pane.header?.content?.mod ?? null;
  for (const child of node.children ?? []) { const mod = paneHeaderMod(child); if (mod) return mod; }
  return null;
}

class Viewer {
  init(cx, handle) {
    const p = props();
    this.handle = handle; this.preview = new Preview();
    this.preview.open(norm(p.file), p.on ?? null, cx);
    if (!p.on) this.watch(dirname(this.preview.path), cx);
  }
  watch(dir, cx) {
    const preview = this.preview, file = preview.path.toLowerCase();
    cx.spawn(async cx => {
      while (this.preview === preview) {
        let paths;
        try { paths = await watchFolder(dir); } catch { return; }
        if (this.preview !== preview) return;
        if (paths.some(p => { const n = norm(p).toLowerCase(); return n === file || n === dir.toLowerCase(); })) preview.changed(cx);
      }
    });
  }
  close() { this.preview?.close(); this.preview = null; }
  render() {
    const t = theme(), p = this.preview;
    if (!p) return div();
    const status = p.status(), named = paneHeaderMod(layout()) === "huntaway-pane", modes = p.modes(t) ?? p.zoomControls(t);
    return v_flex().id("hlf-viewer").size_full().min_h(0).text_color(t.foreground).text_size(13)
      .track_focus(this.handle).on_key_down((e, cx) => { if (p.key(e, cx)) cx.stop_propagation(); })
      .child(h_flex().h(38).flex_none().px(12).gap(4).items_center().border_b(1).border_color(t.border)
        // Markdown's Preview / Split / Code switch, or an image's zoom, sits on the left, apart from the actions.
        .when(Boolean(modes), el => el.child(modes).child(div().w(8).flex_none()))
        .child(h_flex().flex_1().min_w(0).gap(8).items_center().tooltip(display(p.path ?? "", p.on))
          .when(!named, el => el.child(div().flex_none().max_w(320).truncate().font_semibold().text_size(12.5).child(basename(p.path ?? ""))))
          .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(status ? t.accent : t.dim)
            .child(status || display(friendly(dirname(p.path ?? ""), p.on), p.on))))
        .children(p.tools(t)))
      .child(p.body(t, (path, on, cx) => cx.spawn(async cx => openInTab(path, on, cx))));
  }
}

const ROLES = { menu: Menu, dialog: Dialog, viewer: Viewer };

export default class HuntawayFiles extends View {
  init(_props, cx) {
    const Role = ROLES[props()?.role] ?? Panel;
    this.handle = cx.focus_handle();
    this.role = new Role();
    this.role.init(cx, this.handle);
    cx.spawn(async cx => {
      for (;;) {
        const command = await nextCommand();
        if (command === "focus") { this.role.focusCommand ? this.role.focusCommand() : this.handle.focus(); }
        cx.notify();
      }
    });
  }
  render(cx) { return this.role.render(cx); }
  async close() { this.role.close?.(); }
}
