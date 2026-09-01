import { analyzeImportedHtml } from './htmlImportAnalysis';
import { buildFidelityReport } from './htmlImportFidelity';
import { mapImportedHtml } from './htmlImportMapper';
import { buildReconstructionReview } from './reconstructionReview';

// R4-C11 — shared fixture builders + the one pipeline-runner every
// acceptance-matrix test reuses, so 20 scenario classes never mean 20
// hand-rolled copies of "parse -> analyze -> map -> fidelity -> review."
// Every fixture here is a REAL, realistic email-authoring pattern (real
// marketing-email table structure, real inline styles) — never a
// synthetic string built solely to hit a code branch.

export function parseHtml(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

export function freshReconstruction(html: string, widthPx = 600) {
  const doc = parseHtml(html);
  const structure = analyzeImportedHtml(doc, widthPx);
  const mapping = mapImportedHtml(doc);
  const fidelity = buildFidelityReport(doc, structure, mapping);
  const review = buildReconstructionReview(doc, structure, fidelity, mapping.modules);
  return { doc, structure, mapping, fidelity, review };
}

// 1. Simple marketing email — one heading, one paragraph, one CTA. The
// smallest realistic "someone forwarded me an email export" case.
export const SIMPLE_MARKETING_EMAIL_HTML = `<table role="presentation" width="600" cellpadding="0" cellspacing="0"><tr><td>
  <h1 style="color:#002d38;">Big News</h1>
  <p style="font-size:15px; color:#333333;">We just launched something new. Take a look.</p>
  <a href="https://example.com/learn-more" style="background-color:#0082ad; color:#ffffff; padding:12px 24px 12px 24px;">Learn More</a>
</td></tr></table>`;

// 2. Logo + navigation header.
export const LOGO_NAV_HEADER_HTML = `<table role="presentation" width="600" cellpadding="0" cellspacing="0"><tr>
  <td width="200"><img src="https://example.com/logo.png" alt="Acme Co" width="140"></td>
  <td width="400" align="right">
    <a href="https://example.com/shop">Shop</a>
    <a href="https://example.com/about">About</a>
    <a href="https://example.com/contact">Contact</a>
  </td>
</tr></table>`;

// 3. Hero/banner — full-width image at the top.
export const HERO_BANNER_HTML = `<table role="presentation" width="600" cellpadding="0" cellspacing="0"><tr><td>
  <img src="https://example.com/hero-banner.png" alt="Summer Sale" width="600">
</td></tr></table>`;

// 4. Text + CTA, standalone (distinct from the button-only RECON_HTML
// fixture used elsewhere — this pairs a paragraph with the button).
export const TEXT_PLUS_CTA_HTML = `<table role="presentation" width="600" cellpadding="0" cellspacing="0"><tr><td>
  <p style="font-size:16px; color:#333333;">Save 20% this week only.</p>
  <a href="https://example.com/shop-now" style="background-color:#76c043; color:#ffffff; padding:14px 28px 14px 28px;">Shop Now</a>
</td></tr></table>`;

// 5. 2-column.
export const TWO_COLUMN_HTML = `<table role="presentation" width="600" cellpadding="0" cellspacing="0"><tr>
  <td width="50%"><p>Left column content.</p></td>
  <td width="50%"><p>Right column content.</p></td>
</tr></table>`;

// 6. 3-column.
export const THREE_COLUMN_HTML = `<table role="presentation" width="600" cellpadding="0" cellspacing="0"><tr>
  <td width="33%"><p>Column one.</p></td>
  <td width="33%"><p>Column two.</p></td>
  <td width="34%"><p>Column three.</p></td>
</tr></table>`;

// 7. Asymmetric SUPPORTED ratio — 30/70 is one of layoutModel.ts's own
// LAYOUT_COLUMN_COUNTS presets (layout-2col-30-70), unlike the
// deliberately-unsupported 5-way uneven split used elsewhere.
export const ASYMMETRIC_SUPPORTED_RATIO_HTML = `<table role="presentation" width="600" cellpadding="0" cellspacing="0"><tr>
  <td width="30%"><img src="https://example.com/thumb.png" alt="Product" width="160"></td>
  <td width="70%"><p>Product description goes here, in the wider column.</p></td>
</tr></table>`;

// 8. Unsupported arbitrary ratio — no matching layout preset.
export const UNSUPPORTED_RATIO_HTML = '<table><tr>'
  + '<td width="10%"><p>A</p></td><td width="15%"><p>B</p></td><td width="20%"><p>C</p></td>'
  + '<td width="25%"><p>D</p></td><td width="30%"><p>E</p></td>'
  + '</tr></table>';

// 9. Deeply nested tables (beyond the one-level EDM column limit).
export const NESTED_TABLES_HTML = '<table><tr><td>'
  + '<table><tr><td>'
  + '<table><tr><td><p>Deeply nested content</p></td></tr></table>'
  + '</td></tr></table>'
  + '</td></tr></table>';

// 10. Spacer/gutter-heavy email — multiple explicit spacer rows plus a
// gutter cell between two content columns (a real pattern: a thin empty
// <td> used as a manual gutter, which the mapper's own gutter-detection
// is expected to fold into column spacing rather than a phantom column).
export const SPACER_GUTTER_HEAVY_HTML = `<table role="presentation" width="600" cellpadding="0" cellspacing="0">
  <tr><td style="height:24px; line-height:24px; font-size:1px;">&nbsp;</td></tr>
  <tr>
    <td width="280"><p>Left content.</p></td>
    <td width="20">&nbsp;</td>
    <td width="280"><p>Right content.</p></td>
  </tr>
  <tr><td style="height:32px; line-height:32px; font-size:1px;">&nbsp;</td></tr>
</table>`;

// 11. Background colors — row-level and module-level.
export const BACKGROUND_COLOR_HTML = `<table role="presentation" width="600" cellpadding="0" cellspacing="0">
  <tr style="background-color:#002d38;"><td><p style="color:#ffffff;">Dark banner text.</p></td></tr>
  <tr><td><p>Normal row.</p></td></tr>
</table>`;

// 12. Background images — a table cell with a background image
// (a real, common pre-2020 email-authoring pattern: `background=` attr
// + a matching CSS background-image for clients that honor it).
export const BACKGROUND_IMAGE_HTML = `<table role="presentation" width="600" cellpadding="0" cellspacing="0"><tr>
  <td background="https://example.com/bg-texture.png" style="background-image:url('https://example.com/bg-texture.png'); background-color:#f4f6f8;">
    <p style="color:#002d38;">Content over a background image.</p>
  </td>
</tr></table>`;

// 13. Rich typography — heading vs paragraph, varied font sizes,
// weights, colors, and alignment all in one fixture.
export const RICH_TYPOGRAPHY_HTML = `<table role="presentation" width="600" cellpadding="0" cellspacing="0"><tr><td>
  <h1 style="color:#002d38; font-size:32px;">Main Heading</h1>
  <h2 style="color:#0082ad; font-size:22px;">Subheading</h2>
  <p style="font-size:16px; color:#333333; font-weight:700;">Bold intro paragraph.</p>
  <p style="font-size:13px; color:#666666; text-align:center;">Centered fine print.</p>
</td></tr></table>`;

// 14. Outlook/VML opportunity — any button with a rounded corner (the
// default button style already has one) triggers this class; a
// dedicated single-button fixture makes the acceptance test explicit
// rather than relying on it as a side effect of an unrelated fixture.
export const OUTLOOK_VML_OPPORTUNITY_HTML = '<table><tr><td align="center">'
  + '<a href="https://example.com/go" style="background-color:#76c043;color:#fff;padding:14px 28px 14px 28px;border-radius:6px;">Go</a>'
  + '</td></tr></table>';

// 15. Footer / unsubscribe / privacy.
export const FOOTER_UNSUBSCRIBE_PRIVACY_HTML = `<table role="presentation" width="600" cellpadding="0" cellspacing="0">
  <tr><td><p>Main content.</p></td></tr>
  <tr style="background-color:#002d38;"><td>
    <p style="color:#ffffff;">Acme Co, Inc. — Copyright 2026.</p>
    <a href="https://example.com/unsubscribe" style="color:#ffffff;">Unsubscribe</a>
    <a href="https://example.com/privacy" style="color:#ffffff;">Privacy Policy</a>
  </td></tr>
</table>`;

// 16. Broken image — src with no scheme survives sanitization as
// unsafe/unresolvable, and an image with no alt text at all.
export const BROKEN_IMAGE_HTML = '<table><tr><td>'
  + '<img src="images/missing.png" alt="">'
  + '</td></tr></table>';

// 17. Placeholder links — bare "#" hrefs (neither a safe absolute URL
// nor a real fragment target — see htmlImportSanitize.ts's own
// isFragmentHref: "#".length is not > 1).
export const PLACEHOLDER_LINKS_HTML = '<table><tr><td>'
  + '<a href="#" style="background-color:#76c043;color:#fff;padding:12px 24px 12px 24px;">Click Here</a>'
  + '</td></tr></table>';

// 18. Unsafe script/event handlers — see
// reconstructionCorrectionLoop.integration.test.ts's own dedicated
// security describe block for the full assertion suite; this constant
// is re-exported here so the acceptance-matrix file can cite the exact
// same fixture without redefining it.
export const UNSAFE_CONTENT_HTML = '<table><tr><td>'
  + '<script>alert(1)</script>'
  + '<img src="x.png" onerror="alert(1)" alt="Evil">'
  + '<a href="javascript:alert(1)" style="background-color:#76c043;color:#fff;padding:12px 24px 12px 24px;">Click</a>'
  + '<iframe src="https://evil.example.com"></iframe>'
  + '<p onclick="alert(1)">Text</p>'
  + '</td></tr></table>';

// 19. Malformed but recoverable HTML.
export const MALFORMED_RECOVERABLE_HTML = '<table><tr><td><p>Unclosed paragraph<td><p>Another cell</table>';

// 20. Realistic full newsletter — see
// reconstructionCorrectionLoop.integration.test.ts's own
// REALISTIC_NEWSLETTER_HTML (logo+nav header, hero image, heading+
// paragraph+CTA, 3-column feature row, footer/unsubscribe/privacy, all
// in one document) — not re-exported here to avoid two names for the
// same fixture; cited by file+constant name in the acceptance matrix
// instead.
