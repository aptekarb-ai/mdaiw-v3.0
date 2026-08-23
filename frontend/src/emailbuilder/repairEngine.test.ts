import { describe, expect, it } from 'vitest';
import { affectedClientLabel, buildRepairCandidates, signatureForIssueId, toApplyRepairPatchArgs } from './repairEngine';
import { validateEmail } from './emailValidation';
import { renderEmailDocument } from './htmlRenderer';
import { createModule } from './moduleFactory';
import { EMPTY_DOCUMENT_SETTINGS } from './useEmailBuilderState';
import type { EmailDocumentContent, EmailModule, TextModuleProps } from './edm';

function contentWith(modules: EmailModule[]): EmailDocumentContent {
  return { version: 1, modules };
}

describe('affectedClientLabel', () => {
  it('labels outlook-classic: issues as Classic Outlook', () => {
    expect(affectedClientLabel('outlook-classic:missing-office-dpi')).toBe('Classic Outlook');
  });

  it('labels outlook-new: issues as New Outlook (web engine)', () => {
    expect(affectedClientLabel('outlook-new:vml-not-processed')).toBe('New Outlook (web engine)');
  });

  it('labels every other issue id as All email clients', () => {
    expect(affectedClientLabel('document:reset-css-disabled')).toBe('All email clients');
    expect(affectedClientLabel('accessibility:contrast:abc')).toBe('All email clients');
  });
});

// Sub-phase 8 — this is the ONE place a learning signature is derived
// from an issue id; both ValidationCenterPanel and AIEngineerPanel import
// it rather than re-deriving the stable prefix themselves.
describe('signatureForIssueId', () => {
  it('strips the trailing per-instance segment from a 3-part issue id', () => {
    expect(signatureForIssueId('accessibility:contrast:module-abc123')).toBe('accessibility:contrast');
  });

  it('strips only the trailing segment, keeping category:rule-slug for an outlook-prefixed id', () => {
    expect(signatureForIssueId('outlook-classic:button-rounded-corners-need-vml:module-xyz')).toBe(
      'outlook-classic:button-rounded-corners-need-vml',
    );
  });

  it('leaves an already-stable 2-segment id (no instance suffix) unchanged', () => {
    expect(signatureForIssueId('document:reset-css-disabled')).toBe('document:reset-css-disabled');
  });

  it('leaves a bare 1-segment id unchanged rather than truncating it', () => {
    expect(signatureForIssueId('no-colons-here')).toBe('no-colons-here');
  });

  it('two different instances of the same issue type collapse to the same signature', () => {
    const a = signatureForIssueId('accessibility:contrast:module-1');
    const b = signatureForIssueId('accessibility:contrast:module-2');
    expect(a).toBe(b);
  });
});

