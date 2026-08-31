import type { EmailModule } from './edm';
import type { ImportFinding, ImportMappingResult } from './importFindings';
import type { DetectedRegion, DetectedStructure } from './htmlImportAnalysis';
import { isWholeLineBold } from './htmlImportMapper';

// R2 (Import HTML AI Reconstruction) — deterministic Fidelity Report.
//
// A REPORT over three already-existing, already-authoritative artifacts:
// the sanitized `document`, R1's `DetectedStructure` (source facts), and
// the deterministic mapper's `ImportMappingResult` (what was actually
// built + every loss/approximation it already reports as ImportFinding).
// This file never parses, sanitizes, maps, or renders anything itself,
// and never constructs or mutates an EmailModule — it only reads the
// three inputs and classifies. No LLM involved (instruction 8): every
// status below is either (a) a direct relabeling of an ImportFinding the
// deterministic mapper already emitted, (b) a narrowly-scoped,
// explicitly-documented comparison of a SOURCE fact (from
// DetectedStructure) against a KNOWN, fixed gap in what the mapper
// currently represents (e.g. cell padding on a Text module), or (c) a
// direct source-fact-vs-reconstructed-EDM-fact equality check (image
// src/width, link href, background color/image) — never a guess, never
// an invented percentage.
//
// Findings remain the evidence (instruction 2) — this file groups the
// mapper's existing ImportFinding[] by fidelity category and rolls each
// category up to ONE status via a fixed severity order, so an "images"
// category with one preserved image and one unresolved image reports
// the true worst case ('unsupported'), never averaged or hidden.
//
// Hardening pass (post-acceptance): 'preserved' now requires either a
// genuinely vacuous case (nothing of that kind existed in the source —
// see hasRelevantContent) or a POSITIVE match against the reconstructed
// EDM, never mere absence of a finding for categories where the mapper
// has no finding-emission path at all (background color/image had none
// before this pass). 'responsive' can never default to 'preserved' —
// the builder always introduces its own mobile-stacking behavior, which
// is a builder ENHANCEMENT, not evidence that source behavior survived
// (see DEFAULT_STATUS below).

export type FidelityCategoryId =
  | 'structure' | 'content' | 'typography' | 'spacing' | 'images' | 'links' | 'responsive' | 'outlook';

export type FidelityStatus = 'preserved' | 'normalized' | 'approximated' | 'removed' | 'unsupported';

export interface FidelityCategoryResult {
  id: FidelityCategoryId;
  label: string;
  status: FidelityStatus;
  summary: string;
  findings: ImportFinding[];
  // Same "row N" convention as ImportFinding.location / DetectedRegion.
  // sourcePosition — never a fabricated id. Empty when nothing in this
  // category could be tied to a specific source location (e.g. a
  // document-wide "no stylesheet detected" default).
  regionSourcePositions: string[];
}

export interface FidelityReport {
  categories: FidelityCategoryResult[];
}

export const FIDELITY_CATEGORY_ORDER: FidelityCategoryId[] = [
  'structure', 'content', 'typography', 'spacing', 'images', 'links', 'responsive', 'outlook',
];

export const FIDELITY_CATEGORY_LABELS: Record<FidelityCategoryId, string> = {
  structure: 'Structure', content: 'Content', typography: 'Typography', spacing: 'Spacing',
  images: 'Images', links: 'Links', responsive: 'Responsive', outlook: 'Outlook',
};

// Worst-status-wins rollup order (matches the precedent set by
// emailValidation.ts's CategoryResult status rollup — same "the most
// severe fact present decides the category" rule, different vocabulary).
// 'removed' ranks worst: it is the only status that represents content
// GONE by design (security) rather than content the builder might still
// be able to represent better later (approximated/unsupported).
const STATUS_SEVERITY: Record<FidelityStatus, number> = {
  preserved: 0, normalized: 1, approximated: 2, unsupported: 3, removed: 4,
};

// The status a category starts at BEFORE any finding/evidence is
// applied. Every category except 'responsive' starts at 'preserved' —
// genuinely correct only once evidence confirms it (see the layer-2/3
// checks below, and hasRelevantContent's "nothing of this kind existed"
// escape hatch). 'responsive' starts at 'normalized': the builder always
// applies its own mobile-stacking layout regardless of what the source
// did or didn't specify, so there is never a "nothing changed" case to
// call preserved — either the source had no detectable responsive
// instructions (builder default introduced, 'normalized') or it had
// some that could not be represented ('unsupported', via the <style>
// finding below).
const DEFAULT_STATUS: Record<FidelityCategoryId, FidelityStatus> = {
  structure: 'preserved', content: 'preserved', typography: 'preserved', spacing: 'preserved',
  images: 'preserved', links: 'preserved', responsive: 'normalized', outlook: 'preserved',
};

