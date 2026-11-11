// Modified from the "workspace-chrome" mod shipped with Herdr App (Apache License 2.0), changed for the huntaway layout.
import { View, div, image, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, run, props, window, shared, setShared, updates, layout } from "herdr";

// Frosted glass on dark themes: card fills let the blurred wallpaper through. Light themes stay
// nearly solid, so terminal text keeps its contrast on white.
const glass = c => !/^#[0-9a-f]{6}$/i.test(c) ? c : c + (parseInt(c.slice(1, 3), 16) + parseInt(c.slice(3, 5), 16) + parseInt(c.slice(5, 7), 16) < 384 ? "cc" : "f5");

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The layout file only takes plain colors and one wallpaper, so the look that depends on the
// theme is set here, again whenever the theme changes: the panes' glass fill, the cards' and
// panes' rims, and a dark or light wallpaper. Writes only when something differs.
const isDark = c => { const m = /^#(..)(..)(..)/i.exec(c ?? ""); return !m || parseInt(m[1], 16) + parseInt(m[2], 16) + parseInt(m[3], 16) < 384; };
const WALLPAPER = { dark: "mods/huntaway-chrome/backgrounds/glass.jpg", light: "mods/huntaway-chrome/backgrounds/mist-light.jpg" };
// Earlier names of ours, swapped too when an older layout still points at one.
const OLD_WALLPAPERS = ["mods/huntaway-chrome/backgrounds/glass-light.jpg"];
function applyLook() {
  const root = layout(), t = theme();
  if (!find(root, "main")?.content?.pane) return;
  const dark = isDark(t.background);
  const rim = dark ? "#ffffff1f" : "#0000001a", focus = dark ? "#ffffff3d" : "#00000033";
  const next = JSON.parse(JSON.stringify(root));
  let changed = false;
  const set = (obj, key, value) => { if (JSON.stringify(obj[key]) !== JSON.stringify(value)) { obj[key] = value; changed = true; } };
  const pane = find(next, "main").content.pane;
  set(pane, "background", glass(t.background));
  set(pane, "border", { ...(pane.border ?? { width: 1 }), color: rim });
  set(pane, "focus", { ...(pane.focus ?? { width: 1 }), color: focus });
  // Every card node: the ones with rounded corners and a border.
  const walk = node => {
    if (node.radius && node.border) set(node, "border", { ...node.border, color: rim });
    for (const child of node.children ?? []) walk(child);
  };
  walk(next);
  // Only a wallpaper of ours is swapped: a person's own picture or color stays.
  const bg = next.background, ours = [...Object.values(WALLPAPER), ...OLD_WALLPAPERS];
  if (bg?.image && ours.includes(bg.image)) set(next, "background", { ...bg, image: dark ? WALLPAPER.dark : WALLPAPER.light });
  if (changed) run("layout.set", { layout: next });
}

// The sidebar's rail goes by its width, not a flag: dragging its edge narrows it too.
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

// To the rail (on macOS wide enough for the traffic lights), or back to the width it had.
function toggleSidebar() {
  const width = find(layout(), "sidebar")?.size?.px;
  if (!narrow()) setShared("sidebar.width", width);
  // Mods edited before the rail went by width still read the flag.
  setShared("sidebar.collapsed", !narrow());
  run("layout.resize", { id: "sidebar", px: narrow() ? (shared("sidebar.width") ?? 268) : window()?.platform === "macos" ? 76 : 44 });
}

export default class WorkspaceChrome extends View {
  button(id, label, action) {
    const t = theme();
    return div().id(id).size(26).flex_none().flex().items_center().justify_center().rounded(6).text_color(t.muted).hover(s => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click(action).child(label);
  }
  render() {
    const t = theme();
    const collapsed = narrow();
    if (!props()?.footer) applyLook();
    if (props()?.footer) {
      const row = (id, icon, label, dim, action) => h_flex().id(id).h(28).px(8).gap(9).items_center().rounded(8)
        .when(collapsed, el => el.relative().w(32).px(0).justify_center().tooltip(label))
        .text_color(dim ? t.dim : t.muted).hover(s => s.bg(t.hover).text_color(t.foreground)).cursor_pointer()
        .on_click(action).child(svg(`mods/huntaway-chrome/${icon}.svg`).size(14))
        .when(!collapsed, el => el.child(label));
      const ready = div().size(6).rounded_full().bg(t.accent);
      // Its own card: no divider, even padding, rounded inside the node's 14 px corners.
      return v_flex().size_full().rounded(13).overflow_hidden().bg(glass(t.background)).px(8).py(6).justify_center().text_size(13)
        .when(collapsed, el => el.px(0).items_center())
        .child(row("settings", "settings", "Settings", false, () => run("app.settings"))
          .when(Boolean(updates().app.ready), el => el.child(collapsed ? ready.absolute().top(5).right(6) : ready)))
        .child(row("machine", "plus", "Add machine", true, () => run("mod.open", { name: "machine-add" })));
    }
    return h_flex().size_full().rounded(13).overflow_hidden().bg(glass(t.background)).pl(collapsed ? 6 : 14).pr(10).gap(4).items_center().text_size(13.5)
      .when(window()?.platform === "macos" && !window()?.fullscreen && !collapsed, el => el.pl(76))
      .when(!collapsed, el => el.child(h_flex().flex_1().gap(8).items_center().child(image("frame/welcome/herdr.png").size(20).rounded(5)).child(div().font_semibold().text_color(t.foreground).child("Herdr"))))
      .when(!collapsed, el => el.child(this.button("search", svg("mods/huntaway-chrome/search.svg").size(15), () => run("mod.open", { name: "picker" }))))
      // On the macOS rail the traffic lights fill the row; the agents list's » unfolds it.
      .when(!(collapsed && window()?.platform === "macos"), el => el.child(this.button("sidebar-toggle", svg("mods/huntaway-chrome/sidebar.svg").size(15), toggleSidebar)));
  }
}
