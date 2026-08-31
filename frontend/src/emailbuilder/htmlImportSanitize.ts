import { validateCustomCss } from './emailCss';

// Phase C (Import HTML) — the security/allowlist layer. Operates on the
// already-parsed, still-detached Document from htmlImportParser.ts.
// Nothing here ever fetches a resource, renders anything, or inserts a
// node into a live document — pure string/attribute inspection.

// Content elements the mapper is allowed to interpret. Anything not in
// this set, TRANSPARENT_CONTAINER_TAGS, or DANGEROUS_TAGS falls through
// to the mapper's generic "unsupported subtree" handling.
export const CONTENT_TAGS = new Set([
  'table', 'tr', 'td', 'th', 'thead', 'tbody', 'tfoot',
  'p', 'div', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'a', 'img', 'strong', 'b', 'em', 'i', 'u', 'br', 'hr',
  'ul', 'ol', 'li', 'center',
]);

// Approved, CLOSED allowlist — the wrapper itself is discarded, its
// children continue through normal mapping unchanged. Never extended
// generically at implementation time; only this named set. `header`/
// `footer` here are the generic HTML5 sectioning elements — unwrapping
// them NEVER by itself creates an EDM header-*/footer-* module; those
// are only ever selected by their own independent structural predicate
// (see htmlImportMapper.ts), exactly as approved.
export const TRANSPARENT_CONTAINER_TAGS = new Set([
  'section', 'article', 'main', 'figure', 'figcaption', 'header', 'footer',
]);

// Active/dangerous elements — the element AND its entire subtree are
// stripped, always with a 'security' finding. Never unwrapped.
export const DANGEROUS_TAGS = new Set(['script', 'iframe', 'object', 'embed', 'form']);

// Attributes the mapper is allowed to read at all — everything else on
// an element is simply never consulted (not a separate "strip" pass;
// there is nothing to strip because nothing outside this set is ever
// looked up).
export const ATTRIBUTE_ALLOWLIST = new Set([
  'width', 'height', 'align', 'valign', 'bgcolor', 'background',
  'colspan', 'rowspan', 'role', 'style', 'href', 'src', 'srcset', 'alt', 'title',
]);

// The runtime enforcement point for ATTRIBUTE_ALLOWLIST — every
// attribute read anywhere in htmlImportMapper.ts goes through this, so
// the allowlist is an actual guard, not just documentation.
export function readAllowedAttribute(el: Element, name: string): string | null {
  if (!ATTRIBUTE_ALLOWLIST.has(name)) return null;
  return el.getAttribute(name);
}

function tryParseAbsoluteUrl(value: string): URL | null {
  try {
    return new URL(value.trim());
  } catch {
    return null;
  }
}

// Resource-bearing attributes (img src, background image, poster, ...):
// absolute http(s) ONLY. Deliberately stricter than sanitize.ts's
// sanitizeUrl (which also passes relative paths through as-is) — that
// function serves already-typed/trusted module props being re-rendered;
// untrusted imported input needs the narrower policy, since a relative
// path in pasted HTML has no origin to resolve against.
export function isSafeResourceUrl(value: string): boolean {
  const url = tryParseAbsoluteUrl(value);
  return url !== null && (url.protocol === 'http:' || url.protocol === 'https:');
}

// Anchor href: absolute http(s), or mailto:/tel:. Executable/dangerous
// schemes (javascript:, data:, vbscript:) are rejected by construction —
// they are not in this allowlist. Fragment-only hrefs are handled
// separately by the mapper (isFragmentHref below), since validity there
// depends on whether the target survives into the generated EDM HTML.
const SAFE_ANCHOR_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:']);

export function isSafeAnchorUrl(value: string): boolean {
  const url = tryParseAbsoluteUrl(value);
  return url !== null && SAFE_ANCHOR_PROTOCOLS.has(url.protocol);
}

export function isFragmentHref(value: string): boolean {
  return value.trim().startsWith('#') && value.trim().length > 1;
}

export function fragmentTargetId(value: string): string {
  return value.trim().slice(1);
}

// Parses a `style="..."` attribute value into a lowercased
// property->value map, after running the WHOLE string through the same
// CSS-security pattern check Custom CSS uses (emailCss.ts's
// validateCustomCss — script/expression()/behavior/-moz-binding/@import/
// data:/embedded-tag denylist). If the security check fails, the entire
// declaration block is discarded (returns an empty map) — a single
// dangerous declaration invalidates the whole style attribute rather
// than trying to salvage the rest of it.
export function extractStyleDeclarations(styleAttr: string): Map<string, string> {
  const declarations = new Map<string, string>();
  if (!styleAttr.trim()) return declarations;

  const security = validateCustomCss(styleAttr);
  if (!security.valid) return declarations;

  for (const rawDeclaration of styleAttr.split(';')) {
    const colonIndex = rawDeclaration.indexOf(':');
    if (colonIndex === -1) continue;
    const property = rawDeclaration.slice(0, colonIndex).trim().toLowerCase();
    const value = rawDeclaration.slice(colonIndex + 1).trim();
    if (!property || !value) continue;
    declarations.set(property, value);
  }
  return declarations;
}

