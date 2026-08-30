import { describe, expect, it } from 'vitest';
import { explainIssue } from './validationExplanation';
import { validateEmail } from './emailValidation';
import { renderEmailDocument } from './htmlRenderer';
import { createModule } from './moduleFactory';
import { EMPTY_DOCUMENT_SETTINGS } from './useEmailBuilderState';
import type { EmailDocumentContent, EmailModule, TextModuleProps } from './edm';

function contentWith(modules: EmailModule[]): EmailDocumentContent {
  return { version: 1, modules };
}

function issueFor(content: EmailDocumentContent, title: string, settings: Partial<typeof EMPTY_DOCUMENT_SETTINGS> = {}) {
  // A real title/subject baseline (matching repairEngine.test.ts's own
  // "clean, fully-configured document" convention) so unrelated
  // document-level "missing title/subject" issues never pollute a
  // fixture that isn't testing those.
  const merged = { ...EMPTY_DOCUMENT_SETTINGS, email_title: 'Test Email', email_subject: 'Test subject', ...settings };
  const html = renderEmailDocument({
    width: 700, content, title: merged.email_title, faviconUrl: merged.favicon_url,
    resetCssEnabled: merged.reset_css_enabled, customCssEnabled: merged.custom_css_enabled, customCss: merged.custom_css,
  });
  const report = validateEmail(html, content, 'generic', {
    emailSubject: merged.email_subject, faviconUrl: merged.favicon_url,
    resetCssEnabled: merged.reset_css_enabled, customCssEnabled: merged.custom_css_enabled, customCss: merged.custom_css,
  });
  const issue = report.issues.find((i) => i.title === title);
  if (!issue) throw new Error(`Fixture issue not found: ${title}`);
  return issue;
}

describe('explainIssue — Module-4 E7 explanation content', () => {
  it('a SAFE, document-scope issue (Reset CSS disabled): explains it, points to Email Settings, and says it can be auto-fixed', () => {
    const issue = issueFor(contentWith([]), 'Email Reset CSS is disabled', { reset_css_enabled: false });
    const explanation = explainIssue(issue, []);
    expect(explanation.whatIsWrong).toBe('Email Reset CSS is disabled');
    expect(explanation.whyItMatters).toContain(issue.detail);
    expect(explanation.where).toBe('Document-level (Email Settings), not tied to one specific module.');
    expect(explanation.canAutoFix).toBe(true);
    expect(explanation.howToFix).toMatch(/fixed automatically/i);
  });

  it('a MANUAL, module-scope issue (weak contrast): points to the real module label and says it needs a manual decision', () => {
    const module = createModule('text', 0) as unknown as EmailModule<TextModuleProps>;
    module.props = { ...module.props, color: '#050505', backgroundColor: '#0a0a0a' };
    const issue = issueFor(contentWith([module as unknown as EmailModule]), 'Risky under dark-mode inversion');
    const explanation = explainIssue(issue, [module as unknown as EmailModule]);
    expect(explanation.where).toContain('Text');
    expect(explanation.canAutoFix).toBe(false);
    expect(explanation.howToFix).toMatch(/manual decision/i);
    expect(explanation.howToFix).toMatch(/Go to module/i);
  });

  it('a NONE-fixType, whole-document issue (missing alt text): says there is no fix to apply', () => {
    const image = createModule('image', 0);
    const withoutAlt: EmailModule = { ...image, props: { ...image.props, alt: '' } };
    const issue = issueFor(contentWith([withoutAlt]), 'Missing alt text');
    const explanation = explainIssue(issue, [withoutAlt]);
    expect(explanation.canAutoFix).toBe(false);
    expect(explanation.howToFix).toMatch(/informational only/i);
  });

  it('where() reports a module that no longer exists (stale moduleId) gracefully, never throwing', () => {
    const module = createModule('text', 0) as unknown as EmailModule<TextModuleProps>;
    module.props = { ...module.props, color: '#050505', backgroundColor: '#0a0a0a' };
    const issue = issueFor(contentWith([module as unknown as EmailModule]), 'Risky under dark-mode inversion');
    // Modules array no longer contains the module the issue references.
    const explanation = explainIssue(issue, []);
    expect(explanation.where).toBe('A module that no longer exists in this document.');
  });

  it('an error-severity issue gets the stronger "what can happen" framing', () => {
    const image = createModule('image', 0);
    const withoutAlt: EmailModule = { ...image, props: { ...image.props, alt: '' } };
    const issue = issueFor(contentWith([withoutAlt]), 'Missing alt text');
    expect(issue.severity).toBe('error');
    const explanation = explainIssue(issue, [withoutAlt]);
    expect(explanation.whatCanHappen).toMatch(/error/i);
  });

  it('affectedClients is derived from the SAME repairEngine.affectedClientLabel every other panel uses (no second classification scheme)', () => {
    const issue = issueFor(contentWith([]), 'Email Reset CSS is disabled', { reset_css_enabled: false });
    const explanation = explainIssue(issue, []);
    expect(explanation.affectedClients).toBe('All email clients');
  });
});
