// Feature 09, operation 3 ("Format code"). A small, dependency-free
// indent-based pretty-printer for the HTML this app itself generates
// (htmlRenderer.ts) — not a general-purpose HTML parser. Safe to assume
// well-formed, already-escaped markup (every attribute/text value is
// escaped by the renderer before this ever sees it), so a lightweight
// tag-depth tracker is enough; no need for a full HTML parser dependency
// just to indent our own output.
//
// E2 (HTML Formatting Correction) — this is a PRESENTATION-ONLY
// pretty-printer for the Code tab's own display text. It never touches
// the real rendered/persisted/exported HTML (CodeEditorPanel.tsx's Copy
// HTML, Download, and the Preview iframe all read the untouched raw
// string, never this function's output — see htmlFormatter.test.ts's
// "Raw -> Formatted -> Raw is lossless" tests). What it fixed: every
// tag AND every text run used to become its own line unconditionally,
// so inline content like `Hello <strong>World</strong>` fragmented into
// four separate lines and lost the space between "Hello" and the tag —
// harmless to the actual email, but unreadable in the Code tab. Inline
// elements (see INLINE_ELEMENTS/INLINE_VOID_ELEMENTS below) now stay
// joined on one line, verbatim internal whitespace preserved; every
// other tag (table/tr/td/div/p/headings/ul/ol/li/etc — the default for
// any tag name not explicitly listed as inline) keeps the exact same
// one-tag-per-line/depth-tracking behavior as before.
const VOID_ELEMENTS = new Set(['br', 'img', 'hr', 'meta', 'link', 'input']);
// Standard HTML phrasing-content elements this app's renderer actually
// emits (a, strong, span — see catalog/*.tsx) plus the rest of the
// common inline-text set, so a run of adjacent inline tags/text stays on
// one line instead of being shredded tag-by-tag. Anything NOT in this
// set (including any tag this app doesn't know about) keeps the
// original, safe one-line-per-tag block treatment — this is an
// allowlist, not a denylist, by design.
const INLINE_ELEMENTS = new Set([
  'a', 'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'small', 'sub', 'sup',
  'span', 'font', 'code', 'mark', 'abbr', 'cite', 'q', 'time', 'label',
]);
// `<br>` is the one void element that is genuinely inline text flow
// (a mid-sentence line break) rather than a structural block — every
// other void element (img, hr, meta, link, input) keeps its existing
// own-line treatment untouched.
const INLINE_VOID_ELEMENTS = new Set(['br']);
const INDENT_UNIT = '  ';

function isClosingTag(tag: string): boolean {
  return tag.startsWith('</');
}

function tagNameOf(tag: string): string {
  return tag.match(/^<\/?\s*([a-zA-Z0-9-]+)/)?.[1]?.toLowerCase() ?? '';
}

function isSelfClosingTag(tag: string): boolean {
  if (tag.endsWith('/>')) return true;
  const tagName = tagNameOf(tag);
  return tagName ? VOID_ELEMENTS.has(tagName) : false;
}

export function formatEmailHtml(html: string): string {
  // Split into comments, tags, and text, keeping all three. The comment
  // alternative MUST be tried first and MUST scan to the nearest `-->`
  // (not the nearest `>`): MSO conditional comments such as
  // `<!--[if mso]><table ...><tr><td><![endif]-->` contain real `<tag>`
  // markup inside them, so the old bare `<[^>]+>` tag pattern split a
  // single opaque comment into fake `<table>`/`<tr>`/`<td>` tokens that
  // corrupted depth tracking and shredded the comment across several
  // indented lines. Matching `<!--...-->` as one atomic unit first keeps
  // every MSO/IE conditional comment — including the downlevel-revealed
  // `<!--[if !mso]><!-->...<!--<![endif]-->` idiom — a single opaque line.
  const parts = html.split(/(<!--[\s\S]*?-->|<[^>]+>)/).filter((part) => part.length > 0);
  const lines: string[] = [];
  let depth = 0;

  // Accumulates raw (UNTRIMMED) text and inline tag tokens that belong
  // on the same line. Internal whitespace between tokens is preserved
  // verbatim (never per-token trimmed) — only the whole run's outer
  // edges are trimmed once, on flush, exactly mirroring how a single
  // block-level text token was already trimmed before this fix.
  let run: string[] = [];

  function flushRun(): void {
    if (run.length === 0) return;
    const joined = run.join('').trim();
    run = [];
    if (joined) lines.push(INDENT_UNIT.repeat(depth) + joined);
  }

  for (const part of parts) {
    if (part.length === 0) continue;

    if (!part.startsWith('<')) {
      // Plain text. A token that is PURELY whitespace and sits between
      // two block boundaries (nothing accumulated in the run yet) is
      // the original template-literal indentation from htmlRenderer.ts
      // — insignificant, discarded exactly as before. Whitespace that
      // sits between two inline tokens (run already has content) is a
      // real, meaningful separator (e.g. the space in
      // `</strong> <em>`) and must be kept.
      if (part.trim() === '' && run.length === 0) continue;
      run.push(part);
      continue;
    }

    // Doctype/comment tokens (including opaque MSO conditional comments,
    // which may contain real-looking `<table>`/`<tr>`/`<td>` markup
    // inside them — never tag-split, never affects depth or the
    // surrounding inline run).
    if (part.startsWith('<!')) {
      flushRun();
      lines.push(INDENT_UNIT.repeat(depth) + part.trim());
      continue;
    }

    const tagName = tagNameOf(part);

    if (isClosingTag(part)) {
      if (INLINE_ELEMENTS.has(tagName)) {
        run.push(part);
        continue;
      }
      flushRun();
      depth = Math.max(0, depth - 1);
      lines.push(INDENT_UNIT.repeat(depth) + part);
      continue;
    }

    if (isSelfClosingTag(part)) {
      if (INLINE_VOID_ELEMENTS.has(tagName)) {
        run.push(part);
        continue;
      }
      flushRun();
      lines.push(INDENT_UNIT.repeat(depth) + part);
      continue;
    }

    // Opening tag.
    if (INLINE_ELEMENTS.has(tagName)) {
      run.push(part);
      continue;
    }
    flushRun();
    lines.push(INDENT_UNIT.repeat(depth) + part);
    depth += 1;
  }

  flushRun();
  return lines.join('\n');
}
