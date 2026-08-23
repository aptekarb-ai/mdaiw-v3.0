import { computeCompatibilityChecks } from './htmlCompatibilityChecks';
import { detectCompatibilityImpact } from './platformCompatibility';
import { columnResponsiveClassName } from './responsiveStyles';
import { validateCustomCss } from './emailCss';
import { validateFaviconUrl } from './faviconValidation';
import type { EmailColumn, EmailDocumentContent, EmailModule } from './edm';
import type { EmailPlatform } from './types';

// Feature 12 — Validation Center. Deterministic checks only (per
// 03_Implementation_Plan/07_Preview_Validation.md: "Deterministic checks
// first... AI fixes should consume structured issues and propose minimal
// diffs" — no AI call is implemented here, see PROPERTIES panel note on
// "AI-assisted fix" below). Every check operates on the SAME two
// already-existing representations the rest of Module-4 already trusts:
// the real rendered HTML (renderEmailDocument's output, exactly what
// Feature 09's Code Editor and Feature 11's Preview Studio show) and the
// real persisted Email Document Model — never mocked/sample content, and
// never a second parallel HTML-safety engine: the HTML/Outlook/Platform
// categories are thin re-labelings of Feature 09's computeCompatibilityChecks
// and Feature 10's detectCompatibilityImpact, not reimplementations.

export type ValidationSeverity = 'error' | 'warning';
export type ValidationCategoryId =
  | 'document' | 'html' | 'outlook' | 'responsive' | 'accessibility' | 'links' | 'images' | 'dark-mode' | 'platform';
export type IssueFixType = 'safe' | 'manual' | 'none';

// Sub-phase 4, item 4 — a safe fix is either module-scoped (unchanged,
// Feature 12's original shape: patches one module's props via the
// existing onUpdateProps path) or document-scoped (new: patches
// EmailDocumentSettingsSnapshot via the existing
// builder.updateDocumentSettings path — see useEmailBuilderState.ts).
// Never a third, parallel mutation system — both variants apply through
// mutators that already exist and already participate in undo/redo.
export type ValidationSafeFix =
  | { moduleId: string; propPatch: Record<string, unknown> }
  | { documentPatch: Record<string, unknown> };

export interface ValidationIssue {
  id: string;
  category: ValidationCategoryId;
  severity: ValidationSeverity;
  title: string;
  detail: string;
  // Present only when the issue traces to one specific module — drives
  // "navigate to the relevant editor/module" (manual fixes) and "safe fix"
  // (patches this module's props directly).
  moduleId?: string;
  fixType: IssueFixType;
  // Only present when fixType === 'safe'.
  safeFix?: ValidationSafeFix;
}

export type CategoryStatus = 'good' | 'needs-improvement' | 'needs-attention';

export interface CategoryResult {
  id: ValidationCategoryId;
  label: string;
  status: CategoryStatus;
  issueCount: number;
}

export interface ValidationReport {
  score: number;
  categories: CategoryResult[];
  issues: ValidationIssue[];
}

const CATEGORY_LABELS: Record<ValidationCategoryId, string> = {
  document: 'Document Settings',
  html: 'HTML',
  outlook: 'Outlook Compatibility',
  responsive: 'Responsive',
  accessibility: 'Accessibility',
  links: 'Links',
  images: 'Images',
  'dark-mode': 'Dark Mode',
  platform: 'Platform Compatibility',
};

const CATEGORY_ORDER: ValidationCategoryId[] = [
  'document', 'html', 'outlook', 'responsive', 'accessibility', 'links', 'images', 'dark-mode', 'platform',
];

// --- Module tree walk (one level of column nesting, same shape layoutModel.ts's own helpers assume) ---

interface FlatModule {
  module: EmailModule;
}

function flattenModules(modules: EmailModule[]): FlatModule[] {
  const flat: FlatModule[] = [];
  for (const module of modules) {
    flat.push({ module });
    if (module.columns) {
      for (const column of module.columns as EmailColumn[]) {
        for (const nested of column.modules) {
          flat.push({ module: nested });
        }
      }
    }
  }
  return flat;
}

// --- WCAG-style contrast ---

function hexToRgb(hex: string): [number, number, number] | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const value = match[1];
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
  ];
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

