import { describe, expect, it } from 'vitest';
import { buildExportSummary, buildHandoffManifest, extractImageAssetUrls, sanitizeExportFileName } from './exportDeploy';
import { renderEmailDocument } from './htmlRenderer';
import { createModule } from './moduleFactory';
import type { EmailDocumentContent, EmailModule } from './edm';

function contentWith(modules: EmailModule[]): EmailDocumentContent {
  return { version: 1, modules };
}

describe('buildExportSummary', () => {
  it('reports Passed / score 100 / no blocking issues for a clean document', () => {
    const content = contentWith([]);
    const html = renderEmailDocument({ width: 700, content });
    const summary = buildExportSummary(html, content, 'generic', 'Clean Email', 700);

    expect(summary.score).toBe(100);
    expect(summary.hasBlockingIssues).toBe(false);
    expect(summary.validationStatus).toBe('Passed');
    expect(summary.responsiveStatus).toBe('Passed');
    expect(summary.errorCount).toBe(0);
    expect(summary.emailName).toBe('Clean Email');
    expect(summary.platform).toBe('generic');
    expect(summary.platformLabel).toBe('Generic');
    expect(summary.width).toBe(700);
  });

  it('flags hasBlockingIssues and "Needs attention" when an error-severity issue exists (placeholder image)', () => {
    const image = createModule('image', 0);
    const content = contentWith([image]);
    const html = renderEmailDocument({ width: 700, content });
    const summary = buildExportSummary(html, content, 'generic', 'Email', 700);

    expect(summary.hasBlockingIssues).toBe(true);
    expect(summary.validationStatus).toBe('Needs attention');
    expect(summary.errorCount).toBeGreaterThan(0);
  });

  it('does not block export on a warning-only issue (weak contrast)', () => {
    const text = createModule('text', 0) as unknown as EmailModule<{ text: string; color?: string; backgroundColor?: string }>;
    const badContrast = { ...text, props: { ...text.props, color: '#cccccc', backgroundColor: '#ffffff' } };
    const content = contentWith([badContrast as unknown as EmailModule]);
    const html = renderEmailDocument({ width: 700, content });
    const summary = buildExportSummary(html, content, 'generic', 'Email', 700);

    expect(summary.hasBlockingIssues).toBe(false);
    expect(summary.validationStatus).toBe('Passed');
    expect(summary.warningCount).toBeGreaterThan(0);
  });

  it('counts only real (non-placeholder) image sources', () => {
    const placeholderImage = createModule('image', 0);
    const realImage = { ...createModule('image', 1), props: { ...createModule('image', 1).props, src: 'https://example.com/logo.png' } };
    const content = contentWith([placeholderImage, realImage]);
    const html = renderEmailDocument({ width: 700, content });
    const summary = buildExportSummary(html, content, 'generic', 'Email', 700);

    expect(summary.imageCount).toBe(1);
  });

  it('revalidates against the platform passed in — a platform token unsupported by the export platform becomes a warning', () => {
    const text = createModule('text', 0) as unknown as EmailModule<{ text: string }>;
    const withToken = { ...text, props: { ...text.props, text: 'Hi %%FirstName%%' } };
    const content = contentWith([withToken as unknown as EmailModule]);
    const html = renderEmailDocument({ width: 700, content });

    const genericSummary = buildExportSummary(html, content, 'generic', 'Email', 700);
    const sfmcSummary = buildExportSummary(html, content, 'sfmc', 'Email', 700);

    expect(genericSummary.warningCount).toBeGreaterThan(sfmcSummary.warningCount);
  });
});

describe('extractImageAssetUrls', () => {
  it('returns real image URLs only, deduplicated, excluding placeholder src="#"', () => {
    const html = '<img src="https://example.com/a.png" alt=""><img src="#" alt=""><img src="https://example.com/a.png" alt="">';
    expect(extractImageAssetUrls(html)).toEqual(['https://example.com/a.png']);
  });

  it('returns an empty array when there are no images', () => {
    expect(extractImageAssetUrls('<p>no images here</p>')).toEqual([]);
  });
});

describe('buildHandoffManifest', () => {
  it('produces valid, parseable JSON carrying the summary and image URLs', () => {
    const content = contentWith([]);
    const html = renderEmailDocument({ width: 700, content });
    const summary = buildExportSummary(html, content, 'sfmc', 'Summer Sale', 700);

    const manifest = buildHandoffManifest(summary, ['https://example.com/logo.png'], '2026-08-22T00:00:00.000Z');
    const parsed = JSON.parse(manifest);

    expect(parsed.emailName).toBe('Summer Sale');
    expect(parsed.platform).toBe('sfmc');
    expect(parsed.platformLabel).toBe('Salesforce Marketing Cloud');
    expect(parsed.exportedAt).toBe('2026-08-22T00:00:00.000Z');
    expect(parsed.validation.status).toBe('Passed');
    expect(parsed.imageAssetUrls).toEqual(['https://example.com/logo.png']);
  });
});

describe('sanitizeExportFileName', () => {
  it('strips unsafe characters and preserves spaces/hyphens/underscores', () => {
    expect(sanitizeExportFileName('Summer Sale Campaign!!')).toBe('Summer Sale Campaign');
    expect(sanitizeExportFileName('a/b\\c:d*e')).toBe('abcde');
  });

  it('falls back to "email" for an empty/whitespace-only name', () => {
    expect(sanitizeExportFileName('   ')).toBe('email');
    expect(sanitizeExportFileName('')).toBe('email');
  });
});
