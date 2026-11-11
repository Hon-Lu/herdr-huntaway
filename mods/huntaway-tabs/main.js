// The tab bar of the huntaway layout. No fill of its own: the canvas shows
// through. The tabs share one card on the left, then +; the agent inbox bell, the Files and
// Changes panels and the window buttons share one card on the right.
import { View, div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, panes, agents, run, openOverlay, theme, window, shared, layout, settings, appHome, readTextFile, watchFolder } from "herdr";

// Frosted glass on dark themes: card fills let the blurred wallpaper through. Light themes stay
// nearly solid, so terminal text keeps its contrast on white.
const glass = c => !/^#[0-9a-f]{6}$/i.test(c) ? c : c + (parseInt(c.slice(1, 3), 16) + parseInt(c.slice(3, 5), 16) + parseInt(c.slice(5, 7), 16) < 384 ? "cc" : "f5");
// Glass edges (dark themes): a faint light rim.
const darkTheme = t => { const m = /^#(..)(..)(..)/i.exec(t.background ?? ""); return !m || parseInt(m[1], 16) + parseInt(m[2], 16) + parseInt(m[3], 16) < 384; };
const rim = t => darkTheme(t) ? "#ffffff1f" : "#0000001a";

const RADIUS = 14, GAP = 6;
// Tabs sit together in one card, like a segmented control; the selection is a lifted card
// inside it that slides to the tab you pick, so the eye follows where you went.
const INSET = 3, TAB_GAP = 2, SLIDE = { duration: 200, easing: "ease-out" };
const INBOX = "huntaway-inbox";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// Agents waiting on the person, the most urgent first: blocked, then done, newest first.
const URGENCY = { blocked: 2, done: 1 };
const waitingAgents = () => agents()
  .filter(a => URGENCY[a.status])
  .sort((a, b) => URGENCY[b.status] - URGENCY[a.status] || b.seq - a.seq);

export default class Tabs extends View {
  init(_props, cx) {
    this.pressed = null; // the tab index under a held button
    this.over = null; // the tab the pointer is over while one is held: a drag
    this.inbox = false;
    this.widths = {}; // measured tab widths, for placing the sliding selection
    try { this.panels = JSON.parse(localStorage.getItem("panels") ?? "{}"); } catch { this.panels = {}; }
    // The bell shows only while the inbox mod is installed: look now and whenever mods/ changes.
    const mods = `${appHome()}/mods`;
    cx.spawn(async cx => {
      for (;;) {
        let found = false;
        try { found = (await readTextFile(`${mods}/${INBOX}/mod.json`)) !== null; } catch {}
        if (found !== this.inbox) { this.inbox = found; cx.notify(); }
        try { await watchFolder(mods); } catch { await cx.sleep(10000); }
      }
    });
  }

  // The side panel is remembered per space: switching shows that space's choice
  // (closed if it never had one), and opening or closing it records it.
  syncPanel(space, panel, body, enabled) {
    if (!space || !panel) return;
    const now = panel.hidden ? null : body?.active ?? null;
    if (space.id !== this.space) {
      const first = this.space === undefined;
      this.space = space.id; this.pending = null;
      if (!(first && !(space.id in this.panels))) {
        const stored = this.panels[space.id] ?? null, want = enabled.includes(stored) ? stored : null;
        if (want !== now) {
          this.pending = { want, until: Date.now() + 1000 };
          if (want) { run("layout.select", { stack: "panel-body", child: want }); run("layout.show", { id: "panel" }); }
          else run("layout.hide", { id: "panel" });
          return;
        }
      }
    }
    // Until the restore lands (or something else won), the old state isn't a choice.
    if (this.pending) {
      if (this.pending.want !== now && Date.now() < this.pending.until) return;
      this.pending = null;
    }
    if (this.panels[space.id] === now) return;
    this.panels[space.id] = now;
    try { localStorage.setItem("panels", JSON.stringify(this.panels)); } catch {}
  }

  dragging() { return this.pressed !== null && this.over !== null && this.over !== this.pressed; }

  // Which tabs fit. All at full width when they can; otherwise the others shrink to
  // their icon, and if even that is too wide, the run around the active tab that fits.
  // The wheel and the faded edge tabs reach the rest.
  fit(tabs, width, room) {
    const full = tabs.map(c => width(c, false));
    if (!room || full.reduce((n, w) => n + w + TAB_GAP, -TAB_GAP) <= room) return { compact: false, from: 0, to: tabs.length };
    const w = tabs.map((c, i) => c.active ? full[i] : width(c, true));
    const a = Math.max(0, tabs.findIndex(c => c.active));
    let from = a, to = a + 1, used = w[a] ?? 0, grew = true;
    while (grew) {
      grew = false;
      if (to < tabs.length && used + TAB_GAP + w[to] <= room) { used += TAB_GAP + w[to]; to++; grew = true; }
      if (from > 0 && used + TAB_GAP + w[from - 1] <= room) { from--; used += TAB_GAP + w[from]; grew = true; }
    }
    return { compact: true, from, to: Math.max(to, from + 1) };
  }

  render() {
    const t = theme();
    const space = spaces().find(p => p.active);
    const shown = space?.tabs ?? [];
    const stop = (_e, cx) => cx.stop_propagation();
    // Every control is a card of the same material as the panes, on the darker canvas.
    const card = el => el.rounded(RADIUS).border(1).border_color(rim(t)).bg(glass(t.background));
    const lit = t.ansi3; // the active tab glows in the theme's yellow

    const info = c => {
      const ps = panes().filter(p => p.tab === c.id);
      const program = ps.find(p => p.program?.agent)?.program ?? ps[0]?.program;
      const name = /^tb\d+$/.test(c.name) ? program?.name ?? "Terminal" : c.name;
      return { program, name: c.zoomed ? `${name} Z` : name };
    };
    // Mods can't measure text: about 6.4 px a character at 12.5 px.
    const width = (c, compact) => {
      const { program, name } = info(c);
      if (compact) return 24 + (program?.icon ? 14 : 9);
      const status = ["working", "blocked", "done"].includes(c.status) ? 20 : 0;
      return 26 + (program?.icon ? 21 : 0) + Math.min(name.length * 6.4, 170) + status + (c.active ? 20 : 0);
    };
    const room = this.room ? this.room - 38 - GAP - 2 * INSET - 2 : 0; // leave room for + and the group's edge
    const fit = this.fit(shown, width, room);

    const item = (c, i, compact, faded) => {
      const { program, name } = info(c);
      const on = c.active, blocked = c.status === "blocked";
      // Needs you: the tab itself breathes, slowly, in the blocked color.
      const glow = easing => div().absolute().top(0).left(0).size_full().rounded(RADIUS - INSET).bg(t.blocked)
        .loop("opacity", { from: 0.02, to: 0.2, period: 2200, easing });
      return h_flex().id(`tab-${c.id}`).relative().h_full().px(compact ? 10 : 13).gap(7).items_center().flex_none().rounded(RADIUS - INSET)
        .text_size(12.5).text_color(on ? lit : t.muted).when(on, el => el.font_medium())
        .when(compact, el => el.tooltip(name)).when(faded, el => el.opacity(0.45))
        .when(this.dragging() && this.pressed === i, el => el.opacity(0.4))
        .on_mouse_move((_e, cx) => { if (this.pressed !== null && this.over !== i) { this.over = i; cx.notify(); } })
        .when(!on, el => el.hover(s => s.bg(t.hover).text_color(t.foreground))).active(s => s.opacity(0.75))
        .on_size_change((sz, cx) => { const n = Math.round(sz.width); if (this.widths[c.id] !== n) { this.widths[c.id] = n; cx.notify(); } })
        .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); this.pressed = i; this.over = i; if (e.click_count === 2) run("tab.rename", { id: c.id }); })
        .on_mouse_up("left", (_e, cx) => {
          const from = this.pressed; this.pressed = null; this.over = null;
          if (from !== null && from !== i) run("tab.move", { id: shown[from].id, index: space.tabs.findIndex(x => x.id === c.id) + 1 });
          else run("tab.select", { id: c.id });
          cx.notify();
        })
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openOverlay({ mod: "menu", kind: "popup", width: 200, props: { tab: "tab", target: { id: c.id, space: space.id } } }); })
        .when(blocked, el => el.child(glow("ease-in")).child(glow("linear")))
        .when(Boolean(program?.icon), el => el.child(program.tint ? svg(program.icon).size(14).flex_none().text_color(on ? lit : t.muted) : image(program.icon).size(14).flex_none()))
        .when(!compact || !program?.icon, el => el.child(div().max_w(170).truncate().child(compact ? [...name][0] ?? "?" : name)))
        .when(c.status === "working", el => el.child(svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900)))
        .when(blocked || c.status === "done", el => el.child(div().size(6).flex_none().rounded(3).bg(t[c.status])))
        .when(on, el => el.child(div().id(`close-${c.id}`).flex_none().p(2).rounded(4).text_color(t.dim).hover(s => s.bg(t.hover).text_color(t.foreground))
          .on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); run("tab.close", { id: c.id }); }).child(svg("mods/pane/close.svg").size(12))));
    };
    // Where the selection goes: after the measured widths of the tabs before the active one.
    const visible = shown.slice(fit.from, fit.to);
    const at = visible.findIndex(c => c.active);
    let x = INSET;
    for (let k = 0; k < at; k++) x += (this.widths[visible[k].id] ?? width(visible[k], fit.compact)) + TAB_GAP;
    const selW = at >= 0 ? this.widths[visible[at].id] ?? width(visible[at], false) : 0;
    const selection = div().id("tab-selection").absolute().top(INSET).bottom(INSET).left(x).w(selW).rounded(RADIUS - INSET)
      .bg(t.raised).border(1).border_color(lit + "59")
      .transition("left", SLIDE).transition("width", SLIDE);
    // While dragging, a line slides to where the tab will land: after the hovered tab when
    // moving right, before it when moving left.
    const before = k => { let px = INSET; for (let j = 0; j < k; j++) px += (this.widths[visible[j].id] ?? width(visible[j], fit.compact)) + TAB_GAP; return px; };
    let marker = null;
    if (this.dragging()) {
      const from = this.pressed - fit.from, to = this.over - fit.from;
      if (to >= 0 && to < visible.length) {
        const edge = from < to ? before(to + 1) - TAB_GAP : before(to);
        marker = div().id("tab-drop").absolute().top(INSET + 5).bottom(INSET + 5).left(edge - 2).w(2).rounded(1).bg(lit)
          .transition("left", { duration: 120, easing: "ease-out" });
      }
    }
    const group = card(h_flex().id("tab-group").relative().h_full().min_w(0).p(INSET).gap(TAB_GAP).items_center())
      .when(at >= 0, el => el.child(selection))
      .when(Boolean(marker), el => el.child(marker))
      .children(visible.map((c, k) => {
        const i = fit.from + k;
        return item(c, i, fit.compact && !c.active, (k === 0 && fit.from > 0) || (i === fit.to - 1 && fit.to < shown.length));
      }));
    const plus = card(div().id("tab-new").h_full().w(38).flex_none().flex().items_center().justify_center().text_size(16).text_color(t.muted))
      .hover(s => s.bg(t.hover).text_color(t.foreground)).active(s => s.opacity(0.7)).tooltip("New tab")
      .on_mouse_down("left", stop).on_click(() => openOverlay({ mod: "new-menu", kind: "popup", width: 250, height: 512 })).child("+");

    const root = layout(), sidebar = find(root, "sidebar"), w = window();
    // On macOS with the sidebar folded, the tabs start after the traffic lights.
    const lightsPadding = w?.platform === "macos" && w.titlebar === "none" && !w.fullscreen && root?.traffic_lights
      ? Math.max(0, (root.traffic_lights[0] + 64) / settings().zoom - (sidebar?.hidden ? 0 : sidebar?.size?.px ?? 0))
      : 0;
    const panel = find(root, "panel"), body = find(root, "panel-body");
    const enabled = shared("workspace.panels") ?? ["files", "changes"];
    this.syncPanel(space, panel, body, enabled);
    // The right side mirrors the tabs: the bell and the panels share one segmented card, and the
    // open panel is the same lifted selection, sliding between Files and Changes.
    const SEG = 32;
    const segButton = (id, child, tooltip, action, on = false) => div().id(id).h_full().w(SEG).flex_none().flex().items_center().justify_center()
      .rounded(RADIUS - INSET).text_color(on ? lit : t.muted)
      .when(!on, el => el.hover(s => s.bg(t.hover).text_color(t.foreground))).active(s => s.opacity(0.7))
      .when(Boolean(tooltip), el => el.tooltip(tooltip)).on_mouse_down("left", stop).on_click(action).child(child);
    const panelButton = (id, label, file) => {
      const on = panel && !panel.hidden && body?.active === id;
      return segButton(`panel-${id}`, svg(file).size(15), label, () => {
        if (on) run("layout.hide", { id: "panel" });
        else { run("layout.select", { stack: "panel-body", child: id }); run("layout.show", { id: "panel" }); }
      }, on);
    };

    // The bell: plain while nothing waits; otherwise it breathes with the count,
    // in the most urgent status's color (blocked over done).
    const waiting = this.inbox ? waitingAgents() : [];
    const top = waiting[0];
    // The inbox opens under the right card, flush with its right edge, as its own card.
    const INBOX_W = 340;
    const openInbox = () => {
      const b = this.actionsAt;
      const at = b ? { x: Math.max(8, b.x + b.width - INBOX_W), y: b.y + b.height + 8 } : undefined;
      openOverlay({ mod: INBOX, kind: "popup", frame: "none", width: INBOX_W, height: 40 + (waiting.length ? Math.min(388, 12 + waiting.length * 48) : 104), ...(at ? { at } : {}) });
    };
    const alertBell = () => {
      const color = t[top.status];
      // .loop has only four easings; two half-strength glows, one ease-in and one linear,
      // add up to a pulse whose bright part lasts between the two.
      const period = top.status === "blocked" ? 2000 : 2600;
      const glow = easing => div().absolute().top(0).left(0).size_full().rounded(RADIUS - INSET).bg(color).loop("opacity", { from: 0.03, to: 0.24, period, easing });
      return h_flex().id("inbox").relative().h_full().px(9).gap(5).flex_none().items_center().rounded(RADIUS - INSET)
        .bg(color + "1f").text_size(12).font_semibold().text_color(color)
        .hover(s => s.bg(color + "40")).active(s => s.opacity(0.8)).tooltip("Agents waiting on you").on_mouse_down("left", stop).on_click(openInbox)
        .child(glow("ease-in")).child(glow("linear"))
        .child(svg(`mods/${INBOX}/bell.svg`).size(14).flex_none())
        .child(div().flex_none().child(String(waiting.length)));
    };
    const bell = !this.inbox ? null : top ? alertBell() : segButton("inbox", svg(`mods/${INBOX}/bell.svg`).size(15), "Agents waiting on you", openInbox);
    const panelIds = ["files", "changes"].filter(id => enabled.includes(id));
    const openPanel = panel && !panel.hidden ? panelIds.indexOf(body?.active) : -1;
    // Where the panel selection sits: after the bell (its width changes with the count) and the buttons before it.
    const bellW = !bell ? 0 : top ? (this.bellW ?? 48) : SEG;
    const selX = INSET + (bell ? bellW + TAB_GAP : 0) + openPanel * (SEG + TAB_GAP);
    const panelSelection = div().id("panel-selection").absolute().top(INSET).bottom(INSET).left(selX).w(SEG).rounded(RADIUS - INSET)
      .bg(t.raised).border(1).border_color(lit + "59").transition("left", SLIDE);
    // The window buttons share the card, after a divider; close turns red under the pointer.
    const winButton = (id, child, action, danger = false) => segButton(id, child, null, action)
      .when(danger, el => el.hover(s => s.bg("#e81123").text_color("#ffffff")));
    const actions = card(h_flex().id("tab-actions").h_full().p(INSET).gap(TAB_GAP).flex_none().items_center())
      .on_mouse_move(e => { if (e.bounds) this.actionsAt = e.bounds; })
      .when(openPanel >= 0, el => el.child(panelSelection))
      .when(Boolean(bell), el => el.child(top ? bell.on_size_change((sz, cx) => { const n = Math.round(sz.width); if (n !== this.bellW) { this.bellW = n; cx.notify(); } }) : bell))
      .children(panelIds.map(id => id === "files" ? panelButton("files", "Files", "mods/files/file.svg") : panelButton("changes", "Changes", "mods/changes/changes.svg")))
      .when(Boolean(w?.buttons), el => el.when(Boolean(bell) || panelIds.length > 0, el => el.child(div().w(1).h(16).mx(3).flex_none().bg(t.border)))
        .child(winButton("minimize", w.platform === "windows" ? svg("mods/huntaway-tabs/win-min.svg").size(16) : "−", () => run("window.minimize")))
        .child(winButton("maximize", w.platform === "windows" ? svg(`mods/huntaway-tabs/${w.maximized ? "win-restore" : "win-max"}.svg`).size(16) : "□", () => run("window.maximize")))
        .child(winButton("close-window", w.platform === "windows" ? svg("mods/huntaway-tabs/win-close.svg").size(16) : svg("mods/pane/close.svg").size(13), () => run("window.close"), true)));
    const hasActions = Boolean(bell) || panelIds.length > 0 || Boolean(w?.buttons);

    return h_flex().size_full().min_w(0).pl(lightsPadding).gap(GAP * 2).items_center()
      .id("tabs-root")
      .on_mouse_up("left", (_e, cx) => { if (this.pressed !== null) { this.pressed = null; this.over = null; cx.notify(); } })
      // A drag that leaves the bar is dropped where it started.
      .on_hover((hovered, cx) => { if (!hovered && this.pressed !== null) { this.pressed = null; this.over = null; cx.notify(); } })
      .on_scroll_wheel(e => { if (Math.abs(e.delta.y) >= 1) run(e.delta.y > 0 ? "tab.prev" : "tab.next"); })
      .child(h_flex().id("tab-strip").flex_1().min_w(0).h_full().gap(GAP).items_center()
        .on_size_change((s, cx) => { const n = Math.floor(s.width); if (n !== this.room) { this.room = n; cx.notify(); } })
        .when(visible.length > 0, el => el.child(group))
        .child(plus))
      .when(hasActions, el => el.child(actions));
  }
}
