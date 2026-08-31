import type { EmailModule, HorizontalAlign } from './edm';
import { DEFAULT_EMAIL_WIDTH } from './widthOptions';
import {
  classifyRowCells, documentHasMsoConditionalContent, elementAlignHint,
  isWholeLineBold, looksLikeButtonAnchor, pickLayoutType, readAlign, readBackground, readColor,
  readImageWidthPx, readLineHeightPx, readPaddingHV, readPx, resolveTransparent, directChildElements,
  textFromInlineContent, tryDetectFooterCell, tryDetectHeaderRow,
  type WalkContext,
} from './htmlImportMapper';
import { DANGEROUS_TAGS, extractStyleDeclarations, isSafeAnchorUrl, isSafeResourceUrl, readAllowedAttribute } from './htmlImportSanitize';

// R1 (Import HTML AI Reconstruction) — Structural/Semantic Analysis.
//
// A SECOND, ADDITIVE read of the same sanitized DOM htmlImportMapper.ts
// already walks deterministically to build EmailModule[]. This file
// calls that SAME file's own exported pure helpers (readBackground,
// classifyRowCells, pickLayoutType, tryDetectHeaderRow, tryDetectFooterCell,
// looksLikeButtonAnchor, ...) for every fact those helpers already
// compute — width, ratio, color, href, align, background, header/footer
// structural matches. It never reimplements that logic, so this layer
// can never disagree with the deterministic module-building path on any
// fact those functions produce ("deterministic analysis remains
// authoritative" holds by construction, not by convention).
//
// What this file adds is what the mapper deliberately does NOT track: a
// semantic role per region (mapper only ever needs "does this become
// module type X", never "is this conceptually a hero vs a heading"), a
// confidence score per classification (deterministic — a fixed function
// of which structural signal fired, never LLM-produced; see
// ROLE_CONFIDENCE and the per-branch comments below), and a structured
// (never raw-HTML) summary a later AI reconstruction step reads instead
// of being handed markup.
//
// mapImportedHtml itself is NEVER called from here and this file never
// builds an EmailModule — DetectedStructure is a read-only ANALYSIS
// artifact, not a second document representation. The only two places
// that ever construct real EmailModule[] remain htmlImportMapper.ts
// (deterministic path) and moduleFactory.ts's buildComposedModule
// (AI-composition path, reused unchanged by the reconstruction plan).

export type DetectedRegionRole =
  | 'preheader' | 'header' | 'hero' | 'heading' | 'paragraph' | 'cta' | 'image'
  | 'columns' | 'divider' | 'footer' | 'unknown';

export interface DetectedLink {
  label: string;
  href: string;
  safe: boolean;
}

export interface DetectedImage {
  src: string;
  alt: string;
  widthPx: number | null;
  safe: boolean;
}

export interface DetectedTypography {
  fontSize?: number;
  fontWeight?: 400 | 700;
  lineHeight?: number;
  color?: string;
  align?: HorizontalAlign;
}

export interface DetectedSpacing {
  paddingHorizontal?: number;
  paddingVertical?: number;
  outerSpacingLeftPx?: number;
  outerSpacingRightPx?: number;
  gutterPx?: number;
}

export interface DetectedBackground {
  color?: string;
  image?: string;
}

export interface DetectedRegion {
  role: DetectedRegionRole;
  // Deterministic, 0..1 — a fixed function of which structural signal
  // fired (see ROLE_CONFIDENCE below and inline overrides). Never
  // produced by an AI call; uncertain classifications are surfaced with
  // a lower number rather than silently presented as fact (instruction
  // 6), and callers should treat anything below MEDIUM_CONFIDENCE as
  // "the AI/user should confirm this," not as settled.
  confidence: number;
  // Same "row N" convention as ImportFinding.location, so a region and
  // any ImportFinding the deterministic mapper emitted for the same
  // source content can be cross-referenced by a human reading both.
  sourcePosition: string;
  detectedWidthPx: number | null;
  parentWidthPx: number | null;
  // The REAL detected ratio before any preset snap — the exact same
  // value pickLayoutType's own `sourceRatio` already computes, never a
  // second derivation. null for anything that isn't a multi-column row.
  columnRatio: number[] | null;
  content: { text: string[] };
  links: DetectedLink[];
  images: DetectedImage[];
  typography: DetectedTypography;
  spacing: DetectedSpacing;
  background: DetectedBackground;
  children: DetectedRegion[];
}

export interface DetectedStructure {
  documentWidthPx: number;
  regions: DetectedRegion[];
  hasMsoConditionalContent: boolean;
}

export const MEDIUM_CONFIDENCE = 0.7;

