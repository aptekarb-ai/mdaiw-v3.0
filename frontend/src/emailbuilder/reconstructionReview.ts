import type { ButtonModuleProps, EmailModule, ImageModuleProps, TextModuleProps } from './edm';
import { MAX_PADDING, MIN_PADDING } from './edm';
import type { DetectedRegion, DetectedStructure } from './htmlImportAnalysis';
import type { FidelityCategoryId, FidelityCategoryResult, FidelityReport, FidelityStatus } from './htmlImportFidelity';
import type { ImportFinding } from './importFindings';
import { extractStyleDeclarations, isSafeAnchorUrl, isSafeResourceUrl, readAllowedAttribute } from './htmlImportSanitize';
import { buildCandidateId, type ReconstructionRepairCandidate } from './reconstructionRepairCandidate';
import { supportsVmlButtonPattern } from './vml';

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
  // R4-C1 — present only when a source region and a reconstructed
  // module/column were paired UNAMBIGUOUSLY (see each detect*Repairable
  // function's own ordered/count-matched pairing) and the gap maps to a
  // real, already-typed builder field. class 'repairable' does not
  // guarantee this is set (see detectFontWeightRepairable's own
  // docstring for the one case that stays classification-only because
  // safe per-instance pairing isn't possible); every OTHER class never
  // sets it — normalized/approximation/removed-unsupported differences
  // are never "fixed" by construction, only explained.
  repairCandidate?: ReconstructionRepairCandidate;
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
    const module = buttonModules[index];
    const props = module.props as unknown as ButtonModuleProps;
    if (region.typography.align && region.typography.align !== props.align) {
      const signature = 'import-reconstruction:button:alignment';
      differences.push({
        categoryId: 'spacing', class: 'repairable', signature,
        summary: `Button alignment: source "${region.typography.align}", reconstructed "${props.align}".`,
        detail: `The source button at ${region.sourcePosition} was aligned "${region.typography.align}", but the reconstructed Button module is aligned "${props.align}". The Button module already supports alignment (props.align) — this can be corrected.`,
        sourcePosition: region.sourcePosition,
        repairCandidate: {
          id: buildCandidateId(signature, module.id), categoryId: 'spacing', signature,
          sourcePosition: region.sourcePosition, moduleId: module.id, moduleType: module.type,
          problem: 'Button alignment does not match the source.',
          sourceEvidence: `Source button align: "${region.typography.align}".`,
          currentValue: String(props.align), proposedValue: String(region.typography.align),
          expectedImprovement: 'Button alignment will match the imported email.',
          confidence: 1.0, risk: 'low', safeAutoFix: true,
          item: { kind: 'module', issueId: signature, moduleId: module.id, propPatch: { align: region.typography.align } },
        },
      });
    }
    const sourceH = region.spacing.paddingHorizontal;
    const sourceV = region.spacing.paddingVertical;
    const paddingMismatch = (sourceH !== undefined && sourceH !== props.paddingHorizontal)
      || (sourceV !== undefined && sourceV !== props.paddingVertical);
    if (paddingMismatch) {
      const signature = 'import-reconstruction:button:padding';
      const proposedH = sourceH ?? props.paddingHorizontal;
      const proposedV = sourceV ?? props.paddingVertical;
      differences.push({
        categoryId: 'spacing', class: 'repairable', signature,
        summary: `Button padding: source ${sourceH ?? '—'}px/${sourceV ?? '—'}px (H/V), reconstructed ${props.paddingHorizontal}px/${props.paddingVertical}px.`,
        detail: `The source button at ${region.sourcePosition} had ${sourceH ?? 'unset'}px horizontal / ${sourceV ?? 'unset'}px vertical padding, but the reconstructed Button module has ${props.paddingHorizontal}px/${props.paddingVertical}px. The Button module already supports padding (props.paddingHorizontal/paddingVertical) — this can be corrected.`,
        sourcePosition: region.sourcePosition,
        repairCandidate: {
          id: buildCandidateId(signature, module.id), categoryId: 'spacing', signature,
          sourcePosition: region.sourcePosition, moduleId: module.id, moduleType: module.type,
          problem: 'Button padding does not match the source.',
          sourceEvidence: `Source button padding: ${sourceH ?? 'unset'}px horizontal / ${sourceV ?? 'unset'}px vertical.`,
          currentValue: `${props.paddingHorizontal}px/${props.paddingVertical}px`, proposedValue: `${proposedH}px/${proposedV}px`,
          expectedImprovement: 'Button padding will match the imported email.',
          confidence: 1.0, risk: 'low', safeAutoFix: true,
          item: { kind: 'module', issueId: signature, moduleId: module.id, propPatch: { paddingHorizontal: proposedH, paddingVertical: proposedV } },
        },
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
    const module = imageModules[index];
    const props = module.props as unknown as ImageModuleProps;
    if (region.detectedWidthPx === null) return;
    const reconstructedWidthPx = props.width?.desktop?.unit === 'px' ? props.width.desktop.value : null;
    if (reconstructedWidthPx !== region.detectedWidthPx) {
      const signature = 'import-reconstruction:image:width';
      // Preserve any existing mobile override — width is a
      // ResponsiveDimension, and a propPatch replaces the WHOLE field
      // (shallow merge at the props level), so dropping `.mobile` here
      // would silently discard a real per-viewport override.
      const proposedWidth = { desktop: { unit: 'px' as const, value: region.detectedWidthPx }, ...(props.width?.mobile ? { mobile: props.width.mobile } : {}) };
      differences.push({
        categoryId: 'images', class: 'repairable', signature,
        summary: `Image width: source ${region.detectedWidthPx}px, reconstructed ${reconstructedWidthPx ?? 'fluid'}.`,
        detail: `The source image at ${region.sourcePosition} was ${region.detectedWidthPx}px wide, but the reconstructed Image module resolves to ${reconstructedWidthPx ?? 'a fluid (100%) width'}. The Image module already supports a fixed pixel width — this can be corrected.`,
        sourcePosition: region.sourcePosition,
        repairCandidate: {
          id: buildCandidateId(signature, module.id), categoryId: 'images', signature,
          sourcePosition: region.sourcePosition, moduleId: module.id, moduleType: module.type,
          problem: 'Image width does not match the source.',
          sourceEvidence: `Source image width: ${region.detectedWidthPx}px.`,
          currentValue: reconstructedWidthPx !== null ? `${reconstructedWidthPx}px` : 'fluid (100%)',
          proposedValue: `${region.detectedWidthPx}px`,
          expectedImprovement: 'Image width will match the imported email.',
          confidence: 1.0, risk: 'low', safeAutoFix: true,
          item: { kind: 'module', issueId: signature, moduleId: module.id, propPatch: { width: proposedWidth } },
        },
      });
    }
  });
  return differences;
}

