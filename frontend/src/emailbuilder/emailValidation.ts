import { computeCompatibilityChecks } from './htmlCompatibilityChecks';
import { detectCompatibilityImpact } from './platformCompatibility';
import { columnResponsiveClassName } from './responsiveStyles';
import { validateCustomCss } from './emailCss';
import { validateFaviconUrl } from './faviconValidation';
import { isMsoSafeFont } from './fonts';
import { moduleResponsiveClassName } from './registryCore';
import { supportsVmlBackgroundPattern, supportsVmlButtonPattern } from './vml';
import type { EmailColumn, EmailDocumentContent, EmailModule, EmailModuleType } from './edm';
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

// Sub-phase 4, item 4 — a safe fix is either module-scoped (Feature 12's
// original shape: patches one module's props via the existing
// onUpdateProps path) or document-scoped (patches
// EmailDocumentSettingsSnapshot via the existing
// builder.updateDocumentSettings path — see useEmailBuilderState.ts).
// Sub-phase 6, work package C — a THIRD module-scoped shape, settingsPatch,
// routes through the existing updateModuleSettings mutator instead of
// updateModuleProps (e.g. toggling settings.outlookVml — a rendering
// concern, never a content prop). Never a fourth, parallel mutation
// system — all three variants apply through mutators that already exist
// and already participate in undo/redo.
export type ValidationSafeFix =
  | { moduleId: string; propPatch: Record<string, unknown> }
  | { moduleId: string; settingsPatch: Record<string, unknown> }
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
  document: 'Email Settings',
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

// C-3 remediation — a placeholder link must identify WHICH module it
// belongs to (moduleId + a human-readable element like "Shop Now") so the
// issue can offer "Go to module" and route through AI Engineer, which
// must ask the user for the real destination rather than invent one (see
// ai_command.py/ai_command_openai.py's placeholder-link guardrail). This
// walks the real module tree — the same content Fix Issues' own safeFix
// patches already target — rather than re-deriving affected modules from
// the flat rendered HTML string.
const PLACEHOLDER_HREF_PROP_KEYS = ['href', 'ctaHref'] as const;

function isPlaceholderHref(value: unknown): value is string {
  return typeof value === 'string' && (value.trim() === '' || value.trim() === '#');
}