interface CategoryTarget {
  category: FidelityCategoryId;
  status: FidelityStatus;
}

// Maps ONE ImportFinding to the fidelity categor(y/ies) it speaks to and
// the status it implies there — a fixed, deterministic lookup, not a
// guess. Every branch is keyed on the finding's OWN category + a literal
// `source`/`reason` substring the mapper itself always emits verbatim
// (see htmlImportMapper.ts) — never on fuzzy/AI text matching.
function findingCategoryTargets(f: ImportFinding): CategoryTarget[] {
  if (f.category === 'security') {
    // Script/iframe/object/embed/form — always content removed for
    // safety. Security beats visual fidelity (instruction 6): this is
    // reported honestly as 'removed', never softened.
    return [{ category: 'content', status: 'removed' }];
  }

  if (f.category === 'unresolved-resource') {
    // The mapper only ever emits this for <img> (data:/cid:/relative/
    // missing/srcset-only) — always an images-category fact.
    return [{ category: 'images', status: 'unsupported' }];
  }

  if (f.category === 'outlook-regeneration') {
    // Source MSO/VML content was detected but is structurally invisible
    // to the DOM mapper (Comment nodes are never walked) — the builder
    // regenerates its OWN Outlook compatibility (settings.outlookVml)
    // rather than literally preserving whatever the source VML said.
    // Never claimed as 'preserved' — we cannot verify the specific
    // source VML intent was matched, only that AN Outlook-safe
    // equivalent now exists (instruction 7/12). A builder-added VML
    // fallback the SOURCE never had is a builder enhancement, not
    // preservation — never described as such.
    return [{ category: 'outlook', status: 'approximated' }];
  }

  if (f.category === 'structural-conversion') {
    if (f.source.includes('<table> (nested)')) {
      // EDM's one-level column-nesting limit — content is stacked
      // instead of a second column level, but every element still
      // imports; semantic intent (all the content is present, in order)
      // survives even though the visual columns do not.
      return [{ category: 'structure', status: 'normalized' }];
    }
    if (f.reason.includes('Interior spacer cells')) {
      // Differing interior gutter widths collapsed to one uniform value.
      return [{ category: 'spacing', status: 'approximated' }];
    }
    // Remaining structural-conversion case: column ratio snapped to the
    // nearest supported preset (e.g. 38/62 -> 40/60). The finding's own
    // `outcome` text already states BOTH the detected and reconstructed
    // ratio verbatim (see htmlImportMapper.ts's own finding message) —
    // never re-derived or restated here, just carried through as
    // evidence (instruction 5: never imply the preset was the source).
    return [{ category: 'structure', status: 'approximated' }];
  }

  if (f.category === 'unsupported') {
    if (f.source.includes('<tr>')) {
      // Column count/geometry with no supported layout, or irregular
      // colspan geometry — the row was not imported at all.
      return [{ category: 'structure', status: 'unsupported' }];
    }
    if (f.source === '<a href="#...">' || (f.source === '<a>' && f.reason.includes('not a supported/safe destination'))) {
      return [{ category: 'links', status: 'unsupported' }];
    }
    if (f.source === '<style>') {
      // Explicit source responsive/media-query rules existed and could
      // not be represented at all — a genuine loss, not the "nothing
      // detected" default case.
      return [{ category: 'responsive', status: 'unsupported' }];
    }
    // Generic unknown/custom-tag subtree — content the builder has no
    // representation for at all.
    return [{ category: 'content', status: 'unsupported' }];
  }

  if (f.category === 'normalized') {
    if (f.source === '<ul>' || f.source === '<ol>') {
      return [{ category: 'content', status: 'normalized' }];
    }
    if (f.source === '<img srcset>') {
      return [{ category: 'images', status: 'normalized' }];
    }
    if (f.source === '<a>' && f.reason.includes('clickable inline link')) {
      // Destination preserved as visible text, but interactivity (the
      // clickable behavior) changed — the closest-supported
      // representation, not a shape-only normalization.
      return [{ category: 'links', status: 'approximated' }];
    }
    if (f.source === '<nav> links') {
      // Extra links beyond the header module's cap were dropped —
      // genuine content loss for the tail, not just a shape change.
      return [{ category: 'links', status: 'approximated' }];
    }
    if (f.source === '<a> (unsubscribe)') {
      // Unsubscribe LABEL survived but the destination did not — a
      // compliance-sensitive gap, never softened to 'normalized'.
      return [{ category: 'links', status: 'unsupported' }];
    }
    return [{ category: 'content', status: 'normalized' }];
  }

  return [];
}