// WCAG 2.x contrast ratio, 1–21. Returns null when either color isn't a
// plain 6-digit hex this deterministic check can reason about.
function contrastRatio(hexA: string, hexB: string): number | null {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  if (!a || !b) return null;
  const lumA = relativeLuminance(a);
  const lumB = relativeLuminance(b);
  const lighter = Math.max(lumA, lumB);
  const darker = Math.min(lumA, lumB);
  return (lighter + 0.05) / (darker + 0.05);
}

// Approximates the same auto-dark-mode inversion Feature 11's Dark Mode
// preview applies to the iframe (invert lightness, rotate hue back) — done
// here in RGB space against a single hex color so a contrast pair can be
// re-checked post-inversion without touching the rendered HTML.
function invertForDarkMode(hex: string): string | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const [r, g, b] = rgb.map((c) => 255 - c);
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

const WCAG_AA_NORMAL_TEXT_RATIO = 4.5;

// A fix only qualifies as "safe" when it cannot knowingly introduce another
// validation problem of equal or greater severity (this closure pass's
// explicit safe-fix definition). Black/white text against a genuinely
// neutral-gray background inverts symmetrically, but colored (non-gray)
// backgrounds do NOT invert symmetrically under the WCAG luminance formula
// (its per-channel weights are 0.2126R/0.7152G/0.0722B, not equal) — so a
// candidate that passes light-mode contrast can still fail the same check
// once the same module is dark-mode-inverted. Only offer a candidate that
// passes BOTH; otherwise there is no genuinely safe auto-fix and the issue
// must be downgraded to manual.
function jointlySafeReadableColor(background: string): string | null {
  const invertedBackground = invertForDarkMode(background);
  if (!invertedBackground) return null;

  const candidates: string[] = ['#000000', '#ffffff'];
  let best: { color: string; lightRatio: number } | null = null;

  for (const candidate of candidates) {
    const lightRatio = contrastRatio(candidate, background);
    const invertedCandidate = invertForDarkMode(candidate);
    if (lightRatio === null || !invertedCandidate) continue;
    if (lightRatio < WCAG_AA_NORMAL_TEXT_RATIO) continue;

    const darkRatio = contrastRatio(invertedCandidate, invertedBackground);
    if (darkRatio === null || darkRatio < WCAG_AA_NORMAL_TEXT_RATIO) continue;

    if (!best || lightRatio > best.lightRatio) {
      best = { color: candidate, lightRatio };
    }
  }

  return best ? best.color : null;
}

// --- Individual category checks ---

function checkHtmlAndOutlookAndImages(html: string): ValidationIssue[] {
  const checks = computeCompatibilityChecks(html);
  const issues: ValidationIssue[] = [];
  for (const check of checks) {
    if (check.ok) continue;
    const category: ValidationCategoryId = check.id === 'outlook-safe' ? 'outlook' : 'html';
    issues.push({
      id: `html:${check.id}`,
      category,
      severity: 'error',
      title: check.label,
      detail: check.detail,
      fixType: 'none',
    });
  }
  return issues;
}