function checkLinksAndImages(html: string, content: EmailDocumentContent): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  const placeholderLinkModules: string[] = [];
  for (const { module } of flattenModules(content.modules)) {
    const props = (module.props ?? {}) as Record<string, unknown>;
    if (PLACEHOLDER_HREF_PROP_KEYS.some((key) => isPlaceholderHref(props[key]))) {
      placeholderLinkModules.push(module.id);
    }
  }
  if (placeholderLinkModules.length > 0) {
    const count = placeholderLinkModules.length;
    issues.push({
      id: 'links:placeholder-href',
      category: 'links',
      severity: 'error',
      title: 'Placeholder link',
      detail: `${count} link${count === 1 ? '' : 's'} still point to a placeholder URL.`,
      // First affected module — "Go to module" jumps here; AI Engineer
      // must ask for the real destination for THIS module rather than
      // inventing one (see the C-3 remediation comment above).
      moduleId: placeholderLinkModules[0],
      fixType: 'manual',
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
// Sub-phase 6, work package B — module-level Classic Outlook checks need
// the live module tree (not just rendered html) to know which modules are
// real VML-repair CANDIDATES (a hero-background-image with a real image
// but VML not yet enabled; a button with rounded corners but VML not yet
// enabled). `customCss`/`customCssEnabled` come from the same
// DocumentValidationSettings the document-standards checks already read —
// Custom CSS is the ONLY place free-form CSS (float/position/flex/grid,
// unpaired line-height) can enter this app at all, since every module's
// own style is generated by the trusted renderer.
interface ExtractedCta {
  text: string;
  href: string;
}

// Sub-phase 6 closure — shape-based duck-typed CTA reader. Only ever
// called on module types supportsVmlButtonPattern already confirmed are
// bulletproof-CTA-capable (see the manifest-driven check at the call
// site below); reads whichever of the small number of shapes those
// catalog files actually use for their CTA content, never a per-module-
// type switch statement.
function extractCtaContents(props: Record<string, unknown>): ExtractedCta[] {
  const results: ExtractedCta[] = [];
  // The standalone Button module's own text/href fields.
  if (typeof props.text === 'string' && props.text && typeof props.href === 'string') {
    results.push({ text: props.text, href: props.href });
  }
  // Direct ctaText/ctaHref — the common shape (cta-*, content-*, hero-*,
  // header-logo-cta).
  if (typeof props.ctaText === 'string' && props.ctaText && typeof props.ctaHref === 'string') {
    results.push({ text: props.ctaText, href: props.ctaHref });
  }
  // cta-dual's secondary CTA.
  if (typeof props.secondaryCtaText === 'string' && props.secondaryCtaText && typeof props.secondaryCtaHref === 'string') {
    results.push({ text: props.secondaryCtaText, href: props.secondaryCtaHref });
  }
  // The composite (image-text/text-image) module's nested text.ctaText.
  const nestedText = props.text;
  if (nestedText && typeof nestedText === 'object') {
    const nested = nestedText as Record<string, unknown>;
    if (typeof nested.ctaText === 'string' && nested.ctaText) {
      results.push({ text: nested.ctaText, href: typeof nested.ctaHref === 'string' ? nested.ctaHref : '' });
    }
  }
  // Each product item's own CTA.
  if (Array.isArray(props.items)) {
    for (const item of props.items) {
      if (item && typeof item === 'object') {
        const itemProps = item as Record<string, unknown>;
        if (typeof itemProps.ctaText === 'string' && itemProps.ctaText) {
          results.push({ text: itemProps.ctaText, href: typeof itemProps.ctaHref === 'string' ? itemProps.ctaHref : '' });
        }
      }
    }
  }
  // Sub-phase 6 final reconciliation — bordered/rounded "pill" link lists
  // (social-icon-row's `platforms`, footer-social-legal's
  // `socialPlatforms`). Duck-typed on ITEM SHAPE ({label, href}), not on
  // the specific prop key, so any future pill-link array participates
  // automatically. Distinct from navLinks (header-logo-nav) only in that
  // header-logo-nav never sets supportsBulletproofCta, so this function
  // is never called for it — see the manifest-driven gate at the call site.
  for (const value of Object.values(props)) {
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        const itemProps = item as Record<string, unknown>;
        if (typeof itemProps.label === 'string' && itemProps.label && typeof itemProps.href === 'string') {
          results.push({ text: itemProps.label, href: itemProps.href });
        }
      }
    }
  }
  return results;
}

// True when the module has real CTA content AND, for the one
// user-configurable case (the standalone Button, which has its own
// borderRadius/widthMode controls), the button is actually rounded and
// not full-width — vml.ts's own canRenderVmlButton declines full-width,
// and a genuinely square (borderRadius 0) button has nothing Outlook
// would render differently. Every other bulletproof-CTA module always
// renders its CTA with a fixed rounded corner (see each catalog file's
// own renderEmailHtml), so no such gate applies to them.
function ctaNeedsVmlFallback(module: EmailModule): boolean {
  const props = module.props as Record<string, unknown>;
  const contents = extractCtaContents(props);
  if (contents.length === 0) return false;
  if (module.type === 'button') {
    const borderRadius = typeof props.borderRadius === 'number' ? props.borderRadius : 0;
    const widthMode = props.widthMode;
    return borderRadius > 0 && widthMode !== 'full';
  }
  return true;
}

function checkOutlookCompatibility(
  html: string, content?: EmailDocumentContent, customCssEnabled?: boolean, customCss?: string,
): ValidationIssue[] {
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
  if (openConditionalCount > 0) {
    const missingDpi = !/<o:PixelsPerInch>96<\/o:PixelsPerInch>/.test(html);
    const missingAllowPng = !/<o:AllowPNG\s*\/?>/.test(html);
    if (missingDpi || missingAllowPng) {
      const missing = [missingDpi && '<o:PixelsPerInch>96</o:PixelsPerInch>', missingAllowPng && '<o:AllowPNG/>']
        .filter(Boolean).join(' and ');
      issues.push({
        id: 'outlook-classic:missing-office-dpi',
        category: 'outlook',
        severity: 'error',
        title: 'Missing Office document settings',
        detail: `This document targets Outlook but is missing ${missing} — images may be scaled incorrectly or lose PNG transparency in Classic Outlook.`,
        fixType: 'none',
      });
    }
  }

  // Sub-phase 6, item 2 — table/cell spacing. Every table this app's own
  // renderer emits always carries explicit cellpadding="0" cellspacing="0"
  // (registryCore.ts's moduleTable/wrapWithOuterSpacing) — a real absence
  // can only come from a renderer regression, same posture as
  // document:missing-meta-baseline's regression-guard checks above.
  const tablesMissingSpacingAttrs = (html.match(/<table\b[^>]*>/gi) ?? [])
    .filter((tag) => !/cellpadding\s*=/.test(tag) || !/cellspacing\s*=/.test(tag));
  if (tablesMissingSpacingAttrs.length > 0) {
    issues.push({
      id: 'outlook-classic:table-missing-cell-spacing-attrs',
      category: 'outlook',
      severity: 'error',
      title: 'Table missing explicit cellpadding/cellspacing',
      detail: `Found ${tablesMissingSpacingAttrs.length} <table> element(s) without explicit cellpadding="0" cellspacing="0" — Classic Outlook's Word engine can add unwanted spacing inside a table that omits these.`,
      fixType: 'none',
    });
  }

  // Sub-phase 6, item 10 — width/height image rendering. Every <img> this
  // app's renderers emit always carries an explicit width attribute
  // (ImageModuleProps/HeroModuleProps) — same regression-guard posture.
  const imagesMissingWidth = (html.match(/<img\b[^>]*>/gi) ?? []).filter((tag) => !/\bwidth\s*=/.test(tag));
  if (imagesMissingWidth.length > 0) {
    issues.push({
      id: 'outlook-classic:image-missing-width-attribute',
      category: 'outlook',
      severity: 'error',
      title: 'Image missing an explicit width attribute',
      detail: `Found ${imagesMissingWidth.length} <img> element(s) without an explicit width="..." attribute — Classic Outlook's Word engine can render images at the wrong size without it.`,
      fixType: 'none',
    });
  }

  // Sub-phase 6, item 11 — line-height / spacing behavior. The Word engine
  // ignores a plain CSS line-height unless it is paired with
  // mso-line-height-rule:exactly in the SAME declaration block — this can
  // only be introduced through Custom CSS (every module's own line-height
  // styling is renderer-controlled and never triggers this).
  if (customCssEnabled && customCss) {
    const ruleBlocks = customCss.match(/[^{}]+\{[^{}]*\}/g) ?? [];
    const unpaired = ruleBlocks.some((block) => /line-height\s*:/.test(block) && !/mso-line-height-rule\s*:\s*exactly/.test(block));
    if (unpaired) {
      issues.push({
        id: 'outlook-classic:custom-css-line-height-without-mso-rule',
        category: 'outlook',
        severity: 'warning',
        title: 'Custom CSS line-height without mso-line-height-rule',
        detail: 'A Custom CSS rule sets line-height without mso-line-height-rule:exactly in the same rule — Classic Outlook\'s Word engine can add extra vertical spacing on top of the specified line-height.',
        fixType: 'none',
      });
    }

    // Sub-phase 6, item 6 — unsupported CSS/layout patterns. float,
    // position, and CSS flex/grid layout are not supported by the Word
    // rendering engine at all; this app's own generated HTML never emits
    // any of them (table-first throughout — see registryCore.ts), so this
    // can only fire from Custom CSS.
    const unsupportedLayoutPattern = /\b(float|position)\s*:|\bdisplay\s*:\s*(flex|grid|inline-flex|inline-grid)\b/i;
    if (unsupportedLayoutPattern.test(customCss)) {
      issues.push({
        id: 'outlook-classic:custom-css-unsupported-layout',
        category: 'outlook',
        severity: 'warning',
        title: 'Custom CSS uses a layout technique Word does not support',
        detail: 'Custom CSS contains float, position, or CSS flex/grid — Classic Outlook\'s Word rendering engine does not support any of these; content using them can collapse or misplace in Classic Outlook.',
        fixType: 'none',
      });
    }
  }

  // Sub-phase 6, items 8/9 (expanded in the Sub-phase 6 closure round) —
  // genuine VML-repair candidates: any module type vml.ts's manifest-driven
  // supportsVmlButtonPattern/supportsVmlBackgroundPattern recognizes as
  // VML-capable, carrying real content (an actual CTA href/text, or a real
  // background image src), that has not opted into the VML pattern yet.
  // extractCtaContents is a SHAPE-based duck-typed reader (never a
  // hardcoded per-module-type switch) — it covers every distinct prop
  // shape the 23 bulletproof-CTA-capable catalog files actually use
  // (button's own text/href, direct ctaText/ctaHref, cta-dual's secondary
  // pair, the composite modules' nested text.ctaText, and each product
  // item's own ctaText/ctaHref), so a future catalog module automatically
  // participates the moment it sets supportsBulletproofCta and uses one of
  // these already-common shapes — never a fifth hand-maintained list.
  if (content) {
    const visit = (modules: EmailModule[]) => {
      for (const module of modules) {
        if (module.props && module.settings && !module.settings.outlookVml) {
          if (supportsVmlBackgroundPattern(module.type as EmailModuleType)) {
            const props = module.props as { imageSrc?: string };
            if (props.imageSrc) {
              issues.push({
                id: `outlook-classic:background-image-needs-vml:${module.id}`,
                category: 'outlook',
                severity: 'warning',
                title: 'Background image has no Classic Outlook fallback',
                detail: 'This module sets a real background image but has not enabled the VML fallback — Classic Outlook\'s Word engine unreliably renders CSS background-image, so the image may not appear.',
                moduleId: module.id,
                fixType: 'safe',
                safeFix: { moduleId: module.id, settingsPatch: { outlookVml: true } },
              });
            }
          }
          if (supportsVmlButtonPattern(module.type as EmailModuleType) && ctaNeedsVmlFallback(module)) {
            issues.push({
              id: `outlook-classic:button-rounded-corners-need-vml:${module.id}`,
              category: 'outlook',
              severity: 'warning',
              title: 'Rounded button has no Classic Outlook fallback',
              detail: 'This module has a rounded CTA button but has not enabled the VML fallback — the Word rendering engine ignores CSS border-radius, so the button renders as a square in Classic Outlook.',
              moduleId: module.id,
              fixType: 'safe',
              safeFix: { moduleId: module.id, settingsPatch: { outlookVml: true } },
            });
          }
        }
        if (module.columns) {
          for (const column of module.columns) visit(column.modules);
        }
      }
    };
    visit(content.modules);

    // Sub-phase 6, item 9 — font fallback correctness (regression guard).
    // outlookCompatibility.ts's renderOutlookFontFallbackCss ALWAYS emits a
    // scoped [if mso] override for any module using a non-mso-safe font —
    // this can only fail via a renderer regression (every font in the
    // registry today is mso-safe, so this never fires against a real
    // document; see outlookCompatibility.test.ts's own synthetic-font
    // coverage for the mechanism itself).
    for (const { module } of flattenModules(content.modules)) {
      if (!module.props) continue;
      const fontId = (module.props as { fontFamily?: string }).fontFamily;
      if (fontId && !isMsoSafeFont(fontId)) {
        const className = moduleResponsiveClassName(module.id);
        if (!html.includes(`.${className}`) || !html.includes('font-family:') || !/\[if mso\]/.test(html)) {
          issues.push({
            id: `outlook-classic:font-fallback-missing:${module.id}`,
            category: 'outlook',
            severity: 'error',
            title: 'Missing Classic Outlook font fallback',
            detail: `Module "${module.id}" uses a font Classic Outlook may not render correctly, but no scoped [if mso] fallback override was found for it.`,
            moduleId: module.id,
            fixType: 'none',
          });
        }
      }
    }
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

  // renderVmlBackground (vmlBackground.ts) always places the caller's own
  // plain background HTML unconditionally OUTSIDE its two self-contained
  // downlevel-hidden VML comment blocks, so New Outlook (and every other
  // non-MSO client) already sees real background content — v:rect/v:fill
  // are never actionable in this renderer's own output. renderVmlButton
  // (vml.ts) always pairs a v:roundrect with a real HTML fallback wrapped
  // in the '<!--[if !mso]><!-->' downlevel-revealed marker; a v:roundrect
  // WITHOUT that matching marker is the one genuine "content relies only
  // on VML" case this renderer cannot itself produce (it can only reach a
  // document via raw HTML import) — so count the marker pairing instead
  // of assuming every '<v:' occurrence is unsafe, per the requirement
  // that a real HTML/CSS fallback downgrades/removes this warning rather
  // than firing unconditionally whenever VML is present at all.
  const buttonVmlCount = (html.match(/<v:roundrect/g) ?? []).length;
  const buttonFallbackCount = (html.match(/<!--\[if !mso\]><!-->/g) ?? []).length;
  if (buttonVmlCount > buttonFallbackCount) {
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
      detail: 'The document <title> is empty. Set an email title in Email Settings so browser tabs and some clients show a meaningful name.',
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
    ...checkOutlookCompatibility(html, content, documentSettings?.customCssEnabled, documentSettings?.customCss),
    ...checkNewOutlookCompatibility(html),
    ...checkResponsive(html, content),
    ...checkAccessibilityAndDarkMode(html, content),
    ...checkLinksAndImages(html, content),
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