describe('buildRepairCandidates', () => {
  it('produces zero candidates for a clean, fully-configured document', () => {
    const content = contentWith([]);
    const html = renderEmailDocument({ width: 700, content, title: 'My Email' });
    const settings = { ...EMPTY_DOCUMENT_SETTINGS, email_subject: 'A subject' };
    const report = validateEmail(html, content, 'generic', {
      emailSubject: settings.email_subject, faviconUrl: settings.favicon_url,
      resetCssEnabled: settings.reset_css_enabled, customCssEnabled: settings.custom_css_enabled,
      customCss: settings.custom_css,
    });
    expect(buildRepairCandidates(report, content.modules, settings)).toHaveLength(0);
  });

  it('builds a document-scope candidate for Reset CSS disabled, with the real current/proposed values', () => {
    const content = contentWith([]);
    const settings = { ...EMPTY_DOCUMENT_SETTINGS, email_subject: 'x', email_title: 'x', reset_css_enabled: false };
    const html = renderEmailDocument({ width: 700, content, title: settings.email_title, resetCssEnabled: false });
    const report = validateEmail(html, content, 'generic', {
      emailSubject: settings.email_subject, faviconUrl: settings.favicon_url,
      resetCssEnabled: false, customCssEnabled: settings.custom_css_enabled, customCss: settings.custom_css,
    });
    const candidates = buildRepairCandidates(report, content.modules, settings);
    const candidate = candidates.find((c) => c.issueId === 'document:reset-css-disabled');
    expect(candidate).toBeDefined();
    expect(candidate!.before).toBe('Disabled');
    expect(candidate!.after).toBe('Enabled');
    expect(candidate!.affectedClient).toBe('All email clients');
    expect(candidate!.safeAutoFix).toBe(true);
    expect(candidate!.confidence).toBe(1.0);
    expect(candidate!.item).toEqual({
      kind: 'document', issueId: 'document:reset-css-disabled', documentPatch: { reset_css_enabled: true },
    });
  });

  it('builds a module-scope candidate for weak contrast, reading the real current color as "before"', () => {
    const module = createModule('text', 0) as unknown as EmailModule<TextModuleProps>;
    const badContrast: EmailModule<TextModuleProps> = { ...module, props: { ...module.props, color: '#cccccc', backgroundColor: '#ffffff' } };
    const content = contentWith([badContrast]);
    const settings = { ...EMPTY_DOCUMENT_SETTINGS, email_subject: 'x', email_title: 'x' };
    const html = renderEmailDocument({ width: 700, content, title: settings.email_title });
    const report = validateEmail(html, content, 'generic', {
      emailSubject: settings.email_subject, faviconUrl: settings.favicon_url,
      resetCssEnabled: settings.reset_css_enabled, customCssEnabled: settings.custom_css_enabled, customCss: settings.custom_css,
    });
    const candidates = buildRepairCandidates(report, content.modules, settings);
    const candidate = candidates.find((c) => c.issueId === `accessibility:contrast:${badContrast.id}`);
    expect(candidate).toBeDefined();
    expect(candidate!.before).toBe('#cccccc');
    expect(candidate!.after).toBe('#000000');
    expect(candidate!.moduleId).toBe(badContrast.id);
  });

  it('Sub-phase 6: builds a module-SETTINGS-scope candidate for a rounded button needing VML, reading real "before"', () => {
    const module = createModule('button', 0);
    (module as EmailModule<{ borderRadius: number }>).props = { ...(module.props as { borderRadius: number }), borderRadius: 12 };
    const content = contentWith([module]);
    const settings = { ...EMPTY_DOCUMENT_SETTINGS, email_subject: 'x', email_title: 'x' };
    const html = renderEmailDocument({ width: 700, content, title: settings.email_title });
    const report = validateEmail(html, content, 'generic', {
      emailSubject: settings.email_subject, faviconUrl: settings.favicon_url,
      resetCssEnabled: settings.reset_css_enabled, customCssEnabled: settings.custom_css_enabled, customCss: settings.custom_css,
    });
    const candidates = buildRepairCandidates(report, content.modules, settings);
    const candidate = candidates.find((c) => c.issueId === `outlook-classic:button-rounded-corners-need-vml:${module.id}`);
    expect(candidate).toBeDefined();
    expect(candidate!.before).toBe('(not set)');
    expect(candidate!.after).toBe('Enabled');
    expect(candidate!.moduleId).toBe(module.id);
    expect(candidate!.item).toEqual({
      kind: 'module-settings', issueId: `outlook-classic:button-rounded-corners-need-vml:${module.id}`,
      moduleId: module.id, settingsPatch: { outlookVml: true },
    });
  });

  it('never includes a manual or none-fixType issue as a candidate', () => {
    const content = contentWith([]);
    const settings = { ...EMPTY_DOCUMENT_SETTINGS, email_title: '', email_subject: '' };
    const html = renderEmailDocument({ width: 700, content });
    const report = validateEmail(html, content, 'generic', {
      emailSubject: settings.email_subject, faviconUrl: settings.favicon_url,
      resetCssEnabled: settings.reset_css_enabled, customCssEnabled: settings.custom_css_enabled, customCss: settings.custom_css,
    });
    expect(report.issues.some((i) => i.id === 'document:missing-title')).toBe(true);
    const candidates = buildRepairCandidates(report, content.modules, settings);
    expect(candidates.some((c) => c.issueId === 'document:missing-title')).toBe(false);
  });
});

describe('toApplyRepairPatchArgs', () => {
  it('merges multiple document-scope candidates into ONE document patch', () => {
    const candidates = [
      {
        issueId: 'a', title: '', detail: '', severity: 'warning' as const, category: 'document' as const,
        affectedClient: 'All email clients', before: '', after: '', confidence: 1, safeAutoFix: true as const,
        item: { kind: 'document' as const, issueId: 'a', documentPatch: { reset_css_enabled: true } },
      },
      {
        issueId: 'b', title: '', detail: '', severity: 'error' as const, category: 'document' as const,
        affectedClient: 'All email clients', before: '', after: '', confidence: 1, safeAutoFix: true as const,
        item: { kind: 'document' as const, issueId: 'b', documentPatch: { custom_css_enabled: false } },
      },
    ];
    const { modulePatches, documentPatch } = toApplyRepairPatchArgs(candidates);
    expect(modulePatches).toHaveLength(0);
    expect(documentPatch).toEqual({ reset_css_enabled: true, custom_css_enabled: false });
  });

  it('separates module-scope candidates into a list, with no document patch when none exist', () => {
    const candidates = [
      {
        issueId: 'a', title: '', detail: '', severity: 'warning' as const, category: 'accessibility' as const,
        affectedClient: 'All email clients', moduleId: 'm1', before: '', after: '', confidence: 1, safeAutoFix: true as const,
        item: { kind: 'module' as const, issueId: 'a', moduleId: 'm1', propPatch: { color: '#000000' } },
      },
    ];
    const { modulePatches, documentPatch } = toApplyRepairPatchArgs(candidates);
    expect(modulePatches).toEqual([{ moduleId: 'm1', propPatch: { color: '#000000' } }]);
    expect(documentPatch).toBeNull();
  });

  it('Sub-phase 6: separates module-SETTINGS-scope candidates into their own list', () => {
    const candidates = [
      {
        issueId: 'a', title: '', detail: '', severity: 'warning' as const, category: 'outlook' as const,
        affectedClient: 'Classic Outlook', moduleId: 'm1', before: '', after: '', confidence: 1, safeAutoFix: true as const,
        item: { kind: 'module-settings' as const, issueId: 'a', moduleId: 'm1', settingsPatch: { outlookVml: true } },
      },
    ];
    const { modulePatches, settingsPatches, documentPatch } = toApplyRepairPatchArgs(candidates);
    expect(modulePatches).toHaveLength(0);
    expect(settingsPatches).toEqual([{ moduleId: 'm1', settingsPatch: { outlookVml: true } }]);
    expect(documentPatch).toBeNull();
  });
});
