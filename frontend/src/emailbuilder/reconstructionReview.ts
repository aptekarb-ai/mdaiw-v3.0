import type { ButtonModuleProps, EmailModule, ImageModuleProps } from './edm';
import type { DetectedRegion, DetectedStructure } from './htmlImportAnalysis';
import type { FidelityCategoryId, FidelityCategoryResult, FidelityReport, FidelityStatus } from './htmlImportFidelity';
import type { ImportFinding } from './importFindings';
import { extractStyleDeclarations, readAllowedAttribute } from './htmlImportSanitize';

// R4-B (Import HTML AI Reconstruction) — deterministic classification of
// every non-preserved FidelityReport category into exactly one of the
// four difference classes the AI Engineer narrates (instruction 3):
// Normalized / Approximation / Repairable / Removed-Unsupported.
// "Preserved" contributes no difference at all — this file never
// invents a difference for a category R2 already confirmed faithful.
//
// Classification is 100% deterministic (no AI call, no LLM judgement) —
// see this file's own docstring on why: R2's FidelityReport findings
// already carry a precise, evidence-based category+status; this file
// only refines a small number of those into the finer Repairable-vs-
// Approximation distinction R2's 5-value FidelityStatus vocabulary does
// not itself make (R2 groups both under 'approximated'/'unsupported').
// Every rule here cites the EXACT mapper/module capability it is
// checking against — never a guess about what might be fixable.
// "Deterministic facts have priority over AI judgement" (instruction 4)
// holds by construction: the AI Engineer (R4-B's UI layer) is only ever
// given this ALREADY-DECIDED classification to explain, never asked to
// decide it itself.

export type ReconstructionDifferenceClass = 'normalized' | 'approximation' | 'repairable' | 'removed-unsupported';

export interface ReconstructionDifference {
  categoryId: FidelityCategoryId;
  class: ReconstructionDifferenceClass;
  // Stable identity for a KIND of difference (never per-instance) — the
  // exact shape R4-E's LearningSignal integration will key on (e.g.
  // "import-reconstruction:button:alignment"). Never emitted as a
  // learning signal by this file itself (R4-B is review-only).
  signature: string;
  summary: string;
  detail: string;
  sourcePosition?: string;
}

export interface ReconstructionCategoryReview {
  id: FidelityCategoryId;
  label: string;
  // Unchanged from FidelityReport — "Fidelity category rows should
  // remain the factual source of truth" (instruction 9). This file adds
  // a finer-grained `differences` list alongside it; it never overrides
  // or recomputes this status.
  fidelityStatus: FidelityStatus;
  differences: ReconstructionDifference[];
  // The single WORST class among `differences`, or 'preserved' when
  // there are none — display/narration-only (instruction 5's compact
  // "Typography — 1 Repairable difference" line), never a second source
  // of truth for the category's actual fidelity status.
  worstDifferenceClass: ReconstructionDifferenceClass | 'preserved';
}

export interface ReconstructionReview {
  categories: ReconstructionCategoryReview[];
  // Every category's differences, flattened, in category order.
  differences: ReconstructionDifference[];
  counts: Record<ReconstructionDifferenceClass, number>;
  hasRepairableDifferences: boolean;
}

const CLASS_SEVERITY: Record<ReconstructionDifferenceClass, number> = {
  normalized: 1, approximation: 2, repairable: 3, 'removed-unsupported': 4,
};

export const DIFFERENCE_CLASS_LABEL: Record<ReconstructionDifferenceClass, string> = {
  normalized: 'Normalized', approximation: 'Approximation', repairable: 'Repairable',
  'removed-unsupported': 'Removed/Unsupported',
};

function flattenRegions(regions: DetectedRegion[]): DetectedRegion[] {
  return regions.flatMap((r) => [r, ...flattenRegions(r.children)]);
}

function flattenModules(modules: EmailModule[]): EmailModule[] {
  return modules.flatMap((m) => [m, ...(m.columns ? m.columns.flatMap((c) => flattenModules(c.modules)) : [])]);
}

