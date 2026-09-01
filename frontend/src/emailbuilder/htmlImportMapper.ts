import type {
  ButtonModuleProps, EmailColumn, EmailModule, EmailModuleType, FooterModuleProps, HeaderModuleProps,
  HorizontalAlign, ImageModuleProps, TextModuleProps,
} from './edm';
import { getAllModuleDefinitions } from './moduleRegistry';
import { createModule, generateModuleId } from './moduleFactory';
import { createColumnSettings } from './layoutModel';
import { isValidFontId, EMAIL_SAFE_FONTS } from './fonts';
import { px } from './dimensions';
import { SOCIAL_PLATFORM_PRESETS } from './catalog/socialCatalog';
import {
  CONTENT_TAGS, DANGEROUS_TAGS, TRANSPARENT_CONTAINER_TAGS,
  extractStyleDeclarations, isFragmentHref, isSafeAnchorUrl, isSafeResourceUrl, readAllowedAttribute,
} from './htmlImportSanitize';
import type { ImportFinding, ImportMappingResult } from './importFindings';

// Phase C (Import HTML) — HTML(parsed, detached Document) -> EDM.
// Deterministic: same input always produces the same module sequence,
// the same column-width decisions, and the same findings (module/column
// ids are the only thing that vary run to run, which is expected and
// approved — "runtime IDs may of course be freshly generated").
//
// Classification order (approved, exact):
//   1. Exact existing module representation -> map.
//   2. Deterministic near-equivalent -> normalize + report.
//   3. No correct existing representation -> drop that subtree + report.
//   4. Dangerous source -> strip/reject + security finding.
//   5. Fundamentally unparseable/unsafe document -> reject complete import
//      (handled by htmlImportParser.ts's guards, before this file runs).
//
// No raw-HTML module, no hidden preservation field — every accepted
// element becomes real, typed EDM props on an existing module type, or
// it doesn't survive at all (and is always reported when it doesn't).
//
// Fidelity checkpoint (this revision) — the mapper now populates the
// already-existing EDM/module fields that a prior read-only audit found
// were being computed (or trivially derivable) and then discarded:
// outer spacer/gutter cells, real column ratios in findings, header/
// footer structural predicates, safe-href preservation on plain links,
// heading/paragraph separation, bold/lineHeight/image-width/button-
// align+padding typography, and row/cell/table background color+image.
// No new module type, renderer, or registry was introduced — every
// addition below targets a field that already existed and already
// rendered correctly; see htmlImportMapper.test.ts for the fidelity
// acceptance tests this revision adds.

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function isNonEmptyText(value: string): boolean {
  return value.trim().length > 0;
}

function finding(
  category: ImportFinding['category'], source: string, location: string, reason: string,
  outcome: string, recommendation: string,
): ImportFinding {
  return { category, source, location, reason, outcome, recommendation };
}

function hasDangerousDescendant(el: Element): boolean {
  return [...DANGEROUS_TAGS].some((tag) => el.querySelector(tag) !== null);
}

// --- Title -----------------------------------------------------------
// Read separately from the body walk (the body mapper keeps no `title`
// entry in its own tag allowlist). `document.title`'s own DOM algorithm
// already extracts the FIRST <title>'s TEXT content only — child
// elements never contribute markup, only their text — so injected tags
// inside/around <title> can't survive as tags either way; this is stored
// as plain text in a CharField and later escaped again by the existing
// renderer (emailHead.ts: `<title>${escapeHtml(title)}</title>`), never
// re-parsed as HTML.
export function extractImportedTitle(document: Document): string {
  return (document.title ?? '').trim();
}

// --- Style -> typed props ----------------------------------------------

export function readColor(declarations: Map<string, string>, property: string): string | null {
  const value = declarations.get(property);
  if (!value) return null;
  const trimmed = value.trim();
  return HEX_COLOR.test(trimmed) ? trimmed.toLowerCase() : null;
}

export function readPx(declarations: Map<string, string>, property: string): number | null {
  const value = declarations.get(property);
  if (!value) return null;
  const match = /^(\d+(?:\.\d+)?)px$/.exec(value.trim());
  if (!match) return null;
  return Math.round(Number(match[1]));
}

function readFontFamily(declarations: Map<string, string>): string | undefined {
  const value = declarations.get('font-family');
  if (!value) return undefined;
  const lowered = value.toLowerCase();
  const match = EMAIL_SAFE_FONTS.find((font) => lowered.includes(font.id));
  return match && isValidFontId(match.id) ? match.id : undefined;
}

export function readAlign(declarations: Map<string, string>, attrAlign: string | null): HorizontalAlign | undefined {
  const raw = (declarations.get('text-align') ?? attrAlign ?? '').trim().toLowerCase();
  if (raw === 'left' || raw === 'center' || raw === 'right') return raw;
  return undefined;
}

// An element's own alignment signal (its `style="text-align:..."` or
// legacy `align="..."` attribute) — used to carry alignment onto a leaf
// module (image/button) from either the element itself or, when it has
// none of its own, its immediate containing cell/container.
export function elementAlignHint(el: Element): HorizontalAlign | undefined {
  const declarations = extractStyleDeclarations(readAllowedAttribute(el, 'style') ?? '');
  return readAlign(declarations, readAllowedAttribute(el, 'align'));
}

function hasNonZeroPaddingAllSides(declarations: Map<string, string>): boolean {
  const shorthand = declarations.get('padding');
  if (shorthand) {
    const parts = shorthand.trim().split(/\s+/).map((p) => parseFloat(p));
    if (parts.length > 0 && parts.every((p) => Number.isFinite(p) && p > 0)) return true;
  }
  const sides = ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'];
  return sides.every((side) => {
    const value = declarations.get(side);
    if (!value) return false;
    const px = parseFloat(value);
    return Number.isFinite(px) && px > 0;
  });
}

// Reads a CSS padding shorthand (or the four longhand padding-* sides)
// into a single {horizontal, vertical} pair — the ButtonModuleProps
// shape a source anchor's asymmetric-but-usually-paired padding
// ("12px 24px" = vertical/horizontal) collapses onto. A 3- or 4-value
// shorthand averages its two vertical (top/bottom) and two horizontal
// (left/right) values rather than picking one side arbitrarily.
export function readPaddingHV(declarations: Map<string, string>): { horizontal: number; vertical: number } | null {
  const shorthand = declarations.get('padding');
  if (shorthand) {
    const parts = shorthand.trim().split(/\s+/).map((p) => {
      const match = /^(\d+(?:\.\d+)?)px$/.exec(p);
      return match ? Number(match[1]) : null;
    });
    if (parts.length > 0 && parts.every((p) => p !== null)) {
      const values = parts as number[];
      if (values.length === 1) return { vertical: values[0], horizontal: values[0] };
      if (values.length === 2) return { vertical: values[0], horizontal: values[1] };
      if (values.length === 3) return { vertical: Math.round((values[0] + values[2]) / 2), horizontal: values[1] };
      if (values.length === 4) {
        return {
          vertical: Math.round((values[0] + values[2]) / 2),
          horizontal: Math.round((values[1] + values[3]) / 2),
        };
      }
    }
  }
  const top = readPx(declarations, 'padding-top');
  const right = readPx(declarations, 'padding-right');
  const bottom = readPx(declarations, 'padding-bottom');
  const left = readPx(declarations, 'padding-left');
  if (top !== null && right !== null && bottom !== null && left !== null) {
    return { vertical: Math.round((top + bottom) / 2), horizontal: Math.round((right + left) / 2) };
  }
  return null;
}

