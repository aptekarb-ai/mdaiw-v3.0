import { describe, expect, it } from 'vitest';
import { computeCompatibilityChecks } from './htmlCompatibilityChecks';

const SAFE_HTML = (
  '<!doctype html><html xmlns="http://www.w3.org/1999/xhtml"><head></head>'
  + '<body><table role="presentation"><tr><td style="color:#333;">Hi</td></tr></table></body></html>'
);

describe('computeCompatibilityChecks', () => {
  it('all four checks pass for table-first, inline-styled, no-script HTML with the XHTML namespace', () => {
    const checks = computeCompatibilityChecks(SAFE_HTML);
    expect(checks).toHaveLength(4);
    expect(checks.every((check) => check.ok)).toBe(true);
    expect(checks.map((check) => check.id)).toEqual(['html-valid', 'inline-css', 'no-div', 'outlook-safe']);
  });

  it('flags a structural <div>', () => {
    const html = SAFE_HTML.replace('<table', '<div></div><table');
    const checks = computeCompatibilityChecks(html);
    const noDiv = checks.find((check) => check.id === 'no-div')!;
    expect(noDiv.ok).toBe(false);
  });

  it('does not flag "div" appearing only inside another word or attribute', () => {
    // "individual" contains "div" as a substring — must not false-positive.
    const html = SAFE_HTML.replace('Hi', 'individual results');
    const checks = computeCompatibilityChecks(html);
    expect(checks.find((check) => check.id === 'no-div')!.ok).toBe(true);
  });

  it('flags an external stylesheet link', () => {
    const html = SAFE_HTML.replace('<head>', '<head><link rel="stylesheet" href="https://example.com/a.css">');
    const checks = computeCompatibilityChecks(html);
    expect(checks.find((check) => check.id === 'inline-css')!.ok).toBe(false);
  });

  it('flags display:flex and display:grid as not Outlook-safe', () => {
    const flexHtml = SAFE_HTML.replace('color:#333;', 'color:#333;display:flex;');
    expect(computeCompatibilityChecks(flexHtml).find((c) => c.id === 'outlook-safe')!.ok).toBe(false);

    const gridHtml = SAFE_HTML.replace('color:#333;', 'color:#333;display:grid;');
    expect(computeCompatibilityChecks(gridHtml).find((c) => c.id === 'outlook-safe')!.ok).toBe(false);
  });

  it('flags a <script> tag as not Outlook-safe', () => {
    const html = SAFE_HTML.replace('</body>', '<script>alert(1)</script></body>');
    const checks = computeCompatibilityChecks(html);
    expect(checks.find((check) => check.id === 'outlook-safe')!.ok).toBe(false);
  });

  it('flags a missing XHTML namespace as not Outlook-safe', () => {
    const html = SAFE_HTML.replace(' xmlns="http://www.w3.org/1999/xhtml"', '');
    const checks = computeCompatibilityChecks(html);
    expect(checks.find((check) => check.id === 'outlook-safe')!.ok).toBe(false);
  });

  it('every check carries a human-readable detail string', () => {
    const checks = computeCompatibilityChecks(SAFE_HTML);
    for (const check of checks) {
      expect(typeof check.detail).toBe('string');
      expect(check.detail.length).toBeGreaterThan(0);
    }
  });
});