// --- Finding -> difference class/signature -------------------------------
// Sub-classifies ONE ImportFinding the mapper already emitted. This is a
// DIFFERENT question than R2's htmlImportFidelity.ts::findingCategoryTargets
// asks (that function decides WHICH of the 8 categories + which
// FidelityStatus a finding contributes to; this one decides WHICH of the
// 4 R4-B classes + a stable signature) — reading the SAME finding
// objects for a different purpose is not duplicated logic, it answers a
// genuinely different question. Every branch states EXACTLY why a case
// is architectural (Approximation) vs a real capability gap
// (Repairable) — see each comment.
function classifyFinding(finding: ImportFinding): { differenceClass: ReconstructionDifferenceClass; signature: string } {
  if (finding.category === 'security') {
    return { differenceClass: 'removed-unsupported', signature: 'import-reconstruction:content:security-removed' };
  }
  if (finding.category === 'unresolved-resource') {
    // No safe URL exists to represent this image with — nothing to
    // repair without inventing a URL (instruction 11: never invent).
    return { differenceClass: 'removed-unsupported', signature: 'import-reconstruction:images:unresolved' };
  }
  if (finding.category === 'outlook-regeneration') {
    // MSO conditional comments are structurally invisible to the DOM
    // mapper (Comment nodes are never walked) — the specific source VML
    // intent can never be recovered, only regenerated generically.
    return { differenceClass: 'approximation', signature: 'import-reconstruction:outlook:mso-regeneration' };
  }
  if (finding.category === 'structural-conversion') {
    if (finding.reason.includes('Interior spacer cells')) {
      // The layout system supports exactly ONE uniform gutter value —
      // genuinely cannot represent differing per-gap widths.
      return { differenceClass: 'approximation', signature: 'import-reconstruction:spacing:gutter' };
    }
    if (finding.source.includes('<table> (nested)')) {
      return { differenceClass: 'normalized', signature: 'import-reconstruction:structure:nested-table' };
    }
    // Column ratio snapped to the nearest of 10 fixed presets — a real,
    // documented architectural ceiling (no continuous-ratio layout type
    // exists), never a mapper oversight.
    return { differenceClass: 'approximation', signature: 'import-reconstruction:structure:column-ratio' };
  }
  if (finding.category === 'unsupported') {
    if (finding.source.includes('<tr>')) {
      return { differenceClass: 'removed-unsupported', signature: 'import-reconstruction:structure:unsupported-geometry' };
    }
    if (finding.source === '<a href="#...">' || (finding.source === '<a>' && finding.reason.includes('not a supported/safe destination'))) {
      // No safe destination exists — never invent one.
      return { differenceClass: 'removed-unsupported', signature: 'import-reconstruction:links:unsafe-href' };
    }
    if (finding.source === '<style>') {
      return { differenceClass: 'removed-unsupported', signature: 'import-reconstruction:responsive:stylesheet-dropped' };
    }
    return { differenceClass: 'removed-unsupported', signature: 'import-reconstruction:content:unsupported-tag' };
  }
  if (finding.category === 'normalized') {
    if (finding.source === '<ul>' || finding.source === '<ol>') {
      return { differenceClass: 'normalized', signature: 'import-reconstruction:content:list-normalized' };
    }
    if (finding.source === '<img srcset>') {
      return { differenceClass: 'normalized', signature: 'import-reconstruction:images:srcset-dropped' };
    }
    if (finding.source === '<a>' && finding.reason.includes('clickable inline link')) {
      // The Text module has no clickable-link sub-structure at all —
      // genuinely nothing to repair short of a schema change (out of
      // R4-B/C scope entirely).
      return { differenceClass: 'approximation', signature: 'import-reconstruction:links:clickable-text' };
    }
    if (finding.source === '<nav> links') {
      // The header module's navLinks cap (MAX_NAV_LINKS = 6, headerCatalog.tsx)
      // is a hard, deliberate limit — not a populate-the-existing-field gap.
      return { differenceClass: 'approximation', signature: 'import-reconstruction:links:nav-cap' };
    }
    if (finding.source === '<a> (unsubscribe)') {
      return { differenceClass: 'removed-unsupported', signature: 'import-reconstruction:links:unsubscribe-missing-href' };
    }
    return { differenceClass: 'normalized', signature: 'import-reconstruction:content:normalized' };
  }
  return { differenceClass: 'removed-unsupported', signature: 'import-reconstruction:unknown' };
}

function differenceFromFinding(categoryId: FidelityCategoryId, finding: ImportFinding): ReconstructionDifference {
  const { differenceClass, signature } = classifyFinding(finding);
  return {
    categoryId, class: differenceClass, signature,
    summary: finding.reason,
    detail: [finding.reason, finding.outcome].filter(Boolean).join(' '),
    sourcePosition: finding.location,
  };
}

