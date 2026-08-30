import { describe, expect, it } from 'vitest';
import { matchDocumentIntent, resolveDocumentIntent } from './aiDocumentIntelligence';
import { validateEmail } from './emailValidation';
import { renderEmailDocument } from './htmlRenderer';
import { createModule } from './moduleFactory';
import { EMPTY_DOCUMENT_SETTINGS } from './useEmailBuilderState';
import type { EmailDocumentContent, EmailModule, TextModuleProps } from './edm';

function contentWith(modules: EmailModule[]): EmailDocumentContent {
  return { version: 1, modules };
}

function reportFor(content: EmailDocumentContent, settings = EMPTY_DOCUMENT_SETTINGS) {
  const html = renderEmailDocument({
    width: 700, content, title: settings.email_title, faviconUrl: settings.favicon_url,
    resetCssEnabled: settings.reset_css_enabled, customCssEnabled: settings.custom_css_enabled, customCss: settings.custom_css,
  });
  return validateEmail(html, content, 'generic', {
    emailSubject: settings.email_subject, faviconUrl: settings.favicon_url,
    resetCssEnabled: settings.reset_css_enabled, customCssEnabled: settings.custom_css_enabled, customCss: settings.custom_css,
  });
}

describe('matchDocumentIntent', () => {
  it('recognizes "why is this email failing outlook"', () => {
    expect(matchDocumentIntent('why is this email failing outlook')?.kind).toBe('diagnose-classic-outlook');
  });

  it('recognizes "check this email for classic outlook issues"', () => {
    expect(matchDocumentIntent('check this email for classic outlook issues')?.kind).toBe('diagnose-classic-outlook');
  });

  it('recognizes "check new outlook compatibility"', () => {
    expect(matchDocumentIntent('check new outlook compatibility')?.kind).toBe('diagnose-new-outlook');
  });

  it('recognizes "what is wrong with the head"', () => {
    expect(matchDocumentIntent('what is wrong with the head')?.kind).toBe('whats-wrong-head');
  });

  it('recognizes the contraction "what\'s wrong with the head"', () => {
    expect(matchDocumentIntent("what's wrong with the head")?.kind).toBe('whats-wrong-head');
  });

  it('recognizes "which module causes this compatibility issue"', () => {
    expect(matchDocumentIntent('which module causes this compatibility issue')?.kind).toBe('which-module');
  });

  it('recognizes "why is this custom css unsafe"', () => {
    expect(matchDocumentIntent('why is this custom css unsafe')?.kind).toBe('why-custom-css-unsafe');
  });

  it('recognizes "validate the complete email"', () => {
    expect(matchDocumentIntent('validate the complete email')?.kind).toBe('validate-complete');
  });

  it('recognizes "repair all safe outlook problems" as repair-all-safe, not a diagnostic', () => {
    expect(matchDocumentIntent('repair all safe outlook problems')?.kind).toBe('repair-all-safe');
  });

  it('recognizes "fix the dpi issue" as a repair-keyword intent, capturing the lowercased message', () => {
    const match = matchDocumentIntent('fix the DPI issue');
    expect(match?.kind).toBe('repair-keyword');
    expect(match?.keyword).toBe('fix the dpi issue');
  });

  it('recognizes "add the required outlook metadata" as a repair-keyword intent', () => {
    expect(matchDocumentIntent('add the required outlook metadata')?.kind).toBe('repair-keyword');
  });

  it('returns null for an unrelated module command ("add a button")', () => {
    expect(matchDocumentIntent('add a button')).toBeNull();
  });

  it('returns null for an empty message', () => {
    expect(matchDocumentIntent('   ')).toBeNull();
  });
});

