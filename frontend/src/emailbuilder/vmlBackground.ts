// Structural Width Contract — Layout Background scope correction. Split
// out from vml.ts (which re-exports everything here for backward
// compatibility — every existing `import { renderVmlBackground } from
// './vml'` call site keeps working unchanged) so that registryCore.tsx
// can reuse this SAME VML background renderer for the whole-module
// background wrapper (which needs to wrap the FULL Outer-Spacer-inclusive
// structure, at the one centralized renderModuleWithOuterStructure entry
// point) without a circular import: vml.ts itself imports
// resolveModuleDefinition FROM registryCore.tsx, so registryCore.tsx
// cannot import anything from vml.ts without creating a cycle. This file
// has no dependency on registryCore.tsx/moduleRegistry.tsx at all — only
// on ./sanitize — so both vml.ts and registryCore.tsx can safely import
// from it directly. Never a second VML implementation: this is the ONE
// renderVmlBackground function every background-image VML fallback in
// the app uses (Hero's own background variant, per-column backgrounds,
// and the whole-module Layout Background below).
import { escapeAttribute, sanitizeUrl } from './sanitize';

// The standard v:rect + v:fill(type="tile") + v:textbox pattern: Classic
// Outlook renders the image via VML fill; every other client renders the
// caller's OWN existing plain-HTML background-image branch untouched.
// `heightPx` is a deterministic ESTIMATE derived from the caller's own
// padding + a content allowance — content that runs taller than this
// estimate is a known, documented VML limitation (VML cannot auto-size
// to variable HTML content), not silently hidden.
export interface VmlBackgroundInput {
  imageSrc: string;
  backgroundColor: string;
  paddingTop: number;
  paddingBottom: number;
  // A caller whose content shape isn't "headline + subtext + button"
  // (e.g. an arbitrary column, or a whole module row) supplies its own
  // estimate instead — see estimateColumnVmlContentAllowancePx below.
  contentAllowancePx?: number;
}

const VML_BACKGROUND_CONTENT_ALLOWANCE_PX = 120; // headline + subtext + button, roughly

// Same "deterministic estimate, not a promise of pixel-exact parity"
// posture as the bulletproof-button estimators in vml.ts — VML's v:rect
// requires a literal pixel height and cannot auto-size to variable HTML
// content, a documented, known limitation. A column (or a whole module
// row) can hold any number/kind of nested modules, so this scales a flat
// per-module allowance instead of assuming a fixed content shape the way
// Hero's own constant does.
const VML_COLUMN_BLOCK_ALLOWANCE_PX = 80; // rough average per-nested-module block height
const VML_COLUMN_MIN_ALLOWANCE_PX = 120; // same floor as Hero's own constant, for an empty/near-empty region

export function estimateColumnVmlContentAllowancePx(nestedModuleCount: number): number {
  return Math.max(VML_COLUMN_MIN_ALLOWANCE_PX, nestedModuleCount * VML_COLUMN_BLOCK_ALLOWANCE_PX);
}

export function estimateVmlBackgroundHeightPx(input: VmlBackgroundInput): number {
  return input.paddingTop + input.paddingBottom + (input.contentAllowancePx ?? VML_BACKGROUND_CONTENT_ALLOWANCE_PX);
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