// 07_Preview_Validation.md explicitly lists "mobile stacking" as a required
// deterministic responsive check, alongside the fluid-width contract.
function checkResponsive(html: string, content: EmailDocumentContent): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // The Feature 11 fluid-width fix: the real (non-Outlook) content table
  // must be width="100%" with max-width in CSS, never a bare fixed pixel
  // width — verified the same way htmlRenderer.test.ts verifies it.
  const withoutMsoBlock = html.replace(/<!--\[if mso\]>.*?<!\[endif\]-->/gs, '');
  const isFluid = /width="100%"/.test(withoutMsoBlock) && /max-width:\d+px/.test(withoutMsoBlock);
  if (!isFluid) {
    issues.push({
      id: 'responsive:fluid-outer-table',
      category: 'responsive',
      severity: 'error',
      title: 'Email is not fluid-width',
      detail: 'The outer content table should be width="100%" with a max-width in CSS so it shrinks to fit narrow viewports.',
      fixType: 'none',
    });
  }

  // Mobile stacking: a layout module with 2+ columns and mobileStack not
  // explicitly disabled (module.settings.mobileStack === false is a
  // deliberate user choice and is never flagged) must produce a real
  // stacking rule in the rendered CSS for every one of its columns —
  // reuses responsiveStyles.ts's own column class-name generator so this
  // is a regression guard on the real renderer output, not a second
  // opinion about what the class name should be.
  for (const module of content.modules) {
    if (!module.columns || module.columns.length < 2) continue;
    // Optional-chained: a malformed/corrupted module (e.g. loaded from a
    // partially-written draft) must not crash the whole Validation Center —
    // see checkAccessibilityAndDarkMode's identical defense below.
    if (module.settings?.mobileStack === false) continue;

    const missingColumns = module.columns
      .map((_column, index) => index)
      .filter((index) => {
        const cls = columnResponsiveClassName(module.id, index);
        const rule = `.${cls}{display:block !important; width:100% !important;}`;
        return !html.includes(rule);
      });

    if (missingColumns.length > 0) {
      issues.push({
        id: `responsive:mobile-stacking:${module.id}`,
        category: 'responsive',
        severity: 'error',
        title: 'Columns do not stack on mobile',
        detail: 'This layout has multiple columns but is missing the mobile stacking rule that makes them readable on narrow screens.',
        moduleId: module.id,
        fixType: 'none',
      });
    }
  }

  return issues;
}

function checkAccessibilityAndDarkMode(html: string, content: EmailDocumentContent): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // Missing alt text — real HTML scan (covers every module type uniformly,
  // including composite catalog modules with an <img> the EDM prop walk
  // below wouldn't individually know about).
  const imgTags = html.match(/<img\b[^>]*>/gi) ?? [];
  const missingAlt = imgTags.filter((tag) => !/\salt="[^"]*[^"\s][^"]*"/.test(tag)).length;
  if (missingAlt > 0) {
    issues.push({
      id: 'accessibility:missing-alt',
      category: 'accessibility',
      severity: 'error',
      title: 'Missing alt text',
      detail: `${missingAlt} image${missingAlt === 1 ? '' : 's'} missing alt text.`,
      fixType: 'none',
    });
  }

  // Weak contrast + dark-mode inversion risk — real EDM walk (needs the
  // typed color/backgroundColor pair, which the rendered HTML alone
  // doesn't reliably associate with the same visual element).
  for (const { module } of flattenModules(content.modules)) {
    // A malformed/corrupted module (missing props entirely) must not crash
    // the whole Validation Center — degrade by skipping that module's
    // contrast check rather than throwing.
    const props = (module.props ?? {}) as Record<string, unknown>;
    const textColor = (props.color ?? props.textColor) as string | undefined;
    const background = props.backgroundColor as string | undefined;
    if (!textColor || !background) continue;

    const ratio = contrastRatio(textColor, background);
    if (ratio !== null && ratio < WCAG_AA_NORMAL_TEXT_RATIO) {
      // Only offer this as a one-click "safe" fix when the candidate color
      // also survives the dark-mode-inversion check below for the same
      // module (see jointlySafeReadableColor) — otherwise the fix would
      // silently trade one warning for another, which is not "safe".
      const safeColor = jointlySafeReadableColor(background);
      const propName = props.color !== undefined ? 'color' : 'textColor';
      issues.push({
        id: `accessibility:contrast:${module.id}`,
        category: 'accessibility',
        severity: 'warning',
        title: 'Weak text contrast',
        detail: `Text contrast is ${ratio.toFixed(2)}:1 against its background — WCAG AA needs at least ${WCAG_AA_NORMAL_TEXT_RATIO}:1.`,
        moduleId: module.id,
        fixType: safeColor ? 'safe' : 'manual',
        safeFix: safeColor ? { moduleId: module.id, propPatch: { [propName]: safeColor } } : undefined,
      });
    }

    const invertedText = invertForDarkMode(textColor);
    const invertedBackground = invertForDarkMode(background);
    if (invertedText && invertedBackground) {
      const invertedRatio = contrastRatio(invertedText, invertedBackground);
      if (invertedRatio !== null && invertedRatio < WCAG_AA_NORMAL_TEXT_RATIO) {
        issues.push({
          id: `dark-mode:contrast:${module.id}`,
          category: 'dark-mode',
          severity: 'warning',
          title: 'Risky under dark-mode inversion',
          detail: 'This text/background pair becomes hard to read once a client auto-inverts it for dark mode.',
          moduleId: module.id,
          fixType: 'manual',
        });
      }
    }
  }

  return issues;
}