// R3 correction — event-handler attributes (onclick, onerror, ...) are
// never in ATTRIBUTE_ALLOWLIST, so the mapper never READS them, but
// nothing previously REMOVED them from the DOM this function serializes.
// Matches every "on*" attribute name regardless of case (HTML attribute
// names are case-insensitive; the parsed DOM already lowercases them,
// this is defensive).
const EVENT_HANDLER_ATTRIBUTE_PATTERN = /^on/i;

// R3 correction — the ONE place that turns the parsed-but-still-"live"
// import Document into a genuinely safe DOM for preview purposes. Reuses
// this file's own DANGEROUS_TAGS set and isSafeAnchorUrl/isSafeResourceUrl/
// validateCustomCss — the EXACT SAME primitives htmlImportMapper.ts's own
// attribute reading already relies on — never a second, independently-
// defined notion of "safe". Mutates the CLONE in place (never the live
// `document` the mapper/analyzer still need); called once, synchronously,
// by renderSanitizedSourceHtml below.
function stripUnsafePreviewContent(root: Document): void {
  for (const el of Array.from(root.querySelectorAll('*'))) {
    for (const attr of Array.from(el.attributes)) {
      if (EVENT_HANDLER_ATTRIBUTE_PATTERN.test(attr.name)) el.removeAttribute(attr.name);
    }
  }

  // Unsafe anchor destinations: the LABEL/element survives (this is a
  // visual preview, not a re-import), only the dangerous target is
  // removed — same "keep what's safe, drop only what's dangerous"
  // policy the mapper's own describeAnchorLossIfAny already applies to
  // the resulting EDM, just enforced here on the raw markup too.
  // Fragment hrefs are left alone — harmless in-page navigation.
  root.querySelectorAll('a[href]').forEach((a) => {
    const href = a.getAttribute('href');
    if (href && !isFragmentHref(href) && !isSafeAnchorUrl(href)) a.removeAttribute('href');
  });

  root.querySelectorAll('img[src]').forEach((img) => {
    const src = img.getAttribute('src');
    if (src && !isSafeResourceUrl(src)) img.removeAttribute('src');
  });

  root.querySelectorAll('[background]').forEach((el) => {
    const background = el.getAttribute('background');
    if (background && !isSafeResourceUrl(background)) el.removeAttribute('background');
  });

  // Whole style attribute dropped only if the SAME security pattern
  // check extractStyleDeclarations already runs on it fails (script/
  // expression()/behavior/-moz-binding/@import/data:/embedded-tag) —
  // never touched otherwise, so ordinary safe declarations (color,
  // background-color, padding, text-align, font-*, border, ...) survive
  // completely untouched.
  root.querySelectorAll('[style]').forEach((el) => {
    const style = el.getAttribute('style');
    if (style && !validateCustomCss(style).valid) el.removeAttribute('style');
  });

  // A <style> block's contents go through the identical check — dropped
  // whole only if actively dangerous, never because it "originated in
  // <head>" (querySelectorAll on the Document searches head AND body).
  root.querySelectorAll('style').forEach((styleEl) => {
    const css = styleEl.textContent ?? '';
    if (css.trim() && !validateCustomCss(css).valid) styleEl.remove();
  });
}

// R3 (Import HTML AI Reconstruction) — the "Original" preview pane needs
// a real HTML string to hand an isolated, sandboxed iframe (see
// ImportReviewWorkspace.tsx). This represents "the user's HTML after
// mandatory security sanitization" — NOT a deliberately-degraded or
// re-styled version of it: only DANGEROUS_TAGS elements and the unsafe
// content stripUnsafePreviewContent targets are ever removed; every
// other presentation fact (inline style, bgcolor/background, width/
// height/align/valign, safe href/src, table/cell attributes, <style>
// block CSS, ...) survives verbatim. Any visual difference from the
// Reconstructed pane must come from the RECONSTRUCTION adding/changing
// something, never from this function quietly discarding source
// styling. Operates on a CLONE — never the live `document` the mapper/
// analyzer still need to walk (their own dangerous-tag handling only
// ever SKIPS those elements while building modules; it never mutates
// the DOM, so a naive `outerHTML` would still contain live markup this
// function is responsible for removing). The destination iframe is ALSO
// rendered with sandbox="" (no scripting context at all, see
// PreviewStudioPanel.tsx's identical convention) — defense in depth,
// not the sole protection; MSO conditional comments are inert HTML
// comments in every browser regardless (never executed, nothing to
// strip), so they are left exactly as-is and simply render as nothing,
// same as they would in any real inbox preview.
export function renderSanitizedSourceHtml(document: Document): string {
  const clone = document.cloneNode(true) as Document;
  for (const tag of DANGEROUS_TAGS) {
    clone.querySelectorAll(tag).forEach((el) => el.remove());
  }
  stripUnsafePreviewContent(clone);
  return clone.documentElement?.outerHTML ?? clone.body?.outerHTML ?? '';
}