function flattenRegions(regions: DetectedRegion[]): DetectedRegion[] {
  return regions.flatMap((r) => [r, ...flattenRegions(r.children)]);
}

// --- Evidence layer 2 — source fact vs. a KNOWN, fixed reconstruction --
// gap the mapper itself never turns into an ImportFinding today.

// buildTextModule (htmlImportMapper.ts) never reads cell/element padding
// onto a Text module's own settings — only the Button/Layout paths do.
// A source heading/paragraph with explicit padding therefore always
// loses that spacing today; this is real, checkable evidence, not
// speculation.
function hasUnrepresentedTextPadding(structure: DetectedStructure): boolean {
  // 'preheader' is a contextual reclassification of what was still a
  // <p>/<div>-shaped region going through the exact same buildTextModule
  // path — the padding gap applies equally regardless of which role the
  // region ended up labeled with.
  return flattenRegions(structure.regions).some(
    (r) => (r.role === 'paragraph' || r.role === 'heading' || r.role === 'preheader')
      && (r.spacing.paddingHorizontal !== undefined || r.spacing.paddingVertical !== undefined),
  );
}

// isWholeLineBold (htmlImportMapper.ts) is the exact predicate
// buildTextModule uses to decide fontWeight — it deliberately returns
// false whenever a <strong>/<b> covers only PART of a line, silently
// keeping the module's default (non-bold) weight for that whole line.
// This reuses that SAME predicate, read-only, to detect when that
// documented limitation actually applies to this source document.
function hasPartialBoldGap(document: Document): boolean {
  if (!document.body) return false;
  return Array.from(document.body.querySelectorAll('p, div, span, center, h1, h2, h3, h4, h5, h6')).some((el) => {
    const hasStrong = el.querySelector(':scope > strong, :scope > b') !== null;
    return hasStrong && !isWholeLineBold(el);
  });
}

// --- Evidence layer 3 — direct source-fact-vs-reconstructed-EDM-fact --
// equality checks (instruction 3). Only ever consulted for a category
// that is STILL at its default status after layers 1/2 — i.e. no
// ImportFinding touched it at all. This is deliberately safe: every
// lossy image (buildImageModule's own unresolved-resource path) and
// every lossy/approximated link (describeAnchorLossIfAny fires for
// EVERY non-button anchor with an href, safe or not) already produces
// its own ImportFinding, so by construction the only images/links that
// can still be at default status here are ones a finding never touched
// — CTA/header/footer href props and directly-mapped Image module src/
// width. Uses SET membership (detected fact must appear somewhere among
// the reconstructed facts), never positional DOM-index <-> module-index
// pairing — pairing is fragile (see R2's own disclosed boundary); set
// membership is not, and is still genuine positive evidence: a detected
// fact that never appears ANYWHERE in the reconstructed document is a
// real, checkable absence.

function collectMappedImageFacts(modules: EmailModule[]): { src: string; widthPx: number | null }[] {
  const out: { src: string; widthPx: number | null }[] = [];
  const visit = (mods: EmailModule[]) => {
    for (const m of mods) {
      if (m.type === 'image') {
        const props = m.props as { src: string; width?: { desktop?: { value: number; unit: string } } };
        const widthPx = props.width?.desktop && props.width.desktop.unit === 'px' ? props.width.desktop.value : null;
        out.push({ src: props.src, widthPx });
      } else if (m.type.startsWith('header-')) {
        const props = m.props as { logoSrc?: string; logoWidth?: number };
        if (props.logoSrc) out.push({ src: props.logoSrc, widthPx: props.logoWidth ?? null });
      }
      if (m.columns) for (const column of m.columns) visit(column.modules);
    }
  };
  visit(modules);
  return out;
}

function collectMappedHrefs(modules: EmailModule[]): Set<string> {
  const hrefs = new Set<string>();
  const addIfString = (value: unknown) => { if (typeof value === 'string' && value) hrefs.add(value); };
  const visit = (mods: EmailModule[]) => {
    for (const m of mods) {
      const props = m.props as Record<string, unknown>;
      addIfString(props.href);
      addIfString(props.ctaHref);
      addIfString(props.logoHref);
      addIfString(props.unsubscribeHref);
      addIfString(props.preferenceHref);
      if (Array.isArray(props.navLinks)) for (const link of props.navLinks as { href: string }[]) addIfString(link.href);
      if (Array.isArray(props.socialPlatforms)) for (const link of props.socialPlatforms as { href: string }[]) addIfString(link.href);
      if (m.columns) for (const column of m.columns) visit(column.modules);
    }
  };
  visit(modules);
  return hrefs;
}