function checkLinksAndImages(html: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  const placeholderLinkCount = (html.match(/href="#"/g) ?? []).length;
  if (placeholderLinkCount > 0) {
    issues.push({
      id: 'links:placeholder-href',
      category: 'links',
      severity: 'error',
      title: 'Placeholder link',
      detail: `${placeholderLinkCount} link${placeholderLinkCount === 1 ? '' : 's'} still point to a placeholder URL.`,
      fixType: 'none',
    });
  }

  const placeholderImageCount = (html.match(/<img[^>]+src="#"/g) ?? []).length;
  if (placeholderImageCount > 0) {
    issues.push({
      id: 'images:placeholder-src',
      category: 'images',
      severity: 'error',
      title: 'Placeholder image',
      detail: `${placeholderImageCount} image${placeholderImageCount === 1 ? '' : 's'} still use a placeholder source.`,
      fixType: 'none',
    });
  }

  return issues;
}

// Sub-phase 3, item 12 — Outlook-specific checks, kept STRICTLY separate
// from checkHtmlAndOutlookAndImages (Feature 09's generic
// computeCompatibilityChecks re-labeling) since these are new,
// Sub-phase-3-specific concerns: malformed MSO conditional comments,
// VML-without-namespace, missing Office DPI config, and an unscoped
// global Outlook row-collapse rule. Classic Outlook ('outlook-classic:'
// id prefix) and New Outlook ('outlook-new:' id prefix) issues are NEVER
// merged into one undifferentiated "Outlook" bucket — New Outlook's
// web-rendering engine does not process MSO conditional comments or VML
// at all, so a Classic-only problem is never attributed to it, and vice
// versa (see emailClientCapabilities.ts's OutlookAffinity, which keeps
// the same distinction for the AI Engineer / client-matrix layer).
//
// Item 12's "do not create false positives merely because an email does
// not contain VML" — every check below only fires when the RELEVANT
// construct (a conditional comment, a VML tag, an unscoped row-collapse
// rule) is actually present in `html`; an email with none of these
// produces zero issues, exactly like the "clean empty document" baseline
// test already asserts (score 100, zero issues).
function checkOutlookCompatibility(html: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  const openConditionalCount = (html.match(/<!--\[if\s/gi) ?? []).length;
  const closeConditionalCount = (html.match(/<!\[endif\]-->/g) ?? []).length;
  if (openConditionalCount !== closeConditionalCount) {
    issues.push({
      id: 'outlook-classic:malformed-conditional-comment',
      category: 'outlook',
      severity: 'error',
      title: 'Malformed Outlook conditional comment',
      detail: `Found ${openConditionalCount} opening MSO conditional comment(s) but ${closeConditionalCount} closing "<![endif]-->" — Classic Outlook (Word rendering engine) may render this incorrectly or leak the fallback content.`,
      fixType: 'none',
    });
  }

  const hasVmlTags = /<v:[a-zA-Z]/.test(html);
  const htmlTagMatch = /<html\b[^>]*>/i.exec(html);
  const hasVmlNamespace = htmlTagMatch ? /xmlns:v=/.test(htmlTagMatch[0]) : false;
  if (hasVmlTags && !hasVmlNamespace) {
    issues.push({
      id: 'outlook-classic:missing-vml-namespace',
      category: 'outlook',
      severity: 'error',
      title: 'VML markup without the required namespace',
      detail: 'This document contains VML markup but <html> is missing xmlns:v="urn:schemas-microsoft-com:vml" — Classic Outlook will not render it correctly.',
      fixType: 'none',
    });
  }

  // Office DPI/PNG config is only meaningful for a document that claims
  // ANY Outlook support at all (i.e. emits at least one MSO conditional
  // comment) — a document with zero MSO content has nothing to check
  // here (never a false positive on a document that legitimately has no
  // Outlook-targeted content).
  if (openConditionalCount > 0 && !/<o:PixelsPerInch>96<\/o:PixelsPerInch>/.test(html)) {
    issues.push({
      id: 'outlook-classic:missing-office-dpi',
      category: 'outlook',
      severity: 'error',
      title: 'Missing Office 96-DPI configuration',
      detail: 'This document targets Outlook but is missing <o:PixelsPerInch>96</o:PixelsPerInch> — images may be scaled incorrectly in Classic Outlook.',
      fixType: 'none',
    });
  }

  // Item 2 regression guard — the renderer's OWN spacer treatment is
  // always scoped to the .mso-spacer class (never a bare `tr` selector),
  // so this can only ever fire from Custom CSS introducing an unscoped
  // rule; still checked directly against the FULL rendered html (not
  // re-implemented as a Custom-CSS-only scan) so it also catches any
  // future renderer regression, not just a Custom CSS mistake.
  if (/(^|[^.\w-])tr\s*\{[^}]*(?:font-size\s*:\s*0|line-height\s*:\s*0)/i.test(html)) {
    issues.push({
      id: 'outlook-classic:unsafe-global-row-collapse',
      category: 'outlook',
      severity: 'warning',
      title: 'Unscoped Outlook row-collapse rule',
      detail: 'A CSS rule zeroes out font-size/line-height on every <tr>, not just spacer rows — this can collapse real content rows in Classic Outlook. Scope it to a specific class instead.',
      // Sub-phase 4, item 5 — deterministic repair where safe. The
      // renderer's OWN spacer CSS is always scoped to .mso-spacer (see
      // outlookCompatibility.ts), so this pattern can only realistically
      // come from Custom CSS; cannot safely rewrite arbitrary CSS text to
      // re-scope just the offending rule, so the safe remedy disables
      // Custom CSS entirely — same remedy shape as document:custom-css-
      // security, a DIFFERENT check (this one is a structural/compat
      // risk, not a security violation, so it is never redundant with it).
      fixType: 'safe',
      safeFix: { documentPatch: { custom_css_enabled: false } },
    });
  }

  return issues;
}

function checkNewOutlookCompatibility(html: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (/<v:[a-zA-Z]/.test(html)) {
    issues.push({
      id: 'outlook-new:vml-not-processed',
      category: 'outlook',
      severity: 'warning',
      title: 'VML is not processed by New Outlook',
      detail: 'New Outlook uses a Chromium-based web-rendering engine, not the Word engine — it ignores VML and MSO conditional comments entirely. Content relying only on VML needs a real HTML fallback for New Outlook to show anything at all.',
      fixType: 'none',
    });
  }
  return issues;
}

// Sub-phase 4, item 1 — document-level standards (title/subject/favicon/
// Reset CSS/Custom CSS/head metadata/module comments), sourced from the
// SAME two representations every other check already trusts: the real
// rendered HTML (for anything the renderer actually emits) and the live
// EmailDocumentSettingsSnapshot (for the two fields — email_subject and
// the raw favicon_url — that either never render as markup or can be
// silently dropped from the rendered output by the renderer's own
// sanitizeUrl gate, so `html` alone cannot always tell the true stored
// state). Optional: every existing 3-argument validateEmail() call site
// (and every existing test) keeps behaving byte-identically — omitting
// this produces zero 'document' issues, the same "zero-behavior-change
// default" convention emailHead.ts's own optional fields already use.
export interface DocumentValidationSettings {
  emailSubject: string;
  faviconUrl: string;
  resetCssEnabled: boolean;
  customCssEnabled: boolean;
  customCss: string;
}

// Regression guard only (same posture as Sub-phase 3's Outlook checks) —
// renderEmailHead() emits every one of these unconditionally today, so
// this can never fire against this app's own renderer output; it exists
// to catch a future renderer regression, not a document a real user could
// produce, and is intentionally reported as ONE consolidated issue naming
// the missing tags rather than one row per tag (10 near-duplicate rows
// would not be "detecting a real issue," it would be noise).
const REQUIRED_HEAD_META: { pattern: RegExp; label: string }[] = [
  { pattern: /<meta charset="utf-8"\s*\/?>/i, label: 'charset' },
  { pattern: /<meta name="viewport"/i, label: 'viewport' },
  { pattern: /<meta name="robots"/i, label: 'robots' },
  { pattern: /<meta http-equiv="X-UA-Compatible"/i, label: 'X-UA-Compatible (Classic-Outlook-hidden)' },
  { pattern: /<meta name="apple-mobile-web-app-capable"/i, label: 'apple-mobile-web-app-capable' },
  { pattern: /<meta[^>]+apple-touch-fullscreen/i, label: 'apple-touch-fullscreen' },
  { pattern: /<meta name="apple-mobile-web-app-status-bar-style"/i, label: 'apple-mobile-web-app-status-bar-style' },
  { pattern: /<meta name="format-detection" content="address=no"/i, label: 'format-detection (address)' },
  { pattern: /<meta name="format-detection" content="date=no"/i, label: 'format-detection (date)' },
  { pattern: /<meta name="format-detection" content="email=no"/i, label: 'format-detection (email)' },
  { pattern: /<meta name="format-detection" content="telephone=no"/i, label: 'format-detection (telephone)' },
  { pattern: /<meta name="x-apple-disable-message-reformatting"/i, label: 'x-apple-disable-message-reformatting' },
];

function checkDocumentStandards(html: string, documentSettings?: DocumentValidationSettings): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // --- Regression guards (fire only on a hand-broken/malformed document,
  // never on this app's own renderer output — see REQUIRED_HEAD_META's
  // docstring above and Sub-phase 3's identical precedent). ---

  const htmlTagMatch = /<html\b[^>]*>/i.exec(html);
  const htmlTag = htmlTagMatch ? htmlTagMatch[0] : '';
  const missingNamespaces = ['xmlns="http://www.w3.org/1999/xhtml"', 'xmlns:v=', 'xmlns:o=']
    .filter((token) => !htmlTag.includes(token));
  if (missingNamespaces.length > 0) {
    issues.push({
      id: 'document:missing-namespace',
      category: 'document',
      severity: 'error',
      title: 'Missing canonical <html> namespace',
      detail: `The <html> element is missing: ${missingNamespaces.join(', ')} — required for XHTML/VML/Office compatibility.`,
      fixType: 'none',
    });
  }

  const missingMeta = REQUIRED_HEAD_META.filter(({ pattern }) => !pattern.test(html)).map(({ label }) => label);
  if (missingMeta.length > 0) {
    issues.push({
      id: 'document:missing-meta-baseline',
      category: 'document',
      severity: 'error',
      title: 'Missing required email meta/header baseline',
      detail: `This document is missing: ${missingMeta.join(', ')}.`,
      fixType: 'none',
    });
  }

  for (const [tagPattern, label] of [
    [/<title>/gi, '<title>'], [/<meta charset="utf-8"/gi, 'charset meta'], [/<link rel="icon"/gi, 'favicon link'],
  ] as [RegExp, string][]) {
    const count = (html.match(tagPattern) ?? []).length;
    if (count > 1) {
      issues.push({
        id: `document:duplicate-head-declaration:${label}`,
        category: 'document',
        severity: 'error',
        title: 'Duplicate head declaration',
        detail: `Found ${count} occurrences of ${label} in <head> — only one is expected.`,
        fixType: 'none',
      });
    }
  }

  // --- Real, reachable document-settings checks — gated on the caller
  // having actually opted in by passing documentSettings (backward
  // compatible: every existing 3-argument call/test keeps its exact
  // zero-document-issue baseline, since these are the only checks that
  // could otherwise fire on a normal document that simply hasn't set a
  // title/subject/favicon yet). ---

  if (!documentSettings) return issues;

  const titleMatch = /<title>([\s\S]*?)<\/title>/i.exec(html);
  if (titleMatch && titleMatch[1].trim() === '') {
    issues.push({
      id: 'document:missing-title',
      category: 'document',
      severity: 'warning',
      title: 'Email title is empty',
      detail: 'The document <title> is empty. Set an email title in Document Settings so browser tabs and some clients show a meaningful name.',
      fixType: 'none',
    });
  }

  if (documentSettings.emailSubject.trim() === '') {
    issues.push({
      id: 'document:missing-subject',
      category: 'document',
      severity: 'warning',
      title: 'Email subject is empty',
      detail: 'No subject is set for this email. The subject is send/document metadata (never rendered into the HTML) but is normally required before sending.',
      fixType: 'none',
    });
  }

  if (documentSettings.faviconUrl) {
    const faviconError = validateFaviconUrl(documentSettings.faviconUrl);
    if (faviconError) {
      issues.push({
        id: 'document:invalid-favicon',
        category: 'document',
        severity: 'warning',
        title: 'Favicon URL is invalid',
        detail: `${faviconError} The favicon is silently omitted from the rendered document until this is fixed.`,
        fixType: 'safe',
        safeFix: { documentPatch: { favicon_url: '' } },
      });
    }
  }

  if (!documentSettings.resetCssEnabled) {
    issues.push({
      id: 'document:reset-css-disabled',
      category: 'document',
      severity: 'warning',
      title: 'Email Reset CSS is disabled',
      detail: 'Reset CSS is the cross-client compatibility baseline (margin/padding/line-height resets). Leaving it disabled makes rendering differences across clients more likely.',
      fixType: 'safe',
      safeFix: { documentPatch: { reset_css_enabled: true } },
    });
  }

  if (documentSettings.customCssEnabled && documentSettings.customCss.trim() !== '') {
    // Defense-in-depth re-scan of whatever is CURRENTLY stored, using the
    // exact same security validator DocumentSettingsDialog/AI Engineer
    // already gate Apply/Save on (item 7) — reachable if a value ever
    // arrived through a path other than those gates (a legacy document, a
    // direct API write). Cannot safely rewrite arbitrary CSS text, so the
    // only safe deterministic remedy offered is disabling it, not editing it.
    const result = validateCustomCss(documentSettings.customCss);
    if (!result.valid) {
      issues.push({
        id: 'document:custom-css-security',
        category: 'document',
        severity: 'error',
        title: 'Custom CSS failed a security check',
        detail: result.errors[0] ?? 'Custom CSS did not pass validation.',
        fixType: 'safe',
        safeFix: { documentPatch: { custom_css_enabled: false } },
      });
    }
  }

  return issues;
}

