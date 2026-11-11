// Folders for the New space dialog: listing one folder (anywhere, also outside the home
// folder), the drives, and a background index of the folders under home for searching.
import { exec, home } from "herdr";
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
async function powershell(script) {
  // UTF-8 out, so non-English folder names come back intact.
  const wrapped = "$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);" + script;
  const r = await exec("powershell", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", base64(utf16le(wrapped))], { timeout: 8000 });
  return r.code === 0 ? r.stdout : "";
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
    const out = await powershell("[IO.DriveInfo]::GetDrives() | Where-Object { $_.IsReady -and $_.DriveType -in 'Fixed','Removable','Network' } | ForEach-Object { $_.Name }");
    const list = out.split(/\r?\n/).map(s => norm(s.trim()).replace(/\/$/, "")).filter(Boolean);
    return list.length ? list : ["C:"];
  } catch { return ["C:"]; }
}

// --- The index: every folder under home a few levels down, built once in the background and
// kept while the mod is loaded. Heavy or tool folders are skipped; so are hidden ones.
const SKIP = new Set(["node_modules", "appdata", "library", "application data", "local settings", "$recycle.bin", "target", "dist", "build", "out",
  "vendor", "venv", "__pycache__", "bin", "obj", "pkgs", "site-packages", "go", "miniconda3", "anaconda3", "scoop", "onedrive", "icloud drive"]);
const DEPTH = 6, LIMIT = 40000;
let index = null; // { folders: string[], done: boolean }

/** The folder index, starting it the first time; it grows in place until `done`. */
export function folderIndex() {
  if (!index) {
    index = { folders: [], done: false };
    build(index);
  }
  return index;
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
          if (depth + 1 < DEPTH) next.push({ dir: path, depth: depth + 1 });
        }
      }));
    }
    queue = next;
  }
  ix.done = true;
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
