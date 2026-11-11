// Opens a file in a tab of its own. A file that is already open in a tab is
// shown there instead of opening a second one.
import { spaces, panes, run, shared, setShared } from "herdr";
import { basename } from "./paths.js";
import { MOD } from "./ui.js";

const TABS = "huntaway-files.tabs";
const fileKey = (path, on) => `${on ?? ""}|${path}`;
const live = id => spaces().find(s => s.tabs.some(t => t.id === id)) ?? null;

export async function openInTab(path, on, cx) {
  const k = fileKey(path, on), known = (shared(TABS) ?? {})[k];
  const space = known && live(known);
  // The tab must still hold this mod (its pane wasn't replaced by a terminal).
  if (space && panes().some(p => p.tab === known && p.mod === MOD)) {
    if (!space.active) run("space.select", { id: space.id });
    run("tab.select", { id: known });
    return;
  }
  const before = new Set(spaces().flatMap(s => s.tabs.map(t => t.id)));
  run("tab.new", { name: basename(path), mod: MOD, props: { role: "viewer", file: path, on: on ?? null } });
  // run() queues the command; wait until the new tab shows up to remember it.
  for (let i = 0; i < 20; i++) {
    await cx.sleep(i ? 25 : 0);
    const tab = spaces().flatMap(s => s.tabs).find(t => !before.has(t.id));
    if (!tab) continue;
    const next = {};
    for (const [key, id] of Object.entries(shared(TABS) ?? {})) if (live(id)) next[key] = id;
    next[k] = tab.id;
    setShared(TABS, next);
    return;
  }
}
