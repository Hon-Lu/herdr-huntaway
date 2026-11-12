// Everything that touches the disk or starts a program.
//
// Speed: folders in the home folder are read in-process with fs/promises
// (a millisecond or two, no process). Anything else (another drive, a remote
// machine) is listed by one program call for every folder that needs it, so
// expanding or refreshing never starts one process per folder. On this
// Windows machine that call is cmd (a fifth of a second), with PowerShell
// (two seconds) only for what cmd can't read or spell.
//
// Encoding: Windows PowerShell writes in the console code page (CP950 on a
// Traditional Chinese system), while exec decodes UTF-8, which turns Chinese
// names into mojibake. Every PowerShell call here sets UTF-8 output first and
// receives its script as -EncodedCommand (UTF-16), so paths with spaces,
// quotes or non-ASCII characters never pass through a command line.
import * as fs from "fs/promises";
import { exec, readTextFile, writeTextFile, appHome } from "herdr";
import { norm, join, dirname, basename, extname, isWindows, isMac, localWindows, underHome, display, key } from "./paths.js";

export const MAX_PER_FOLDER = 5000;

// ---- program helpers ------------------------------------------------------

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
/** A PowerShell single-quoted literal. PowerShell treats curly single quotes as quotes too. */
export const psq = s => "'" + String(s).replace(/['‘’‚‛]/g, "$&$&") + "'";

const PRELUDE = "$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);";
/** Runs a script; failures come back as an Error with PowerShell's message. */
export async function powershell(script, { on = null, timeout = 30000 } = {}) {
  const wrapped = `${PRELUDE}try { ${script} } catch { [Console]::Out.WriteLine("@@ERR@@" + $_.Exception.Message); exit 1 }`;
  const r = await exec("powershell", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", base64(utf16le(wrapped))], { on, timeout });
  if (r.code !== 0) {
    const m = r.stdout.split("@@ERR@@")[1];
    throw new Error((m ?? r.stderr ?? "").trim() || "PowerShell failed");
  }
  return r.stdout;
}
/** Runs a POSIX shell script with arguments ($1, $2, ...). */
export async function sh(script, args, { on = null, timeout = 30000 } = {}) {
  const r = await exec("sh", ["-c", script, "huntaway-files", ...args], { on, timeout });
  if (r.code !== 0) throw new Error(r.stderr.trim() || r.stdout.trim() || "Command failed");
  return r.stdout;
}
/** Remote Windows machines have no sh. */
const noShell = e => /cannot start sh|program not found|not recognized/i.test(String(e));

// ---- listing ---------------------------------------------------------------

/** Folders the in-process reader refused (outside every granted root). */
const refused = new Set();

async function readInProcess(path) {
  const list = await fs.readdir(path, { withFileTypes: true });
  return list.map(d => ({ name: d.name, dir: d.isDirectory() }));
}

const PS_LIST = paths => `foreach ($p in @(${paths.map(psq).join(",")})) {
  [Console]::Out.Write("D\`t" + $p + "\`n")
  try {
    $n = 0
    foreach ($i in [IO.DirectoryInfo]::new($p).EnumerateFileSystemInfos()) {
      if ($n -ge ${MAX_PER_FOLDER + 1}) { break }; $n++
      $d = ($i.Attributes -band [IO.FileAttributes]::Directory) -ne 0
      if ($d -and ($i.Attributes -band [IO.FileAttributes]::ReparsePoint) -and -not [IO.Directory]::Exists($i.FullName)) { $d = $false }
      [Console]::Out.Write($(if ($d) { "d" } else { "f" }) + "\`t" + $i.Name + "\`n")
    }
  } catch { [Console]::Out.Write("E\`t" + $(if ($_.Exception.InnerException) { $_.Exception.InnerException.Message } else { $_.Exception.Message }) + "\`n") }
}`;

function parsePowerShell(text, out) {
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    const tab = line.indexOf("\t");
    if (tab < 0) continue;
    const kind = line.slice(0, tab), value = line.slice(tab + 1);
    if (kind === "D") { current = { entries: [] }; out.set(norm(value), current); }
    else if (!current) continue;
    else if (kind === "E") current.error = value.trim() || "Cannot read this folder";
    else current.entries.push({ name: value, dir: kind === "d" });
  }
}

const SH_LIST = `for d in "$@"; do printf 'D\\0%s\\0' "$d"
if [ -d "$d" ] && [ -r "$d" ] && [ -x "$d" ]; then n=0
for p in "$d"/* "$d"/.[!.]* "$d"/..?*; do [ -e "$p" ] || [ -L "$p" ] || continue
n=$((n+1)); [ "$n" -gt ${MAX_PER_FOLDER + 1} ] && break
if [ -d "$p" ]; then k=d; else k=f; fi; printf '%s\\0%s\\0' "$k" "\${p##*/}"; done
else printf 'E\\0%s\\0' "Cannot read this folder"; fi; done`;

function parseShell(text, out) {
  const f = text.split("\0");
  let current = null;
  for (let i = 0; i + 1 < f.length; i += 2) {
    if (f[i] === "D") { current = { entries: [] }; out.set(norm(f[i + 1]), current); }
    else if (!current) continue;
    else if (f[i] === "E") current.error = f[i + 1];
    else current.entries.push({ name: f[i + 1], dir: f[i] === "d" });
  }
}

// cmd's `dir` starts in a fifth of a second where PowerShell takes two, so this machine's folders
// outside home go to cmd first. Per folder it prints a header, `::K` when the folder can be read,
// its folders, `::F`, its files; `::X` when it doesn't exist (`:` can't be in a name). Each path
// is its own argument (quoted when it has spaces); one with cmd's own symbols goes to PowerShell,
// and so does one cmd can't read (PowerShell has the reason).
// Run by Herdr, cmd has no console and would write names in the system code page (Chinese ones
// arrive garbled), so its output goes UTF-16 (`/u`) into a file in the cache, read back as bytes.
const CMD_UNSAFE = /[&|<>^%!()",;=]/;
const CMD_LIMIT = 7000; // cmd takes 8191 characters
let cmdRuns = 0;

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
  const file = `${await cacheDir()}/cmd-${Date.now()}-${++cmdRuns}.txt`;
  if (CMD_UNSAFE.test(file)) return null;
  try {
    await exec("cmd", ["/d", "/u", "/c", "(", ...args, ")", ">", display(file, null)], { timeout: 30000 });
    return fromUtf16(await fs.readFile(file));
  } catch { return null; }
  finally { await fs.unlink(file).catch(() => {}); }
}

/** Lists what cmd can into `out`; returns the paths left for PowerShell. */
async function listByCmd(paths, out) {
  const left = [], todo = [];
  for (const p of paths) (CMD_UNSAFE.test(display(p, null)) ? left : todo).push(p);
  for (let i = 0; i < todo.length;) {
    const batch = [], args = [];
    let size = 0;
    while (i < todo.length && (batch.length === 0 || size + todo[i].length * 4 + 120 < CMD_LIMIT)) {
      const p = todo[i++], d = display(p, null), slash = d.endsWith("\\") ? d : d + "\\";
      if (batch.length) args.push("&");
      // The whole `if` in parentheses: an else part takes in the rest of the line, so without
      // them every folder after this one would run only when this one is missing.
      args.push("echo", `::D${batch.length}`, "&", "(", "if", "exist", slash,
        "(", "(", "dir", "/a", d, ">nul", "2>nul", "&&", "echo", "::K", ")",
        "&", "dir", "/a:d", "/b", d, "2>nul", "&", "echo", "::F", "&", "dir", "/a:-d", "/b", d, "2>nul",
        ")", "else", "(", "echo", "::X", ")", ")");
      size += p.length * 4 + 120; batch.push(p);
    }
    const text = await cmdText(args);
    if (text === null) { left.push(...batch); continue; }
    const found = new Map();
    let current = null;
    for (const line of text.split(/\r?\n/)) {
      const mark = line.trimEnd(), head = /^::D(\d+)$/.exec(mark);
      if (head) { current = { readable: false, missing: false, files: false, entries: [] }; found.set(Number(head[1]), current); }
      else if (!current || !line) continue;
      else if (mark === "::K") current.readable = true;
      else if (mark === "::X") current.missing = true;
      else if (mark === "::F") current.files = true;
      else current.entries.push({ name: line, dir: !current.files });
    }
    batch.forEach((p, n) => {
      const r = found.get(n);
      if (r?.missing) out.set(norm(p), { entries: [], error: "This folder no longer exists" });
      else if (r?.readable && r.files) out.set(norm(p), { entries: r.entries });
      else left.push(p);
    });
  }
  return left;
}

async function listByProgram(paths, on) {
  const out = new Map();
  const viaPowerShell = async paths => {
    // Keep each encoded command well below Windows' 32k command line.
    for (let i = 0; i < paths.length;) {
      const batch = [];
      let size = 0;
      while (i < paths.length && (batch.length === 0 || size + paths[i].length < 2500)) { size += paths[i].length; batch.push(paths[i++]); }
      parsePowerShell(await powershell(PS_LIST(batch.map(p => display(p, null))), { on }), out);
    }
  };
  if (localWindows(on)) {
    const left = await listByCmd(paths, out);
    if (left.length) await viaPowerShell(left);
  } else {
    try { parseShell(await sh(SH_LIST, paths, { on }), out); }
    catch (e) { if (on && noShell(e)) await viaPowerShell(paths); else throw e; }
  }
  // PowerShell reports Windows spelling; map back to the requested paths.
  const result = new Map();
  for (const p of paths) result.set(p, out.get(norm(p)) ?? [...out.entries()].find(([k]) => key(k, on) === key(p, on))?.[1] ?? { entries: [], error: "Cannot read this folder" });
  return result;
}

/**
 * Lists several folders at once. Resolves to Map(path -> { entries, error? }).
 * Entries are unsorted { name, dir }.
 */
export async function listFolders(paths, on) {
  const result = new Map(), slow = [];
  await Promise.all(paths.map(async p => {
    if (on || !underHome(p, on) || refused.has(dirname(p)) || refused.has(p)) { slow.push(p); return; }
    try { result.set(p, { entries: await readInProcess(p) }); }
    catch (e) {
      const m = String(e?.message ?? e);
      if (/granted read root|capabilit/i.test(m)) { refused.add(p); slow.push(p); }
      else result.set(p, { entries: [], error: /not found|no such|cannot find|os error [23]\b|找不到/i.test(m) ? "This folder no longer exists" : m.replace(/^\w*Error:\s*/, "") });
    }
  }));
  if (slow.length) {
    try { for (const [p, v] of await listByProgram(slow, on)) result.set(p, v); }
    catch (e) { for (const p of slow) result.set(p, { entries: [], error: String(e?.message ?? e) }); }
  }
  return result;
}

// ---- search index ------------------------------------------------------------

const SKIP = new Set(["node_modules", ".git", ".hg", ".svn", "dist", "build", "out", "target", ".next", ".nuxt", ".turbo",
  ".cache", "__pycache__", ".venv", "venv", ".gradle", ".idea", "vendor", "coverage", ".pytest_cache", ".mypy_cache", "bin", "obj"]);
export const INDEX_LIMIT = 50000;

/** Relative file paths under root: git's list when it's a repository, else a bounded walk. */
export async function fileIndex(root, on, gitTop) {
  if (gitTop) {
    try {
      const r = await exec("git", ["-c", "core.quotepath=false", "ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", "."], { cwd: root, on, timeout: 20000 });
      if (r.code === 0) {
        const list = r.stdout.split("\0").filter(Boolean);
        return { files: list.slice(0, INDEX_LIMIT), limited: list.length > INDEX_LIMIT };
      }
    } catch {}
  }
  if (!on && underHome(root, on)) {
    const files = [], queue = [""];
    while (queue.length && files.length < INDEX_LIMIT) {
      const rel = queue.shift();
      let list;
      try { list = await readInProcess(rel ? join(root, rel) : root); } catch { continue; }
      for (const e of list) {
        const p = rel ? `${rel}/${e.name}` : e.name;
        if (e.dir) { if (!SKIP.has(e.name)) queue.push(p); }
        else files.push(p);
      }
    }
    return { files: files.slice(0, INDEX_LIMIT), limited: files.length >= INDEX_LIMIT || queue.length > 0 };
  }
  if (localWindows(on)) {
    const skip = [...SKIP].map(psq).join(",");
    const text = await powershell(`$skip = [Collections.Generic.HashSet[string]]::new([string[]]@(${skip}), [StringComparer]::OrdinalIgnoreCase)
      $root = ${psq(display(root, on))}; $q = [Collections.Generic.Queue[string]]::new(); $q.Enqueue($root); $n = 0
      $out = [Text.StringBuilder]::new()
      while ($q.Count -gt 0 -and $n -lt ${INDEX_LIMIT}) { $d = $q.Dequeue()
        try { foreach ($i in [IO.DirectoryInfo]::new($d).EnumerateFileSystemInfos()) {
          if ($i.Attributes -band [IO.FileAttributes]::Directory) { if (-not $skip.Contains($i.Name) -and -not ($i.Attributes -band [IO.FileAttributes]::ReparsePoint)) { $q.Enqueue($i.FullName) } }
          else { [void]$out.Append($i.FullName.Substring($root.TrimEnd('\\').Length + 1)).Append([char]0); $n++ } } } catch {} }
      [Console]::Out.Write($out.ToString())`, { on, timeout: 30000 });
    const files = text.split("\0").filter(Boolean).map(p => p.replace(/\\/g, "/"));
    return { files, limited: files.length >= INDEX_LIMIT };
  }
  const prune = [...SKIP].map(n => `-name '${n}'`).join(" -o ");
  const text = await sh(`cd "$1" && find . \\( ${prune} \\) -prune -o -type f -print0 2>/dev/null | head -c 8000000`, [root], { on, timeout: 30000 });
  const files = text.split("\0").filter(Boolean).map(p => p.replace(/^\.\//, "")).slice(0, INDEX_LIMIT);
  return { files, limited: files.length >= INDEX_LIMIT };
}

/** Fuzzy match: every query character in order; contiguous and name matches score higher. */
export function rank(files, query, limit = 300) {
  const q = query.toLowerCase().replace(/\\/g, "/").trim();
  if (!q) return [];
  const words = q.split(/\s+/).filter(Boolean), out = [];
  for (const file of files) {
    const lower = file.toLowerCase(), slash = lower.lastIndexOf("/"), name = lower.slice(slash + 1);
    let score = 0, ok = true;
    for (const w of words) {
      const inName = name.indexOf(w), inPath = lower.indexOf(w);
      if (inName >= 0) score += 100 - Math.min(inName, 50) + (inName === 0 ? 40 : 0) + (name === w ? 80 : 0);
      else if (inPath >= 0) score += 40 - Math.min(inPath / 10, 30);
      else {
        let i = 0, gaps = 0, last = -1;
        for (const ch of w) { const at = lower.indexOf(ch, i); if (at < 0) { ok = false; break; } if (last >= 0 && at !== last + 1) gaps++; last = at; i = at + 1; }
        if (!ok) break;
        score += 10 - Math.min(gaps, 9) + (last > slash ? 5 : 0);
      }
    }
    if (ok) out.push({ file, score: score - file.length / 200 });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit).map(r => r.file);
}

// ---- git ---------------------------------------------------------------------

const GIT = ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "core.quotepath=false"];
export async function gitTop(root, on) {
  try {
    const r = await exec("git", [...GIT, "rev-parse", "--show-toplevel"], { cwd: root, on, timeout: 10000 });
    return r.code === 0 ? norm(r.stdout.trim()) : null;
  } catch { return null; }
}
export async function gitBranch(top, on) {
  try {
    const r = await exec("git", [...GIT, "branch", "--show-current"], { cwd: top, on, timeout: 10000 });
    return r.code === 0 ? r.stdout.trim() || null : null;
  } catch { return null; }
}
/**
 * Git status as Map(relative path -> mark) plus folder marks. Marks: M modified, A added,
 * D deleted, R renamed, U untracked, C conflict, I ignored. Paths ending in "/" are folders.
 */
export async function gitStatus(top, on) {
  const r = await exec("git", [...GIT, "status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=normal", "--ignored=matching"], { cwd: top, on, timeout: 20000 });
  if (r.code !== 0) return null;
  const files = new Map();
  let n = 0;
  for (const entry of r.stdout.split("\0")) {
    if (entry.length < 4 || ++n > 20000) continue;
    const xy = entry.slice(0, 2), path = entry.slice(3);
    const mark = xy === "!!" ? "I" : xy === "??" ? "U" : xy.includes("U") || xy === "AA" || xy === "DD" ? "C"
      : xy.includes("D") ? "D" : xy.includes("A") ? "A" : xy.includes("R") ? "R" : "M";
    files.set(path, mark);
  }
  return files;
}

// ---- reading and writing files -------------------------------------------------

export const IMAGE = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "ico", "tif", "tiff", "avif"]);
export const BINARY = new Set(["exe", "dll", "so", "dylib", "bin", "o", "a", "lib", "obj", "pdb", "class", "jar", "war", "zip", "7z", "rar", "gz",
  "tgz", "bz2", "xz", "zst", "tar", "iso", "dmg", "msi", "pkg", "deb", "rpm", "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt",
  "mp3", "wav", "flac", "ogg", "m4a", "aac", "mp4", "mkv", "mov", "avi", "webm", "wmv", "ttf", "otf", "woff", "woff2", "eot", "psd", "ai",
  "sqlite", "db", "pyc", "wasm", "node", "nupkg", "apk", "ipa", "heic", "raw", "cr2", "blend", "fbx", "glb", "lockb"]);
export const kindOf = name => {
  const ext = extname(name);
  return IMAGE.has(ext) ? "image" : BINARY.has(ext) ? "binary" : ext === "md" || ext === "markdown" || ext === "mdx" ? "markdown" : "text";
};

export async function readText(path, on) {
  try { return await readTextFile(path, { on }); }
  catch (e) {
    const m = String(e?.message ?? e);
    throw new Error(/too large|1 ?mib|limit/i.test(m) ? "This file is larger than 1 MB" : /utf-?8|invalid|decode/i.test(m) ? "Not a text file" : m);
  }
}
/** Saves only if the file still holds `expected`. */
export const writeText = (path, text, expected) => writeTextFile(path, text, expected);

const CACHE = ".cache/huntaway-files";
let cacheSwept = false;
/** The cache folder, swept of files older than an hour the first time it is used. */
async function cacheDir() {
  const dir = join(norm(appHome()), CACHE);
  try { await fs.mkdir(dir, { recursive: true }); } catch {}
  if (!cacheSwept) {
    cacheSwept = true;
    try {
      const now = Date.now();
      for (const name of await fs.readdir(dir)) {
        const at = Number(name.split("-")[1]);
        if (!at || now - at > 3600e3) await fs.unlink(join(dir, name)).catch(() => {});
      }
    } catch {}
  }
  return dir;
}

let cacheSeq = 0;
function cacheName(source, ext) {
  let hash = 0;
  for (const ch of source) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return `${hash.toString(36)}-${Date.now()}${(cacheSeq++).toString(36)}.${ext || "img"}`;
}

/**
 * Copies files and downloads web addresses into the cache in one go, with the system's own
 * tools: Herdr's fs.writeFile writes binary data as 0 bytes, and fetch has no binary body.
 * `jobs`: [{ from, to }] where `from` is a path or an http(s) address. Missing files are skipped.
 */
async function fill(jobs) {
  if (!jobs.length) return;
  if (isWindows()) {
    const lines = jobs.map(({ from, to }) => /^https?:/i.test(from)
      ? `try { & curl.exe -sSL --max-time 20 -o ${psq(display(to, null))} ${psq(from)} } catch {}`
      : `try { Copy-Item -LiteralPath ${psq(display(from, null))} -Destination ${psq(display(to, null))} -Force } catch {}`);
    await powershell(lines.join("\n"), { timeout: 60000 });
  } else {
    const args = jobs.flatMap(({ from, to }) => [from, to]);
    await sh('while [ $# -gt 1 ]; do case "$1" in http://*|https://*) curl -sSL --max-time 20 -o "$2" "$1" ;; *) cp -- "$1" "$2" ;; esac; shift 2; done 2>/dev/null; true', args, { timeout: 60000 });
  }
}

/**
 * SVGs styled with CSS variables (`fill: var(--bg)`) draw black in Herdr: its SVG renderer has
 * no var(). Rewrites a cached SVG with the values put in, the dark-scheme ones on a dark theme.
 */
async function resolveSvgVars(file, dark) {
  let text;
  try { text = await fs.readFile(file, "utf8"); } catch { return; }
  if (!/var\(--/.test(text)) return;
  const css = [...text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map(m => m[1]).join("\n");
  const media = /@media[^{]*prefers-color-scheme\s*:\s*(dark|light)[^{]*\{((?:[^{}]*\{[^{}]*\})*[^{}]*)\}/gi;
  const vars = {};
  const take = (block, force) => { for (const m of block.matchAll(/--([\w-]+)\s*:\s*([^;}]+)/g)) if (force || !(m[1] in vars)) vars[m[1]] = m[2].trim(); };
  take(css.replace(media, ""), false);
  for (const m of css.matchAll(media)) if ((m[1].toLowerCase() === "dark") === dark) take(m[2], true);
  let out = text, guard = 0;
  while (/var\(--/.test(out) && guard++ < 5) out = out.replace(/var\(\s*--([\w-]+)\s*(?:,\s*([^)]+))?\)/g, (_m, name, fallback) => vars[name] ?? (fallback ?? "currentColor").trim());
  try { await fs.writeFile(file, out); } catch {}
}

/** Copies an image under the app folder (image() reads only there) and returns the app-relative path. */
export async function cacheImage(path, on, dark = true) {
  if (on) throw new Error("Image preview is only available for files on this computer");
  const dir = await cacheDir(), name = cacheName(path, extname(path));
  await fill([{ from: path, to: join(dir, name) }]);
  if (!(await fs.exists(join(dir, name)))) throw new Error("Could not read the image");
  if (/\.svg$/i.test(name)) await resolveSvgVars(join(dir, name), dark);
  return `${CACHE}/${name}`;
}
/** The size of an image already in the cache, or null. */
export async function cachedImageSize(rel) {
  try { return imageSize(await fs.readFile(join(norm(appHome()), rel))); } catch { return null; }
}

export async function dropCached(rel) {
  if (rel) try { await fs.unlink(join(norm(appHome()), rel)); } catch {}
}

/** An image's size in pixels from its first bytes: PNG, GIF, JPEG, WebP, BMP or SVG. null if unknown. */
export function imageSize(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const u16be = i => (b[i] << 8) | b[i + 1], u16le = i => b[i] | (b[i + 1] << 8);
  const u32be = i => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
  const u32le = i => b[i] + (b[i + 1] << 8) + (b[i + 2] << 16) + ((b[i + 3] << 24) >>> 0);
  if (b.length < 24) return null;
  if (b[0] === 0x89 && b[1] === 0x50) return { w: u32be(16), h: u32be(20) };
  if (b[0] === 0x47 && b[1] === 0x49) return { w: u16le(6), h: u16le(8) };
  if (b[0] === 0x42 && b[1] === 0x4d) return { w: u32le(18), h: Math.abs(u32le(22) | 0) };
  if (b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45) {
    const kind = String.fromCharCode(b[12], b[13], b[14], b[15]);
    if (kind === "VP8 ") return { w: u16le(26) & 0x3fff, h: u16le(28) & 0x3fff };
    if (kind === "VP8L") { const v = u32le(21); return { w: (v & 0x3fff) + 1, h: ((v >> 14) & 0x3fff) + 1 }; }
    if (kind === "VP8X") return { w: 1 + b[24] + (b[25] << 8) + (b[26] << 16), h: 1 + b[27] + (b[28] << 8) + (b[29] << 16) };
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    for (let i = 2; i + 9 < b.length;) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { w: u16be(i + 7), h: u16be(i + 5) };
      i += 2 + u16be(i + 2);
    }
    return null;
  }
  // SVG: width/height, else the viewBox.
  // The runtime has no TextDecoder; the tag's attributes are ASCII, so bytes as characters will do.
  let head = "";
  for (let i = 0; i < Math.min(b.length, 4096); i++) head += String.fromCharCode(b[i]);
  const tag = /<svg\b[^>]*>/i.exec(head)?.[0];
  if (!tag) return null;
  const num = name => { const m = new RegExp(`\\b${name}\\s*=\\s*["']\\s*([\\d.]+)(px)?\\s*["']`, "i").exec(tag); return m ? Number(m[1]) : null; };
  const vb = /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(tag);
  const w = num("width") ?? (vb ? Number(vb[1]) : null), h = num("height") ?? (vb ? Number(vb[2]) : null);
  return w && h ? { w, h } : null;
}

/**
 * The images a Markdown file points at, made ready to draw in one batch: local paths (relative
 * to the file's folder) are copied into the cache, web addresses downloaded into it.
 * Returns a Map from each source to { rel, size } or { error }.
 */
export async function cacheMarkdownImages(sources, fileDir, on, dark = true) {
  const out = new Map(), jobs = [], dir = await cacheDir();
  for (const src of sources) {
    let from = src, ext;
    if (/^https?:\/\//i.test(src)) {
      ext = /\.(png|jpe?g|gif|webp|svg|bmp)(?:[?#]|$)/i.exec(src)?.[1] ?? (/shields\.io|badge|\.svg/i.test(src) ? "svg" : "img");
    } else {
      if (on) { out.set(src, { error: "Images are shown only for files on this computer" }); continue; }
      let path = decodeURIComponent(src.replace(/^file:\/\/\/?/i, "").replace(/[?#].*$/, ""));
      path = /^([a-z]:)?[\\/]/i.test(path) ? norm(path) : norm(join(fileDir, path));
      const parts = [];
      for (const part of path.split("/")) { if (part === "..") parts.pop(); else if (part !== ".") parts.push(part); }
      from = parts.join("/"); ext = extname(from);
    }
    const name = cacheName(src, ext);
    jobs.push({ src, from, to: join(dir, name), rel: `${CACHE}/${name}` });
  }
  try { await fill(jobs); } catch {}
  for (const job of jobs) {
    try {
      let bytes = await fs.readFile(job.to);
      if (!bytes.length) throw new Error("empty");
      if (bytes[0] === 0x3c || /\.svg$/i.test(job.to)) { await resolveSvgVars(job.to, dark); bytes = await fs.readFile(job.to); }
      let size = null;
      try { size = imageSize(bytes); } catch {}
      out.set(job.src, { rel: job.rel, size });
    } catch {
      out.set(job.src, { error: /^https?:/i.test(job.src) ? "Could not download the image" : "Image file not found" });
    }
  }
  return out;
}

// ---- file operations ------------------------------------------------------------

export async function createFile(path, on) {
  if (!on) {
    try { await writeTextFile(path, "", null); return; }
    catch (e) { throw new Error(/stale|exist|snapshot|changed outside/i.test(String(e)) ? "A file or folder with this name already exists" : String(e?.message ?? e)); }
  }
  try { await sh('[ -e "$1" ] && { echo "A file or folder with this name already exists" >&2; exit 1; }; : > "$1"', [path], { on }); }
  catch (e) { if (noShell(e)) await powershell(`if (Test-Path -LiteralPath ${psq(path)}) { throw "A file or folder with this name already exists" }; New-Item -ItemType File -Path ${psq(path)} | Out-Null`, { on }); else throw e; }
}

export async function createFolder(path, on) {
  if (localWindows(on)) {
    await powershell(`$p = ${psq(display(path, on))}; if (Test-Path -LiteralPath $p) { throw "A file or folder with this name already exists" }; [void][IO.Directory]::CreateDirectory($p)`);
    return;
  }
  try { await sh('[ -e "$1" ] && { echo "A file or folder with this name already exists" >&2; exit 1; }; mkdir -- "$1"', [path], { on }); }
  catch (e) { if (on && noShell(e)) await powershell(`if (Test-Path -LiteralPath ${psq(path)}) { throw "A file or folder with this name already exists" }; [void][IO.Directory]::CreateDirectory(${psq(path)})`, { on }); else throw e; }
}

export async function rename(path, newPath, on) {
  // A case-only rename is the same entry on Windows and macOS: allow it.
  const caseOnly = path.toLowerCase() === newPath.toLowerCase();
  if (localWindows(on)) {
    await powershell(`$a = ${psq(display(path, on))}; $b = ${psq(display(newPath, on))}
      ${caseOnly ? "" : 'if (Test-Path -LiteralPath $b) { throw "A file or folder with this name already exists" }'}
      if ([IO.Directory]::Exists($a)) { if (${caseOnly ? "$true" : "$false"}) { $t = $a + '.~rename'; [IO.Directory]::Move($a, $t); [IO.Directory]::Move($t, $b) } else { [IO.Directory]::Move($a, $b) } }
      else { [IO.File]::Move($a, $b) }`);
    return;
  }
  const guard = caseOnly ? "" : '[ -e "$2" ] && { echo "A file or folder with this name already exists" >&2; exit 1; }; ';
  try { await sh(`${guard}mv -- "$1" "$2"`, [path, newPath], { on }); }
  catch (e) { if (on && noShell(e)) await powershell(`Move-Item -LiteralPath ${psq(path)} -Destination ${psq(newPath)}`, { on }); else throw e; }
}

/** Moves to the Recycle Bin / Trash where there is one; remote machines delete for good. */
export async function remove(path, dir, on) {
  if (localWindows(on)) {
    const method = dir ? "DeleteDirectory" : "DeleteFile";
    await powershell(`Add-Type -AssemblyName Microsoft.VisualBasic
      [Microsoft.VisualBasic.FileIO.FileSystem]::${method}(${psq(display(path, on))}, 'OnlyErrorDialogs', 'SendToRecycleBin')`, { timeout: 120000 });
    return "trash";
  }
  if (!on && isMac()) {
    try {
      await sh(`osascript -e 'on run argv' -e 'tell application "Finder" to delete (POSIX file (item 1 of argv) as alias)' -e 'end run' "$1" >/dev/null`, [path], { timeout: 120000 });
      return "trash";
    } catch {
      await sh('t="$HOME/.Trash/$(basename "$1") $(date +%s)"; mv -- "$1" "$t"', [path]);
      return "trash";
    }
  }
  if (!on) {
    try { await sh('command -v gio >/dev/null && gio trash -- "$1"', [path], { timeout: 120000 }); return "trash"; } catch {}
  }
  try { await sh('rm -rf -- "$1"', [path], { on, timeout: 120000 }); }
  catch (e) { if (on && noShell(e)) await powershell(`Remove-Item -LiteralPath ${psq(path)} -Recurse -Force`, { on, timeout: 120000 }); else throw e; }
  return "deleted";
}

export async function reveal(path, on) {
  if (on) throw new Error("Only files on this computer can be shown in the file manager");
  if (isWindows()) { await exec("explorer.exe", [`/select,${display(path, null)}`]); return; } // explorer exits 1 even on success
  if (isMac()) { await sh('open -R -- "$1"', [path]); return; }
  await sh('xdg-open "$(dirname -- "$1")"', [path]);
}

// On Windows, explorer.exe and rundll32 open at once where PowerShell takes two seconds. Explorer
// opens Documents for a path that doesn't exist and splits its arguments at commas, so the path
// is checked with cmd first; one with a comma or cmd's symbols is left to PowerShell.
export async function openDefault(path, on) {
  if (on) throw new Error("Only files on this computer can be opened with their app");
  if (isWindows()) {
    const p = display(path, null);
    if (/[,&|<>^%!()"]/.test(p)) { await powershell(`Invoke-Item -LiteralPath ${psq(p)}`); return; }
    const there = await exec("cmd", ["/d", "/c", "if", "exist", p, "(", "exit", "0", ")", "else", "(", "exit", "2", ")"], { timeout: 8000 });
    if (there.code !== 0) throw new Error("It no longer exists");
    await exec("explorer.exe", [p]); // explorer exits 1 even on success
    return;
  }
  if (isMac()) { await sh('open -- "$1"', [path]); return; }
  await sh('xdg-open "$1" >/dev/null 2>&1 &', [path]);
}

export async function openUrl(url) {
  if (!/^(https?|mailto):/i.test(url)) return;
  // rundll32 hands the URL to its default app; one with spaces or quotes goes to PowerShell.
  if (isWindows()) {
    if (/^[\x21-\x7e]+$/.test(url) && !url.includes('"')) await exec("rundll32", ["url.dll,FileProtocolHandler", url], { timeout: 8000 });
    else await powershell(`Start-Process ${psq(url)}`);
  }
  else if (isMac()) await sh('open "$1"', [url]);
  else await sh('xdg-open "$1" >/dev/null 2>&1 &', [url]);
}

export { basename, dirname };