// Deterministic confidence per signal — a lookup table, not a guess.
// Higher when the source signal is structurally unambiguous (an <hr> can
// only ever be a divider; a row matching the header logo+nav predicate
// is a very specific two-cell shape unlikely to occur by accident for
// any other reason); lower when the classification is a heuristic that
// COULD be wrong for a legitimate, differently-intended source (a short
// first-line text block is usually a preheader, but might just be a
// short opening sentence).
const ROLE_CONFIDENCE: Record<DetectedRegionRole, number> = {
  divider: 1, heading: 1, footer: 0.95, header: 0.95, cta: 0.9, columns: 1,
  image: 0.9, paragraph: 1, hero: 0.7, preheader: 0.6, unknown: 0.3,
};

const PREHEADER_MAX_CHARS = 200;
const HERO_MIN_WIDTH_RATIO = 0.9;
const HERO_MAX_REGION_INDEX = 2;

function emptyRegion(role: DetectedRegionRole, sourcePosition: string, confidence = ROLE_CONFIDENCE[role]): DetectedRegion {
  return {
    role, confidence, sourcePosition, detectedWidthPx: null, parentWidthPx: null, columnRatio: null,
    content: { text: [] }, links: [], images: [], typography: {}, spacing: {}, background: {}, children: [],
  };
}

function typographyOf(el: Element): DetectedTypography {
  const declarations = extractStyleDeclarations(readAllowedAttribute(el, 'style') ?? '');
  const typography: DetectedTypography = {};
  const align = readAlign(declarations, readAllowedAttribute(el, 'align'));
  if (align) typography.align = align;
  const color = readColor(declarations, 'color');
  if (color) typography.color = color;
  const fontSize = readPx(declarations, 'font-size');
  if (fontSize) typography.fontSize = fontSize;
  if (isWholeLineBold(el)) typography.fontWeight = 700;
  const lineHeight = readLineHeightPx(declarations, typography.fontSize ?? 16);
  if (lineHeight !== null) typography.lineHeight = lineHeight;
  return typography;
}

function spacingOf(el: Element): DetectedSpacing {
  const declarations = extractStyleDeclarations(readAllowedAttribute(el, 'style') ?? '');
  const spacing: DetectedSpacing = {};
  const padding = readPaddingHV(declarations);
  if (padding) {
    spacing.paddingHorizontal = padding.horizontal;
    spacing.paddingVertical = padding.vertical;
  }
  return spacing;
}

function linkOf(a: Element): DetectedLink {
  const href = readAllowedAttribute(a, 'href') ?? '';
  const safe = href.length > 0 && isSafeAnchorUrl(href);
  return { label: (a.textContent ?? '').trim() || 'Link', href: safe ? href.trim() : '', safe };
}

function imageOf(img: Element): DetectedImage {
  const src = readAllowedAttribute(img, 'src') ?? '';
  const safe = src.length > 0 && isSafeResourceUrl(src) && !src.trim().toLowerCase().startsWith('data:') && !src.trim().toLowerCase().startsWith('cid:');
  return {
    src: safe ? src.trim() : '',
    alt: readAllowedAttribute(img, 'alt') ?? '',
    widthPx: readImageWidthPx(img),
    safe,
  };
}

// Classifies ONE content-bearing element within a cell into a region.
// Mirrors the shape of tags htmlImportMapper.ts's mapContentSequence
// already recognizes (h1-6/p/div/span/center/img/a/hr/table), but keeps
// what that file intentionally discards for module-building purposes —
// the source TAG identity (h1 vs p), which is exactly what distinguishes
// a 'heading' region from a 'paragraph' region. Nested tables are not
// recursed into here (the deterministic mapper's own flattening already
// handles that structurally); a nested table becomes a single low-
// confidence 'unknown' region rather than silently vanishing.
function analyzeElement(el: Element, location: string, parentWidthPx: number | null): DetectedRegion | null {
  const tag = el.tagName.toLowerCase();

  if (DANGEROUS_TAGS.has(tag)) return null; // the deterministic mapper is the one that strips + reports this; analysis does not duplicate that finding

  if (tag === 'hr') return emptyRegion('divider', location);

  if (tag === 'img') {
    const region = emptyRegion('image', location);
    region.parentWidthPx = parentWidthPx;
    region.detectedWidthPx = readImageWidthPx(el);
    region.images = [imageOf(el)];
    const align = elementAlignHint(el);
    if (align) region.typography.align = align;
    return region;
  }

  if (tag === 'a') {
    if (looksLikeButtonAnchor(el)) {
      const region = emptyRegion('cta', location);
      region.links = [linkOf(el)];
      region.typography = typographyOf(el);
      region.spacing = spacingOf(el);
      return region;
    }
    // A plain, non-button anchor is not its own region — it folds into
    // whatever paragraph text surrounds it, same as the deterministic
    // mapper's own text-buffering behavior for a non-button <a>.
    return null;
  }

  if (/^h[1-6]$/.test(tag) || tag === 'p' || tag === 'div' || tag === 'span' || tag === 'center') {
    const text = textFromInlineContent(el);
    if (text.length === 0 && el.querySelectorAll('img, a, hr, table').length === 0) return null;
    const role: DetectedRegionRole = /^h[1-6]$/.test(tag) ? 'heading' : 'paragraph';
    const region = emptyRegion(role, location);
    if (text) region.content.text = [text];
    region.typography = typographyOf(el);
    region.spacing = spacingOf(el);
    region.links = Array.from(el.querySelectorAll('a')).filter((a) => !looksLikeButtonAnchor(a)).map(linkOf);
    const nestedImg = el.querySelector('img');
    if (nestedImg) region.images = [imageOf(nestedImg)];
    return region;
  }

  if (tag === 'table') {
    const region = emptyRegion('unknown', location);
    region.content.text = ['Nested table content — represented as stacked content by the deterministic importer.'];
    return region;
  }

  return null;
}

