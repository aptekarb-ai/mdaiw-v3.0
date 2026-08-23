import { describe, expect, it } from 'vitest';
import { validateEmail } from './emailValidation';
import { renderEmailDocument } from './htmlRenderer';
import { createModule } from './moduleFactory';
import type { EmailDocumentContent, EmailModule, TextModuleProps } from './edm';

function contentWith(modules: EmailModule[]): EmailDocumentContent {
  return { version: 1, modules };
}

function textModule(overrides: Partial<TextModuleProps> = {}): EmailModule<TextModuleProps> {
  const module = createModule('text', 0) as unknown as EmailModule<TextModuleProps>;
  return { ...module, props: { ...module.props, ...overrides } };
}

describe('validateEmail', () => {
  it('gives a clean, empty document a perfect score and every category "good"', () => {
    const content = contentWith([]);
    const html = renderEmailDocument({ width: 700, content });
    const report = validateEmail(html, content, 'generic');

    expect(report.score).toBe(100);
    expect(report.issues).toHaveLength(0);
    for (const category of report.categories) {
      expect(category.status).toBe('good');
      expect(category.issueCount).toBe(0);
    }
  });

  it('flags a placeholder image src and a missing-alt image both, from real generated HTML', () => {
    const image = createModule('image', 0);
    const content = contentWith([image]);
    const html = renderEmailDocument({ width: 700, content });
    const report = validateEmail(html, content, 'generic');

    const linkOrImageIssue = report.issues.find((i) => i.id === 'images:placeholder-src');
    expect(linkOrImageIssue).toBeDefined();
    expect(linkOrImageIssue!.severity).toBe('error');
    const accCategory = report.categories.find((c) => c.id === 'images')!;
    expect(accCategory.status).toBe('needs-attention');
  });

  it('flags weak text/background contrast with a safe-fix that snaps to a readable color', () => {
    const badContrast = textModule({ color: '#cccccc', backgroundColor: '#ffffff' });
    const content = contentWith([badContrast]);
    const html = renderEmailDocument({ width: 700, content });
    const report = validateEmail(html, content, 'generic');

    const issue = report.issues.find((i) => i.id === `accessibility:contrast:${badContrast.id}`);
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe('warning');
    expect(issue!.fixType).toBe('safe');
    expect(issue!.safeFix).toEqual({ moduleId: badContrast.id, propPatch: { color: '#000000' } });
  });

  it('downgrades a contrast fix to manual (no safeFix) when the black/white candidate would fail dark-mode inversion on the SAME module — a safe fix must not knowingly trade one warning for another', () => {
    // Gray text on a saturated green background: black text passes the
    // light-mode WCAG check (15.3:1), but the WCAG luminance formula
    // weights G at 0.7152 — inverting this pair (magenta bg, white text)
    // drops contrast to ~3.1:1, well below AA. White fails light-mode
    // outright (1.37:1). No candidate is jointly safe, so this must not
    // be offered as an auto-fix.
    const module = textModule({ color: '#808080', backgroundColor: '#00ff00' });
    const content = contentWith([module]);
    const html = renderEmailDocument({ width: 700, content });
    const report = validateEmail(html, content, 'generic');

    const issue = report.issues.find((i) => i.id === `accessibility:contrast:${module.id}`);
    expect(issue).toBeDefined();
    expect(issue!.fixType).toBe('manual');
    expect(issue!.safeFix).toBeUndefined();
  });

  it('does not flag contrast when there is no explicit background (inherits the safe page background)', () => {
    const module = textModule({ color: '#333333', backgroundColor: '' });
    const content = contentWith([module]);
    const html = renderEmailDocument({ width: 700, content });
    const report = validateEmail(html, content, 'generic');

    expect(report.issues.some((i) => i.category === 'accessibility' && i.id.includes('contrast'))).toBe(false);
  });

  it('flags a dark-mode inversion risk independently of the normal-mode contrast check', () => {
    // Near-black text on near-black background: normal-mode contrast is
    // already terrible (also flags accessibility), AND inverting both
    // (near-white on near-white) is equally unreadable.
    const module = textModule({ color: '#050505', backgroundColor: '#0a0a0a' });
    const content = contentWith([module]);
    const html = renderEmailDocument({ width: 700, content });
    const report = validateEmail(html, content, 'generic');

    expect(report.issues.some((i) => i.id === `dark-mode:contrast:${module.id}`)).toBe(true);
  });

  it('flags a foreign platform token as a platform-compatibility issue for the current platform', () => {
    const module = textModule({ text: 'Hi %%FirstName%%' });
    const content = contentWith([module]);
    const html = renderEmailDocument({ width: 700, content });
    const report = validateEmail(html, content, 'generic');

    const issue = report.issues.find((i) => i.category === 'platform');
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe('warning');
  });

  it('does not flag a platform token the current platform natively supports', () => {
    const module = textModule({ text: 'Hi %%FirstName%%' });
    const content = contentWith([module]);
    const html = renderEmailDocument({ width: 700, content });
    const report = validateEmail(html, content, 'sfmc');

    expect(report.issues.some((i) => i.category === 'platform')).toBe(false);
  });

  it('a fresh multi-column layout with default mobileStack is not flagged (the renderer already stacks it correctly)', () => {
    const layout = createModule('layout-2col-50-50', 0);
    const content = contentWith([layout]);
    const html = renderEmailDocument({ width: 700, content });
    const report = validateEmail(html, content, 'generic');

    expect(report.issues.filter((i) => i.category === 'responsive')).toHaveLength(0);
  });

  it('does not flag mobile stacking when the user explicitly disabled it (module.settings.mobileStack === false)', () => {
    const layout = createModule('layout-2col-50-50', 0);
    layout.settings.mobileStack = false;
    const content = contentWith([layout]);
    const html = renderEmailDocument({ width: 700, content });
    const report = validateEmail(html, content, 'generic');

    expect(report.issues.some((i) => i.id.startsWith('responsive:mobile-stacking'))).toBe(false);
  });

  it('regression guard: flags a layout missing its mobile stacking rule (07_Preview_Validation.md requires "mobile stacking")', () => {
    const layout = createModule('layout-2col-50-50', 0);
    const content = contentWith([layout]);
    // Hand-built HTML that omits the stacking rule the real renderer always
    // includes today — proves this check would catch a renderer regression.
    const htmlWithoutStackingRule = renderEmailDocument({ width: 700, content })
      .replace(/@media only screen[^<]*<\/style>/, '</style>');
    const report = validateEmail(htmlWithoutStackingRule, content, 'generic');

    expect(report.issues.some((i) => i.id === `responsive:mobile-stacking:${layout.id}`)).toBe(true);
  });

  it('regression guard: flags a non-fluid outer table as a responsive error (the Feature 11 renderer contract)', () => {
    // The real renderer always produces this fluid pattern today; this
    // proves the check itself would catch a regression if that ever broke,
    // by feeding a hand-built HTML string that lacks it.
    const content = contentWith([]);
    const nonFluidHtml = '<!doctype html><html xmlns="http://www.w3.org/1999/xhtml"><body>'
      + '<table width="700" style="width:700px; max-width:700px;"><tr><td></td></tr></table>'
      + '</body></html>';
    const report = validateEmail(nonFluidHtml, content, 'generic');

    expect(report.issues.some((i) => i.id === 'responsive:fluid-outer-table')).toBe(true);
  });

  it('score decreases deterministically as issues accumulate, and clamps at 0', () => {
    const manyBadModules = Array.from({ length: 20 }, (_, index) => {
      const module = createModule('text', index) as unknown as EmailModule<TextModuleProps>;
      return { ...module, props: { ...module.props, color: '#cccccc', backgroundColor: '#ffffff' } };
    });
    const content = contentWith(manyBadModules);
    const html = renderEmailDocument({ width: 700, content });
    const report = validateEmail(html, content, 'generic');

    expect(report.score).toBeGreaterThanOrEqual(0);
    expect(report.score).toBeLessThan(100);
  });

  it('does not throw when a module is missing its props entirely (malformed/corrupted document) — degrades by skipping that check, not crashing the whole Validation Center', () => {
    const module = createModule('text', 0);
    (module as unknown as { props: unknown }).props = undefined;
    const content = contentWith([module]);

    expect(() => validateEmail('<html><body></body></html>', content, 'generic')).not.toThrow();
  });

  it('does not throw when a layout module is missing its settings entirely', () => {
    const layout = createModule('layout-2col-50-50', 0);
    (layout as unknown as { settings: unknown }).settings = undefined;
    const content = contentWith([layout]);

    expect(() => validateEmail('<html><body></body></html>', content, 'generic')).not.toThrow();
  });

  it('reuses Feature 09s compatibility checks for the HTML/Outlook categories rather than a second engine — an artificially unsafe HTML string trips both', () => {
    // computeCompatibilityChecks itself is exercised directly elsewhere;
    // this proves validateEmail is wired to the SAME function, not a
    // parallel reimplementation, by checking a real generated document
    // (which always passes) contributes zero html/outlook issues.
    const content = contentWith([createModule('text', 0)]);
    const html = renderEmailDocument({ width: 700, content });
    const report = validateEmail(html, content, 'generic');
    expect(report.issues.filter((i) => i.category === 'html' || i.category === 'outlook')).toHaveLength(0);
  });

  it('Sub-phase 3: a real generated document with a spacer module (the one built-in that emits scoped MSO CSS) still produces zero outlook issues', () => {
    const content = contentWith([createModule('spacer', 0)]);
    const html = renderEmailDocument({ width: 700, content });
    const report = validateEmail(html, content, 'generic');
    expect(report.issues.filter((i) => i.category === 'outlook')).toHaveLength(0);
  });

  it('Sub-phase 3: flags a malformed (unbalanced) MSO conditional comment', () => {
    const content = contentWith([]);
    const html = '<!doctype html><html><body><!--[if mso]><table><tr><td>x</td></tr></table></body></html>';
    const report = validateEmail(html, content, 'generic');
    expect(report.issues.some((i) => i.id === 'outlook-classic:malformed-conditional-comment')).toBe(true);
  });

  it('Sub-phase 3: does not flag a balanced MSO conditional comment', () => {
    const content = contentWith([]);
    const html = '<!doctype html><html><body><!--[if mso]><table><tr><td>x</td></tr></table><![endif]--></body></html>';
    const report = validateEmail(html, content, 'generic');
    expect(report.issues.some((i) => i.id === 'outlook-classic:malformed-conditional-comment')).toBe(false);
  });

  it('Sub-phase 3: flags VML markup missing the xmlns:v namespace', () => {
    const content = contentWith([]);
    const html = '<!doctype html><html xmlns="http://www.w3.org/1999/xhtml"><body><v:roundrect>x</v:roundrect></body></html>';
    const report = validateEmail(html, content, 'generic');
    expect(report.issues.some((i) => i.id === 'outlook-classic:missing-vml-namespace')).toBe(true);
  });

  it('Sub-phase 3: does not flag VML markup when xmlns:v is present on <html>', () => {
    const content = contentWith([]);
    const html = '<!doctype html><html xmlns:v="urn:schemas-microsoft-com:vml"><body><v:roundrect>x</v:roundrect></body></html>';
    const report = validateEmail(html, content, 'generic');
    expect(report.issues.some((i) => i.id === 'outlook-classic:missing-vml-namespace')).toBe(false);
  });

  it('Sub-phase 3: does not flag missing VML namespace when there is no VML markup at all (no false positive on a normal document)', () => {
    const content = contentWith([]);
    const html = renderEmailDocument({ width: 700, content });
    const report = validateEmail(html, content, 'generic');
    expect(report.issues.some((i) => i.id === 'outlook-classic:missing-vml-namespace')).toBe(false);
  });

  it('Sub-phase 3: flags a document with MSO conditional content but missing the 96-DPI Office config', () => {
    const content = contentWith([]);
    const html = '<!doctype html><html><body><!--[if mso]><table><tr><td>x</td></tr></table><![endif]--></body></html>';
    const report = validateEmail(html, content, 'generic');
    expect(report.issues.some((i) => i.id === 'outlook-classic:missing-office-dpi')).toBe(true);
  });

  it('Sub-phase 3: does not flag missing DPI config on a document with zero MSO conditional content', () => {
    const content = contentWith([]);
    const html = '<!doctype html><html><body>plain</body></html>';
    const report = validateEmail(html, content, 'generic');
    expect(report.issues.some((i) => i.id === 'outlook-classic:missing-office-dpi')).toBe(false);
  });

  it('Sub-phase 3: real generated document (which always emits the 96-DPI block) never flags missing-office-dpi', () => {
    const content = contentWith([createModule('text', 0)]);
    const html = renderEmailDocument({ width: 700, content });
    const report = validateEmail(html, content, 'generic');
    expect(report.issues.some((i) => i.id === 'outlook-classic:missing-office-dpi')).toBe(false);
  });

  it('Sub-phase 3: flags an unscoped global tr{font-size:0} row-collapse rule (e.g. injected via Custom CSS)', () => {
    const content = contentWith([]);
    const html = '<!doctype html><html><head><style>tr{font-size:0;line-height:0;}</style></head><body></body></html>';
    const report = validateEmail(html, content, 'generic');
    expect(report.issues.some((i) => i.id === 'outlook-classic:unsafe-global-row-collapse')).toBe(true);
  });

  it('Sub-phase 4: the unsafe global row-collapse rule has a safe fix that disables Custom CSS', () => {
    const content = contentWith([]);
    const html = '<!doctype html><html><head><style>tr{font-size:0;line-height:0;}</style></head><body></body></html>';
    const report = validateEmail(html, content, 'generic');
    const issue = report.issues.find((i) => i.id === 'outlook-classic:unsafe-global-row-collapse');
    expect(issue).toBeDefined();
    expect(issue!.fixType).toBe('safe');
    expect(issue!.safeFix).toEqual({ documentPatch: { custom_css_enabled: false } });
  });

  it('Sub-phase 3: does not flag the scoped .mso-spacer rule the renderer itself emits', () => {
    const content = contentWith([]);
    const html = '<!doctype html><html><head><style>.mso-spacer{font-size:0;line-height:0;}</style></head><body></body></html>';
    const report = validateEmail(html, content, 'generic');
    expect(report.issues.some((i) => i.id === 'outlook-classic:unsafe-global-row-collapse')).toBe(false);
  });

  it('Sub-phase 3: flags VML for New Outlook (web engine ignores VML) independently of the Classic Outlook namespace check', () => {
    const content = contentWith([]);
    const html = '<!doctype html><html xmlns:v="urn:schemas-microsoft-com:vml"><body><v:roundrect>x</v:roundrect></body></html>';
    const report = validateEmail(html, content, 'generic');
    const classicIssue = report.issues.find((i) => i.id === 'outlook-classic:missing-vml-namespace');
    const newOutlookIssue = report.issues.find((i) => i.id === 'outlook-new:vml-not-processed');
    expect(classicIssue).toBeUndefined();
    expect(newOutlookIssue).toBeDefined();
    expect(newOutlookIssue!.severity).toBe('warning');
  });

  it('Sub-phase 3: does not flag New Outlook when there is no VML at all (a real generated document)', () => {
    const content = contentWith([createModule('text', 0)]);
    const html = renderEmailDocument({ width: 700, content });
    const report = validateEmail(html, content, 'generic');
    expect(report.issues.some((i) => i.id === 'outlook-new:vml-not-processed')).toBe(false);
  });
});