// R4-C3 — image SOURCE (not just width): only ever proposed when the
// source URL was already marked safe by htmlImportAnalysis.ts's own
// imageOf() (isSafeResourceUrl + never data:/cid:) — an unsafe source
// image never reaches this function with a usable `.src` at all (see
// DetectedImage.safe), so there is no path from an unsanitized/unsafe
// URL into a repair candidate. Same for alt text (always safe — plain
// text, never markup).
function detectImageSrcRepairable(structure: DetectedStructure, modules: EmailModule[]): ReconstructionDifference[] {
  const imageRegions = flattenRegions(structure.regions).filter((r) => r.role === 'image' || r.role === 'hero');
  const imageModules = flattenModules(modules).filter((m) => m.type === 'image');
  if (imageRegions.length === 0 || imageRegions.length !== imageModules.length) return [];

  const differences: ReconstructionDifference[] = [];
  imageRegions.forEach((region, index) => {
    const module = imageModules[index];
    const props = module.props as unknown as ImageModuleProps;
    const source = region.images[0];
    if (!source || !source.safe || !source.src || !isSafeResourceUrl(source.src)) return;
    const patch: Record<string, unknown> = {};
    if (source.src !== props.src) patch.src = source.src;
    if (source.alt && source.alt !== props.alt) patch.alt = source.alt;
    if (Object.keys(patch).length === 0) return;
    const signature = 'import-reconstruction:image:source';
    differences.push({
      categoryId: 'images', class: 'repairable', signature,
      summary: 'Image source/alt text does not match the source.',
      detail: `The source image at ${region.sourcePosition} has a different ${patch.src ? 'source URL' : 'alt text'} than the reconstructed Image module. Both fields are already supported — this can be corrected.`,
      sourcePosition: region.sourcePosition,
      repairCandidate: {
        id: buildCandidateId(signature, module.id), categoryId: 'images', signature,
        sourcePosition: region.sourcePosition, moduleId: module.id, moduleType: module.type,
        problem: 'Reconstructed image source/alt does not match the source.',
        sourceEvidence: `Source image: src="${source.src}"${source.alt ? `, alt="${source.alt}"` : ''}.`,
        currentValue: `src="${props.src}", alt="${props.alt}"`,
        proposedValue: `src="${(patch.src as string | undefined) ?? props.src}", alt="${(patch.alt as string | undefined) ?? props.alt}"`,
        expectedImprovement: 'Image will show the exact source image and alt text.',
        confidence: 1.0, risk: 'low', safeAutoFix: true,
        item: { kind: 'module', issueId: signature, moduleId: module.id, propPatch: patch },
      },
    });
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
        const signature = 'import-reconstruction:background:color';
        differences.push({
          categoryId: 'content', class: 'repairable', signature,
          summary: `Column background: source ${child.background.color}, reconstructed ${column.settings.backgroundColor || 'none'}.`,
          detail: `Column ${columnIndex + 1} at ${region.sourcePosition} had background ${child.background.color} in the source, but the reconstructed column's background is ${column.settings.backgroundColor || 'unset'}. Per-column background is already supported — this can be corrected.`,
          sourcePosition: region.sourcePosition,
          repairCandidate: {
            id: buildCandidateId(signature, `${layoutModule.id}:${column.id}`), categoryId: 'content', signature,
            sourcePosition: region.sourcePosition, moduleId: layoutModule.id, moduleType: layoutModule.type, columnId: column.id,
            problem: `Column ${columnIndex + 1} background does not match the source.`,
            sourceEvidence: `Source column ${columnIndex + 1} background: ${child.background.color}.`,
            currentValue: column.settings.backgroundColor || '(none)', proposedValue: child.background.color,
            expectedImprovement: `Column ${columnIndex + 1} background will match the imported email.`,
            confidence: 1.0, risk: 'low', safeAutoFix: true,
            item: { kind: 'column-settings', issueId: signature, layoutId: layoutModule.id, columnId: column.id, settingsPatch: { backgroundColor: child.background.color } },
          },
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

// R4-C3 — text typography (heading + paragraph regions both become a
// 'text' module — see edm.ts's EmailModuleType, there is no separate
// heading module type). Same ordered/count-matched pairing discipline
// as every other detector here: header/footer/hero/cta/columns regions
// are excluded (they become distinct module types, never 'text'), so a
// heading/paragraph region only ever pairs against a genuine Text
// module, never a coincidentally-same-index unrelated module.
//
// Bundles every mismatched field into ONE propPatch per module rather
// than one candidate per field — applyRepairPatch's own merge-by-
// moduleId (useEmailBuilderState.ts) means multiple simultaneous
// candidates for the same module would still apply safely, but a
// single "fix this text block's typography" candidate is both simpler
// for the user to review and avoids proposing 3 separate confirmations
// for what is really one visual fact (the block's typography).
function detectTextTypographyRepairable(structure: DetectedStructure, modules: EmailModule[]): ReconstructionDifference[] {
  const textRegions = flattenRegions(structure.regions).filter((r) => r.role === 'heading' || r.role === 'paragraph' || r.role === 'preheader');
  const textModules = flattenModules(modules).filter((m) => m.type === 'text');
  if (textRegions.length === 0 || textRegions.length !== textModules.length) return [];

  const differences: ReconstructionDifference[] = [];
  textRegions.forEach((region, index) => {
    const module = textModules[index];
    const props = module.props as unknown as TextModuleProps;
    const patch: Record<string, unknown> = {};
    const mismatches: string[] = [];
    if (region.typography.color && region.typography.color !== props.color) {
      patch.color = region.typography.color;
      mismatches.push(`color (source ${region.typography.color}, reconstructed ${props.color})`);
    }
    if (region.typography.fontSize && region.typography.fontSize !== props.fontSize) {
      patch.fontSize = region.typography.fontSize;
      mismatches.push(`font size (source ${region.typography.fontSize}px, reconstructed ${props.fontSize}px)`);
    }
    if (region.typography.align && region.typography.align !== props.align) {
      patch.align = region.typography.align;
      mismatches.push(`alignment (source "${region.typography.align}", reconstructed "${props.align}")`);
    }
    if (mismatches.length === 0) return;
    const signature = 'import-reconstruction:typography:text';
    differences.push({
      categoryId: 'typography', class: 'repairable', signature,
      summary: `Text typography: ${mismatches.join('; ')}.`,
      detail: `The source text at ${region.sourcePosition} differs from the reconstructed Text module in ${mismatches.length} way${mismatches.length === 1 ? '' : 's'}: ${mismatches.join('; ')}. Every one of these fields is already supported — this can be corrected.`,
      sourcePosition: region.sourcePosition,
      repairCandidate: {
        id: buildCandidateId(signature, module.id), categoryId: 'typography', signature,
        sourcePosition: region.sourcePosition, moduleId: module.id, moduleType: module.type,
        problem: 'Text typography does not match the source.',
        sourceEvidence: mismatches.join('; '),
        currentValue: `color=${props.color}, fontSize=${props.fontSize}px, align=${props.align}`,
        proposedValue: `color=${patch.color ?? props.color}, fontSize=${patch.fontSize ?? props.fontSize}px, align=${patch.align ?? props.align}`,
        expectedImprovement: 'Text typography will match the imported email.',
        confidence: 1.0, risk: 'low', safeAutoFix: true,
        item: { kind: 'module', issueId: signature, moduleId: module.id, propPatch: patch },
      },
    });
  });
  return differences;
}

// R4-C3 — text module padding. Same "already-typed field, no capability
// check needed" posture as every other candidate here — settings.desktop
// exists on EVERY module type (edm.ts's EmailModuleSettings), so this
// never needs a manifest lookup the way the AI-command path does. Clamps
// to the SAME MIN_PADDING/MAX_PADDING bound the Properties panel and
// ai_command.py's own _validate_settings_patch already enforce, so a
// source value outside that range degrades to the nearest in-range value
// rather than proposing a patch that would be out of bounds.
function detectTextPaddingRepairable(structure: DetectedStructure, modules: EmailModule[]): ReconstructionDifference[] {
  const textRegions = flattenRegions(structure.regions).filter((r) => r.role === 'heading' || r.role === 'paragraph' || r.role === 'preheader');
  const textModules = flattenModules(modules).filter((m) => m.type === 'text');
  if (textRegions.length === 0 || textRegions.length !== textModules.length) return [];

  const clamp = (n: number) => Math.min(MAX_PADDING, Math.max(MIN_PADDING, n));

  const differences: ReconstructionDifference[] = [];
  textRegions.forEach((region, index) => {
    const module = textModules[index];
    const sourceH = region.spacing.paddingHorizontal;
    const sourceV = region.spacing.paddingVertical;
    if (sourceH === undefined && sourceV === undefined) return;
    const current = module.settings.desktop;
    const proposedTop = sourceV !== undefined ? clamp(sourceV) : current.paddingTop;
    const proposedBottom = sourceV !== undefined ? clamp(sourceV) : current.paddingBottom;
    const proposedLeft = sourceH !== undefined ? clamp(sourceH) : current.paddingLeft;
    const proposedRight = sourceH !== undefined ? clamp(sourceH) : current.paddingRight;
    const changed = proposedTop !== current.paddingTop || proposedBottom !== current.paddingBottom
      || proposedLeft !== current.paddingLeft || proposedRight !== current.paddingRight;
    if (!changed) return;
    const signature = 'import-reconstruction:spacing:text-padding';
    differences.push({
      categoryId: 'spacing', class: 'repairable', signature,
      summary: `Text padding: source ${sourceH ?? '—'}px/${sourceV ?? '—'}px (H/V), reconstructed ${current.paddingLeft}px/${current.paddingTop}px.`,
      detail: `The source text at ${region.sourcePosition} had ${sourceH ?? 'unset'}px horizontal / ${sourceV ?? 'unset'}px vertical padding. The Text module already supports padding on every side (settings.desktop) — this can be corrected.`,
      sourcePosition: region.sourcePosition,
      repairCandidate: {
        id: buildCandidateId(signature, module.id), categoryId: 'spacing', signature,
        sourcePosition: region.sourcePosition, moduleId: module.id, moduleType: module.type,
        problem: 'Text padding does not match the source.',
        sourceEvidence: `Source text padding: ${sourceH ?? 'unset'}px horizontal / ${sourceV ?? 'unset'}px vertical.`,
        currentValue: `${current.paddingLeft}/${current.paddingRight}/${current.paddingTop}/${current.paddingBottom}px`,
        proposedValue: `${proposedLeft}/${proposedRight}/${proposedTop}/${proposedBottom}px`,
        expectedImprovement: 'Text padding will match the imported email.',
        confidence: 1.0, risk: 'low', safeAutoFix: true,
        // Full desktop object, not a partial one — settings-patch merge
        // is shallow at the TOP level only (useEmailBuilderState.ts's
        // applyRepairPatch), so a nested `desktop` key here REPLACES the
        // whole object; every side must be present or a sibling field
        // (e.g. a side this detector didn't change) would be silently
        // dropped. Mirrors the exact fix R4-B4 made for the AI-command
        // path's own UPDATE_MODULE_SETTINGS handling.
        item: {
          kind: 'module-settings', issueId: signature, moduleId: module.id,
          settingsPatch: { desktop: { ...current, paddingTop: proposedTop, paddingBottom: proposedBottom, paddingLeft: proposedLeft, paddingRight: proposedRight } },
        },
      },
    });
  });
  return differences;
}

// R4-C3 — link/href transfer. ONLY ever proposed when the source href
// was already marked safe (isSafeAnchorUrl, the SAME check
// htmlImportAnalysis.ts's own linkOf() already applies) — an unsafe
// source href never reaches this function with a non-empty `.href` at
// all (see DetectedLink.safe), so there is no path from
// javascript:/data: or any other unsafe scheme into a repair candidate.
// Re-checks isSafeAnchorUrl here too, defense-in-depth, never trusting
// a boolean alone to gate a URL that ends up in an href attribute.
function detectLinkRepairable(structure: DetectedStructure, modules: EmailModule[]): ReconstructionDifference[] {
  const ctaRegions = flattenRegions(structure.regions).filter((r) => r.role === 'cta');
  const buttonModules = flattenModules(modules).filter((m) => m.type === 'button');
  if (ctaRegions.length === 0 || ctaRegions.length !== buttonModules.length) return [];

  const differences: ReconstructionDifference[] = [];
  ctaRegions.forEach((region, index) => {
    const module = buttonModules[index];
    const props = module.props as unknown as ButtonModuleProps;
    const link = region.links[0];
    if (!link || !link.safe || !link.href || !isSafeAnchorUrl(link.href)) return;
    if (link.href === props.href) return;
    const signature = 'import-reconstruction:links:href';
    differences.push({
      categoryId: 'links', class: 'repairable', signature,
      summary: `Button link: source "${link.href}", reconstructed "${props.href}".`,
      detail: `The source button at ${region.sourcePosition} links to "${link.href}", but the reconstructed Button module links to "${props.href}". This can be corrected.`,
      sourcePosition: region.sourcePosition,
      repairCandidate: {
        id: buildCandidateId(signature, module.id), categoryId: 'links', signature,
        sourcePosition: region.sourcePosition, moduleId: module.id, moduleType: module.type,
        problem: 'Button destination link does not match the source.',
        sourceEvidence: `Source button href: "${link.href}".`,
        currentValue: props.href, proposedValue: link.href,
        expectedImprovement: 'Button will link to the same destination as the imported email.',
        confidence: 1.0, risk: 'low', safeAutoFix: true,
        item: { kind: 'module', issueId: signature, moduleId: module.id, propPatch: { href: link.href } },
      },
    });
  });
  return differences;
}

// R4-C3 — Outlook/VML fallback opportunity. Not a source-vs-reconstructed
// comparison (the source has no "outlookVml" concept) — this is the
// builder PROACTIVELY offering its own already-built Classic Outlook
// compatibility feature (vml.ts) for a rounded button that doesn't have
// it enabled yet, exactly like the existing Validation Center rule
// (emailValidation.ts) already flags this — reusing supportsVmlButtonPattern,
// never a second capability check.
function detectOutlookFallbackRepairable(modules: EmailModule[]): ReconstructionDifference[] {
  const buttonModules = flattenModules(modules).filter((m) => m.type === 'button' && supportsVmlButtonPattern(m.type));
  const differences: ReconstructionDifference[] = [];
  for (const module of buttonModules) {
    const props = module.props as unknown as ButtonModuleProps;
    if (!props.borderRadius || props.borderRadius <= 0) continue;
    if (module.settings.outlookVml === true) continue;
    const signature = 'import-reconstruction:outlook:vml-button';
    differences.push({
      categoryId: 'outlook', class: 'repairable', signature,
      summary: 'Rounded button has no Classic Outlook fallback enabled.',
      detail: 'This button has rounded corners but no VML fallback — Classic Outlook (Word rendering engine) ignores CSS border-radius, so the button would render as a square. Enabling the fallback is already supported.',
      repairCandidate: {
        id: buildCandidateId(signature, module.id), categoryId: 'outlook', signature,
        moduleId: module.id, moduleType: module.type,
        problem: 'Rounded button has no Classic Outlook fallback.',
        sourceEvidence: `Button has borderRadius=${props.borderRadius}px with no VML fallback enabled.`,
        currentValue: 'VML fallback disabled', proposedValue: 'VML fallback enabled',
        expectedImprovement: 'Button will render correctly (rounded) in Classic Outlook.',
        confidence: 1.0, risk: 'low', safeAutoFix: true,
        item: { kind: 'module-settings', issueId: signature, moduleId: module.id, settingsPatch: { outlookVml: true } },
      },
    });
  }
  return differences;
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
  addIndependent(detectImageSrcRepairable(structure, modules));
  addIndependent(detectBackgroundRepairable(structure, modules));
  addIndependent(detectFontWeightRepairable(document));
  addIndependent(detectTextTypographyRepairable(structure, modules));
  addIndependent(detectTextPaddingRepairable(structure, modules));
  addIndependent(detectLinkRepairable(structure, modules));
  addIndependent(detectOutlookFallbackRepairable(modules));

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