describe('resolveDocumentIntent', () => {
  it('diagnose-classic-outlook reports honestly when nothing is wrong (real generated document)', () => {
    const content = contentWith([]);
    const report = reportFor(content);
    const result = resolveDocumentIntent({ kind: 'diagnose-classic-outlook' }, report, content.modules, EMPTY_DOCUMENT_SETTINGS);
    expect(result.reply).toContain('No Classic Outlook compatibility problems');
    expect(result.repairCandidates).toBeUndefined();
  });

  it('diagnose-classic-outlook reports a real detected issue', () => {
    const content = contentWith([]);
    const html = '<!doctype html><html><body><!--[if mso]><table></table></body></html>';
    const report = validateEmail(html, content, 'generic');
    const result = resolveDocumentIntent({ kind: 'diagnose-classic-outlook' }, report, content.modules, EMPTY_DOCUMENT_SETTINGS);
    expect(result.reply).toContain('Malformed Outlook conditional comment');
  });

  it('diagnose-new-outlook is honest about the web-engine distinction when clean', () => {
    const content = contentWith([]);
    const report = reportFor(content);
    const result = resolveDocumentIntent({ kind: 'diagnose-new-outlook' }, report, content.modules, EMPTY_DOCUMENT_SETTINGS);
    expect(result.reply).toContain('New Outlook uses a web rendering engine');
  });

  it('whats-wrong-head reports document-category issues only', () => {
    const content = contentWith([]);
    const settings = { ...EMPTY_DOCUMENT_SETTINGS, reset_css_enabled: false };
    const report = reportFor(content, settings);
    const result = resolveDocumentIntent({ kind: 'whats-wrong-head' }, report, content.modules, settings);
    expect(result.reply).toContain('Email Reset CSS is disabled');
  });

  it('validate-complete reports the score and every category', () => {
    const content = contentWith([]);
    const report = reportFor(content);
    const result = resolveDocumentIntent({ kind: 'validate-complete' }, report, content.modules, EMPTY_DOCUMENT_SETTINGS);
    expect(result.reply).toContain(`Email Health Score: ${report.score}/100`);
    expect(result.reply).toContain('Email Settings');
  });

  it('repair-all-safe finds zero candidates on a clean document and says so honestly', () => {
    const content = contentWith([]);
    const settings = { ...EMPTY_DOCUMENT_SETTINGS, email_title: 'x', email_subject: 'x' };
    const report = reportFor(content, settings);
    const result = resolveDocumentIntent({ kind: 'repair-all-safe' }, report, content.modules, settings);
    expect(result.reply).toContain('No safely auto-fixable issues were found');
    expect(result.repairCandidates).toBeUndefined();
  });

  it('repair-all-safe finds a real candidate (Reset CSS disabled) and proposes it', () => {
    const content = contentWith([]);
    const settings = { ...EMPTY_DOCUMENT_SETTINGS, reset_css_enabled: false };
    const report = reportFor(content, settings);
    const result = resolveDocumentIntent({ kind: 'repair-all-safe' }, report, content.modules, settings);
    expect(result.repairCandidates).toBeDefined();
    expect(result.repairCandidates!.some((c) => c.issueId === 'document:reset-css-disabled')).toBe(true);
    expect(result.reply).toContain('safely auto-fixable');
  });

  it('repair-keyword ("reset css") finds and proposes the matching safe fix', () => {
    const content = contentWith([]);
    const settings = { ...EMPTY_DOCUMENT_SETTINGS, reset_css_enabled: false };
    const report = reportFor(content, settings);
    const result = resolveDocumentIntent({ kind: 'repair-keyword', keyword: 'enable reset css please' }, report, content.modules, settings);
    expect(result.repairCandidates).toBeDefined();
    expect(result.repairCandidates![0].issueId).toBe('document:reset-css-disabled');
  });

  it('repair-keyword ("dpi") never fabricates a fix when the real document has no such problem', () => {
    const content = contentWith([]);
    const report = reportFor(content);
    const result = resolveDocumentIntent({ kind: 'repair-keyword', keyword: 'fix the dpi issue' }, report, content.modules, EMPTY_DOCUMENT_SETTINGS);
    expect(result.reply).toContain('could not find a matching problem');
    expect(result.repairCandidates).toBeUndefined();
  });

  it('repair-keyword surfaces an honest "no safe fix" reply for a real-but-unsafe-to-auto-fix issue', () => {
    const content = contentWith([]);
    const html = '<!doctype html><html><body><!--[if mso]><table></table></body></html>';
    const report = validateEmail(html, content, 'generic');
    const result = resolveDocumentIntent({ kind: 'repair-keyword', keyword: 'fix the conditional comment' }, report, content.modules, EMPTY_DOCUMENT_SETTINGS);
    expect(result.reply).toContain('does not have a safe, fully-automatic fix');
    expect(result.repairCandidates).toBeUndefined();
  });

  it('which-module reports "no module" honestly when no issue traces to a module', () => {
    const content = contentWith([]);
    const report = reportFor(content, { ...EMPTY_DOCUMENT_SETTINGS, email_title: 'x', email_subject: 'x' });
    const result = resolveDocumentIntent({ kind: 'which-module' }, report, content.modules, EMPTY_DOCUMENT_SETTINGS);
    expect(result.reply).toContain('No currently-found issue traces back to a specific module');
  });

  it('why-custom-css-unsafe explains a real unsafe Custom CSS finding', () => {
    const content = contentWith([]);
    const settings = { ...EMPTY_DOCUMENT_SETTINGS, custom_css_enabled: true, custom_css: '.x{background:url(javascript:alert(1))}' };
    const report = reportFor(content, settings);
    const result = resolveDocumentIntent({ kind: 'why-custom-css-unsafe' }, report, content.modules, settings);
    expect(result.reply.length).toBeGreaterThan(0);
    expect(result.reply).not.toContain('passed the security check');
  });

  it('why-custom-css-unsafe is honest when Custom CSS is actually safe', () => {
    const content = contentWith([]);
    const settings = { ...EMPTY_DOCUMENT_SETTINGS, custom_css_enabled: true, custom_css: '.x{color:red}' };
    const report = reportFor(content, settings);
    const result = resolveDocumentIntent({ kind: 'why-custom-css-unsafe' }, report, content.modules, settings);
    expect(result.reply).toContain('passed the security check');
  });
});