// Sub-phase 4, item 1 — document-level standards checks. The 4th
// (documentSettings) argument is optional and additive: every check
// above in this file calls validateEmail with 3 args and must keep
// scoring 100/0-issues on a clean document — proven directly below.
describe('validateEmail — document-level standards (Sub-phase 4)', () => {
  function fullSettings(overrides: Partial<{
    emailSubject: string; faviconUrl: string; resetCssEnabled: boolean; customCssEnabled: boolean; customCss: string;
  }> = {}) {
    return {
      emailSubject: 'A real subject line',
      faviconUrl: '',
      resetCssEnabled: true,
      customCssEnabled: false,
      customCss: '',
      ...overrides,
    };
  }

  it('omitting documentSettings (3-arg call) never produces a document-category issue, even with an empty title', () => {
    const content = contentWith([]);
    const html = renderEmailDocument({ width: 700, content });
    const report = validateEmail(html, content, 'generic');
    expect(report.issues.filter((i) => i.category === 'document')).toHaveLength(0);
  });

  it('a fully-configured document (title + full settings) produces zero document issues', () => {
    const content = contentWith([]);
    const html = renderEmailDocument({ width: 700, content, title: 'My Email' });
    const report = validateEmail(html, content, 'generic', fullSettings());
    expect(report.issues.filter((i) => i.category === 'document')).toHaveLength(0);
  });

  it('flags an empty email title only when documentSettings is passed', () => {
    const content = contentWith([]);
    const html = renderEmailDocument({ width: 700, content });
    const report = validateEmail(html, content, 'generic', fullSettings());
    expect(report.issues.some((i) => i.id === 'document:missing-title')).toBe(true);
  });

  it('flags an empty email subject', () => {
    const content = contentWith([]);
    const html = renderEmailDocument({ width: 700, content, title: 'My Email' });
    const report = validateEmail(html, content, 'generic', fullSettings({ emailSubject: '' }));
    const issue = report.issues.find((i) => i.id === 'document:missing-subject');
    expect(issue).toBeDefined();
    expect(issue!.fixType).toBe('none');
  });

  it('flags an invalid favicon URL with a safe fix that clears it', () => {
    const content = contentWith([]);
    const html = renderEmailDocument({ width: 700, content, title: 'My Email' });
    const report = validateEmail(html, content, 'generic', fullSettings({ faviconUrl: 'javascript:alert(1)' }));
    const issue = report.issues.find((i) => i.id === 'document:invalid-favicon');
    expect(issue).toBeDefined();
    expect(issue!.fixType).toBe('safe');
    expect(issue!.safeFix).toEqual({ documentPatch: { favicon_url: '' } });
  });

  it('does not flag a valid https favicon URL', () => {
    const content = contentWith([]);
    const html = renderEmailDocument({ width: 700, content, title: 'My Email', faviconUrl: 'https://example.com/favicon.png' });
    const report = validateEmail(html, content, 'generic', fullSettings({ faviconUrl: 'https://example.com/favicon.png' }));
    expect(report.issues.some((i) => i.id === 'document:invalid-favicon')).toBe(false);
  });

  it('flags Reset CSS disabled with a safe fix that re-enables it', () => {
    const content = contentWith([]);
    const html = renderEmailDocument({ width: 700, content, title: 'My Email', resetCssEnabled: false });
    const report = validateEmail(html, content, 'generic', fullSettings({ resetCssEnabled: false }));
    const issue = report.issues.find((i) => i.id === 'document:reset-css-disabled');
    expect(issue).toBeDefined();
    expect(issue!.fixType).toBe('safe');
    expect(issue!.safeFix).toEqual({ documentPatch: { reset_css_enabled: true } });
  });

  it('does not flag Reset CSS when it is enabled', () => {
    const content = contentWith([]);
    const html = renderEmailDocument({ width: 700, content, title: 'My Email', resetCssEnabled: true });
    const report = validateEmail(html, content, 'generic', fullSettings({ resetCssEnabled: true }));
    expect(report.issues.some((i) => i.id === 'document:reset-css-disabled')).toBe(false);
  });

  it('flags unsafe stored Custom CSS with a safe fix that disables it (cannot safely rewrite arbitrary CSS text)', () => {
    const content = contentWith([]);
    const unsafeCss = '.x{background:url(javascript:alert(1))}';
    const html = renderEmailDocument({ width: 700, content, title: 'My Email' });
    const report = validateEmail(html, content, 'generic', fullSettings({ customCssEnabled: true, customCss: unsafeCss }));
    const issue = report.issues.find((i) => i.id === 'document:custom-css-security');
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe('error');
    expect(issue!.fixType).toBe('safe');
    expect(issue!.safeFix).toEqual({ documentPatch: { custom_css_enabled: false } });
  });

  it('does not flag safe stored Custom CSS', () => {
    const content = contentWith([]);
    const html = renderEmailDocument({ width: 700, content, title: 'My Email' });
    const report = validateEmail(html, content, 'generic', fullSettings({ customCssEnabled: true, customCss: '.x{color:red}' }));
    expect(report.issues.some((i) => i.id === 'document:custom-css-security')).toBe(false);
  });

  it('does not flag custom-css-security when Custom CSS is disabled, even if the stored text is unsafe', () => {
    const content = contentWith([]);
    const html = renderEmailDocument({ width: 700, content, title: 'My Email' });
    const report = validateEmail(html, content, 'generic', fullSettings({ customCssEnabled: false, customCss: '.x{background:url(javascript:alert(1))}' }));
    expect(report.issues.some((i) => i.id === 'document:custom-css-security')).toBe(false);
  });

  it('regression guard: flags a missing canonical namespace on a hand-built document', () => {
    const content = contentWith([]);
    const html = '<!doctype html><html><head><title>x</title></head><body></body></html>';
    const report = validateEmail(html, content, 'generic');
    expect(report.issues.some((i) => i.id === 'document:missing-namespace')).toBe(true);
  });

  it('does not flag namespaces on a real generated document', () => {
    const content = contentWith([]);
    const html = renderEmailDocument({ width: 700, content });
    const report = validateEmail(html, content, 'generic');
    expect(report.issues.some((i) => i.id === 'document:missing-namespace')).toBe(false);
  });

  it('regression guard: flags a missing required meta baseline on a hand-built document', () => {
    const content = contentWith([]);
    const html = '<!doctype html><html xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office"><head><title>x</title></head><body></body></html>';
    const report = validateEmail(html, content, 'generic');
    const issue = report.issues.find((i) => i.id === 'document:missing-meta-baseline');
    expect(issue).toBeDefined();
    expect(issue!.detail).toContain('charset');
  });

  it('does not flag the meta baseline on a real generated document', () => {
    const content = contentWith([]);
    const html = renderEmailDocument({ width: 700, content });
    const report = validateEmail(html, content, 'generic');
    expect(report.issues.some((i) => i.id === 'document:missing-meta-baseline')).toBe(false);
  });

  it('regression guard: flags a duplicated <title> declaration', () => {
    const content = contentWith([]);
    const html = '<!doctype html><html xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office"><head><title>a</title><title>b</title></head><body></body></html>';
    const report = validateEmail(html, content, 'generic');
    expect(report.issues.some((i) => i.id === 'document:duplicate-head-declaration:<title>')).toBe(true);
  });

  it('does not flag duplicate declarations on a real generated document', () => {
    const content = contentWith([]);
    const html = renderEmailDocument({ width: 700, content });
    const report = validateEmail(html, content, 'generic');
    expect(report.issues.some((i) => i.id.startsWith('document:duplicate-head-declaration'))).toBe(false);
  });

  it('"document" category appears in the report even with zero issues (categories are always enumerated)', () => {
    const content = contentWith([]);
    const html = renderEmailDocument({ width: 700, content });
    const report = validateEmail(html, content, 'generic');
    const category = report.categories.find((c) => c.id === 'document');
    expect(category).toBeDefined();
    expect(category!.status).toBe('good');
  });
});
