import type { EmailColumn, EmailModule, EmailModuleType, HorizontalAlign } from './edm';
import { getAllModuleDefinitions } from './moduleRegistry';
import { createModule, generateModuleId } from './moduleFactory';
import { createColumnSettings } from './layoutModel';
import { isValidFontId, EMAIL_SAFE_FONTS } from './fonts';
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

function readColor(declarations: Map<string, string>, property: string): string | null {
  const value = declarations.get(property);
  if (!value) return null;
  const trimmed = value.trim();
  return HEX_COLOR.test(trimmed) ? trimmed.toLowerCase() : null;
}

function readPx(declarations: Map<string, string>, property: string): number | null {
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

function readAlign(declarations: Map<string, string>, attrAlign: string | null): HorizontalAlign | undefined {
  const raw = (declarations.get('text-align') ?? attrAlign ?? '').trim().toLowerCase();
  if (raw === 'left' || raw === 'center' || raw === 'right') return raw;
  return undefined;
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

// --- Button predicate (explicit, deterministic, approved) ---------------
// An <a> whose OWN inline style sets both a background-color AND
// non-zero padding on all sides. Never inferred from position, text
// content, or ancestor styling — an unstyled link is never guessed into
// a button.
function looksLikeButtonAnchor(anchor: Element): boolean {
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

function pickLayoutType(cells: Element[]): { type: EmailModuleType; widths: number[]; exact: boolean } | null {
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
  return { type: best.type, widths: best.widths, exact };
}

// --- Leaf classification -------------------------------------------------

function textFromInlineContent(el: Element): string {
  // Inline formatting (strong/b/em/i/u) and <br> contribute their text
  // content only — the `text` module prop has no rich-run/href
  // sub-structure to preserve emphasis or inline links distinctly; this
  // is a known, accepted typed-property limitation, not a dropped
  // structure, so it is not individually reported per occurrence.
  const clone = el.cloneNode(true) as Element;
  clone.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
  return (clone.textContent ?? '').replace(/\s+\n/g, '\n').replace(/\n\s+/g, '\n').trim();
}

function buildTextModule(text: string, declarations: Map<string, string>, attrAlign: string | null, order: number): EmailModule {
  const module = createModule('text', order);
  const props = module.props as { text: string; align: HorizontalAlign; fontFamily?: string; fontSize: number; fontWeight: 400 | 700; color: string; lineHeight: number };
  props.text = text;
  const align = readAlign(declarations, attrAlign);
  if (align) props.align = align;
  const color = readColor(declarations, 'color');
  if (color) props.color = color;
  const fontSize = readPx(declarations, 'font-size');
  if (fontSize) props.fontSize = fontSize;
  const fontFamily = readFontFamily(declarations);
  if (fontFamily) props.fontFamily = fontFamily;
  return module;
}

function buildImageModule(img: Element, order: number, findings: ImportFinding[], location: string): EmailModule | null {
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
  const props = module.props as { src: string; alt: string; href: string };
  props.src = src.trim();
  props.alt = readAllowedAttribute(img, 'alt') ?? '';
  return module;
}

function buildButtonModule(anchor: Element, order: number): EmailModule | null {
  const href = readAllowedAttribute(anchor, 'href') ?? '';
  if (!isSafeAnchorUrl(href)) return null;
  const declarations = extractStyleDeclarations(readAllowedAttribute(anchor, 'style') ?? '');
  const module = createModule('button', order);
  const props = module.props as { text: string; href: string; backgroundColor: string; textColor: string; fontSize: number; borderRadius: number };
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
  return module;
}

function buildDividerModule(order: number): EmailModule {
  return createModule('divider', order);
}

// --- Anchor (non-button) handling ---------------------------------------
// A plain (non-button) <a> degrades to its visible text — the `text`
// module has no href sub-structure to preserve the link itself. This is
// always reported (not silent): the reader keeps the words, loses the
// link.
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
  findings.push(finding(
    'unsupported', '<a>', location,
    'Inline/standalone hyperlinks are not preserved by the destination Text module.',
    'The link text was kept; the hyperlink itself was not preserved.',
    'Re-add this link manually after import if needed, or use a button-styled link (background color + padding) which imports as a Button.',
  ));
}

// --- Tree walking ---------------------------------------------------------

function directChildElements(el: Element): Element[] {
  return Array.from(el.children);
}

// Resolves through the CLOSED transparent-container allowlist only —
// never unknown/custom tags. Returns the list of elements to actually
// consider at this level (unwrapping recursively as needed).
function resolveTransparent(elements: Element[]): Element[] {
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

interface WalkContext {
  findings: ImportFinding[];
  orderCounter: { value: number };
}

function nextOrder(ctx: WalkContext): number {
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

  function flushText() {
    if (textBuffer.length === 0) return;
    const first = textBuffer[0];
    const combined = textBuffer.map((el) => textFromInlineContent(el)).filter(isNonEmptyText).join('\n');
    textBuffer.length = 0;
    if (!isNonEmptyText(combined)) return;
    const declarations = extractStyleDeclarations(readAllowedAttribute(first, 'style') ?? '');
    modules.push(buildTextModule(combined, declarations, readAllowedAttribute(first, 'align'), nextOrder(ctx)));
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
      const built = buildImageModule(el, nextOrder(ctx), ctx.findings, location);
      if (built) modules.push(built);
      continue;
    }

    if (tag === 'a') {
      if (looksLikeButtonAnchor(el)) {
        flushText();
        const built = buildButtonModule(el, nextOrder(ctx));
        if (built) {
          modules.push(built);
          continue;
        }
      }
      describeAnchorLossIfAny(el, location, ctx.findings);
      textBuffer.push(el);
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
        modules.push(buildTextModule(items.join('\n'), new Map(), null, nextOrder(ctx)));
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
      // buffered as one unit so adjacent text blocks combine into a
      // single Text module.
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
      const hasDangerousDescendant = [...DANGEROUS_TAGS].some((tag) => el.querySelector(tag) !== null);
      if (hasOwnModuleChild || hasDangerousDescendant) {
        flushText();
        modules.push(...mapContentSequence(el, location, ctx));
      } else if (isNonEmptyText(el.textContent ?? '')) {
        textBuffer.push(el);
      }
      continue;
    }

    if (CONTENT_TAGS.has(tag)) {
      // Recognized-but-otherwise-unhandled content tag (e.g. a bare
      // strong/em appearing directly as a block-level child rather than
      // inline within a paragraph) — treat its text as content.
      if (isNonEmptyText(el.textContent ?? '')) textBuffer.push(el);
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
  return buildButtonModule(anchor, nextOrder(ctx));
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

// --- Row/column (layout) mapping -----------------------------------------

function mapTableAsRows(table: Element, ctx: WalkContext): EmailModule[] {
  const sections = resolveTransparent(directChildElements(table));
  const rows = sections.flatMap((el) => {
    const tag = el.tagName.toLowerCase();
    return tag === 'tbody' || tag === 'thead' || tag === 'tfoot' ? resolveTransparent(directChildElements(el)) : [el];
  }).filter((el) => el.tagName.toLowerCase() === 'tr');

  const modules: EmailModule[] = [];
  rows.forEach((row, rowIndex) => {
    const location = `row ${rowIndex + 1}`;
    const cells = directChildElements(row).filter((c) => c.tagName.toLowerCase() === 'td' || c.tagName.toLowerCase() === 'th');
    if (cells.length === 0) return;

    // A single-cell row is just one column's worth of content — no
    // layout wrapper needed, map its content directly at this level.
    if (cells.length === 1) {
      modules.push(...mapContentSequence(cells[0], location, ctx));
      return;
    }

    const picked = pickLayoutType(cells);
    if (!picked) {
      ctx.findings.push(finding(
        'unsupported', `<tr> (${cells.length} columns)`, location,
        'This row’s column count or geometry does not correspond to any supported layout.',
        'This row was not imported.',
        'Rebuild this row manually using an existing Layout module after import.',
      ));
      return;
    }
    if (!picked.exact) {
      ctx.findings.push(finding(
        'structural-conversion', `<tr> (${cells.length} columns)`, location,
        'Source column widths do not exactly match any supported layout split.',
        `Converted with normalization to the nearest supported layout (${picked.widths.join('/')}).`,
        'Adjust column widths manually after import if exact proportions matter.',
      ));
    }

    const columns: EmailColumn[] = cells.map((cell) => ({
      id: generateModuleId(),
      settings: createColumnSettings(),
      modules: mapContentSequence(cell, location, ctx),
    }));

    const layoutModule = createModule(picked.type, nextOrder(ctx));
    layoutModule.columns = columns;
    modules.push(layoutModule);
  });

  return modules;
}

// --- Entry point -----------------------------------------------------------

export function mapImportedHtml(document: Document): ImportMappingResult {
  const findings: ImportFinding[] = [];
  const ctx: WalkContext = { findings, orderCounter: { value: 0 } };
  const emailTitle = extractImportedTitle(document);

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