// Module-4 E9 — editor-context-aware intents. Every case is answered
// entirely from the passed-in DocumentIntentContext, zero network.
describe('matchDocumentIntent — E9 context-aware intents', () => {
  it('recognizes "what am I looking at"', () => {
    expect(matchDocumentIntent('what am I looking at here?')?.kind).toBe('what-am-i-looking-at');
  });

  it('recognizes "what am I viewing"', () => {
    expect(matchDocumentIntent('what am I viewing right now')?.kind).toBe('what-am-i-looking-at');
  });

  it('recognizes "what\'s wrong with the selected module"', () => {
    expect(matchDocumentIntent("what's wrong with the selected module")?.kind).toBe('whats-wrong-selected');
  });

  it('recognizes "what\'s wrong with this image"', () => {
    expect(matchDocumentIntent("what's wrong with this image")?.kind).toBe('whats-wrong-selected');
  });

  it('recognizes "why is this button not outlook compatible"', () => {
    expect(matchDocumentIntent('why is this button not outlook compatible')?.kind).toBe('whats-wrong-selected');
  });

  it('recognizes "explain this issue"', () => {
    expect(matchDocumentIntent('explain this issue')?.kind).toBe('explain-selected-issue');
  });

  it('recognizes "explain the selected validation problem"', () => {
    expect(matchDocumentIntent('explain the selected validation problem')?.kind).toBe('explain-selected-issue');
  });

  it('does NOT misread "what is wrong with the head" as a selected-module question (existing whats-wrong-head intent still wins)', () => {
    expect(matchDocumentIntent('what is wrong with the head')?.kind).toBe('whats-wrong-head');
  });

  it('recognizes bare "fix it"', () => {
    expect(matchDocumentIntent('fix it')?.kind).toBe('fix-selected-issue');
  });

  it('recognizes "can you fix that"', () => {
    expect(matchDocumentIntent('can you fix that?')?.kind).toBe('fix-selected-issue');
  });

  it('recognizes "please repair this"', () => {
    expect(matchDocumentIntent('please repair this')?.kind).toBe('fix-selected-issue');
  });
});

