// Feature 14 V3 Sub-phase 6, work package A — real, deterministic VML
// generation for Classic Outlook. Sub-phase 3 only added the xmlns:v/
// xmlns:o <html> namespaces (VML "readiness"); this file emits the actual
// VML markup those namespaces were reserved for.
//
// Hard rules this file enforces structurally, not just by convention:
//   - VML only ever appears inside `<!--[if mso]>...<![endif]-->`. New
//     Outlook (a Chromium web-rendering engine, not Word) does not process
//     MSO conditional comments at all, so it always falls through to the
//     plain-HTML branch — see emailValidation.ts's checkNewOutlookCompatibility,
//     which still flags a document that has VML with no HTML fallback
//     paired next to it.
//   - The plain HTML fallback is wrapped in `<!--[if !mso]><!-->...<!--<![endif]-->`
//     so Classic Outlook (which DOES see the mso branch) never renders
//     both the VML shape and the plain HTML fallback at once.
//   - Every value here comes from the module's OWN existing props/settings
//     (href, text, colors, padding, font size, image src) — never a
//     fabricated asset URL or invented copy. Numeric VML-only parameters
//     that have no equivalent explicit prop (bulletproof-button pixel
//     width when widthMode is 'auto', ghost-table pixel height for a
//     background module) are DETERMINISTIC ESTIMATES computed from the
//     real props (text length/font size/padding) — a well-established
//     technique in bulletproof-button generators — and are documented as
//     estimates, never claimed to be pixel-exact.
import { escapeAttribute, escapeHtml, sanitizeUrl } from './sanitize';
import type { EmailModuleType } from './edm';
import { resolveModuleDefinition } from './registryCore';

// --- Capability predicates -----------------------------------------------
//
// Sub-phase 6 closure — these are now MANIFEST-DRIVEN (via each module
// definition's own `supportsBulletproofCta`/`supportsBulletproofBackground`
// field, set once per catalog file at the definition itself — see
// registryCore.ts's ModuleDefinition docstring), never a second hand-typed
// list here. This file reads the registry through the SAME dependency-
// injected resolver moduleRegistry.tsx already registers for
// renderModuleWithOuterStructure, which is what makes it safe to query the
// live registry from a file every catalog file also imports (see
// registryCore.ts's own docstring on `registerModuleDefinitionResolver`
// for why this doesn't create a circular import). A module type the
// registry doesn't recognize (or that hasn't loaded yet) safely resolves
// to `false`, never a crash.
export function supportsVmlButtonPattern(type: EmailModuleType): boolean {
  return resolveModuleDefinition(type)?.supportsBulletproofCta === true;
}

export function supportsVmlBackgroundPattern(type: EmailModuleType): boolean {
  return resolveModuleDefinition(type)?.supportsBulletproofBackground === true;
}

// --- Bulletproof VML button (a.k.a. "bulletproof CTA") ------------------
//
// The industry-standard "VML roundrect" bulletproof-button pattern
// (the same technique Campaign Monitor's/Litmus's public button
// generators use) — a v:roundrect for Classic Outlook only, paired with
// the CALLER's own already-existing <a>/<table><a> HTML button as the
// non-Outlook fallback. ONE shared renderer for every module that renders
// a genuine clickable CTA/button (see supportsVmlButtonPattern above for
// which those are) — every catalog file passes in the exact styling
// values IT already computed (colors/padding/font-size/radius), so this
// function never re-derives or approximates a module's own visual design;
// it only adds the VML-equivalent shape alongside it.
//
// `widthMode: 'full'` is deliberately NOT supported (declined, not
// silently approximated) — a percentage-width VML roundrect is not a
// reliable, well-tested pattern, and this module never ships an
// unverified rendering technique (master prompt: "do not claim support...
// until implementation exists and is tested"). Every non-Button module
// only ever has a content-width (never full-width) CTA, so this only
// actually excludes the standalone Button module's own explicit "Full
// width" option.
export interface VmlButtonInput {
  href: string;
  text: string;
  // '' or 'transparent' means an OUTLINE/border-only button (no fill) —
  // see borderColor/borderWidth below. A real hex fill means a solid
  // button, the common case for every module here.
  backgroundColor: string;
  textColor: string;
  fontSize: number;
  borderRadius: number;
  // Optional so callers with no width-mode concept (every module besides
  // the standalone Button) can simply omit it — defaults to 'auto'.
  widthMode?: 'auto' | 'fixed' | 'full';
  fixedWidth?: number;
  paddingHorizontal: number;
  paddingVertical: number;
  // Sub-phase 6 closure — an outline/secondary button (e.g. cta-dual's
  // secondary CTA, or the standalone Button module's own optional border)
  // has no background fill; VML represents that as stroke="t" with a real
  // strokecolor/strokeweight instead of a solid fillcolor.
  borderColor?: string;
  borderWidth?: number;
}

export function canRenderVmlButton(input: Pick<VmlButtonInput, 'widthMode'>): boolean {
  return input.widthMode !== 'full';
}

function isFilled(backgroundColor: string): boolean {
  const value = backgroundColor.trim().toLowerCase();
  return value !== '' && value !== 'transparent';
}

