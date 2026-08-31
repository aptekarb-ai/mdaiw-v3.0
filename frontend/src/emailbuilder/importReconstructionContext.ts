import type {
  AICommandFidelityCategorySummary, AICommandImportFindingSummary, AICommandImportReconstructionContext,
  AICommandRegionSummary,
} from './aiCommand';
import type { DetectedRegion, DetectedStructure } from './htmlImportAnalysis';
import type { FidelityReport } from './htmlImportFidelity';
import { FIDELITY_CATEGORY_ORDER } from './htmlImportFidelity';

// R4-A (Import HTML AI Reconstruction) — the ONE place that condenses
// R1's DetectedStructure and R2's FidelityReport into the bounded wire
// shape AICommandRequest.import_reconstruction carries. Pure, synchronous,
// deterministic: never calls the AI, never mutates its inputs, never
// constructs an EmailModule. This is a NEW summarization step, not a
// second analysis/fidelity engine — every fact it reads already exists
// in DetectedStructure/FidelityReport; it only truncates/flattens them
// to a size safe to send on every conversational turn (instruction: "Do
// not blindly send the complete raw source HTML on every AI turn").

export const MAX_REGIONS_SENT = 20;
export const MAX_SAMPLE_FINDINGS_PER_CATEGORY = 3;
export const CONTENT_PREVIEW_MAX_CHARS = 120;

function truncate(text: string, maxChars: number): string {
  const trimmed = text.trim();
  return trimmed.length > maxChars ? `${trimmed.slice(0, maxChars).trimEnd()}…` : trimmed;
}

// Depth-first flatten (top-level regions first, then each one's
// children before moving to the next sibling) — matches the order a
// human reading the document top-to-bottom would encounter them, so a
// truncation at MAX_REGIONS_SENT drops the LATEST content, never
// scrambles the order of what does get sent.
function flattenRegionsInOrder(regions: DetectedRegion[]): DetectedRegion[] {
  const out: DetectedRegion[] = [];
  for (const region of regions) {
    out.push(region);
    out.push(...flattenRegionsInOrder(region.children));
  }
  return out;
}

function regionContentPreview(region: DetectedRegion): string | undefined {
  const text = region.content.text.join(' ').trim();
  return text ? truncate(text, CONTENT_PREVIEW_MAX_CHARS) : undefined;
}

function summarizeRegion(region: DetectedRegion): AICommandRegionSummary {
  const summary: AICommandRegionSummary = {
    role: region.role,
    confidence: region.confidence,
    source_position: region.sourcePosition,
    has_image: region.images.length > 0,
    has_links: region.links.length > 0,
  };
  const preview = regionContentPreview(region);
  if (preview) summary.content_preview = preview;
  if (region.columnRatio) summary.column_ratio = region.columnRatio;
  if (region.background.color) summary.background_color = region.background.color;
  if (region.typography.align) summary.align = region.typography.align;
  return summary;
}

function summarizeFinding(finding: { category: string; source: string; location: string; reason: string }): AICommandImportFindingSummary {
  return { category: finding.category, source: finding.source, location: finding.location, reason: finding.reason };
}

function summarizeCategory(category: FidelityReport['categories'][number]): AICommandFidelityCategorySummary {
  return {
    id: category.id,
    status: category.status,
    summary: category.summary,
    finding_count: category.findings.length,
    sample_findings: category.findings.slice(0, MAX_SAMPLE_FINDINGS_PER_CATEGORY).map(summarizeFinding),
  };
}

export function buildImportReconstructionContext(
  structure: DetectedStructure, fidelity: FidelityReport, moduleCount: number,
): AICommandImportReconstructionContext {
  const flattened = flattenRegionsInOrder(structure.regions);
  const categoriesById = new Map(fidelity.categories.map((c) => [c.id, c]));

  return {
    document_width: structure.documentWidthPx,
    module_count: moduleCount,
    region_count: flattened.length,
    regions: flattened.slice(0, MAX_REGIONS_SENT).map(summarizeRegion),
    // Always all 8, in the same fixed order the UI itself renders them
    // in — the AI never receives categories in an unpredictable order.
    fidelity_categories: FIDELITY_CATEGORY_ORDER
      .map((id) => categoriesById.get(id))
      .filter((c): c is FidelityReport['categories'][number] => Boolean(c))
      .map(summarizeCategory),
    has_mso_conditional_content: structure.hasMsoConditionalContent,
  };
}
