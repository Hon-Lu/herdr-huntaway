// Herdr's Markdown view draws text well but no images at all, and centers nothing.
// This splits a Markdown file into blocks the file tab draws itself:
//   { kind: "md", text }                 Markdown text, for TextView.markdown
//   { kind: "html", html, center }       an HTML fragment's text, for TextView.html
//   { kind: "images", items, center }    a row of images (badges, buttons, screenshots)
//   { kind: "table", head, rows }        a table with images in it; cells are { text, items }
// An image item is { src, alt, width, href }. Code blocks are left alone.

const IMG_MD = /(\[\s*)?!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+["'][^"']*["'])?\s*\)(\s*\]\(\s*([^)\s]+)[^)]*\))?/g;
const IMG_HTML = /(<a\b[^>]*?\bhref\s*=\s*["']([^"']*)["'][^>]*>\s*)?<img\b([^>]*?)\/?>(\s*<\/a>)?/gi;
const attr = (tag, name) => new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i").exec(tag)?.[1] ?? new RegExp(`\\b${name}\\s*=\\s*([^\\s>]+)`, "i").exec(tag)?.[1] ?? null;
const visible = html => html.replace(/<[^>]*>/g, "").replace(/&nbsp;|&#160;/g, " ").replace(/[\s|｜·•]+/g, "").length > 0;
const FENCE = /^\s{0,3}(```|~~~)/;
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const HTML_START = /^\s*<\/?(div|p|h[1-6]|center|picture|source|a|img|br|table|thead|tbody|tr|td|th|details|summary|sub|sup|strong|em|b|i|span)\b/i;

/** Images in a run of Markdown text, and the text without them. */
function mdImages(text) {
  const items = [];
  const rest = text.replace(IMG_MD, (_m, _open, alt, src, _close, href) => { items.push({ src, alt, width: null, href: href ?? null }); return " "; });
  return { items, rest: rest.replace(/\[\s*\]\([^)]*\)/g, "") };
}

/** Images in an HTML fragment, in order, split from the text around them. */
function htmlParts(html) {
  const parts = [];
  let last = 0, m;
  IMG_HTML.lastIndex = 0;
  while ((m = IMG_HTML.exec(html))) {
    if (m.index > last) parts.push({ text: html.slice(last, m.index) });
    const tag = m[3];
    const src = attr(tag, "src");
    if (src) parts.push({ item: { src, alt: attr(tag, "alt") ?? "", width: Number(attr(tag, "width")) || null, href: m[2] ?? null } });
    last = m.index + m[0].length;
  }
  if (last < html.length) parts.push({ text: html.slice(last) });
  return parts;
}

/** Open tags still open at the end of `html`, as their opening text: carried into the next piece. */
function openTags(html, stack) {
  for (const m of html.matchAll(/<\s*(\/)?\s*([a-z][a-z0-9]*)\b[^>]*?(\/)?>/gi)) {
    const name = m[2].toLowerCase();
    if (m[3] || ["br", "img", "hr", "source"].includes(name)) continue;
    if (m[1]) { const i = stack.map(s => s.name).lastIndexOf(name); if (i >= 0) stack.splice(i); }
    else stack.push({ name, open: m[0] });
  }
  return stack;
}

/** One HTML block (it may span blank lines inside a <div>), as html and image blocks. */
function htmlBlock(html, center, out) {
  const stack = [];
  let row = null;
  const flush = () => { if (row) { out.push({ kind: "images", items: row, center }); row = null; } };
  for (const part of htmlParts(html)) {
    if (part.item) { (row ??= []).push(part.item); continue; }
    const before = stack.map(s => s.open).join("");
    openTags(part.text, stack);
    // Whitespace, &nbsp; and tags alone keep a row of images together; a break or new paragraph ends it.
    if (!visible(part.text)) { if (/<br\b|<\/p>|<p\b|<\/h\d>|<h\d\b|<\/div>|<div\b/i.test(part.text)) flush(); continue; }
    flush();
    if (!center) { out.push({ kind: "html", html: before + part.text, center }); continue; }
    // Centered: one block per paragraph or heading, so each centers on its own width.
    const pieces = (before + part.text).split(/(?<=<\/(?:p|h[1-6]|div|center)>)/i);
    for (const piece of pieces) if (visible(piece)) out.push({ kind: "html", html: piece, center });
  }
  flush();
}

const cells = line => line.trim().replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/).map(c => c.trim());

/** Splits Markdown into blocks; see the top of this file. */
export function parseMarkdown(source) {
  const lines = source.replace(/^﻿/, "").replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  let md = [];
  const flushMd = () => { if (md.join("").trim()) out.push({ kind: "md", text: md.join("\n") }); md = []; };
  let fence = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (fence) { md.push(line); if (line.trim().startsWith(fence)) fence = null; continue; }
    const f = FENCE.exec(line);
    if (f) { fence = f[1]; md.push(line); continue; }

    // An HTML block: up to a blank line, or for a <div>, up to its closing tag.
    if (HTML_START.test(line)) {
      let j = i, depth = 0;
      const block = [];
      for (; j < lines.length; j++) {
        const l = lines[j];
        if (j > i && !l.trim() && depth <= 0) break;
        depth += (l.match(/<div\b/gi) ?? []).length - (l.match(/<\/div>/gi) ?? []).length;
        block.push(l);
        if (depth <= 0 && j > i && !lines[j + 1]?.trim()) { j++; break; }
      }
      const html = block.join("\n");
      if (/<img\b/i.test(html) || /\balign\s*=\s*["']?center/i.test(html)) {
        flushMd();
        htmlBlock(html, /\balign\s*=\s*["']?center/i.test(html), out);
        i = j - 1;
        continue;
      }
      md.push(...block); i = j - 1; continue;
    }

    // A table with images in it.
    if (line.includes("|") && TABLE_SEP.test(lines[i + 1] ?? "")) {
      let j = i + 2;
      while (j < lines.length && lines[j].includes("|") && lines[j].trim()) j++;
      const rows = lines.slice(i + 2, j).map(cells);
      if (rows.some(r => r.some(c => /!\[|<img\b/i.test(c)))) {
        flushMd();
        const cell = c => { const { items, rest } = mdImages(c); const html = htmlParts(rest); return { text: html.filter(p => p.text).map(p => p.text).join(" ").trim(), items: [...items, ...html.filter(p => p.item).map(p => p.item)] }; };
        out.push({ kind: "table", head: cells(line).map(cell), rows: rows.map(r => r.map(cell)) });
        i = j - 1;
        continue;
      }
      md.push(...lines.slice(i, j)); i = j - 1; continue;
    }

    // Images on a line of their own, or inside text: the text stays, the images follow it.
    if (/!\[[^\]]*\]\(/.test(line)) {
      const { items, rest } = mdImages(line);
      if (rest.trim()) md.push(rest);
      flushMd();
      out.push({ kind: "images", items, center: false });
      continue;
    }
    md.push(line);
  }
  flushMd();
  return out;
}

/** Every image a parsed file shows, for loading. */
export function imageSources(blocks) {
  const out = [];
  for (const b of blocks) {
    if (b.kind === "images") out.push(...b.items.map(x => x.src));
    if (b.kind === "table") for (const r of [b.head, ...b.rows]) for (const c of r) out.push(...c.items.map(x => x.src));
  }
  return [...new Set(out)];
}