// Deterministic pixel-width ESTIMATE for 'auto' width mode — VML
// v:roundrect requires a literal pixel width, but the HTML fallback sizes
// itself to content. ~0.6× font-size per character is the same rough
// average-glyph-width heuristic bulletproof-button generators use;
// documented here as an estimate, not a promise of pixel-exact parity
// with the HTML version.
function estimateButtonWidthPx(input: VmlButtonInput): number {
  if (input.widthMode === 'fixed' && input.fixedWidth) return input.fixedWidth;
  const textWidth = Math.ceil(input.text.length * input.fontSize * 0.6);
  return textWidth + input.paddingHorizontal * 2;
}

// Deterministic pixel-height ESTIMATE from font-size/vertical padding —
// same estimation posture as width above.
function estimateButtonHeightPx(input: VmlButtonInput): number {
  return Math.round(input.fontSize * 1.3) + input.paddingVertical * 2;
}

// arcsize is VML's own "corner radius as a % of the shorter side"
// convention — computed from the module's real borderRadius so a 6px
// radius on a 40px-tall button becomes a comparable rounded corner in
// Outlook, not a fixed/guessed percentage.
function arcsizePercent(borderRadiusPx: number, heightPx: number): number {
  if (borderRadiusPx <= 0 || heightPx <= 0) return 0;
  return Math.max(0, Math.min(50, Math.round((borderRadiusPx / heightPx) * 100)));
}

// Returns the FULL replacement for the button module's rendered HTML
// (VML branch + the existing plain-HTML branch, both conditional-comment
// gated) — callers pass in the plain HTML the module would have rendered
// anyway, so this never re-derives or duplicates that markup.
export function renderVmlButton(input: VmlButtonInput, plainHtml: string): string {
  const widthPx = estimateButtonWidthPx(input);
  const heightPx = estimateButtonHeightPx(input);
  const arcsize = arcsizePercent(input.borderRadius, heightPx);
  const safeHref = escapeAttribute(sanitizeUrl(input.href));
  const filled = isFilled(input.backgroundColor);
  // Outline/secondary buttons (no fill) render as stroke="t" with the
  // real border color/width; a solid button renders as stroke="f" with
  // its real fillcolor — never a fabricated default for either.
  const strokeAttrs = filled
    ? `stroke="f" fillcolor="${escapeAttribute(input.backgroundColor)}"`
    : `stroke="t" strokecolor="${escapeAttribute(input.borderColor || input.textColor)}" strokeweight="${input.borderWidth || 1}px" fillcolor="none"`;
  const vml = (
    '<!--[if mso]>\n'
    + `<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${safeHref}" `
    + `style="height:${heightPx}px;v-text-anchor:middle;width:${widthPx}px;" arcsize="${arcsize}%" ${strokeAttrs}>\n`
    + '<w:anchorlock/>\n'
    + `<center style="color:${escapeAttribute(input.textColor)};font-family:Arial,Helvetica,sans-serif;font-size:${input.fontSize}px;font-weight:bold;">${escapeHtml(input.text)}</center>\n`
    + '</v:roundrect>\n'
    + '<![endif]-->\n'
  );
  const fallback = `<!--[if !mso]><!-->\n${plainHtml}\n<!--<![endif]-->`;
  return vml + fallback;
}

// --- VML background "ghost table" ---------------------------------------
//
// The standard v:rect + v:fill(type="tile") + v:textbox pattern: Classic
// Outlook renders the image via VML fill; every other client renders the
// module's OWN existing plain-HTML background-image branch untouched.
// `heightPx` is a deterministic ESTIMATE derived from the module's own
// padding + a fixed per-line-of-content allowance (headline/subtext/
// button) — content that runs taller than this estimate is a known,
// documented VML limitation (VML cannot auto-size to variable HTML
// content), not silently hidden.
export interface VmlBackgroundInput {
  imageSrc: string;
  backgroundColor: string;
  paddingTop: number;
  paddingBottom: number;
}

const VML_BACKGROUND_CONTENT_ALLOWANCE_PX = 120; // headline + subtext + button, roughly

export function estimateVmlBackgroundHeightPx(input: VmlBackgroundInput): number {
  return input.paddingTop + input.paddingBottom + VML_BACKGROUND_CONTENT_ALLOWANCE_PX;
}

export function renderVmlBackground(input: VmlBackgroundInput, widthPx: number, plainHtml: string): string {
  const heightPx = estimateVmlBackgroundHeightPx(input);
  const safeSrc = escapeAttribute(sanitizeUrl(input.imageSrc));
  const open = (
    '<!--[if gte mso 9]>\n'
    + `<v:rect xmlns:v="urn:schemas-microsoft-com:vml" fill="true" stroke="false" style="width:${widthPx}px;height:${heightPx}px;">\n`
    + `<v:fill type="tile" src="${safeSrc}" color="${escapeAttribute(input.backgroundColor)}" />\n`
    + '<v:textbox inset="0,0,0,0">\n'
    + '<![endif]-->\n'
  );
  const close = (
    '<!--[if gte mso 9]>\n'
    + '</v:textbox>\n'
    + '</v:rect>\n'
    + '<![endif]-->\n'
  );
  return open + plainHtml + close;
}
