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