// Reads `line-height` in any of its common source forms (px, unitless
// multiplier, or percentage) into the single px value TextModuleProps
// stores. Unitless/percentage values resolve against the ALREADY-decided
// font size for this module (falling back to the Text module's own
// default, 16, when the source specified no font-size either) — the
// same "resolve against this element's own font size" rule browsers use.
export function readLineHeightPx(declarations: Map<string, string>, resolvedFontSizePx: number): number | null {
  const value = declarations.get('line-height');
  if (!value) return null;
  const trimmed = value.trim();
  const pxMatch = /^(\d+(?:\.\d+)?)px$/.exec(trimmed);
  if (pxMatch) return Math.round(Number(pxMatch[1]));
  const percentMatch = /^(\d+(?:\.\d+)?)%$/.exec(trimmed);
  if (percentMatch) return Math.round((resolvedFontSizePx * Number(percentMatch[1])) / 100);
  const unitlessMatch = /^(\d+(?:\.\d+)?)$/.exec(trimmed);
  if (unitlessMatch) return Math.round(resolvedFontSizePx * Number(unitlessMatch[1]));
  return null;
}

// True when EVERY bit of this element's text is wrapped in <strong>/<b>
// — the only case a single whole-module fontWeight can honestly
// represent. <p>Some <strong>partial</strong> text</p> deliberately does
// NOT qualify (there is no way to make part of a Text module bold — see
// textFromInlineContent's own docstring for this same, pre-existing,
// accepted limitation); it silently keeps the module's normal weight,
// same as today.
export function isWholeLineBold(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  if (tag === 'strong' || tag === 'b') return true;
  const children = Array.from(el.children);
  if (children.length === 0) return false;
  if (!children.every((child) => {
    const childTag = child.tagName.toLowerCase();
    return childTag === 'strong' || childTag === 'b';
  })) return false;
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE && isNonEmptyText(node.textContent ?? '')) return false;
  }
  return true;
}

