// Folders for the New space dialog: listing one folder (anywhere, also outside the home
// folder), the drives, and a background index of folders (under home and near the open spaces)
// for searching.
import { exec, home, appHome } from "herdr";
import * as fs from "fs/promises";

// Forward slashes, no doubled ones, no trailing one (except a lone root).
export const norm = p => (p ?? "").replace(/\\/g, "/").replace(/(?!^)\/{2,}/g, "/").replace(/(.)\/+$/, "$1");
export const isWin = () => /^[a-z]:/i.test(home());

// --- PowerShell, for folders the in-process reader isn't allowed to read (other drives).
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function base64(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = bytes[i + 1], c = bytes[i + 2];
    out += B64[a >> 2] + B64[((a & 3) << 4) | ((b ?? 0) >> 4)]
      + (b === undefined ? "=" : B64[((b & 15) << 2) | ((c ?? 0) >> 6)])
      + (c === undefined ? "=" : B64[c & 63]);
  }
  return out;
}
function utf16le(text) {
  const bytes = new Uint8Array(text.length * 2);
  for (let i = 0; i < text.length; i++) { const c = text.charCodeAt(i); bytes[2 * i] = c & 255; bytes[2 * i + 1] = c >> 8; }
  return bytes;
}
const psq = s => "'" + String(s).replace(/['‘’‚‛]/g, "$&$&") + "'";
async function powershell(script, timeout = 8000) {
  // UTF-8 out, so non-English folder names come back intact.
  const wrapped = "$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);" + script;
  const r = await exec("powershell", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", base64(utf16le(wrapped))], { timeout });
  return r.code === 0 ? r.stdout : "";
}

// --- cmd, with Unicode output. Run by Herdr it has no console and would write names in the
// system code page (Chinese ones arrive garbled), so its output goes UTF-16 (`/u`) into a file
// under the Herdr folder, read back as bytes.
const CMD_UNSAFE = /[&|<>^%!()",;=]/;
let cmdRuns = 0, swept = false;
const fromUtf16 = bytes => {
  let s = "";
  for (let i = 0; i + 1 < bytes.length; i += 4096) {
    const end = Math.min(bytes.length - 1, i + 4096), codes = [];
    for (let j = i; j < end; j += 2) codes.push(bytes[j] | (bytes[j + 1] << 8));
    s += String.fromCharCode(...codes);
  }
  return s;
};
/** What a cmd line prints, in full Unicode; null when it can't run. */
async function cmdText(args) {
  const dir = norm(appHome()) + "/.cache/huntaway-newspace", file = `${dir}/cmd-${Date.now()}-${++cmdRuns}.txt`;
  if (CMD_UNSAFE.test(file)) return null;
  try {
    await fs.mkdir(dir, { recursive: true });
    if (!swept) {
      // Files a closed dialog left behind, an hour old or more.
      swept = true;
      for (const name of await fs.readdir(dir).catch(() => [])) {
        const at = Number(name.split("-")[1]);
        if (!at || Date.now() - at > 3600e3) await fs.unlink(`${dir}/${name}`).catch(() => {});
      }
    }
    await exec("cmd", ["/d", "/u", "/c", "(", ...args, ")", ">", file.replace(/\//g, "\\")], { timeout: 8000 });
    return fromUtf16(await fs.readFile(file));
  } catch { return null; }
  finally { await fs.unlink(file).catch(() => {}); }
}

const byName = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

/** The subfolder names of one folder, hidden ones left out unless asked for. [] when unreadable. */
export async function listDirs(dir, { hidden = false } = {}) {
  const path = norm(dir) || "/";
  const keep = n => hidden || !n.startsWith(".");
  try {
    const list = await fs.readdir(/^[a-z]:$/i.test(path) ? path + "/" : path, { withFileTypes: true });
    return list.filter(d => d.isDirectory() && keep(d.name)).map(d => d.name).sort(byName);
  } catch {}
  try {
    if (isWin()) {
      const target = (/^[a-z]:$/i.test(path) ? path + "/" : path).replace(/\//g, "\\");
      // cmd's `dir` starts in a fifth of a second, PowerShell in two. The path goes as its own
      // argument (quoted when it has spaces); one with cmd's own symbols goes to PowerShell.
      if (!CMD_UNSAFE.test(target)) {
        const text = await cmdText(["dir", "/a:d-h", "/b", target, "2>nul"]);
        if (text !== null) return text.split(/\r?\n/).filter(Boolean).filter(keep).sort(byName);
      }
      const out = await powershell(`[IO.DirectoryInfo]::new(${psq(target)}).EnumerateDirectories() | Where-Object { -not ($_.Attributes -band [IO.FileAttributes]::Hidden) } | ForEach-Object { $_.Name }`);
      return out.split(/\r?\n/).filter(Boolean).filter(keep).sort(byName);
    }
    const r = await exec("sh", ["-c", 'for f in "$1"/*/ "$1"/.*/; do [ -d "$f" ] && basename "$f"; done', "sh", path], { timeout: 8000 });
    return r.code === 0 ? r.stdout.split("\n").filter(n => n && n !== "." && n !== "..").filter(keep).sort(byName) : [];
  } catch { return []; }
}

/** The drives on Windows (C:, D:, ...), the root elsewhere. */
export async function drives() {
  if (!isWin()) return ["/"];
  try {
    // Every letter with a readable drive behind it (cmd: far quicker to start than PowerShell).
    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").join(" ");
    const r = await exec("cmd", ["/d", "/c", `for %d in (${letters}) do @if exist %d:\\ echo %d:`], { timeout: 8000 });
    const list = (r.stdout ?? "").split(/\r?\n/).map(s => s.trim().toUpperCase()).filter(s => /^[A-Z]:$/.test(s));
    return list.length ? list : ["C:"];
  } catch { return ["C:"]; }
}

// --- The index: every folder a few levels down under home and under the folders that hold the
// open spaces (C:\tools when a space is in C:\tools\app), built in the background and kept while
// the mod is loaded. Tool folders are skipped; build output is listed but not gone into; hidden
// folders are left out.
const SKIP = new Set(["node_modules", "appdata", "library", "application data", "local settings", "$recycle.bin", "venv", "__pycache__",
  "pkgs", "site-packages", "miniconda3", "anaconda3", "scoop", "onedrive", "icloud drive", "windows", "program files", "program files (x86)", "programdata"]);
const SKIP_INSIDE = new Set(["target", "dist", "build", "out", "vendor", "bin", "obj", "go"]);
const DEPTH = 6, ROOT_DEPTH = 4, LIMIT = 40000;
let index = null; // { folders: string[], roots: string[], pending: number, done: boolean }

const lower = p => norm(p).toLowerCase();
const within = (p, root) => { const a = lower(p), r = lower(root); return a === r || a.startsWith(r.endsWith("/") ? r : r + "/"); };
const isTop = p => /^[a-z]:\/?$|^\/$/i.test(norm(p));

/**
 * The folder index, starting it the first time; it grows in place until `done`. `near` are
 * folders in use (the open spaces'): the folder each sits in is indexed as well, unless home
 * covers it already or it is a whole drive (then the folder itself is).
 */
export function folderIndex(near = []) {
  if (!index) {
    index = { folders: [], roots: [norm(home())], pending: 1, done: false };
    build(index).finally(() => finish(index));
  }
  for (const f of near) {
    const n = norm(f);
    if (!n || isTop(n)) continue;
    const up = n.slice(0, n.lastIndexOf("/")) || "/";
    const root = isTop(up) ? n : up;
    if (index.roots.some(r => within(root, r))) continue;
    index.roots.push(root);
    index.pending++; index.done = false;
    buildOther(index, root).finally(() => finish(index));
  }
  return index;
}

function finish(ix) { if (--ix.pending === 0) ix.done = true; }

/** Outside home the in-process reader may not look: walk there with PowerShell or `find`. */
async function buildOther(ix, root) {
  try {
    let out;
    if (isWin()) {
      const list = s => [...s].map(psq).join(",");
      out = await powershell(`$skip=@(${list(SKIP)});$skipIn=@(${list(SKIP_INSIDE)});`
        + `$q=[Collections.Generic.Queue[object]]::new();$q.Enqueue(@(${psq(root.replace(/\//g, "\\") + "\\")},0));$n=0;`
        + `$skipAttr=[IO.FileAttributes]::Hidden -bor [IO.FileAttributes]::ReparsePoint;`
        + `while($q.Count -gt 0 -and $n -lt ${LIMIT}){$d,$lv=$q.Dequeue();try{foreach($c in [IO.DirectoryInfo]::new($d).EnumerateDirectories()){`
        + `if($c.Attributes -band $skipAttr){continue};$l=$c.Name.ToLower();if($l.StartsWith('.') -or $skip -contains $l){continue};`
        + `$c.FullName;$n++;if($lv+1 -lt ${ROOT_DEPTH} -and -not($skipIn -contains $l)){$q.Enqueue(@($c.FullName,($lv+1)))}}}catch{}}`, 30000);
    } else {
      const r = await exec("find", [root, "-mindepth", "1", "-maxdepth", String(ROOT_DEPTH), "-type", "d"], { timeout: 30000 });
      out = r.stdout ?? "";
    }
    const base = lower(root).length;
    for (const line of out.split(/\r?\n/)) {
      const p = norm(line.trim());
      if (!p || ix.folders.length >= LIMIT) continue;
      const parts = p.slice(base).split("/").filter(Boolean);
      const bad = parts.some((s, i) => s.startsWith(".") || SKIP.has(s.toLowerCase()) || (i < parts.length - 1 && SKIP_INSIDE.has(s.toLowerCase())));
      if (!bad) ix.folders.push(p);
    }
  } catch {}
}

async function build(ix) {
  const root = norm(home());
  let queue = [{ dir: root, depth: 0 }];
  while (queue.length && ix.folders.length < LIMIT) {
    const next = [];
    // A level at a time, a few folders at once.
    for (let i = 0; i < queue.length && ix.folders.length < LIMIT; i += 16) {
      await Promise.all(queue.slice(i, i + 16).map(async ({ dir, depth }) => {
        let list = [];
        try { list = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
        for (const d of list) {
          if (!d.isDirectory() || d.name.startsWith(".") || SKIP.has(d.name.toLowerCase())) continue;
          const path = `${dir}/${d.name}`;
          ix.folders.push(path);
          if (depth + 1 < DEPTH && !SKIP_INSIDE.has(d.name.toLowerCase())) next.push({ dir: path, depth: depth + 1 });
        }
      }));
    }
    queue = next;
  }
}

/**
 * Folders matching a query, best first. Every word must be in the path; a word in the folder's
 * own name counts most, at its start more; shorter paths win ties.
 */
export function searchFolders(paths, query, limit = 50) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const out = [];
  for (const p of paths) {
    const low = p.toLowerCase();
    if (!words.every(w => low.includes(w))) continue;
    const name = low.slice(low.lastIndexOf("/") + 1);
    let score = 0;
    for (const w of words) score += name === w ? 60 : name.startsWith(w) ? 40 : name.includes(w) ? 25 : 5;
    score -= p.split("/").length * 1.5 + p.length * 0.02;
    out.push({ p, score });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit).map(x => x.p);
}
