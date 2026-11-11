// Path helpers. Internally every path uses forward slashes, has no trailing
// slash (except a root: "/", "C:/", "//server/share") and keeps its spelling.
import { home, window as appWindow } from "herdr";

export const platform = () => appWindow()?.platform ?? "linux";
export const isWindows = () => platform() === "windows";
export const isMac = () => platform() === "macos";
/** Local Windows paths compare case-insensitively. */
export const localWindows = on => !on && isWindows();

export function norm(path) {
  if (!path) return path ?? null;
  let s = String(path).replace(/\\/g, "/");
  const unc = s.startsWith("//");
  s = s.replace(/\/{2,}/g, "/");
  if (unc) s = "/" + s;
  if (/^[a-z]:$/i.test(s)) s += "/";
  if (/^[a-z]:\//i.test(s)) s = s[0].toUpperCase() + s.slice(1);
  while (s.length > 1 && s.endsWith("/") && !/^[A-Z]:\/$/.test(s)) s = s.slice(0, -1);
  return s;
}

export const isRoot = p => p === "/" || /^[A-Z]:\/$/.test(p) || /^\/\/[^/]+\/[^/]+$/.test(p);
export const join = (dir, name) => dir.endsWith("/") ? dir + name : `${dir}/${name}`;
export function dirname(p) {
  if (isRoot(p)) return p;
  const i = p.lastIndexOf("/");
  if (i < 0) return p;
  const parent = p.slice(0, i);
  if (/^[A-Z]:$/.test(parent)) return parent + "/";
  return parent || "/";
}
export function basename(p) {
  if (isRoot(p)) return p.replace(/\/$/, "") || "/";
  return p.slice(p.lastIndexOf("/") + 1);
}
export function extname(name) {
  const base = name.slice(name.lastIndexOf("/") + 1), dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

/** A comparison key: case-folded on local Windows. */
export const key = (p, on) => localWindows(on) ? p.toLowerCase() : p;
export function contains(parent, child, on) {
  const a = key(parent, on), b = key(child, on);
  return a === b || b.startsWith(a.endsWith("/") ? a : a + "/");
}
export function relative(root, p, on) {
  if (key(root, on) === key(p, on)) return "";
  if (!contains(root, p, on)) return p;
  return p.slice(root.length + (root.endsWith("/") ? 0 : 1));
}

/** What a person sees and copies: backslashes on local Windows. */
export const display = (p, on) => p && localWindows(on) ? p.replace(/\//g, "\\") : p;

export function homeDir() { return norm(home()); }
export function underHome(p, on) {
  if (on || !p) return false;
  const h = homeDir();
  return Boolean(h) && contains(h, p, on);
}
/** ~/Desktop/x for paths in the home folder. */
export function friendly(p, on) {
  if (!p) return "";
  if (!on && underHome(p, on)) {
    const rel = relative(homeDir(), p, on);
    return rel ? `~/${rel}` : "~";
  }
  return p;
}

/** Natural, case-insensitive name order; folders first. */
const collator = typeof Intl !== "undefined" ? new Intl.Collator(undefined, { numeric: true, sensitivity: "base" }) : null;
export const compareNames = (a, b) => collator ? collator.compare(a, b) : a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0;
export const compareEntries = (a, b) => (b.dir - a.dir) || compareNames(a.name, b.name);

export function validName(name) {
  const n = name.trim();
  if (!n || n === "." || n === "..") return "Enter a name";
  if (/[\\/\x00-\x1f\x7f]/.test(n)) return "A name cannot contain / or \\";
  if (isWindows() && /[<>:"|?*]/.test(n)) return 'A name cannot contain < > : " | ? *';
  if (isWindows() && /[. ]$/.test(n)) return "A name cannot end with a dot or a space";
  return null;
}