function collectMappedBackgrounds(modules: EmailModule[]): { colors: Set<string>; images: Set<string> } {
  const colors = new Set<string>();
  const images = new Set<string>();
  const visit = (mods: EmailModule[]) => {
    for (const m of mods) {
      if (m.settings.backgroundColor) colors.add(m.settings.backgroundColor);
      if (m.settings.backgroundImage) images.add(m.settings.backgroundImage);
      if (m.columns) {
        for (const column of m.columns) {
          if (column.settings.backgroundColor) colors.add(column.settings.backgroundColor);
          if (column.settings.backgroundImage) images.add(column.settings.backgroundImage);
          visit(column.modules);
        }
      }
    }
  };
  visit(modules);
  return { colors, images };
}

function imagesFullyVerified(structure: DetectedStructure, mapping: ImportMappingResult): boolean {
  const detected = flattenRegions(structure.regions).flatMap((r) => r.images).filter((image) => image.safe);
  if (detected.length === 0) return true;
  const mapped = collectMappedImageFacts(mapping.modules);
  return detected.every((d) => mapped.some((m) => m.src === d.src && (d.widthPx === null || m.widthPx === d.widthPx)));
}

function linksFullyVerified(structure: DetectedStructure, mapping: ImportMappingResult): boolean {
  const detected = flattenRegions(structure.regions).flatMap((r) => r.links).filter((link) => link.safe);
  if (detected.length === 0) return true;
  const mappedHrefs = collectMappedHrefs(mapping.modules);
  return detected.every((d) => mappedHrefs.has(d.href));
}

function backgroundsFullyVerified(structure: DetectedStructure, mapping: ImportMappingResult): boolean {
  const regions = flattenRegions(structure.regions);
  const detectedColors = new Set(regions.map((r) => r.background.color).filter((c): c is string => Boolean(c)));
  const detectedImages = new Set(regions.map((r) => r.background.image).filter((v): v is string => Boolean(v)));
  if (detectedColors.size === 0 && detectedImages.size === 0) return true;
  const mapped = collectMappedBackgrounds(mapping.modules);
  return Array.from(detectedColors).every((c) => mapped.colors.has(c))
    && Array.from(detectedImages).every((i) => mapped.images.has(i));
}

function hasRelevantContent(id: FidelityCategoryId, structure: DetectedStructure): boolean {
  const all = flattenRegions(structure.regions);
  if (id === 'images') return all.some((r) => r.images.length > 0);
  if (id === 'links') return all.some((r) => r.links.length > 0);
  if (id === 'typography') return all.some((r) => Object.keys(r.typography).length > 0);
  if (id === 'spacing') return all.some((r) => Object.keys(r.spacing).length > 0);
  if (id === 'outlook') return structure.hasMsoConditionalContent;
  return true; // structure/content/responsive are always relevant — every document has rows and content
}

// The "at default status, no findings" summary — describes what the
// default status genuinely MEANS for that category (preserved for most,
// normalized for responsive, per DEFAULT_STATUS above). Never claims
// something was verified that wasn't; for images/links/content this
// wording is only reached once evidence layer 3 has confirmed a real
// source-vs-reconstructed match (or there was nothing to check).
const DEFAULT_SUMMARY: Record<FidelityCategoryId, string> = {
  structure: 'Document structure (rows, columns, sections) mapped with no reported loss.',
  content: 'All detected content mapped to supported builder modules with no reported loss.',
  typography: 'Detected font size/weight/color/alignment mapped without approximation.',
  spacing: 'Detected padding/gutter/outer-spacing values mapped without approximation.',
  images: 'All detected images resolved to a safe, supported source URL, confirmed present in the reconstructed modules.',
  links: 'All detected safe links carried a supported destination, confirmed present in the reconstructed modules.',
  responsive: 'No explicit source responsive behavior was detected. Builder-standard mobile behavior will be applied.',
  outlook: 'No Outlook/MSO-specific source behavior was detected; no Outlook-specific source behavior was lost during reconstruction.',
};

const NO_CONTENT_SUMMARY: Partial<Record<FidelityCategoryId, string>> = {
  typography: 'No typography facts (font size/weight/color/alignment) detected in the source.',
  spacing: 'No padding/gutter/outer-spacing facts detected in the source.',
  images: 'No images detected in the source.',
  links: 'No links detected in the source.',
};