// A non-preserved category with ZERO findings — R2's own "evidence
// layer 2" categories (spacing/typography default-status checks) and
// the responsive default never produce an ImportFinding at all. Each
// case here cites the EXACT R2 check it corresponds to.
function differenceForFindingLessCategory(category: FidelityCategoryResult): ReconstructionDifference {
  if (category.id === 'spacing' && category.status === 'unsupported') {
    // htmlImportFidelity.ts::hasUnrepresentedTextPadding — the Text
    // module already has settings.paddingTop/Right/Bottom/Left (EVERY
    // module type does, resolved via resolveSpacing + rendered via
    // paddingStyle in every renderEmailHtml) — buildTextModule
    // (htmlImportMapper.ts) simply never reads source cell/element
    // padding into it. The capability exists; this is repairable.
    return {
      categoryId: 'spacing', class: 'repairable', signature: 'import-reconstruction:text:padding',
      summary: category.summary, detail: category.summary,
    };
  }
  if (category.id === 'typography' && category.status === 'approximated') {
    // htmlImportFidelity.ts::hasPartialBoldGap — a Text module's
    // fontWeight is one value for the WHOLE module; there is no way to
    // make PART of a line bold. Genuinely architectural.
    return {
      categoryId: 'typography', class: 'approximation', signature: 'import-reconstruction:typography:partial-bold',
      summary: category.summary, detail: category.summary,
    };
  }
  if (category.id === 'responsive' && category.status === 'normalized') {
    // The builder always applies its own mobile-stacking layout —
    // intentional, standard, keeps the same responsive INTENT even
    // though no source media queries existed to compare against.
    return {
      categoryId: 'responsive', class: 'normalized', signature: 'import-reconstruction:responsive:default-mobile-behavior',
      summary: category.summary, detail: category.summary,
    };
  }
  // Defensive fallback for any future no-finding non-preserved case —
  // maps the R2 status to the nearest R4-B class rather than silently
  // dropping the difference.
  const differenceClass: ReconstructionDifferenceClass = category.status === 'normalized' ? 'normalized'
    : category.status === 'approximated' ? 'approximation' : 'removed-unsupported';
  return {
    categoryId: category.id, class: differenceClass, signature: `import-reconstruction:${category.id}:general`,
    summary: category.summary, detail: category.summary,
  };
}

// --- Independent repairability comparisons --------------------------------
// Every check below compares a SOURCE fact (DetectedStructure, or the
// raw sanitized `document` for the one case R1 doesn't itself capture —
// see detectFontWeightRepairable) against the CORRESPONDING
// reconstructed EmailModule fact, for a prop the builder already
// supports. Pairing is ORDERED, same-role, and ONLY attempted when the
// counts match exactly — never a fragile arbitrary index guess across
// mismatched counts (matches the R2-established "no fragile DOM-index
// <-> module-index matching" boundary: an ambiguous pairing is skipped
// entirely rather than guessed).

function detectButtonRepairable(structure: DetectedStructure, modules: EmailModule[]): ReconstructionDifference[] {
  const ctaRegions = flattenRegions(structure.regions).filter((r) => r.role === 'cta');
  const buttonModules = flattenModules(modules).filter((m) => m.type === 'button');
  if (ctaRegions.length === 0 || ctaRegions.length !== buttonModules.length) return [];

  const differences: ReconstructionDifference[] = [];
  ctaRegions.forEach((region, index) => {
    const props = buttonModules[index].props as unknown as ButtonModuleProps;
    if (region.typography.align && region.typography.align !== props.align) {
      differences.push({
        categoryId: 'spacing', class: 'repairable', signature: 'import-reconstruction:button:alignment',
        summary: `Button alignment: source "${region.typography.align}", reconstructed "${props.align}".`,
        detail: `The source button at ${region.sourcePosition} was aligned "${region.typography.align}", but the reconstructed Button module is aligned "${props.align}". The Button module already supports alignment (props.align) — this can be corrected.`,
        sourcePosition: region.sourcePosition,
      });
    }
    const sourceH = region.spacing.paddingHorizontal;
    const sourceV = region.spacing.paddingVertical;
    const paddingMismatch = (sourceH !== undefined && sourceH !== props.paddingHorizontal)
      || (sourceV !== undefined && sourceV !== props.paddingVertical);
    if (paddingMismatch) {
      differences.push({
        categoryId: 'spacing', class: 'repairable', signature: 'import-reconstruction:button:padding',
        summary: `Button padding: source ${sourceH ?? '—'}px/${sourceV ?? '—'}px (H/V), reconstructed ${props.paddingHorizontal}px/${props.paddingVertical}px.`,
        detail: `The source button at ${region.sourcePosition} had ${sourceH ?? 'unset'}px horizontal / ${sourceV ?? 'unset'}px vertical padding, but the reconstructed Button module has ${props.paddingHorizontal}px/${props.paddingVertical}px. The Button module already supports padding (props.paddingHorizontal/paddingVertical) — this can be corrected.`,
        sourcePosition: region.sourcePosition,
      });
    }
  });
  return differences;
}

