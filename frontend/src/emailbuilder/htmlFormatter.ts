// Feature 09, operation 3 ("Format code"). A small, dependency-free
// indent-based pretty-printer for the HTML this app itself generates
// (htmlRenderer.ts) — not a general-purpose HTML parser. Safe to assume
// well-formed, already-escaped markup (every attribute/text value is
// escaped by the renderer before this ever sees it), so a lightweight
// tag-depth tracker is enough; no need for a full HTML parser dependency
// just to indent our own output.
const VOID_ELEMENTS = new Set(['br', 'img', 'hr', 'meta', 'link', 'input']);
const INDENT_UNIT = '  ';

function isClosingTag(tag: string): boolean {
  return tag.startsWith('</');
}

function isSelfClosingTag(tag: string): boolean {
  if (tag.endsWith('/>')) return true;
  const tagName = tag.match(/^<\s*([a-zA-Z0-9-]+)/)?.[1]?.toLowerCase();
  return tagName ? VOID_ELEMENTS.has(tagName) : false;
}

function isOpeningTag(tag: string): boolean {
  return tag.startsWith('<') && !isClosingTag(tag) && !isSelfClosingTag(tag) && !tag.startsWith('<!');
}

export function formatEmailHtml(html: string): string {
  // Split into tags and text, keeping both — every element of `parts` is
  // either a complete `<...>` tag or a run of text between tags.
  const parts = html.split(/(<[^>]+>)/).filter((part) => part.length > 0);
  const lines: string[] = [];
  let depth = 0;

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith('<')) {
      if (isClosingTag(trimmed)) {
        depth = Math.max(0, depth - 1);
        lines.push(INDENT_UNIT.repeat(depth) + trimmed);
      } else if (isOpeningTag(trimmed)) {
        lines.push(INDENT_UNIT.repeat(depth) + trimmed);
        depth += 1;
      } else {
        // Self-closing / void / doctype / comment — same depth, no push.
        lines.push(INDENT_UNIT.repeat(depth) + trimmed);
      }
    } else {
      lines.push(INDENT_UNIT.repeat(depth) + trimmed);
    }
  }

  return lines.join('\n');
}
