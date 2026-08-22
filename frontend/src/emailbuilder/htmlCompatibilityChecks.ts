// Feature 09, operation 7 ("Validation markers") — the four status chips
// from the Code Editor reference (HTML Valid / Inline CSS / No DIV Usage /
// Outlook Safe). Computed live from the ALREADY-generated HTML on every
// render (it's a pure function of a string), never a separate validation
// pass — these mirror the exact same structural rules
// htmlRenderer.test.ts asserts on the renderer's own output, just
// surfaced as user-visible feedback instead of only a test assertion.
export interface CompatibilityCheck {
  id: 'html-valid' | 'inline-css' | 'no-div' | 'outlook-safe';
  label: string;
  ok: boolean;
  detail: string;
}

function isWellFormed(html: string): boolean {
  if (typeof DOMParser === 'undefined') return true;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return doc.querySelector('parsererror') === null;
}

export function computeCompatibilityChecks(html: string): CompatibilityCheck[] {
  const hasExternalStylesheet = /<link[^>]+rel=["']?stylesheet/i.test(html);
  const hasStructuralDiv = /<div[\s>]/i.test(html);
  const hasFlexOrGrid = /display\s*:\s*(flex|grid)/i.test(html);
  const hasScript = /<script[\s>]/i.test(html);
  const hasXhtmlNamespace = /<html[^>]+xmlns=/i.test(html);

  return [
    {
      id: 'html-valid',
      label: 'HTML Valid',
      ok: isWellFormed(html),
      detail: 'Markup parses as well-formed HTML.',
    },
    {
      id: 'inline-css',
      label: 'Inline CSS',
      ok: !hasExternalStylesheet,
      detail: hasExternalStylesheet
        ? 'An external stylesheet link was found — email clients strip these.'
        : 'Styles are inlined or in the one responsive <style> block; no external stylesheet.',
    },
    {
      id: 'no-div',
      label: 'No DIV Usage',
      ok: !hasStructuralDiv,
      detail: hasStructuralDiv
        ? 'Structural <div> tags found — table/tr/td is required for email-client compatibility.'
        : 'Table-first markup throughout — zero structural <div> tags.',
    },
    {
      id: 'outlook-safe',
      label: 'Outlook Safe',
      ok: !hasFlexOrGrid && !hasScript && hasXhtmlNamespace,
      detail: !hasXhtmlNamespace
        ? 'Missing the XHTML namespace Outlook\'s Word rendering engine expects.'
        : hasFlexOrGrid
          ? 'display:flex/grid found — Outlook\'s Word engine does not support these.'
          : hasScript
            ? '<script> tags found — most clients strip or block scripted email.'
            : 'Table-based layout, no flex/grid, no scripts — safe for Outlook\'s Word engine.',
    },
  ];
}