function detectImageWidthRepairable(structure: DetectedStructure, modules: EmailModule[]): ReconstructionDifference[] {
  const imageRegions = flattenRegions(structure.regions).filter((r) => r.role === 'image' || r.role === 'hero');
  const imageModules = flattenModules(modules).filter((m) => m.type === 'image');
  if (imageRegions.length === 0 || imageRegions.length !== imageModules.length) return [];

  const differences: ReconstructionDifference[] = [];
  imageRegions.forEach((region, index) => {
    const props = imageModules[index].props as unknown as ImageModuleProps;
    if (region.detectedWidthPx === null) return;
    const reconstructedWidthPx = props.width?.desktop?.unit === 'px' ? props.width.desktop.value : null;
    if (reconstructedWidthPx !== region.detectedWidthPx) {
      differences.push({
        categoryId: 'images', class: 'repairable', signature: 'import-reconstruction:image:width',
        summary: `Image width: source ${region.detectedWidthPx}px, reconstructed ${reconstructedWidthPx ?? 'fluid'}.`,
        detail: `The source image at ${region.sourcePosition} was ${region.detectedWidthPx}px wide, but the reconstructed Image module resolves to ${reconstructedWidthPx ?? 'a fluid (100%) width'}. The Image module already supports a fixed pixel width — this can be corrected.`,
        sourcePosition: region.sourcePosition,
      });
    }
  });
  return differences;
}

function detectBackgroundRepairable(structure: DetectedStructure, modules: EmailModule[]): ReconstructionDifference[] {
  const columnsRegions = flattenRegions(structure.regions).filter((r) => r.role === 'columns');
  const layoutModules = flattenModules(modules).filter((m) => m.type.startsWith('layout-'));
  if (columnsRegions.length === 0 || columnsRegions.length !== layoutModules.length) return [];

  const differences: ReconstructionDifference[] = [];
  columnsRegions.forEach((region, index) => {
    const layoutModule = layoutModules[index];
    if (!layoutModule.columns || region.children.length !== layoutModule.columns.length) return;
    region.children.forEach((child, columnIndex) => {
      const column = layoutModule.columns![columnIndex];
      if (child.background.color && child.background.color !== column.settings.backgroundColor) {
        differences.push({
          categoryId: 'content', class: 'repairable', signature: 'import-reconstruction:background:color',
          summary: `Column background: source ${child.background.color}, reconstructed ${column.settings.backgroundColor || 'none'}.`,
          detail: `Column ${columnIndex + 1} at ${region.sourcePosition} had background ${child.background.color} in the source, but the reconstructed column's background is ${column.settings.backgroundColor || 'unset'}. Per-column background is already supported — this can be corrected.`,
          sourcePosition: region.sourcePosition,
        });
      }
    });
  });
  return differences;
}

// A real, currently-existing gap neither R1's DetectedStructure nor the
// mapper's buildTextModule captures: CSS `font-weight` declared directly
// on a text element (never via <strong>/<b>) is read by NEITHER
// isWholeLineBold (only checks for strong/b tags) NOR buildTextModule's
// own typography extraction. TextModuleProps.fontWeight (400|700) is a
// real, already-rendered prop — the capability exists, it is simply
// never populated from this specific source signal. Reads the raw
// sanitized `document` directly (not R1's region, which has the SAME
// blind spot) — this is the one repairability check that cannot be
// expressed as "R1 detected X, module has Y" since R1 never detected it
// either. Reported as ONE aggregate difference (not per-element) since
// safely pairing each occurrence to a specific Text module has the same
// fragility every other pairing check here deliberately avoids.
function detectFontWeightRepairable(document: Document): ReconstructionDifference[] {
  if (!document.body) return [];
  const candidates = Array.from(document.body.querySelectorAll('p, div, span, center, h1, h2, h3, h4, h5, h6'));
  const boldViaCssOnly = candidates.filter((el) => {
    if (el.querySelector(':scope > strong, :scope > b') !== null) return false;
    const style = readAllowedAttribute(el, 'style');
    if (!style) return false;
    const declarations = extractStyleDeclarations(style);
    const fontWeight = declarations.get('font-weight');
    if (!fontWeight) return false;
    const numeric = Number(fontWeight);
    return fontWeight.trim().toLowerCase() === 'bold' || (Number.isFinite(numeric) && numeric >= 700);
  });
  if (boldViaCssOnly.length === 0) return [];
  return [{
    categoryId: 'typography', class: 'repairable', signature: 'import-reconstruction:text:font-weight',
    summary: `${boldViaCssOnly.length} text element${boldViaCssOnly.length === 1 ? '' : 's'} declared bold via CSS font-weight, not yet reflected in the reconstruction.`,
    detail: `The source declares font-weight:bold (or a numeric weight ≥700) directly in CSS on ${boldViaCssOnly.length} text element${boldViaCssOnly.length === 1 ? '' : 's'} without a <strong>/<b> tag. The Text module already supports fontWeight — this can be corrected.`,
  }];
}

