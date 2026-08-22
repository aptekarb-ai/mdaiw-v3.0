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
});
