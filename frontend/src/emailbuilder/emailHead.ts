// Email Document Standards — Sub-phase 1. The ONE centralized builder for
// everything inside <head> (per the approved architecture: "one source of
// truth for email-head generation" — never scattered across modules or
// components). htmlRenderer.ts's renderEmailDocument() is the only caller.
//
// Canonical order (approved):
//   1. charset  2. viewport  3. non-MSO X-UA-Compatible  4. robots/Apple/
//   format-detection metadata  5. title  6. optional favicon
//   7. built-in Email Reset CSS       [Sub-phase 2]
//   8. existing responsive CSS        (unchanged — Feature 07, position
//                                      preserved per approved decision E)
//   9. optional Custom CSS            [Sub-phase 2]
//   10. Outlook OfficeDocumentSettings [Sub-phase 3]
//   11. scoped Outlook conditional CSS [Sub-phase 3]
//   12. </head>
// Positions 10/11 are NOT implemented yet (Sub-phase 3) — later phases
// insert at the marked point below, they do not restructure this function.
import { escapeAttribute, escapeHtml, sanitizeUrl } from './sanitize';
import { renderResponsiveStyles } from './responsiveStyles';
import { renderCustomCssBlock, renderResetCssBlock } from './emailCss';
import type { EmailDocumentContent } from './edm';

export interface EmailHeadOptions {
  title: string;
  faviconUrl: string;
  content: EmailDocumentContent;
  // Sub-phase 2 — all optional so every Sub-phase-1 caller/test keeps
  // compiling and rendering byte-identically without passing them (same
  // "omitting these is a zero-behavior-change default" convention as
  // title/faviconUrl). Real callers (EmailBuilderWorkspacePage.tsx) pass
  // the loaded document's real values — resetCssEnabled defaults true at
  // the MODEL/DB layer (EmailDocument.reset_css_enabled), not here; this
  // leaf rendering primitive defaults to false/off like every other
  // optional field here, so it never surprises an existing test call site.
  resetCssEnabled?: boolean;
  customCssEnabled?: boolean;
  customCss?: string;
}

// Approved decision F: never blindly emit type="image/x-icon" for
// whatever URL is given — infer the real MIME type from the file
// extension when reliably known, otherwise omit `type` entirely (valid,
// honest HTML — `type` is optional on <link rel="icon">). An
// Asset-Manager-sourced favicon's real content_type is not threaded
// through to this layer today (the field is just a resolved URL string,
// see EmailDocument.favicon_url) — extension inference is the only
// signal available here, which is why "reliably known" matters: we do
// not guess when the extension is missing or unrecognized.
const FAVICON_MIME_BY_EXTENSION: Record<string, string> = {
  ico: 'image/x-icon',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
};

export function inferFaviconMimeType(url: string): string | null {
  const match = /\.([a-z0-9]+)(?:[?#]|$)/i.exec(url);
  const extension = match?.[1]?.toLowerCase();
  return extension ? (FAVICON_MIME_BY_EXTENSION[extension] ?? null) : null;
}

// rel="icon" (the modern, semantically correct value) — not the legacy
// "shortcut icon" — and no `media="all"` (meaningless boilerplate on a
// favicon link). Absent/blank faviconUrl or one sanitizeUrl rejects
// (unsafe scheme) renders nothing — favicon is optional, never a
// fallback broken-icon link. sanitizeUrl is the SAME allow-list every
// other URL in this app already goes through — no separate mechanism.
function renderFaviconLink(faviconUrl: string): string {
  if (!faviconUrl) return '';
  const safeUrl = sanitizeUrl(faviconUrl);
  if (!safeUrl || safeUrl === '#') return '';
  const mimeType = inferFaviconMimeType(safeUrl);
  const typeAttr = mimeType ? ` type="${mimeType}"` : '';
  return `<link rel="icon"${typeAttr} href="${escapeAttribute(safeUrl)}" />\n`;
}

export function renderEmailHead({
  title, faviconUrl, content, resetCssEnabled, customCssEnabled, customCss,
}: EmailHeadOptions): string {
  return (
    '<meta charset="utf-8" />\n'
    // Approved decision B — the existing, stronger, mobile-friendly
    // viewport is kept verbatim; no maximum-scale (never disable user
    // zoom — accessibility takes priority over a boilerplate default).
    + '<meta name="viewport" content="width=device-width, initial-scale=1.0" />\n'
    // Hidden from Classic Outlook specifically (X-UA-Compatible targets
    // old Trident-based renderers, not Word — Outlook's Word engine
    // ignores it anyway, and hiding it keeps the <head> honest about
    // what actually applies to which engine family).
    + '<!--[if !mso]><!-->\n'
    + '<meta http-equiv="X-UA-Compatible" content="IE=edge" />\n'
    + '<!--<![endif]-->\n'
    + '<meta name="robots" content="noindex, nofollow" />\n'
    + '<meta name="apple-mobile-web-app-capable" content="yes" />\n'
    + '<meta content="yes" name="apple-touch-fullscreen" />\n'
    + '<meta name="apple-mobile-web-app-status-bar-style" content="black" />\n'
    + '<meta name="format-detection" content="address=no" />\n'
    + '<meta name="format-detection" content="date=no" />\n'
    + '<meta name="format-detection" content="email=no" />\n'
    + '<meta name="format-detection" content="telephone=no" />\n'
    + '<meta name="x-apple-disable-message-reformatting" />\n'
    + `<title>${escapeHtml(title)}</title>\n`
    + renderFaviconLink(faviconUrl)
    + (resetCssEnabled ? renderResetCssBlock() : '')
    + renderResponsiveStyles(content)
    + (customCssEnabled ? renderCustomCssBlock(customCss ?? '') : '')
    // --- Sub-phase 3 inserts the Outlook OfficeDocumentSettings XML
    //     block and the scoped Outlook conditional CSS block here ---
  );
}
