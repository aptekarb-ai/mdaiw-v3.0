// Email Document Standards Sub-phase 3 — Classic Outlook (Word rendering
// engine) compatibility. Everything here targets Classic Outlook
// SPECIFICALLY (conditional comments like `[if mso]`/`[if gte mso 9]`,
// VML/Office XML namespaces) — New Outlook renders with a completely
// different (Chromium-based webview) engine that does not honor MSO
// conditional comments at all, so nothing in this file "fixes" New
// Outlook, and nothing here is ever claimed to. See
// emailClientCapabilities.ts's OutlookAffinity type, which keeps the two
// families distinct throughout the Validation/Knowledge system —
// 'outlook-word' (Classic) vs 'outlook-webview' (New Outlook).
//
// VML readiness (item 6): this phase does NOT generate actual VML markup
// (no bulletproof-button VML, no VML background repair) — the
// xmlns:v/xmlns:o namespaces were already added to <html> in Sub-phase 1
// so the document is READY for a later Feature 14 V2 repair phase to
// emit real VML, but nothing here fabricates unverified VML today.
import type { EmailDocumentContent, EmailModule } from './edm';
import { moduleResponsiveClassName } from './registryCore';
import { isMsoSafeFont, msoFallbackStackFor } from './fonts';

// --- 1. Office settings block (item 1) ----------------------------------
//
// `[if gte mso 9]` (Office 2000+ / Word 9+) rather than the older bare
// `[if mso]` — OfficeDocumentSettings/o:AllowPNG/o:PixelsPerInch are
// genuinely Office-9-and-later constructs; using the narrower conditional
// is more accurate than the common but looser copy-pasted `[if mso]`.
// Always emitted (like the VML/Office <html> namespaces) — it is a
// baseline compatibility setting (96 DPI image scaling, PNG alpha
// support), not tied to whether this particular document happens to use
// any specific module.
export function renderOutlookOfficeSettingsBlock(): string {
  return (
    '<!--[if gte mso 9]>\n'
    + '<xml>\n'
    + '<o:OfficeDocumentSettings>\n'
    + '<o:AllowPNG/>\n'
    + '<o:PixelsPerInch>96</o:PixelsPerInch>\n'
    + '</o:OfficeDocumentSettings>\n'
    + '</xml>\n'
    + '<![endif]-->\n'
  );
}

// --- 2. Scoped Outlook spacer-row treatment (item 2) --------------------
//
// NEVER a global `tr { font-size:0; line-height:0; }` rule — that would
// zero out every content row's text too. Instead: the Spacer module's own
// <td> (see catalog/basicCatalog.tsx's spacerDefinition) carries this
// exact class, and ONLY this class gets the MSO-only zero-metrics
// treatment. Every other module's own class (m-eb-<id>, from
// moduleResponsiveClassName) never appears here, so text/button/image/
// header/footer/multi-column rows are structurally unreachable by this
// rule — proven in outlookCompatibility.test.ts, not just asserted here.
export const MSO_SPACER_ROW_CLASS = 'mso-spacer';

function contentHasSpacerModule(content: EmailDocumentContent): boolean {
  const hasSpacer = (modules: EmailModule[]): boolean => modules.some((module) => {
    if (module.type === 'spacer') return true;
    if (module.columns) {
      return module.columns.some((column) => hasSpacer(column.modules));
    }
    return false;
  });
  return hasSpacer(content.modules);
}

export function renderOutlookSpacerRowCss(content: EmailDocumentContent): string {
  if (!contentHasSpacerModule(content)) return '';
  return (
    '<!--[if mso]>\n'
    + '<style type="text/css">\n'
    + `.${MSO_SPACER_ROW_CLASS} { font-size: 0 !important; line-height: 0 !important; mso-line-height-rule: exactly; }\n`
    + '</style>\n'
    + '<![endif]-->\n'
  );
}

// --- 3. Outlook font fallback (item 3) -----------------------------------
//
// Scoped per MODULE INSTANCE (via its existing m-eb-<id> responsive
// class — the same one Feature 07's responsive CSS already targets),
// never a blanket `* { font-family: Arial !important; }`. A module is
// only touched when it actually uses a font flagged !mso-safe in
// fonts.ts — every font in the registry today IS mso-safe (all are
// genuine Windows-native fonts Word already renders correctly), so in
// PRACTICE this returns '' for every real document today. The mechanism
// itself has direct unit coverage (outlookCompatibility.test.ts) via a
// synthetic non-mso-safe font id, proving it works without needing a
// fabricated web-font entry in the live picker.
function collectFontFamilyIds(props: unknown, found: Set<string>): void {
  if (!props || typeof props !== 'object') return;
  for (const [key, value] of Object.entries(props as Record<string, unknown>)) {
    if (key === 'fontFamily' && typeof value === 'string') {
      found.add(value);
    } else if (value && typeof value === 'object') {
      collectFontFamilyIds(value, found);
    }
  }
}

function collectMsoFontOverrides(content: EmailDocumentContent): Map<string, string> {
  const overrides = new Map<string, string>();
  const visit = (modules: EmailModule[]) => {
    for (const module of modules) {
      const fontIds = new Set<string>();
      collectFontFamilyIds(module.props, fontIds);
      const unsafeId = [...fontIds].find((id) => !isMsoSafeFont(id));
      if (unsafeId !== undefined) {
        overrides.set(moduleResponsiveClassName(module.id), msoFallbackStackFor(unsafeId));
      }
      if (module.columns) {
        for (const column of module.columns) visit(column.modules);
      }
    }
  };
  visit(content.modules);
  return overrides;
}

export function renderOutlookFontFallbackCss(content: EmailDocumentContent): string {
  const overrides = collectMsoFontOverrides(content);
  if (overrides.size === 0) return '';
  const rules = [...overrides.entries()]
    .map(([className, stack]) => `.${className} { font-family: ${stack} !important; }`)
    .join('\n');
  return (
    '<!--[if mso]>\n'
    + '<style type="text/css">\n'
    + `${rules}\n`
    + '</style>\n'
    + '<![endif]-->\n'
  );
}
