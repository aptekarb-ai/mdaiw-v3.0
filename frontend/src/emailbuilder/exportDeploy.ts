import { validateEmail } from './emailValidation';
import { getPlatformLabel } from './platformOptions';
import type { EmailDocumentContent } from './edm';
import type { EmailPlatform } from './types';

// Feature 13 — Export / Deploy. Deliberately thin: every check here is a
// direct reuse of Feature 12's validateEmail (the same score/category/issue
// engine the Validation Center shows) — this file adds no second opinion
// about what "safe to export" means, only the export-specific packaging
// (summary, handoff manifest, asset URL extraction, filename) around it.

export interface ExportSummary {
  emailName: string;
  platform: EmailPlatform;
  platformLabel: string;
  width: number;
  imageCount: number;
  score: number;
  hasBlockingIssues: boolean;
  validationStatus: 'Passed' | 'Needs attention';
  responsiveStatus: 'Passed' | 'Needs attention';
  errorCount: number;
  warningCount: number;
}

// A real (non-placeholder) <img> source only — "images used" should count
// actual assets, not the same placeholder-src defect Feature 12's own
// Images category already flags separately.
function countRealImages(html: string): number {
  const tags = html.match(/<img\b[^>]*>/gi) ?? [];
  return tags.filter((tag) => {
    const match = /\ssrc="([^"]*)"/.exec(tag);
    const src = match?.[1]?.trim() ?? '';
    return src.length > 0 && src !== '#';
  }).length;
}

// One entry per distinct real image URL an exported deployment package
// would need alongside the HTML — deduplicated, placeholder/empty sources
// excluded (same "real asset" definition as countRealImages).
export function extractImageAssetUrls(html: string): string[] {
  const tags = html.match(/<img\b[^>]*>/gi) ?? [];
  const urls = new Set<string>();
  for (const tag of tags) {
    const match = /\ssrc="([^"]*)"/.exec(tag);
    const src = match?.[1]?.trim() ?? '';
    if (src.length > 0 && src !== '#') urls.add(src);
  }
  return Array.from(urls);
}

// The final validation gate (operation 1 / 8): an export is "unsafe" when
// the SAME deterministic checks Feature 12 already runs found at least one
// error-severity issue (broken/placeholder markup, non-fluid structure,
// missing alt text, placeholder links/images) — warnings (weak contrast,
// dark-mode risk, a platform token the chosen export platform doesn't
// natively support) do not block, they are exactly the kind of thing a
// deployment hand-off is meant to surface for human review, not prevent.
export function buildExportSummary(
  html: string, content: EmailDocumentContent, platform: EmailPlatform, emailName: string, width: number,
): ExportSummary {
  const report = validateEmail(html, content, platform);
  const errorCount = report.issues.filter((issue) => issue.severity === 'error').length;
  const warningCount = report.issues.length - errorCount;
  const responsiveCategory = report.categories.find((category) => category.id === 'responsive');

  return {
    emailName,
    platform,
    platformLabel: getPlatformLabel(platform),
    width,
    imageCount: countRealImages(html),
    score: report.score,
    hasBlockingIssues: errorCount > 0,
    validationStatus: errorCount > 0 ? 'Needs attention' : 'Passed',
    responsiveStatus: responsiveCategory?.status === 'good' ? 'Passed' : 'Needs attention',
    errorCount,
    warningCount,
  };
}

// Operation 7, "Create deployment handoff": a small, honest JSON record of
// what was actually validated and exported — platform/validation metadata
// a receiving deployment process or teammate can read without re-deriving
// it, downloaded alongside the HTML (never sent to a server; there is no
// deployment backend in this MVP to hand it off to).
export function buildHandoffManifest(summary: ExportSummary, imageAssetUrls: string[], exportedAt: string): string {
  return JSON.stringify(
    {
      emailName: summary.emailName,
      platform: summary.platform,
      platformLabel: summary.platformLabel,
      width: summary.width,
      exportedAt,
      validation: {
        score: summary.score,
        status: summary.validationStatus,
        errorCount: summary.errorCount,
        warningCount: summary.warningCount,
      },
      responsive: summary.responsiveStatus,
      imageCount: summary.imageCount,
      imageAssetUrls,
    },
    null,
    2,
  );
}

// Same filename convention as Feature 09's Code Editor download (kept
// local rather than imported — this file has no dependency on
// CodeEditorPanel.tsx, and the two independently-evolvable download
// buttons already established this exact convention).
export function sanitizeExportFileName(name: string): string {
  const trimmed = name.trim().replace(/[^a-zA-Z0-9-_ ]/g, '').trim();
  return trimmed.length > 0 ? trimmed : 'email';
}