function worstClass(differences: ReconstructionDifference[]): ReconstructionDifferenceClass | 'preserved' {
  if (differences.length === 0) return 'preserved';
  return differences.reduce<ReconstructionDifferenceClass>(
    (worst, d) => (CLASS_SEVERITY[d.class] > CLASS_SEVERITY[worst] ? d.class : worst),
    differences[0].class,
  );
}

export function buildReconstructionReview(
  document: Document, structure: DetectedStructure, fidelity: FidelityReport, modules: EmailModule[],
): ReconstructionReview {
  const categories: ReconstructionCategoryReview[] = fidelity.categories.map((category) => {
    const differences: ReconstructionDifference[] = category.status === 'preserved'
      ? []
      : category.findings.length > 0
        ? category.findings.map((finding) => differenceFromFinding(category.id, finding))
        : [differenceForFindingLessCategory(category)];
    return {
      id: category.id, label: category.label, fidelityStatus: category.status,
      differences, worstDifferenceClass: worstClass(differences),
    };
  });

  const byId = new Map(categories.map((c) => [c.id, c]));
  const addIndependent = (differences: ReconstructionDifference[]) => {
    for (const difference of differences) {
      const category = byId.get(difference.categoryId);
      if (!category) continue;
      category.differences.push(difference);
      category.worstDifferenceClass = worstClass(category.differences);
    }
  };
  addIndependent(detectButtonRepairable(structure, modules));
  addIndependent(detectImageWidthRepairable(structure, modules));
  addIndependent(detectBackgroundRepairable(structure, modules));
  addIndependent(detectFontWeightRepairable(document));

  const flattened = categories.flatMap((c) => c.differences);
  const counts: Record<ReconstructionDifferenceClass, number> = {
    normalized: 0, approximation: 0, repairable: 0, 'removed-unsupported': 0,
  };
  for (const difference of flattened) counts[difference.class] += 1;

  return { categories, differences: flattened, counts, hasRepairableDifferences: counts.repairable > 0 };
}

// --- Natural-language, professional-tone summary --------------------------
// Deterministic, template-based — never an AI call. Matches the exact
// tone instruction 2 requires ("I reviewed the imported email against
// the reconstructed builder version...") and the compact per-category
// layout instruction 5 requires. This is what seeds the AI Engineer's
// FIRST message on handoff (R4-B UI wiring) — the model is never asked
// to invent this summary itself.
export function formatReconstructionReviewMessage(review: ReconstructionReview): string {
  const attentionCategories = review.categories.filter((c) => c.differences.length > 0);

  if (attentionCategories.length === 0) {
    return 'I reviewed the imported email against the reconstructed builder version. Everything was faithfully preserved — no differences worth addressing.';
  }

  const lines: string[] = [];
  const repairableCount = review.counts.repairable;
  const categoryWord = attentionCategories.length === 1 ? 'category' : 'categories';
  if (repairableCount > 0) {
    lines.push(
      `I reviewed the imported email against the reconstructed builder version. I found ${attentionCategories.length} ${categoryWord} `
      + `with differences worth reviewing, including ${repairableCount} repairable difference${repairableCount === 1 ? '' : 's'}.`,
    );
  } else {
    lines.push(
      `I reviewed the imported email against the reconstructed builder version. Most of the structure and content were preserved. `
      + `I found ${attentionCategories.length} ${categoryWord} with differences — all intentional normalizations or architectural limits, nothing repairable.`,
    );
  }

  lines.push('', 'Reconstruction review');
  for (const category of review.categories) {
    if (category.worstDifferenceClass === 'preserved') {
      lines.push(`${category.label} — Preserved`);
      continue;
    }
    const count = category.differences.filter((d) => d.class === category.worstDifferenceClass).length;
    const label = DIFFERENCE_CLASS_LABEL[category.worstDifferenceClass];
    lines.push(`${category.label} — ${count} ${label} difference${count === 1 ? '' : 's'}`);
  }

  const toExplain = attentionCategories;
  if (toExplain.length > 0) {
    lines.push('');
    for (const category of toExplain) {
      for (const difference of category.differences) {
        lines.push(`• ${difference.summary}`);
      }
    }
  }

  return lines.join('\n');
}
