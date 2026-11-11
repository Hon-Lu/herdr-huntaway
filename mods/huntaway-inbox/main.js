import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, spaces, run, theme, props, closeOverlay } from "herdr";

// The popup the tab bar's bell opens: agents waiting on the person, the blocked
// ones first. Nothing is stored here. Herdr turns "done" into "idle" once someone
// looks at the agent, and "blocked" into something else once it's answered, so
// a row goes away by itself after its agent has been seen.
// It draws its own frame (opened with frame: "none"): a card like the layout's. Its parts have fixed
// heights: a popup is as tall as its content.
const RANK = { blocked: 2, done: 1 };
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

export default class AgentInbox extends View {
  open(agent) {
    closeOverlay(props().overlay);
    run("pane.focus", { pane: agent.pane });
  }

  row(agent, tab, t) {
    const blocked = agent.status === "blocked";
    const color = t[agent.status];
    const program = agent.program;
    return h_flex().id(`inbox-${agent.address}`).h(46).px(10).gap(10).rounded(10).items_center().flex_none().cursor_pointer()
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

  render() {
    const t = theme();
    const tabs = new Map(spaces().flatMap((s) => s.tabs).map((tab) => [tab.id, tab]));
    const waiting = agents()
      .filter((a) => RANK[a.status])
      .sort((a, b) => RANK[b.status] - RANK[a.status] || b.seq - a.seq);
    return v_flex().id("agent-inbox").size_full().rounded(14).overflow_hidden().border_1().border_color(rim(t)).bg(veil(t.background))
      .child(h_flex().h(38).flex_none().px(14).items_center().gap(8).border_b(1).border_color(t.border)
        .child(div().flex_1().text_size(12).font_semibold().text_color(t.foreground).child("Waiting on you"))
        .when(waiting.length > 0, (el) => el.child(div().text_size(11).text_color(t.dim).child(String(waiting.length)))))
      .when(waiting.length === 0, (el) => el.child(v_flex().h(104).flex_none().items_center().justify_center().gap(6).text_color(t.dim)
        .child(svg(`mods/huntaway-inbox/bell.svg`).size(18))
        .child(div().text_size(12).child("All caught up"))))
      .when(waiting.length > 0, (el) => el.child(v_flex().id("inbox-list").h(Math.min(388, 12 + waiting.length * 48)).flex_none().p(6).gap(2).overflow_y_scrollbar()
        .children(waiting.map((a) => this.row(a, tabs.get(a.tab), t)))));
  }
}
