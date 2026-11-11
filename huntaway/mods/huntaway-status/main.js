// Modified from the "workspace-status" mod shipped with Herdr App (Apache License 2.0), changed for the huntaway layout.
import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, agents, theme, run, window, keys } from "herdr";

// Frosted glass on dark themes: card fills let the blurred wallpaper through. Light themes stay
// nearly solid, so terminal text keeps its contrast on white.
const glass = c => !/^#[0-9a-f]{6}$/i.test(c) ? c : c + (parseInt(c.slice(1, 3), 16) + parseInt(c.slice(3, 5), 16) + parseInt(c.slice(5, 7), 16) < 384 ? "cc" : "f5");

export default class WorkspaceStatus extends View {
  // The palette key as actually bound, not a hardcoded one; without a
  // binding the hint stays useful ("commands") instead of lying.
  hint(t) {
    const mac = window()?.platform === "macos";
    const mod = { cmd: mac ? "⌘" : "Ctrl+", ctrl: mac ? "⌃" : "Ctrl+", shift: mac ? "⇧" : "Shift+", alt: mac ? "⌥" : "Alt+", option: mac ? "⌥" : "Alt+" };
    const b = keys().find((k) => k.section === "global" && k.action === "app.palette");
    const parts = b && b.keys.endsWith("--") ? [...b.keys.slice(0, -2).split("-"), "-"] : b?.keys.split("-");
    const key = parts && parts.map((p) => mod[p.toLowerCase()] ?? p.toUpperCase()).join("");
    return key ? `${key}  commands` : "commands";
  }

  render() {
    const t = theme();
    const space = spaces().find(s => s.active);
    const list = agents();
    const needs = list.filter(a => a.status === "blocked").length;
    // Icons carry the color, text stays muted.
    const label = (icon, text, color) => h_flex().gap(6).items_center().child(svg(`mods/workspace-chrome/${icon}.svg`).size(13).text_color(color)).child(text);
    const dot = needs > 0 ? t.blocked : list.some(a => a.status === "working") ? t.working : list.length ? t.done : t.dim;
    // Its own card: rounded inside the node's 14 px corners, no divider.
    return h_flex().size_full().px(14).gap(16).items_center().rounded(13).overflow_hidden().bg(glass(t.background)).text_size(11.8).text_color(t.muted)
      .child(label(space?.machine ? "server" : "monitor", space?.machine ?? "This computer", t.muted))
      .when(Boolean(space?.branch), el => el.child(label("branch", space.branch, t.accent)))
      .child(h_flex().gap(6).items_center().child(div().size(6).rounded(3).bg(dot)).child(`${list.length} agents`)
        .when(needs > 0, el => el.child(div().text_color(t.blocked).child(`· ${needs} needs you`))))
      .child(div().flex_1())
      .child(div().id("palette").text_color(t.dim).on_click(() => run("app.palette")).child(this.hint(t)));
  }
}
