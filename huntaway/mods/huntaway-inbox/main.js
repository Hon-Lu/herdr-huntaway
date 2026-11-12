import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, spaces, run, theme, props, placement, shared, setShared, nextCommand, openOverlay, closeOverlay } from "herdr";

// Agents waiting on the person, the blocked ones first. One mod, two parts:
// - the list ("Waiting on you"), a popup opened by huntaway's tab bar bell or by the bell below;
// - a bell of its own, for any other layout: a floating block on an edge
//   (`"floating": [{ "id": "inbox", "content": { "mod": "huntaway-inbox" }, "edge": "right", "align": "start" }]`).
// Nothing is stored. Herdr turns "done" into "idle" once someone looks at the agent, and
// "blocked" into something else once it's answered, so a row goes away by itself.
const RANK = { blocked: 2, done: 1 };
const LIST_W = 340;
const ROW = 46;
const GAP = 10; // between the bell and its list
const SLIDE_MS = 300;
const SETTLE_MS = 450; // after a drop Herdr springs the bell to its edge; its bounds aren't final yet
const OPEN = "huntaway-inbox.open"; // the list's overlay id while it shows

// Nearly opaque: it sits over terminal text, and nothing here can blur what is behind it.
const veil = c => /^#[0-9a-f]{6}$/i.test(c) ? c + "f0" : c;
// Glass edges (dark themes): a faint light rim.
const darkTheme = t => { const m = /^#(..)(..)(..)/i.exec(t.background ?? ""); return !m || parseInt(m[1], 16) + parseInt(m[2], 16) + parseInt(m[3], 16) < 384; };
const rim = t => darkTheme(t) ? "#ffffff1f" : "#0000001a";

const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();

function nameOf(agent, tab) {
  if (tab?.named) return tab.name;
  const title = clean(agent.title);
  const isPath = /^[~/]|^[A-Za-z]:\\/.test(title);
  return title && !isPath ? title : agent.program?.name || "Agent";
}

function ago(ms) {
  if (!ms) return "";
  const minutes = Math.floor((Date.now() - ms) / 60000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

const waiting = () => agents()
  .filter((a) => RANK[a.status])
  .sort((a, b) => RANK[b.status] - RANK[a.status] || b.seq - a.seq);

// The list's height for n rows: up to seven, then it scrolls; empty, "All caught up".
// huntaway-tabs opens it with the same sum.
const listHeight = (n) => 40 + (n ? Math.min(388, 12 + n * 48) : 104);

const focusAgent = (agent) => { if (agent?.pane) run("pane.focus", { pane: agent.pane }); };

// When the list last went away. Module scope: the bell and the list are copies of this mod and
// share it. A press on the bell closes the popup (the bell is outside it) before the bell's click
// runs; without this the click would open it again at once.
let listClosedAt = 0;

// A corner counts as its side edge, whichever edge Herdr put it on: top-right and right-top look
// and open the same. Only the middles of the top and bottom edges open down or up.
function sideOf(where) {
  const { edge, align } = where;
  if ((edge === "top" || edge === "bottom") && align !== "center") {
    return { edge: align === "start" ? "left" : "right", align: edge === "top" ? "start" : "end" };
  }
  return { edge, align };
}

export default class AgentInbox extends View {
  init(_props, cx) {
    if (props()?.overlay) {
      setShared(OPEN, props().overlay);
      // Shown hidden first, then moved to its place next frame, so the spring plays the entrance.
      this.shown = false;
      cx.timer.after(16, (cx) => { this.shown = true; cx.notify(); });
      return;
    }
    // Keys: "huntaway-inbox.next" goes to the agent at the top of the list.
    cx.spawn(async (cx) => {
      for (;;) {
        const command = await nextCommand();
        if (command === "next") focusAgent(waiting()[0]);
        cx.notify();
      }
    });
  }

  // However the list goes (Esc, a press outside, a row, the bell), this runs once.
  async close() {
    if (!props()?.overlay) return;
    listClosedAt = Date.now();
    if (shared(OPEN) === props().overlay) setShared(OPEN, null);
  }

  render() {
    return props()?.overlay ? this.list() : this.bell();
  }

  // ---- The bell (floating) ----

  toggle() {
    if (shared(OPEN) != null) { closeOverlay(shared(OPEN)); return; }
    if (Date.now() - listClosedAt < 250) return; // this click's own press just closed it
    this.openList();
  }

  // The list opens from the bell toward the middle of the window, lined up with the bell along
  // its edge (start, center or end).
  openList() {
    const b = this.at;
    const { edge, align } = sideOf(placement() ?? { edge: "right", align: "start" });
    const h = listHeight(waiting().length);
    let at;
    if (b) {
      const along = (pos, size, len) => align === "start" ? pos - 6
        : align === "end" ? pos + size - len + 6 : pos + size / 2 - len / 2;
      const x = edge === "right" ? b.x - LIST_W - GAP : edge === "left" ? b.x + b.width + GAP : along(b.x, b.width, LIST_W);
      const y = edge === "bottom" ? b.y - h - GAP : edge === "top" ? b.y + b.height + GAP : along(b.y, b.height, h);
      at = { x: Math.max(8, x), y: Math.max(8, y) };
    }
    openOverlay({ mod: "huntaway-inbox", kind: "popup", frame: "none", width: LIST_W, height: h,
      props: { edge, height: h }, ...(at ? { at } : {}) });
  }

  bell() {
    const list = waiting();
    // Always there, so people can find it before anything has waited: with nothing waiting it is a
    // quiet bell alone (muted, no count, still), and clicking it says "All caught up".
    const idle = list.length === 0;
    const t = theme();
    const where = placement();
    // A dragged bell leaves its list behind: close it. Clicks wait until the drop has settled, so
    // a drag's release isn't taken for a click and the list opens from the bell's final spot.
    if (where?.dragging) { if (shared(OPEN) != null) closeOverlay(shared(OPEN)); this.dragged = true; }
    else if (this.dragged) { this.dragged = false; this.settleUntil = Date.now() + SETTLE_MS; }
    // Upright everywhere but the middle of the top or bottom edge.
    const across = where && !where.vertical && where.align === "center";
    const open = shared(OPEN) != null;
    const color = open ? t.accent : idle ? t.muted : t[list[0].status];
    // Only the glyph breathes: a fill would be a second rounded shape inside Herdr's frame. While
    // the list is open the bell holds still, in accent on an accent tint.
    const breathe = !open && !idle;
    const period = list[0]?.status === "blocked" ? 2000 : 2600;
    const glyph = svg("mods/huntaway-inbox/bell.svg").size(14).text_color(color);
    return (across ? h_flex().h(22).px(6).gap(4) : v_flex().w(22).py(5).gap(3))
      .id("inbox-bell").items_center().justify_center().rounded(7).cursor_pointer()
      .text_color(open ? t.accent : t.foreground)
      .when(open, (el) => el.bg(t.accent + "26"))
      .when(!open, (el) => el.hover((s) => s.bg(t.hover)))
      .tooltip(`${idle ? "Nothing waiting" : `${list.length} waiting on you`} · drag to move`)
      .on_mouse_move((e) => { if (e.bounds) this.at = e.bounds; })
      .on_click((e) => {
        if (e?.bounds) this.at = e.bounds;
        if (placement()?.dragging || Date.now() < (this.settleUntil ?? 0)) return;
        this.toggle();
      })
      .child(breathe ? glyph.loop("opacity", { from: 0.35, to: 1, period, easing: "ease-in-out" }) : glyph)
      .when(!idle, (el) => el.child(div().text_size(11).font_semibold().child(list.length > 99 ? "99+" : String(list.length))));
  }

  // ---- The list (popup) ----

  open(agent) {
    closeOverlay(props().overlay);
    focusAgent(agent);
  }

  row(agent, tab, t) {
    const blocked = agent.status === "blocked";
    const color = t[agent.status];
    const program = agent.program;
    return h_flex().id(`inbox-${agent.address}`).h(ROW).px(10).gap(10).rounded(10).items_center().flex_none().cursor_pointer()
      .hover((el) => el.bg(t.hover)).active((el) => el.opacity(0.75))
      .on_click(() => this.open(agent))
      .child(h_flex().size(28).flex_none().rounded(8).items_center().justify_center().bg(t.raised)
        .child(program?.icon
          ? (program.tint ? svg(program.icon).size(15).text_color(t.muted) : image(program.icon).size(15))
          : div().size(7).rounded(4).bg(color)))
      .child(v_flex().flex_1().min_w(0).gap(1)
        .child(div().truncate().text_size(12.8).font_medium().text_color(t.foreground).child(nameOf(agent, tab)))
        .child(div().truncate().text_size(11).text_color(t.dim).child([agent.space_name || tab?.name || "", ago(tab?.changed_at)].filter(Boolean).join(" · "))))
      .child(div().flex_none().px(7).h(20).flex().items_center().rounded(6).bg(color + "26")
        .text_size(10.5).font_semibold().text_color(color).child(blocked ? "Needs you" : "Done"));
  }

  list() {
    const t = theme();
    const tabs = new Map(spaces().flatMap((s) => s.tabs).map((tab) => [tab.id, tab]));
    const list = waiting();
    // It slides in from the side it was opened from (props.edge: the bell's edge) and fades in.
    // A popup is as tall as its content and the card is absolute, so the root gets a real size.
    const h = props().height ?? listHeight(list.length);
    const [axis, away] = {
      right: ["left", LIST_W], left: ["left", -LIST_W], bottom: ["top", h], top: ["top", -h],
    }[props().edge] ?? ["top", -h];
    const pos = this.shown ? 0 : away;
    const card = v_flex().id("agent-inbox").absolute().w(LIST_W).h(h)
      .left(axis === "left" ? pos : 0).top(axis === "top" ? pos : 0)
      .spring(axis, { response: SLIDE_MS, damping: 1 })
      .opacity(this.shown ? 1 : 0).transition("opacity", { duration: 180, easing: "ease-out" })
      .rounded(14).overflow_hidden().border_1().border_color(rim(t)).bg(veil(t.background))
      .child(h_flex().h(38).flex_none().px(14).items_center().gap(8).border_b(1).border_color(t.border)
        .child(div().flex_1().text_size(12).font_semibold().text_color(t.foreground).child("Waiting on you"))
        .when(list.length > 0, (el) => el.child(div().text_size(11).text_color(t.dim).child(String(list.length)))))
      .when(list.length === 0, (el) => el.child(v_flex().h(104).flex_none().items_center().justify_center().gap(6).text_color(t.dim)
        .child(svg(`mods/huntaway-inbox/bell.svg`).size(18))
        .child(div().text_size(12).child("All caught up"))))
      .when(list.length > 0, (el) => el.child(v_flex().id("inbox-list").h(Math.min(388, 12 + list.length * 48)).flex_none().p(6).gap(2).overflow_y_scrollbar()
        .children(list.map((a) => this.row(a, tabs.get(a.tab), t)))));
    return div().id("inbox-frame").relative().w(LIST_W).h(h).overflow_hidden().child(card);
  }
}