// Set only when evidence layer 3's positive comparison genuinely fails —
// a detected safe image/link/background fact never appeared anywhere in
// the reconstructed modules despite no ImportFinding explaining why.
// This should not occur in practice (R1 and the mapper read the same
// source elements through the same exported helpers, see the layer-3
// docstring above), but the check is real, not decorative — see
// htmlImportFidelity.test.ts's synthetic-mismatch coverage.
const VERIFICATION_FAILED_SUMMARY: Partial<Record<FidelityCategoryId, string>> = {
  images: 'A detected image could not be confirmed present in the reconstructed modules.',
  links: 'A detected link destination could not be confirmed present in the reconstructed modules.',
  content: 'A detected background color/image could not be confirmed present in the reconstructed modules.',
};

function buildSummary(
  id: FidelityCategoryId, status: FidelityStatus, findings: ImportFinding[], hasContent: boolean, verificationFailed: boolean,
): string {
  if (verificationFailed && VERIFICATION_FAILED_SUMMARY[id]) return VERIFICATION_FAILED_SUMMARY[id]!;
  if (findings.length > 0) {
    const plural = findings.length === 1 ? 'finding' : 'findings';
    return `${status[0].toUpperCase()}${status.slice(1)}: ${findings.length} relevant ${plural}.`;
  }
  if (!hasContent && NO_CONTENT_SUMMARY[id]) return NO_CONTENT_SUMMARY[id]!;
  return DEFAULT_SUMMARY[id];
}

interface CategoryAccumulator {
  status: FidelityStatus;
  findings: ImportFinding[];
  positions: Set<string>;
  verificationFailed: boolean;
}

export function buildFidelityReport(
  document: Document, structure: DetectedStructure, mapping: ImportMappingResult,
): FidelityReport {
  const accumulators = new Map<FidelityCategoryId, CategoryAccumulator>();
  const accumulator = (id: FidelityCategoryId): CategoryAccumulator => {
    let entry = accumulators.get(id);
    if (!entry) {
      entry = { status: DEFAULT_STATUS[id], findings: [], positions: new Set(), verificationFailed: false };
      accumulators.set(id, entry);
    }
    return entry;
  };
  for (const id of FIDELITY_CATEGORY_ORDER) accumulator(id);

  // Evidence layer 1 — the mapper's own ImportFinding[], regrouped.
  for (const finding of mapping.findings) {
    for (const target of findingCategoryTargets(finding)) {
      const entry = accumulator(target.category);
      entry.findings.push(finding);
      entry.positions.add(finding.location);
      if (STATUS_SEVERITY[target.status] > STATUS_SEVERITY[entry.status]) entry.status = target.status;
    }
  }

  // Evidence layer 2 — source facts vs. a known, fixed reconstruction
  // gap, for the two documented cases the mapper itself never turns
  // into an ImportFinding (see the two functions' own docstrings).
  if (hasUnrepresentedTextPadding(structure)) {
    const entry = accumulator('spacing');
    if (STATUS_SEVERITY.unsupported > STATUS_SEVERITY[entry.status]) entry.status = 'unsupported';
  }
  if (hasPartialBoldGap(document)) {
    const entry = accumulator('typography');
    if (STATUS_SEVERITY.approximated > STATUS_SEVERITY[entry.status]) entry.status = 'approximated';
  }

  // Evidence layer 3 — only runs while the category is still exactly at
  // its DEFAULT status (no finding, and for spacing/typography no
  // layer-2 gap either) — see this section's own docstring above for
  // why that scoping is safe rather than fragile.
  {
    const images = accumulator('images');
    if (images.status === DEFAULT_STATUS.images && !imagesFullyVerified(structure, mapping)) {
      images.status = 'unsupported';
      images.verificationFailed = true;
    }
  }
  {
    const links = accumulator('links');
    if (links.status === DEFAULT_STATUS.links && !linksFullyVerified(structure, mapping)) {
      links.status = 'unsupported';
      links.verificationFailed = true;
    }
  }
  {
    const content = accumulator('content');
    if (content.status === DEFAULT_STATUS.content && !backgroundsFullyVerified(structure, mapping)) {
      content.status = 'unsupported';
      content.verificationFailed = true;
    }
  }

  const categories = FIDELITY_CATEGORY_ORDER.map((id): FidelityCategoryResult => {
    const entry = accumulator(id);
    const hasContent = hasRelevantContent(id, structure);
    return {
      id,
      label: FIDELITY_CATEGORY_LABELS[id],
      status: entry.status,
      summary: buildSummary(id, entry.status, entry.findings, hasContent, entry.verificationFailed),
      findings: entry.findings,
      regionSourcePositions: Array.from(entry.positions),
    };
  });

  return { categories };
}