// --- Background (row/table/cell/column) extraction ----------------------
// One shared reader for every level backgrounds can appear at (<table>,
// <tr>, <td>) — bgcolor/`background` attributes and style
// background-color/background-image, applied by callers onto whichever
// EDM field matches that source element's structural role (module-level
// settings.backgroundColor/backgroundImage for a table/row — the
// "physical row" scope registryCore.ts's wrapWithModuleBackground already
// covers outer spacers with — or a column's own
// ColumnContainerSettings.backgroundColor/backgroundImage for a single
// <td> that became one column of a multi-column layout). Colors go
// through the SAME strict 6-digit-hex-only policy as every other color
// read in this file (a bgcolor attribute without a leading '#' is
// normalized before the same check) — a named CSS color (e.g. "white")
// is not represented (closest-safe-approximation: no background, not a
// guess), consistent with readColor's existing behavior elsewhere. A
// background image goes through the exact same isSafeResourceUrl policy
// as an <img>'s own src — never a laxer rule for a decorative image.
export function readBackground(el: Element): { color?: string; image?: string } {
  const result: { color?: string; image?: string } = {};
  const style = readAllowedAttribute(el, 'style');
  const declarations = style ? extractStyleDeclarations(style) : new Map<string, string>();

  const styleColor = readColor(declarations, 'background-color');
  if (styleColor) {
    result.color = styleColor;
  } else {
    const bgcolorAttr = readAllowedAttribute(el, 'bgcolor');
    if (bgcolorAttr) {
      const trimmed = bgcolorAttr.trim();
      const withHash = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
      if (HEX_COLOR.test(withHash)) result.color = withHash.toLowerCase();
    }
  }

  const styleImageRaw = declarations.get('background-image');
  const urlMatch = styleImageRaw ? /^url\((['"]?)(.*?)\1\)$/i.exec(styleImageRaw.trim()) : null;
  const backgroundAttr = readAllowedAttribute(el, 'background');
  const candidateImage = urlMatch ? urlMatch[2] : backgroundAttr;
  if (candidateImage && isSafeResourceUrl(candidateImage.trim())) {
    result.image = candidateImage.trim();
  }
  return result;
}

function applyBackground(module: EmailModule, background: { color?: string; image?: string }) {
  if (background.color) module.settings.backgroundColor = background.color;
  if (background.image) module.settings.backgroundImage = background.image;
}

// Outer Spacer Columns (settings.outerSpacing) are a per-MODULE field —
// every module type carries it (not just layouts), so a spacer cell
// flanking a single-column row is preserved by applying it directly to
// whatever content module(s) that row produced, exactly the same
// mechanism a multi-column row's Layout module already uses.
function applyOuterSpacingPx(module: EmailModule, leftPx: number, rightPx: number) {
  if (leftPx <= 0 && rightPx <= 0) return;
  module.settings.outerSpacing = { desktop: { left: px(leftPx), right: px(rightPx) }, mobile: {} };
}

// --- Button predicate (explicit, deterministic, approved) ---------------
// An <a> whose OWN inline style sets both a background-color AND
// non-zero padding on all sides. Never inferred from position, text
// content, or ancestor styling — an unstyled link is never guessed into
// a button.
export function looksLikeButtonAnchor(anchor: Element): boolean {
  const style = readAllowedAttribute(anchor, 'style');
  if (!style) return false;
  const declarations = extractStyleDeclarations(style);
  return readColor(declarations, 'background-color') !== null && hasNonZeroPaddingAllSides(declarations);
}

// --- Layout module selection (approved column-normalization algorithm) --

interface LayoutCandidate {
  type: EmailModuleType;
  widths: number[];
}

function layoutCandidatesForColumnCount(columnCount: number): LayoutCandidate[] {
  // Reads the ACTUAL registered layout definitions at runtime — never a
  // second, independently-maintained list of column arrangements.
  return getAllModuleDefinitions()
    .filter((definition) => definition.category === 'layout')
    .map((definition) => ({
      type: definition.type,
      widths: (definition.createDefaultProps() as { columnWidths: number[] }).columnWidths,
    }))
    .filter((candidate) => candidate.widths.length === columnCount);
}

function normalizeToHundred(rawWidths: number[]): number[] {
  const total = rawWidths.reduce((sum, w) => sum + w, 0);
  if (total <= 0) return rawWidths.map(() => Math.round(100 / rawWidths.length));
  return rawWidths.map((w) => Math.round((w / total) * 100));
}

// Derives source column proportions in the approved priority order:
// td[width] -> inline style width -> unambiguous colspan -> equal split.
// Returns null when the row's geometry is genuinely ambiguous/irregular
// (e.g. mismatched colspans that don't reduce to a clean ratio) — the
// caller rejects that row rather than guessing.
function deriveSourceWidths(cells: Element[]): number[] | null {
  const widthAttrValues = cells.map((cell) => {
    const attr = readAllowedAttribute(cell, 'width');
    if (!attr) return null;
    const parsed = parseFloat(attr);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  });
  if (widthAttrValues.every((w) => w !== null)) return widthAttrValues as number[];

  const styleWidthValues = cells.map((cell) => {
    const style = readAllowedAttribute(cell, 'style');
    if (!style) return null;
    const declarations = extractStyleDeclarations(style);
    const value = declarations.get('width');
    if (!value) return null;
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  });
  if (styleWidthValues.every((w) => w !== null)) return styleWidthValues as number[];

  const colspanValues = cells.map((cell) => {
    const attr = readAllowedAttribute(cell, 'colspan');
    if (!attr) return null;
    const parsed = parseInt(attr, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  });
  if (colspanValues.some((c) => c !== null)) {
    // Some, but not all, cells declare a colspan — this is exactly the
    // irregular/ambiguous geometry the approved contract says to reject
    // rather than guess (do NOT silently fall through to equal split,
    // which would ignore the partial signal that IS present).
    if (!colspanValues.every((c) => c !== null)) return null;
    if (colspanValues.some((c) => c !== 1)) return colspanValues as number[];
    // Every cell declares colspan=1 — no real signal, fall through.
  }

  // No reliable explicit information anywhere -> equal distribution
  // (still a defined, deterministic outcome, not a rejection).
  return cells.map(() => 1);
}

export function pickLayoutType(
  cells: Element[],
): { type: EmailModuleType; widths: number[]; exact: boolean; sourceRatio: number[] } | null {
  const candidates = layoutCandidatesForColumnCount(cells.length);
  if (candidates.length === 0) return null; // no variant for this column count -> reject the row

  const sourceWidths = deriveSourceWidths(cells);
  if (sourceWidths === null) return null; // irregular geometry -> reject the row

  const normalized = normalizeToHundred(sourceWidths);

  let best = candidates[0];
  let bestDistance = Infinity;
  for (const candidate of candidates) {
    const distance = candidate.widths.reduce((sum, w, i) => sum + Math.abs(normalized[i] - w), 0);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate; // candidates array is already in the catalog's own declared order -> stable tie-break
    }
  }

  const exact = best.widths.every((w, i) => w === normalized[i]);
  return {
    type: best.type, widths: best.widths, exact,
    sourceRatio: normalized, // the REAL computed ratio — reported verbatim even when snapped to a preset, never discarded
  };
}

// --- Row cell classification: content vs outer spacer vs gutter ---------
// A cell counts as a spacer/gutter CANDIDATE only when it is BOTH narrow
// (a real content column at any supported email width is never this
// thin) AND empty (no text, no img/table/a/hr) — both conditions
// together, never width alone (a genuinely empty-but-wide content cell
// stays a content cell) and never emptiness alone (a narrow-but-populated
// cell, e.g. a small icon column, stays a content cell).
const SPACER_CELL_MAX_PX = 60;

function cellWidthPx(cell: Element): number | null {
  const attr = readAllowedAttribute(cell, 'width');
  if (attr && !attr.trim().endsWith('%')) {
    const parsed = parseFloat(attr);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  const style = readAllowedAttribute(cell, 'style');
  if (style) {
    const declarations = extractStyleDeclarations(style);
    const widthPx = readPx(declarations, 'width');
    if (widthPx !== null) return widthPx;
  }
  return null;
}

function isEmptyOfContent(cell: Element): boolean {
  if (cell.querySelector('img, table, a, hr')) return false;
  const text = (cell.textContent ?? '').replace(/ /g, ' ').trim();
  return text.length === 0;
}

function isSpacerCandidate(cell: Element): boolean {
  const widthPx = cellWidthPx(cell);
  if (widthPx === null || widthPx > SPACER_CELL_MAX_PX) return false;
  return isEmptyOfContent(cell);
}

export interface RowCellClassification {
  contentCells: Element[];
  outerLeftPx: number;
  outerRightPx: number;
  gutterPx: number;
  gutterApproximated: boolean;
}

// Reconstructs "30px spacer | 40% content | 20px gutter | 60% content |
// 30px spacer" into the Layout module's own outerSpacing/columnGutterPx
// fields instead of letting the spacer cells inflate the column count
// (5 content columns instead of 2). Only a LEADING and a TRAILING spacer
// become outer spacing (asymmetric widths preserved independently, e.g.
// 20 | content | content | 40); anything narrow-and-empty found BETWEEN
// two real content cells becomes the column gutter. The layout system
// supports exactly one uniform gutter value, so multiple interior
// spacers with DIFFERING widths collapse to the first one's width, with
// `gutterApproximated` telling the caller to report that specific loss
// (never silently — see the 'structural-conversion' finding this
// produces in mapTableAsRows).
export function classifyRowCells(cells: Element[]): RowCellClassification {
  const working = [...cells];
  let outerLeftPx = 0;
  let outerRightPx = 0;

  if (working.length > 1 && isSpacerCandidate(working[0])) {
    outerLeftPx = cellWidthPx(working[0]) ?? 0;
    working.shift();
  }
  if (working.length > 1 && isSpacerCandidate(working[working.length - 1])) {
    outerRightPx = cellWidthPx(working[working.length - 1]) ?? 0;
    working.pop();
  }

  const gutterWidths: number[] = [];
  const contentCells: Element[] = [];
  working.forEach((cell, index) => {
    const isInterior = index > 0 && index < working.length - 1;
    if (isInterior && isSpacerCandidate(cell)) {
      gutterWidths.push(cellWidthPx(cell) ?? 0);
      return;
    }
    contentCells.push(cell);
  });

  const gutterPx = gutterWidths.length > 0 ? gutterWidths[0] : 0;
  const gutterApproximated = gutterWidths.some((w) => w !== gutterPx);

  return { contentCells, outerLeftPx, outerRightPx, gutterPx, gutterApproximated };
}

// --- Leaf classification -------------------------------------------------

export function textFromInlineContent(el: Element): string {
  // Inline formatting (em/i/u) and <br> contribute their text content
  // only — the `text` module prop has no rich-run sub-structure to
  // preserve most inline emphasis distinctly; this is a known, accepted
  // typed-property limitation, not a dropped structure, so it is not
  // individually reported per occurrence. A safe <a href> IS preserved,
  // as visible "label (https://...)" text next to itself — the Text
  // module has no clickable inline link, so this is the closest safe
  // representation existing capability allows (see
  // describeAnchorLossIfAny, which reports this as an approximation,
  // never as an exact conversion); an unsafe or fragment href is left
  // exactly as before (label only, reported as a genuine loss).
  const clone = el.cloneNode(true) as Element;
  clone.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
  const hrefSuffixIfSafe = (a: Element): string | null => {
    const href = readAllowedAttribute(a, 'href');
    if (!href || !isSafeAnchorUrl(href) || isFragmentHref(href)) return null;
    return href.trim();
  };
  // querySelectorAll only ever matches DESCENDANTS — when the buffered
  // element IS itself the <a> (the mapContentSequence branch that pushes
  // a lone non-button anchor straight into the text buffer), replaceWith
  // on a parentless clone root is a silent no-op, so that case is
  // resolved directly instead of going through the descendant-replace
  // path below.
  if (clone.tagName.toLowerCase() === 'a') {
    const safeHref = hrefSuffixIfSafe(clone);
    const text = (clone.textContent ?? '').trim();
    if (safeHref) return text ? `${text} (${safeHref})` : safeHref;
    return text;
  }
  Array.from(clone.querySelectorAll('a')).forEach((a) => {
    const safeHref = hrefSuffixIfSafe(a);
    if (!safeHref) return;
    const text = (a.textContent ?? '').trim();
    a.replaceWith(clone.ownerDocument!.createTextNode(text ? `${text} (${safeHref})` : safeHref));
  });
  return (clone.textContent ?? '').replace(/\s+\n/g, '\n').replace(/\n\s+/g, '\n').trim();
}

function buildTextModule(
  text: string, declarations: Map<string, string>, attrAlign: string | null, order: number, allBold: boolean,
): EmailModule {
  const module = createModule('text', order);
  const props = module.props as unknown as TextModuleProps;
  props.text = text;
  const align = readAlign(declarations, attrAlign);
  if (align) props.align = align;
  const color = readColor(declarations, 'color');
  if (color) props.color = color;
  const fontSize = readPx(declarations, 'font-size');
  if (fontSize) props.fontSize = fontSize;
  const fontFamily = readFontFamily(declarations);
  if (fontFamily) props.fontFamily = fontFamily;
  if (allBold) props.fontWeight = 700;
  const lineHeightPx = readLineHeightPx(declarations, props.fontSize);
  if (lineHeightPx !== null) props.lineHeight = lineHeightPx;
  return module;
}

export function readImageWidthPx(img: Element): number | null {
  const attr = readAllowedAttribute(img, 'width');
  if (attr) {
    const parsed = parseFloat(attr);
    if (Number.isFinite(parsed) && parsed > 0) return Math.round(parsed);
  }
  const style = readAllowedAttribute(img, 'style');
  if (style) {
    const declarations = extractStyleDeclarations(style);
    const widthPx = readPx(declarations, 'width');
    if (widthPx !== null) return widthPx;
  }
  return null;
}

function buildImageModule(
  img: Element, order: number, findings: ImportFinding[], location: string, alignHint?: HorizontalAlign,
): EmailModule | null {
  const src = readAllowedAttribute(img, 'src');
  const srcset = readAllowedAttribute(img, 'srcset');

  if (!src) {
    if (srcset) {
      findings.push(finding(
        'unresolved-resource', '<img srcset>', location,
        'Image has a responsive srcset but no plain src attribute.',
        'No Image module was created for this element.',
        'Add a direct image URL and re-import, or add the image manually after import.',
      ));
    }
    return null;
  }

  if (src.trim().toLowerCase().startsWith('data:')) {
    findings.push(finding(
      'unresolved-resource', '<img>', location,
      'Embedded (data:) image data is unsupported for this import version.',
      'This image was not imported.',
      'Host the image at a URL and re-import, or add it manually via Asset Manager after import.',
    ));
    return null;
  }
  if (src.trim().toLowerCase().startsWith('cid:')) {
    findings.push(finding(
      'unresolved-resource', '<img>', location,
      'This image references an email attachment (cid:), which Import HTML has no access to.',
      'This image was not imported.',
      'Add the image manually after import.',
    ));
    return null;
  }
  if (!isSafeResourceUrl(src)) {
    findings.push(finding(
      'unresolved-resource', '<img>', location,
      'Image source is missing, relative, or not an absolute http(s) URL.',
      'This image was not imported.',
      'Use an absolute https:// image URL and re-import.',
    ));
    return null;
  }

  if (srcset) {
    findings.push(finding(
      'normalized', '<img srcset>', location,
      'The destination Image module does not support responsive source sets.',
      'Only the primary image source was imported; srcset alternatives were not.',
      'No action needed — the image imported using its main source.',
    ));
  }

  const module = createModule('image', order);
  const props = module.props as unknown as ImageModuleProps;
  props.src = src.trim();
  props.alt = readAllowedAttribute(img, 'alt') ?? '';
  const widthPx = readImageWidthPx(img);
  if (widthPx !== null) props.width = { desktop: px(widthPx) };
  if (alignHint) props.align = alignHint;
  return module;
}

function buildButtonModule(anchor: Element, order: number, alignHint?: HorizontalAlign): EmailModule | null {
  const href = readAllowedAttribute(anchor, 'href') ?? '';
  if (!isSafeAnchorUrl(href)) return null;
  const declarations = extractStyleDeclarations(readAllowedAttribute(anchor, 'style') ?? '');
  const module = createModule('button', order);
  const props = module.props as unknown as ButtonModuleProps;
  props.text = (anchor.textContent ?? '').trim() || 'Button';
  props.href = href.trim();
  const bg = readColor(declarations, 'background-color');
  if (bg) props.backgroundColor = bg;
  const color = readColor(declarations, 'color');
  if (color) props.textColor = color;
  const fontSize = readPx(declarations, 'font-size');
  if (fontSize) props.fontSize = fontSize;
  const radius = readPx(declarations, 'border-radius');
  if (radius !== null) props.borderRadius = radius;
  if (alignHint) props.align = alignHint;
  const padding = readPaddingHV(declarations);
  if (padding) {
    props.paddingHorizontal = padding.horizontal;
    props.paddingVertical = padding.vertical;
  }
  return module;
}

function buildDividerModule(order: number): EmailModule {
  return createModule('divider', order);
}

// --- Anchor (non-button) handling ---------------------------------------
// A plain (non-button) <a> degrades to its visible text plus, when the
// href is safe, the href itself as trailing visible text (see
// textFromInlineContent) — the `text` module has no clickable-link
// sub-structure to preserve the link as a real hyperlink. This is always
// reported (not silent): a safe href is reported as an approximation
// (destination kept, not clickable); an unsafe/fragment href is reported
// as a genuine loss (text kept, destination not preserved at all).
function describeAnchorLossIfAny(anchor: Element, location: string, findings: ImportFinding[]) {
  const href = readAllowedAttribute(anchor, 'href');
  if (!href) return;
  if (isFragmentHref(href)) {
    findings.push(finding(
      'unsupported', '<a href="#...">', location,
      'Fragment (in-page jump) links are not supported in this import version.',
      'The link text was kept; the fragment link itself was not preserved.',
      'Re-add this link manually after import if needed.',
    ));
    return;
  }
  if (!isSafeAnchorUrl(href)) {
    findings.push(finding(
      'unsupported', '<a>', location,
      'This hyperlink’s URL is not a supported/safe destination.',
      'The link text was kept; the hyperlink itself was not preserved.',
      'Re-add this link manually after import if needed.',
    ));
    return;
  }
  findings.push(finding(
    'normalized', '<a>', location,
    'The destination Text module cannot represent a clickable inline link.',
    'The link destination was preserved as visible URL text next to the link label, but is not clickable.',
    'Convert to a Button (background color + padding) for a clickable call-to-action, or re-add as a manual link after import.',
  ));
}

// --- Tree walking ---------------------------------------------------------

export function directChildElements(el: Element): Element[] {
  return Array.from(el.children);
}

// Resolves through the CLOSED transparent-container allowlist only —
// never unknown/custom tags. Returns the list of elements to actually
// consider at this level (unwrapping recursively as needed).
export function resolveTransparent(elements: Element[]): Element[] {
  const resolved: Element[] = [];
  for (const el of elements) {
    const tag = el.tagName.toLowerCase();
    if (TRANSPARENT_CONTAINER_TAGS.has(tag)) {
      resolved.push(...resolveTransparent(directChildElements(el)));
    } else {
      resolved.push(el);
    }
  }
  return resolved;
}

export interface WalkContext {
  findings: ImportFinding[];
  orderCounter: { value: number };
}

export function nextOrder(ctx: WalkContext): number {
  const order = ctx.orderCounter.value;
  ctx.orderCounter.value += 1;
  return order;
}

// Maps one cell's (or top-level "row"'s) content into a flat sequence of
// primitive modules. Real emails often nest a second table inside a
// single-cell row (e.g. a "bulletproof button" construction) purely for
// rendering technique — since EDM column nesting is capped at exactly
// one level (a nested module can never itself be a layout type), a
// nested <table> found here is flattened into its cells' content in
// document order rather than represented as a second layout level, with
// a 'structural-conversion' finding explaining the simplification —
// UNLESS that nested table itself is a single button-shaped cell, which
// is mapped straight to a Button (the common case, so it does not need
// a finding at all).
function mapContentSequence(container: Element, location: string, ctx: WalkContext): EmailModule[] {
  const modules: EmailModule[] = [];
  const textBuffer: Element[] = [];

  // Same-tag-family buffering only — a heading never silently combines
  // with a following paragraph (or a different heading level) into one
  // Text module just because nothing else forced a flush in between.
  // Every non-heading text container (p/div/span/center, and a lone
  // buffered <a>) shares one family so ordinary adjacent paragraphs
  // still combine exactly as before.
  function textFamily(el: Element): string {
    const tag = el.tagName.toLowerCase();
    return /^h[1-6]$/.test(tag) ? tag : 'text';
  }

  function flushText() {
    if (textBuffer.length === 0) return;
    const first = textBuffer[0];
    const combined = textBuffer.map((el) => textFromInlineContent(el)).filter(isNonEmptyText).join('\n');
    const allBold = textBuffer.every((el) => isWholeLineBold(el));
    textBuffer.length = 0;
    if (!isNonEmptyText(combined)) return;
    const declarations = extractStyleDeclarations(readAllowedAttribute(first, 'style') ?? '');
    modules.push(buildTextModule(combined, declarations, readAllowedAttribute(first, 'align'), nextOrder(ctx), allBold));
  }

  function pushToTextBuffer(el: Element) {
    if (textBuffer.length > 0 && textFamily(textBuffer[0]) !== textFamily(el)) flushText();
    textBuffer.push(el);
  }

  const children = resolveTransparent(directChildElements(container));
  for (const el of children) {
    const tag = el.tagName.toLowerCase();

    if (DANGEROUS_TAGS.has(tag)) {
      ctx.findings.push(finding(
        'security', `<${tag}>`, location,
        'Active/executable content is never imported.',
        'This element and its contents were removed.',
        'No action needed — this was intentionally stripped for safety.',
      ));
      continue;
    }

    if (tag === 'table') {
      flushText();
      const singleCellButton = tryMapSingleCellButtonTable(el, ctx);
      if (singleCellButton) {
        modules.push(singleCellButton);
        continue;
      }
      ctx.findings.push(finding(
        'structural-conversion', '<table> (nested)', location,
        'A nested table was found inside content that already occupies one level of columns; EDM supports only one level of column nesting.',
        'The nested table’s content was converted to stacked content in place, not preserved as a second column level.',
        'Review the imported layout and re-arrange columns manually if needed.',
      ));
      modules.push(...mapNestedTableFlattened(el, location, ctx));
      continue;
    }

    if (tag === 'hr') {
      flushText();
      modules.push(buildDividerModule(nextOrder(ctx)));
      continue;
    }

    if (tag === 'img') {
      flushText();
      const alignHint = elementAlignHint(el) ?? elementAlignHint(container);
      const built = buildImageModule(el, nextOrder(ctx), ctx.findings, location, alignHint);
      if (built) modules.push(built);
      continue;
    }

    if (tag === 'a') {
      if (looksLikeButtonAnchor(el)) {
        flushText();
        const alignHint = elementAlignHint(el) ?? elementAlignHint(container);
        const built = buildButtonModule(el, nextOrder(ctx), alignHint);
        if (built) {
          modules.push(built);
          continue;
        }
      }
      describeAnchorLossIfAny(el, location, ctx.findings);
      pushToTextBuffer(el);
      continue;
    }

    if (tag === 'ul' || tag === 'ol') {
      flushText();
      const items = Array.from(el.querySelectorAll(':scope > li')).map((li) => textFromInlineContent(li)).filter(isNonEmptyText);
      if (items.length > 0) {
        ctx.findings.push(finding(
          'normalized', `<${tag}>`, location,
          'List formatting (bullets/numbering) is not represented by the Text module.',
          'List items were imported as plain text, one per line.',
          'No action needed — reformat manually if bullet styling is required.',
        ));
        modules.push(buildTextModule(items.join('\n'), new Map(), null, nextOrder(ctx), false));
      }
      continue;
    }

    if (tag === 'p' || tag === 'div' || tag === 'span' || /^h[1-6]$/.test(tag) || tag === 'center') {
      // A container holding its own module-worthy content — a nested
      // table/list, a standalone image, a divider, or a link (which must
      // be individually visited so a non-button link's loss is reported,
      // not silently absorbed into a flattened text block) — is walked
      // structurally instead of being flattened. A purely textual
      // container (plain text, possibly with inline strong/em/br) is
      // buffered as one unit so adjacent text blocks of the SAME tag
      // family combine into a single Text module (see textFamily above —
      // a heading never combines with a paragraph, or with a different
      // heading level, just because nothing else forced a flush first).
      const hasOwnModuleChild = directChildElements(el).some((child) => {
        const childTag = child.tagName.toLowerCase();
        return childTag === 'table' || childTag === 'ul' || childTag === 'ol' || childTag === 'img' || childTag === 'hr' || childTag === 'a';
      });
      // A dangerous element ANYWHERE inside (not just as a direct child)
      // must always be individually visited so it gets stripped and
      // reported — .textContent on the un-recursed container would
      // otherwise silently include a <script>'s own text alongside real
      // content (never executable once rendered as escaped text, but the
      // element itself would never be reported, which the security
      // policy requires).
      const hasDangerous = hasDangerousDescendant(el);
      if (hasOwnModuleChild || hasDangerous) {
        flushText();
        modules.push(...mapContentSequence(el, location, ctx));
      } else if (isNonEmptyText(el.textContent ?? '')) {
        pushToTextBuffer(el);
      }
      continue;
    }

    if (CONTENT_TAGS.has(tag)) {
      // Recognized-but-otherwise-unhandled content tag (e.g. a bare
      // strong/em appearing directly as a block-level child rather than
      // inline within a paragraph) — treat its text as content.
      if (isNonEmptyText(el.textContent ?? '')) pushToTextBuffer(el);
      continue;
    }

    // Unknown/custom tag — never generically unwrapped. Whole subtree
    // dropped, reported once.
    ctx.findings.push(finding(
      'unsupported', `<${tag}>`, location,
      'This element has no corresponding representation in the email builder.',
      'This element and its contents were not imported.',
      'Rebuild this content manually using existing modules after import.',
    ));
  }

  flushText();
  return modules;
}

function tryMapSingleCellButtonTable(table: Element, ctx: WalkContext): EmailModule | null {
  const rows = resolveTransparent(directChildElements(table)).flatMap((el) =>
    el.tagName.toLowerCase() === 'tbody' || el.tagName.toLowerCase() === 'thead' || el.tagName.toLowerCase() === 'tfoot'
      ? resolveTransparent(directChildElements(el))
      : [el]);
  if (rows.length !== 1 || rows[0].tagName.toLowerCase() !== 'tr') return null;
  const cells = directChildElements(rows[0]).filter((c) => c.tagName.toLowerCase() === 'td' || c.tagName.toLowerCase() === 'th');
  if (cells.length !== 1) return null;
  const anchor = cells[0].querySelector(':scope > a');
  if (!anchor || !looksLikeButtonAnchor(anchor)) return null;
  return buildButtonModule(anchor, nextOrder(ctx), elementAlignHint(cells[0]));
}

function mapNestedTableFlattened(table: Element, location: string, ctx: WalkContext): EmailModule[] {
  const rows = resolveTransparent(directChildElements(table)).flatMap((el) => {
    const tag = el.tagName.toLowerCase();
    return tag === 'tbody' || tag === 'thead' || tag === 'tfoot' ? resolveTransparent(directChildElements(el)) : [el];
  }).filter((el) => el.tagName.toLowerCase() === 'tr');

  const modules: EmailModule[] = [];
  for (const row of rows) {
    const cells = directChildElements(row).filter((c) => c.tagName.toLowerCase() === 'td' || c.tagName.toLowerCase() === 'th');
    for (const cell of cells) {
      modules.push(...mapContentSequence(cell, location, ctx));
    }
  }
  return modules;
}

// --- Header structural predicate (logo / logo+nav / logo+cta) -----------
// Fires ONLY on a 1- or 2-cell row where exactly one cell is
// unambiguously "just a logo" (see findLogoImageIn — a single <img>,
// optionally wrapped in its own <a>, with nothing else of substance in
// that cell) — never inferred from position, class names, or known
// template markup. A 2-cell row additionally needs the OTHER cell to
// contain real <a> links: two-or-more (or one NOT button-styled) become
// navigation links; exactly one button-styled anchor becomes the header's
// CTA. Anything else (no logo cell, or a second cell with no links at
// all) is not a confident structural match and falls through unchanged
// to the generic per-element content mapping, which still imports the
// image/links individually (with the normal findings) rather than losing
// them outright.
const NAV_LINK_CAP = 6;

export function findLogoImageIn(cell: Element): Element | null {
  const imgs = Array.from(cell.querySelectorAll('img'));
  if (imgs.length !== 1) return null;
  const clone = cell.cloneNode(true) as Element;
  clone.querySelectorAll('img').forEach((n) => n.remove());
  const remainingText = (clone.textContent ?? '').trim();
  const otherStructural = clone.querySelectorAll('table, hr, ul, ol').length > 0;
  if (remainingText.length > 0 || otherStructural) return null;
  return imgs[0];
}

export function tryDetectHeaderRow(
  cells: Element[], ctx: WalkContext, location: string, rowBackgroundFallback: { color?: string; image?: string },
): EmailModule | null {
  // Deliberately requires BOTH a logo cell AND a links cell — a bare
  // single-cell row containing just one image is structurally
  // indistinguishable from ordinary image content (a hero image, a
  // content photo, ...) and must NOT be reclassified as a header on
  // that signal alone. The two-cell "logo area next to a links area"
  // shape is the unambiguous, position-independent signal this predicate
  // actually keys on.
  if (cells.length !== 2) return null;
  if (cells.some((c) => hasDangerousDescendant(c))) return null; // defer to the generic per-element path so dangerous content is still individually stripped + reported

  let logoCellIndex = -1;
  let logoImg: Element | null = null;
  cells.forEach((cell, index) => {
    if (logoImg) return;
    const found = findLogoImageIn(cell);
    if (found) { logoImg = found; logoCellIndex = index; }
  });
  if (!logoImg || logoCellIndex === -1) return null;
  // Rebind to a fresh const — logoImg is reassigned inside the forEach
  // closure above, which keeps TS from narrowing it to non-null for the
  // rest of this function even after the guard immediately above.
  const confirmedLogoImg: Element = logoImg;

  const logoSrc = readAllowedAttribute(confirmedLogoImg, 'src');
  if (!logoSrc || !isSafeResourceUrl(logoSrc)) return null;

  const logoCell = cells[logoCellIndex];
  const otherCell = cells[1 - logoCellIndex];

  const anchors = Array.from(otherCell.querySelectorAll('a'));
  if (anchors.length === 0) return null; // no links at all in the second cell -> not a recognizable header pattern

  let navLinks: { label: string; href: string }[] = [];
  let ctaAnchor: Element | null = null;
  if (anchors.length === 1 && looksLikeButtonAnchor(anchors[0])) {
    ctaAnchor = anchors[0];
  } else {
    navLinks = anchors.slice(0, NAV_LINK_CAP).map((a) => {
      const href = readAllowedAttribute(a, 'href');
      return { label: (a.textContent ?? '').trim() || 'Link', href: href && isSafeAnchorUrl(href) ? href.trim() : '' };
    });
    if (anchors.length > NAV_LINK_CAP) {
      ctx.findings.push(finding(
        'normalized', '<nav> links', location,
        `This header has ${anchors.length} navigation links; the header module supports at most ${NAV_LINK_CAP}.`,
        `Only the first ${NAV_LINK_CAP} navigation links were imported.`,
        'Add the remaining links manually after import.',
      ));
    }
  }

  const wrappingAnchor = confirmedLogoImg.closest('a');
  const logoHref = wrappingAnchor ? readAllowedAttribute(wrappingAnchor, 'href') : null;

  const type: EmailModuleType = ctaAnchor ? 'header-logo-cta' : 'header-logo-nav';

  const module = createModule(type, nextOrder(ctx));
  const props = module.props as unknown as HeaderModuleProps;
  props.logoSrc = logoSrc.trim();
  props.logoAlt = readAllowedAttribute(confirmedLogoImg, 'alt') ?? '';
  const logoWidthPx = readImageWidthPx(confirmedLogoImg);
  if (logoWidthPx !== null) props.logoWidth = logoWidthPx;
  if (logoHref && isSafeAnchorUrl(logoHref)) props.logoHref = logoHref.trim();
  if (ctaAnchor) {
    const href = readAllowedAttribute(ctaAnchor, 'href') ?? '';
    if (isSafeAnchorUrl(href)) {
      props.ctaText = (ctaAnchor.textContent ?? '').trim() || 'Shop Now';
      props.ctaHref = href.trim();
    }
  }
  if (navLinks.length > 0) props.navLinks = navLinks;
  const logoCellBackground = readBackground(logoCell);
  const effectiveHeaderBackground = logoCellBackground.color || logoCellBackground.image ? logoCellBackground : rowBackgroundFallback;
  applyBackground(module, effectiveHeaderBackground);

  return module;
}

// --- Footer structural predicate (unsubscribe / preference / social) ----
// Triggered by an unambiguous, compliance-specific signal — an anchor
// whose visible text matches "unsubscribe" — rather than any generic
// "looks like a footer" heuristic (position, small font size, etc. are
// all too easily confused with an ordinary content section). No
// unsubscribe link anywhere in the cell means this is not a confident
// structural match, and the cell falls through unchanged to the generic
// content mapper, which still imports its text/links individually.
function matchSocialPlatform(label: string): string | null {
  const trimmed = label.trim().toLowerCase();
  if (!trimmed) return null;
  return SOCIAL_PLATFORM_PRESETS.find((preset) => preset.toLowerCase() === trimmed) ?? null;
}

interface FooterSignals {
  companyName: string;
  legalLines: string[];
  unsubscribe: { text: string; href: string } | null;
  preference: { text: string; href: string } | null;
  social: { label: string; href: string }[];
}

function collectFooterSignals(cell: Element): FooterSignals {
  const anchors = Array.from(cell.querySelectorAll('a'));
  let unsubscribe: { text: string; href: string } | null = null;
  let preference: { text: string; href: string } | null = null;
  const social: { label: string; href: string }[] = [];
  // Structural containment, not text equality — a consumed link's own
  // block-level line must never ALSO surface as a legal/company text
  // line, and text equality breaks the moment textFromInlineContent
  // appends "(href)" to a safe link (see its own docstring), which would
  // no longer match the anchor's bare .textContent.
  const consumedAnchors: Element[] = [];

  for (const a of anchors) {
    const text = (a.textContent ?? '').trim();
    const href = readAllowedAttribute(a, 'href');
    const safeHref = href && isSafeAnchorUrl(href) ? href.trim() : '';
    if (!unsubscribe && /unsubscribe/i.test(text)) {
      unsubscribe = { text: text || 'Unsubscribe', href: safeHref };
      consumedAnchors.push(a);
      continue;
    }
    if (!preference && /privacy|preference/i.test(text)) {
      preference = { text, href: safeHref };
      consumedAnchors.push(a);
      continue;
    }
    const img = a.querySelector('img');
    const altLabel = img ? (readAllowedAttribute(img, 'alt') ?? '') : '';
    const socialMatch = matchSocialPlatform(text) ?? matchSocialPlatform(altLabel);
    if (socialMatch) { social.push({ label: socialMatch, href: safeHref }); consumedAnchors.push(a); }
  }

  const blocks = resolveTransparent(directChildElements(cell))
    .filter((el) => /^(p|div|span|center|h[1-6])$/.test(el.tagName.toLowerCase()));
  const blockTextLines = blocks
    .filter((el) => !consumedAnchors.some((a) => el.contains(a)))
    .map((el) => textFromInlineContent(el))
    .filter(isNonEmptyText);

  // R4-D Checkpoint D3 — a real bug found during live QA: a footer whose
  // address/legal text is a BARE text node directly inside the cell
  // ("123 Main St, Springfield<br><a>Unsubscribe</a>" — no wrapping
  // <p>/<div>, extremely common in real-world sender footers) was
  // silently dropped here. `blocks` above only ever looks at ELEMENT
  // children, so a bare text node contributed nothing to `textLines`,
  // `companyName` stayed empty, and the footer module fell back to its
  // own factory default company/legal text — while the fidelity report
  // still claimed "Content: Preserved" (no finding was ever generated
  // for this, because nothing here recognized a loss occurred). Fixed by
  // also collecting the cell's own direct TEXT-NODE children as
  // candidate lines. Deliberately narrow: this does not attempt to
  // recombine bare text that sits on the SAME line as a consumed anchor
  // (e.g. a bare " | " separator between two links) — filterable noise
  // like that is exactly why bare text is appended AFTER the more
  // structured block lines rather than replacing them.
  const bareTextLines = Array.from(cell.childNodes)
    .filter((node): node is Text => node.nodeType === Node.TEXT_NODE)
    .map((node) => (node.textContent ?? '').trim())
    .filter(isNonEmptyText);
  const textLines = [...blockTextLines, ...bareTextLines];

  return {
    companyName: textLines[0] ?? '',
    legalLines: textLines.slice(1),
    unsubscribe,
    preference,
    social,
  };
}

export function tryDetectFooterCell(
  cell: Element, ctx: WalkContext, location: string, rowBackgroundFallback: { color?: string; image?: string },
): EmailModule | null {
  if (hasDangerousDescendant(cell)) return null; // defer to the generic per-element path

  const signals = collectFooterSignals(cell);
  if (!signals.unsubscribe) return null;

  const type: EmailModuleType = signals.social.length >= 2 ? 'footer-social-legal' : 'footer-preference-unsubscribe';
  const module = createModule(type, nextOrder(ctx));
  const props = module.props as unknown as FooterModuleProps;
  if (signals.companyName) props.companyName = signals.companyName;
  if (signals.legalLines.length > 0) props.legalText = signals.legalLines.join(' ');
  props.unsubscribeText = signals.unsubscribe.text;
  props.unsubscribeHref = signals.unsubscribe.href;
  if (signals.preference) {
    props.preferenceText = signals.preference.text;
    props.preferenceHref = signals.preference.href;
  }
  if (signals.social.length > 0) props.socialPlatforms = signals.social;

  const cellBackground = readBackground(cell);
  const effectiveFooterBackground = cellBackground.color || cellBackground.image ? cellBackground : rowBackgroundFallback;
  applyBackground(module, effectiveFooterBackground);

  if (!signals.unsubscribe.href) {
    ctx.findings.push(finding(
      'normalized', '<a> (unsubscribe)', location,
      'The unsubscribe link had no safe absolute URL.',
      'The unsubscribe label was imported but the link target was not.',
      'Set the unsubscribe link URL manually after import.',
    ));
  }
  return module;
}

// --- Row/column (layout) mapping -----------------------------------------

function mapTableAsRows(table: Element, ctx: WalkContext): EmailModule[] {
  const sections = resolveTransparent(directChildElements(table));
  const rows = sections.flatMap((el) => {
    const tag = el.tagName.toLowerCase();
    return tag === 'tbody' || tag === 'thead' || tag === 'tfoot' ? resolveTransparent(directChildElements(el)) : [el];
  }).filter((el) => el.tagName.toLowerCase() === 'tr');

  const tableBackground = readBackground(table);
  const modules: EmailModule[] = [];

  rows.forEach((row, rowIndex) => {
    const location = `row ${rowIndex + 1}`;
    const rawCells = directChildElements(row).filter((c) => c.tagName.toLowerCase() === 'td' || c.tagName.toLowerCase() === 'th');
    if (rawCells.length === 0) return;

    const rowBackground = readBackground(row);
    // A background declared on the wrapping <table> applies to the whole
    // section it wraps; only trusted as THIS row's own background when
    // the table wraps exactly one row (otherwise it would incorrectly
    // paint every row in a larger table the same color).
    const fallbackBackground = rows.length === 1 ? tableBackground : {};
    const effectiveRowBackground = rowBackground.color || rowBackground.image ? rowBackground : fallbackBackground;

    const headerModule = tryDetectHeaderRow(rawCells, ctx, location, effectiveRowBackground);
    if (headerModule) {
      modules.push(headerModule);
      return;
    }

    const { contentCells, outerLeftPx, outerRightPx, gutterPx, gutterApproximated } = classifyRowCells(rawCells);
    if (contentCells.length === 0) return;

    if (contentCells.length === 1) {
      const cellBackground = readBackground(contentCells[0]);
      const effectiveBackground = cellBackground.color || cellBackground.image ? cellBackground : effectiveRowBackground;
      const footerModule = tryDetectFooterCell(contentCells[0], ctx, location, effectiveRowBackground);
      const built = footerModule ? [footerModule] : mapContentSequence(contentCells[0], location, ctx);
      for (const builtModule of built) {
        applyOuterSpacingPx(builtModule, outerLeftPx, outerRightPx);
        if (!footerModule) applyBackground(builtModule, effectiveBackground); // a matched footer already applied its own (cell-or-row) background above
      }
      modules.push(...built);
      return;
    }

    const picked = pickLayoutType(contentCells);
    if (!picked) {
      ctx.findings.push(finding(
        'unsupported', `<tr> (${contentCells.length} columns)`, location,
        'This row’s column count or geometry does not correspond to any supported layout.',
        'This row was not imported.',
        'Rebuild this row manually using an existing Layout module after import.',
      ));
      return;
    }
    if (!picked.exact) {
      ctx.findings.push(finding(
        'structural-conversion', `<tr> (${contentCells.length} columns)`, location,
        'Source column widths do not exactly match any supported layout split.',
        `Source column ratio ${picked.sourceRatio.join('/')} was approximated to supported layout ${picked.widths.join('/')}.`,
        'Adjust column widths manually after import if exact proportions matter.',
      ));
    }
    if (gutterApproximated) {
      ctx.findings.push(finding(
        'structural-conversion', `<tr> (${contentCells.length} columns)`, location,
        'Interior spacer cells between columns had differing widths; the layout system supports one uniform gutter.',
        `A single ${gutterPx}px column gutter was used for every gap in this row.`,
        'Adjust individual column gutters manually after import if needed.',
      ));
    }

    const columns: EmailColumn[] = contentCells.map((cell) => {
      const settings = createColumnSettings();
      const cellBackground = readBackground(cell);
      if (cellBackground.color) settings.backgroundColor = cellBackground.color;
      if (cellBackground.image) settings.backgroundImage = cellBackground.image;
      return { id: generateModuleId(), settings, modules: mapContentSequence(cell, location, ctx) };
    });

    const layoutModule = createModule(picked.type, nextOrder(ctx));
    layoutModule.columns = columns;
    applyOuterSpacingPx(layoutModule, outerLeftPx, outerRightPx);
    if (gutterPx > 0) layoutModule.settings.columnGutterPx = gutterPx;
    applyBackground(layoutModule, effectiveRowBackground);
    modules.push(layoutModule);
  });

  return modules;
}

// --- Outlook/MSO conditional content (informational, once per document) -
// MSO conditional comments parse as Comment nodes, never real elements —
// the mapper's element-walk naturally never visits them (they are
// fallback markup for Classic Outlook, not missing content the rest of
// the document depends on). Rather than staying completely silent about
// it, one summary finding tells the user WHY that markup did not carry
// over: the destination renderer regenerates its own Outlook/VML
// compatibility (see vml.ts, wired through settings.outlookVml) instead
// of replaying the source's own conditional block. Deliberately at most
// ONE finding for the whole document, not one per comment — this is a
// single, document-level fact, not a per-element loss.
export function documentHasMsoConditionalContent(document: Document): boolean {
  if (!document.body) return false;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_COMMENT);
  let node = walker.nextNode();
  while (node) {
    if (/\[if\s*!?\s*mso/i.test(node.nodeValue ?? '')) return true;
    node = walker.nextNode();
  }
  return false;
}

// --- Entry point -----------------------------------------------------------

export function mapImportedHtml(document: Document): ImportMappingResult {
  const findings: ImportFinding[] = [];
  const ctx: WalkContext = { findings, orderCounter: { value: 0 } };
  const emailTitle = extractImportedTitle(document);

  if (documentHasMsoConditionalContent(document)) {
    findings.push(finding(
      'outlook-regeneration', '<!--[if mso]-->', 'document',
      'Source contained Outlook/MSO conditional markup.',
      'The imported builder recreates supported Outlook compatibility from its own VML renderer rather than retaining the original conditional block.',
      'Enable Outlook compatibility in Export/Deploy settings if VML button/background fallbacks are required.',
    ));
  }

  const body = document.body;
  const modules: EmailModule[] = [];
  if (body) {
    const topLevel = resolveTransparent(directChildElements(body));
    for (const el of topLevel) {
      const tag = el.tagName.toLowerCase();
      if (DANGEROUS_TAGS.has(tag)) {
        findings.push(finding(
          'security', `<${tag}>`, 'document body',
          'Active/executable content is never imported.',
          'This element and its contents were removed.',
          'No action needed — this was intentionally stripped for safety.',
        ));
        continue;
      }
      if (tag === 'table') {
        modules.push(...mapTableAsRows(el, ctx));
        continue;
      }
      // Any other top-level block (a bare <p>/<div> not wrapped in a
      // table) maps as a single implicit "row" of content.
      const wrapper = document.createElement('div');
      wrapper.appendChild(el.cloneNode(true));
      modules.push(...mapContentSequence(wrapper, 'document body', ctx));
    }
  }

  return { modules, findings, emailTitle };
}