describe('resolveDocumentIntent — E9 context-aware intents', () => {
  it('what-am-i-looking-at describes the Code tab', () => {
    const report = reportFor(contentWith([]));
    const result = resolveDocumentIntent({ kind: 'what-am-i-looking-at' }, report, [], EMPTY_DOCUMENT_SETTINGS, {
      editorMode: 'code',
    });
    expect(result.reply).toContain('Code tab');
  });

  it('what-am-i-looking-at describes Preview Studio', () => {
    const report = reportFor(contentWith([]));
    const result = resolveDocumentIntent({ kind: 'what-am-i-looking-at' }, report, [], EMPTY_DOCUMENT_SETTINGS, {
      editorMode: 'preview',
    });
    expect(result.reply).toContain('Preview Studio');
  });

  it('what-am-i-looking-at describes Validation Center', () => {
    const report = reportFor(contentWith([]));
    const result = resolveDocumentIntent({ kind: 'what-am-i-looking-at' }, report, [], EMPTY_DOCUMENT_SETTINGS, {
      editorMode: 'validate',
    });
    expect(result.reply).toContain('Validation Center');
  });

  it('what-am-i-looking-at describes itself (AI Engineer) when asked from within the AI Engineer tab', () => {
    const report = reportFor(contentWith([]));
    const result = resolveDocumentIntent({ kind: 'what-am-i-looking-at' }, report, [], EMPTY_DOCUMENT_SETTINGS, {
      editorMode: 'ai',
    });
    expect(result.reply).toContain('AI Engineer');
  });

  it('what-am-i-looking-at defaults to describing the Visual canvas for any other/missing editorMode', () => {
    const report = reportFor(contentWith([]));
    const result = resolveDocumentIntent({ kind: 'what-am-i-looking-at' }, report, [], EMPTY_DOCUMENT_SETTINGS, {});
    expect(result.reply).toContain('Visual builder canvas');
  });

  it('whats-wrong-selected reports no module selected when none is given', () => {
    const report = reportFor(contentWith([]));
    const result = resolveDocumentIntent({ kind: 'whats-wrong-selected' }, report, [], EMPTY_DOCUMENT_SETTINGS, {});
    expect(result.reply).toContain('No module is currently selected');
  });

  it('whats-wrong-selected reports the real issues for the selected module', () => {
    const module = createModule('text', 0) as unknown as EmailModule<TextModuleProps>;
    module.props = { ...module.props, color: '#050505', backgroundColor: '#0a0a0a' };
    const widened = module as unknown as EmailModule;
    const content = contentWith([widened]);
    const report = reportFor(content);
    const result = resolveDocumentIntent({ kind: 'whats-wrong-selected' }, report, content.modules, EMPTY_DOCUMENT_SETTINGS, {
      selectedModule: widened,
    });
    expect(result.reply).toContain('Text');
    expect(result.reply).toContain('Risky under dark-mode inversion');
  });

  it('whats-wrong-selected reports a clean module has no issues', () => {
    const module = createModule('divider', 0);
    const content = contentWith([module]);
    const report = reportFor(content);
    const result = resolveDocumentIntent({ kind: 'whats-wrong-selected' }, report, content.modules, EMPTY_DOCUMENT_SETTINGS, {
      selectedModule: module,
    });
    expect(result.reply).toContain('no known issues');
  });

  it('explain-selected-issue reports nothing is focused when no issue is given', () => {
    const report = reportFor(contentWith([]));
    const result = resolveDocumentIntent({ kind: 'explain-selected-issue' }, report, [], EMPTY_DOCUMENT_SETTINGS, {});
    expect(result.reply).toContain('No specific validation issue is currently focused');
  });

  it('explain-selected-issue reports the real issue detail when one is given', () => {
    const settings = { ...EMPTY_DOCUMENT_SETTINGS, reset_css_enabled: false };
    const report = reportFor(contentWith([]), settings);
    const issue = report.issues.find((i) => i.title === 'Email Reset CSS is disabled')!;
    const result = resolveDocumentIntent({ kind: 'explain-selected-issue' }, report, [], settings, {
      selectedValidationIssue: issue,
    });
    expect(result.reply).toContain('Email Reset CSS is disabled');
    expect(result.reply).toContain(issue.detail);
  });

  it('fix-selected-issue proposes the real repair candidate for a safe issue', () => {
    const settings = { ...EMPTY_DOCUMENT_SETTINGS, reset_css_enabled: false };
    const report = reportFor(contentWith([]), settings);
    const issue = report.issues.find((i) => i.title === 'Email Reset CSS is disabled')!;
    const result = resolveDocumentIntent({ kind: 'fix-selected-issue' }, report, [], settings, {
      selectedValidationIssue: issue,
    });
    expect(result.repairCandidates).toHaveLength(1);
    expect(result.repairCandidates![0].issueId).toBe(issue.id);
  });

  it('fix-selected-issue is honest when the tracked issue has no safe auto-fix', () => {
    const module = createModule('text', 0) as unknown as EmailModule<TextModuleProps>;
    module.props = { ...module.props, color: '#050505', backgroundColor: '#0a0a0a' };
    const widened = module as unknown as EmailModule;
    const content = contentWith([widened]);
    const report = reportFor(content);
    const issue = report.issues.find((i) => i.title === 'Risky under dark-mode inversion')!;
    const result = resolveDocumentIntent({ kind: 'fix-selected-issue' }, report, content.modules, EMPTY_DOCUMENT_SETTINGS, {
      selectedValidationIssue: issue,
    });
    expect(result.repairCandidates).toBeUndefined();
    expect(result.reply).toContain('does not have a safe, fully-automatic fix');
  });

  it('fix-selected-issue asks for clarification when nothing has been discussed yet', () => {
    const report = reportFor(contentWith([]));
    const result = resolveDocumentIntent({ kind: 'fix-selected-issue' }, report, [], EMPTY_DOCUMENT_SETTINGS, {});
    expect(result.reply).toContain("not sure which issue you mean");
  });
});