function analyzeCellContent(cell: Element, location: string, parentWidthPx: number | null): DetectedRegion[] {
  const children = resolveTransparent(directChildElements(cell));
  const regions: DetectedRegion[] = [];
  for (const el of children) {
    const region = analyzeElement(el, location, parentWidthPx);
    if (region) regions.push(region);
  }
  return regions;
}

function regionFromHeaderModule(headerModule: EmailModule, location: string, documentWidthPx: number, background: DetectedBackground): DetectedRegion {
  const props = headerModule.props as { logoSrc?: string; logoAlt?: string; logoWidth?: number; navLinks?: { label: string; href: string }[]; ctaText?: string; ctaHref?: string };
  const region = emptyRegion('header', location);
  region.detectedWidthPx = documentWidthPx;
  region.parentWidthPx = documentWidthPx;
  region.background = background;
  if (props.logoSrc) region.images = [{ src: props.logoSrc, alt: props.logoAlt ?? '', widthPx: props.logoWidth ?? null, safe: true }];
  if (props.navLinks?.length) region.links = props.navLinks.map((l) => ({ label: l.label, href: l.href, safe: l.href.length > 0 }));
  else if (props.ctaText) region.links = [{ label: props.ctaText, href: props.ctaHref ?? '', safe: Boolean(props.ctaHref) }];
  return region;
}

function regionFromFooterModule(footerModule: EmailModule, location: string, background: DetectedBackground, outerLeftPx: number, outerRightPx: number): DetectedRegion {
  const props = footerModule.props as {
    companyName?: string; legalText?: string; unsubscribeText?: string; unsubscribeHref?: string;
    preferenceText?: string; preferenceHref?: string; socialPlatforms?: { label: string; href: string }[];
  };
  const region = emptyRegion('footer', location);
  region.background = background;
  region.spacing.outerSpacingLeftPx = outerLeftPx || undefined;
  region.spacing.outerSpacingRightPx = outerRightPx || undefined;
  const textLines = [props.companyName, props.legalText].filter((v): v is string => Boolean(v));
  region.content.text = textLines;
  const links: DetectedLink[] = [];
  if (props.unsubscribeText) links.push({ label: props.unsubscribeText, href: props.unsubscribeHref ?? '', safe: Boolean(props.unsubscribeHref) });
  if (props.preferenceText) links.push({ label: props.preferenceText, href: props.preferenceHref ?? '', safe: Boolean(props.preferenceHref) });
  if (props.socialPlatforms) links.push(...props.socialPlatforms.map((s) => ({ label: s.label, href: s.href, safe: s.href.length > 0 })));
  region.links = links;
  return region;
}