function checkPlatform(html: string, platform: EmailPlatform): ValidationIssue[] {
  const impacts = detectCompatibilityImpact(html, platform);
  return impacts.map((impact) => ({
    id: `platform:${impact.family}`,
    category: 'platform' as const,
    severity: 'warning' as const,
    title: 'Platform token mismatch',
    detail: `This email contains ${impact.count} ${impact.label} that the current platform does not natively support.`,
    fixType: 'none' as const,
  }));
}

function categoryStatus(issues: ValidationIssue[]): CategoryStatus {
  if (issues.length === 0) return 'good';
  return issues.some((issue) => issue.severity === 'error') ? 'needs-attention' : 'needs-improvement';
}

const SEVERITY_PENALTY: Record<ValidationSeverity, number> = { error: 10, warning: 4 };

function computeScore(issues: ValidationIssue[]): number {
  const penalty = issues.reduce((sum, issue) => sum + SEVERITY_PENALTY[issue.severity], 0);
  return Math.max(0, Math.min(100, 100 - penalty));
}

export function validateEmail(
  html: string,
  content: EmailDocumentContent,
  platform: EmailPlatform,
  documentSettings?: DocumentValidationSettings,
): ValidationReport {
  const issues: ValidationIssue[] = [
    ...checkDocumentStandards(html, documentSettings),
    ...checkHtmlAndOutlookAndImages(html),
    ...checkOutlookCompatibility(html),
    ...checkNewOutlookCompatibility(html),
    ...checkResponsive(html, content),
    ...checkAccessibilityAndDarkMode(html, content),
    ...checkLinksAndImages(html),
    ...checkPlatform(html, platform),
  ];

  const categories: CategoryResult[] = CATEGORY_ORDER.map((id) => {
    const categoryIssues = issues.filter((issue) => issue.category === id);
    return {
      id,
      label: CATEGORY_LABELS[id],
      status: categoryStatus(categoryIssues),
      issueCount: categoryIssues.length,
    };
  });

  return { score: computeScore(issues), categories, issues };
}