function analyzeTable(table: Element, documentWidthPx: number): DetectedRegion[] {
  const sections = resolveTransparent(directChildElements(table));
  const rows = sections.flatMap((el) => {
    const tag = el.tagName.toLowerCase();
    return tag === 'tbody' || tag === 'thead' || tag === 'tfoot' ? resolveTransparent(directChildElements(el)) : [el];
  }).filter((el) => el.tagName.toLowerCase() === 'tr');

  const tableBackground = readBackground(table);
  const regions: DetectedRegion[] = [];

  rows.forEach((row, rowIndex) => {
    const location = `row ${rowIndex + 1}`;
    const rawCells = directChildElements(row).filter((c) => c.tagName.toLowerCase() === 'td' || c.tagName.toLowerCase() === 'th');
    if (rawCells.length === 0) return;

    const rowBackground = readBackground(row);
    const fallbackBackground = rows.length === 1 ? tableBackground : {};
    const effectiveRowBackground = rowBackground.color || rowBackground.image ? rowBackground : fallbackBackground;

    // Scratch WalkContext — the mapper's own header/footer predicates
    // require one to push findings into, but ANALYSIS never emits
    // ImportFindings itself (that stays the deterministic mapper's sole
    // responsibility); this context's findings are discarded.
    const scratch: WalkContext = { findings: [], orderCounter: { value: 0 } };

    const headerModule = tryDetectHeaderRow(rawCells, scratch, location, effectiveRowBackground);
    if (headerModule) {
      regions.push(regionFromHeaderModule(headerModule, location, documentWidthPx, effectiveRowBackground));
      return;
    }

    const { contentCells, outerLeftPx, outerRightPx, gutterPx } = classifyRowCells(rawCells);
    if (contentCells.length === 0) return;

    if (contentCells.length === 1) {
      const cellBackground = readBackground(contentCells[0]);
      const effectiveBackground = cellBackground.color || cellBackground.image ? cellBackground : effectiveRowBackground;

      const footerModule = tryDetectFooterCell(contentCells[0], scratch, location, effectiveRowBackground);
      if (footerModule) {
        regions.push(regionFromFooterModule(footerModule, location, effectiveBackground, outerLeftPx, outerRightPx));
        return;
      }

      const cellRegions = analyzeCellContent(contentCells[0], location, documentWidthPx);
      for (const region of cellRegions) {
        region.background = effectiveBackground;
        if (outerLeftPx) region.spacing.outerSpacingLeftPx = outerLeftPx;
        if (outerRightPx) region.spacing.outerSpacingRightPx = outerRightPx;
      }
      regions.push(...cellRegions);
      return;
    }

    // Multi-column row — column widths/ratio come straight from
    // pickLayoutType, the SAME function the deterministic mapper uses to
    // pick the actual layout module, so the ratio reported here can
    // never diverge from what gets built.
    const picked = pickLayoutType(contentCells);
    const region = emptyRegion('columns', location, picked ? (picked.exact ? 1 : 0.85) : 0.4);
    region.detectedWidthPx = documentWidthPx;
    region.parentWidthPx = documentWidthPx;
    region.columnRatio = picked ? picked.sourceRatio : null;
    region.background = effectiveRowBackground;
    if (outerLeftPx) region.spacing.outerSpacingLeftPx = outerLeftPx;
    if (outerRightPx) region.spacing.outerSpacingRightPx = outerRightPx;
    if (gutterPx) region.spacing.gutterPx = gutterPx;
    region.children = contentCells.map((cell) => {
      const cellBackground = readBackground(cell);
      const childRegions = analyzeCellContent(cell, location, null);
      if (childRegions.length === 1) {
        childRegions[0].background = cellBackground;
        return childRegions[0];
      }
      const wrapper = emptyRegion('unknown', location, childRegions.length > 0 ? 0.8 : 0.3);
      wrapper.background = cellBackground;
      wrapper.children = childRegions;
      return wrapper;
    });
    regions.push(region);
  });

  return regions;
}

// Post-processing corrections — reclassify a small number of regions
// whose role depends on document-level context (their position/size
// relative to the WHOLE document), not on anything knowable while that
// one region was being built in isolation.
function applyContextualReclassification(regions: DetectedRegion[]): void {
  const first = regions[0];
  if (
    first && first.role === 'paragraph' && first.links.length === 0 && first.images.length === 0
    && first.content.text.join(' ').length <= PREHEADER_MAX_CHARS
  ) {
    first.role = 'preheader';
    first.confidence = ROLE_CONFIDENCE.preheader;
  }

  regions.forEach((region, index) => {
    if (
      region.role === 'image' && index <= HERO_MAX_REGION_INDEX
      && region.detectedWidthPx !== null && region.parentWidthPx !== null && region.parentWidthPx > 0
      && region.detectedWidthPx / region.parentWidthPx >= HERO_MIN_WIDTH_RATIO
    ) {
      region.role = 'hero';
      region.confidence = ROLE_CONFIDENCE.hero;
    }
  });
}

export function analyzeImportedHtml(document: Document, documentWidthPx: number = DEFAULT_EMAIL_WIDTH): DetectedStructure {
  const body = document.body;
  const regions: DetectedRegion[] = [];

  if (body) {
    const topLevel = resolveTransparent(directChildElements(body));
    let looseIndex = 0;
    for (const el of topLevel) {
      const tag = el.tagName.toLowerCase();
      if (DANGEROUS_TAGS.has(tag)) continue;
      if (tag === 'table') {
        regions.push(...analyzeTable(el, documentWidthPx));
        continue;
      }
      looseIndex += 1;
      const region = analyzeElement(el, `document body ${looseIndex}`, documentWidthPx);
      if (region) regions.push(region);
    }
  }

  applyContextualReclassification(regions);

  return {
    documentWidthPx,
    regions,
    hasMsoConditionalContent: documentHasMsoConditionalContent(document),
  };
}
