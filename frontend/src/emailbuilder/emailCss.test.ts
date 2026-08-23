import { describe, expect, it } from 'vitest';
import {
  BUILTIN_RESET_CSS, MAX_CUSTOM_CSS_LENGTH, detectCustomCssWarnings, renderCustomCssBlock, renderResetCssBlock,
  validateCustomCss,
} from './emailCss';

describe('BUILTIN_RESET_CSS — content audit', () => {
  it('does not hard-code any link color (no #006379 or similar, no color: declaration scoped to <a>)', () => {
    expect(BUILTIN_RESET_CSS).not.toMatch(/#006379/i);
    // `a` legitimately appears in the shared text-size-adjust selector
    // list (body, table, td, p, a) — the audit concern is a COLOR
    // declaration targeting links specifically, which must not exist.
    expect(BUILTIN_RESET_CSS).not.toMatch(/\ba\s*\{[^}]*color\s*:/);
    expect(BUILTIN_RESET_CSS).not.toMatch(/\bu\s*\+\s*#body\s+a\b/);
  });

  it('declares text-size-adjust exactly once per vendor prefix (no contradictory duplicate)', () => {
    const webkitMatches = BUILTIN_RESET_CSS.match(/-webkit-text-size-adjust/g) ?? [];
    const msMatches = BUILTIN_RESET_CSS.match(/-ms-text-size-adjust/g) ?? [];
    expect(webkitMatches).toHaveLength(1);
    expect(msMatches).toHaveLength(1);
    expect(BUILTIN_RESET_CSS).toContain('-webkit-text-size-adjust: 100%');
    expect(BUILTIN_RESET_CSS).toContain('-ms-text-size-adjust: 100%');
  });

  it('keeps the Outlook/Word table-spacing baseline', () => {
    expect(BUILTIN_RESET_CSS).toContain('mso-table-lspace: 0pt');
    expect(BUILTIN_RESET_CSS).toContain('mso-table-rspace: 0pt');
  });

  it('keeps table border-collapse/border-spacing normalization', () => {
    expect(BUILTIN_RESET_CSS).toContain('border-collapse: collapse');
    expect(BUILTIN_RESET_CSS).toContain('border-spacing: 0');
  });

  it('keeps image reset (border/outline/text-decoration/interpolation-mode)', () => {
    expect(BUILTIN_RESET_CSS).toMatch(/img\s*\{[^}]*border:\s*0/);
    expect(BUILTIN_RESET_CSS).toContain('-ms-interpolation-mode: bicubic');
  });

  it('keeps body margin/padding normalization', () => {
    expect(BUILTIN_RESET_CSS).toMatch(/body\s*\{[^}]*margin:\s*0/);
  });

  it('keeps <p> margin normalization (genuinely emitted by the renderer)', () => {
    expect(BUILTIN_RESET_CSS).toMatch(/(^|\s)p\s*\{[^}]*margin:\s*0/m);
  });

  it('does not include heading (h1-h6) rules — no module renders heading tags', () => {
    expect(BUILTIN_RESET_CSS).not.toMatch(/\bh1\b/);
    expect(BUILTIN_RESET_CSS).not.toMatch(/\bh[1-6]\s*,|\bh[1-6]\s*\{/);
  });

  it('does not include list (ul/ol/li) rules — no module renders list tags', () => {
    expect(BUILTIN_RESET_CSS).not.toMatch(/\bul\b/);
    expect(BUILTIN_RESET_CSS).not.toMatch(/\bol\b/);
    expect(BUILTIN_RESET_CSS).not.toMatch(/\bli\s*\{/);
  });

  it('does not include a global font-family fallback (every module already sets one inline)', () => {
    expect(BUILTIN_RESET_CSS).not.toMatch(/font-family/i);
  });

  it('does not include the Outlook spacer-row hack (tr{font-size:0})', () => {
    expect(BUILTIN_RESET_CSS).not.toMatch(/\btr\s*\{/);
  });
});

describe('renderResetCssBlock', () => {
  it('wraps the reset CSS in a single <style> tag with start/end comment markers', () => {
    const block = renderResetCssBlock();
    expect(block).toContain('<style type="text/css">');
    expect(block).toContain('EMAIL RESET CSS - START');
    expect(block).toContain('EMAIL RESET CSS - ENDS');
    expect(block).toContain(BUILTIN_RESET_CSS);
    expect((block.match(/<style/g) ?? []).length).toBe(1);
  });
});

describe('renderCustomCssBlock', () => {
  it('renders nothing for an empty string', () => {
    expect(renderCustomCssBlock('')).toBe('');
  });

  it('renders nothing for a whitespace-only string', () => {
    expect(renderCustomCssBlock('   \n  ')).toBe('');
  });

  it('wraps non-empty CSS in a <style> tag with start/end comment markers', () => {
    const block = renderCustomCssBlock('.x{color:red}');
    expect(block).toContain('<style type="text/css">');
    expect(block).toContain('CUSTOM CSS - START');
    expect(block).toContain('CUSTOM CSS - ENDS');
    expect(block).toContain('.x{color:red}');
  });
});

describe('validateCustomCss — blocks malicious constructs', () => {
  const unsafeCases: [string, string][] = [
    ['</style breakout', 'body{}</style><script>alert(1)</script>'],
    ['<script tag', '.x{content:"a"} <script>alert(1)</script>'],
    ['HTML comment open', '.x{color:red} <!-- x'],
    ['HTML comment close', '.x{color:red} x -->'],
    ['javascript: scheme', '.x{background:url(javascript:alert(1))}'],
    ['vbscript: scheme', '.x{background:url(vbscript:msgbox(1))}'],
    ['CSS expression()', '.x{width:expression(alert(1))}'],
    ['IE behavior:', '.x{behavior:url(evil.htc)}'],
    ['-moz-binding:', '.x{-moz-binding:url(evil.xml)}'],
    ['@import', '@import url("https://evil.example.com/x.css");'],
    ['embedded HTML tag', '.x{content:"<img src=x onerror=alert(1)>"}'],
    ['data: URI (image subtype — now unconditionally rejected, item 2)', '.dot{background-image:url(data:image/png;base64,AAAA)}'],
    ['data: URI (non-image subtype)', '@font-face{src:url(data:font/woff2;base64,AAAA)}'],
  ];

  it.each(unsafeCases)('rejects: %s', (_label, css) => {
    const result = validateCustomCss(css);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('rejects CSS longer than the maximum length', () => {
    const result = validateCustomCss('.x{color:red}'.repeat(2000));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('too long'))).toBe(true);
  });

  it(`MAX_CUSTOM_CSS_LENGTH is ${20000}`, () => {
    expect(MAX_CUSTOM_CSS_LENGTH).toBe(20000);
  });
});

// Closure item 3 — obfuscated/adversarial variants of the SAME attacks
// above. Each must still be rejected after normalization (CSS hex/char
// escape decoding, comment stripping, control-char stripping, case
// folding) — see emailCss.ts's normalizeForSecurityScan docstring for
// exactly what is undone and why.
describe('validateCustomCss — obfuscation/adversarial resistance (closure item 3)', () => {
  const obfuscatedCases: [string, string][] = [
    ['CSS hex-escaped "javascript:" (\\61 = a)', '.x{background:url(j\\61vascript:alert(1))}'],
    ['CSS hex-escaped "expression(" (\\73 = s)', '.x{width:expre\\73sion(alert(1))}'],
    ['CSS hex-escaped "@import" (\\40 = @)', '\\40 import url(evil.css);'],
    ['CSS hex-escaped "behavior:" (\\61 = a)', '.x{beh\\61vior:url(evil.htc)}'],
    ['CSS hex-escaped "-moz-binding:" (\\69 = i)', '.x{-moz-b\\69nding:url(evil.xml)}'],
    // A trailing space after a 1-2 digit hex escape is REQUIRED by the
    // CSS spec to terminate it before a following hex-digit character
    // ('a' is itself a valid hex digit) — without it, \64ata would
    // greedily consume "64a" as ONE 3-hex-digit escape (U+064A), not "d"
    // + literal "ata". Real browsers apply the same greedy rule, so this
    // is the realistic obfuscated form, not `\64ata` (which decodes to
    // something else entirely, in a real engine too).
    ['CSS hex-escaped "data:" (\\64 = d, space-terminated)', '.x{background:url(\\64 ata:image/png;base64,AAAA)}'],
    ['literal NUL control character mid-token', '.x{background:url(java\x00script:alert(1))}'],
    ['mixed case "JavaScript:"', '.x{background:url(JavaScript:alert(1))}'],
    ['mixed case "EXPRESSION("', '.x{width:EXPRESSION(alert(1))}'],
    ['mixed case "@IMPORT"', '@IMPORT url(evil.css);'],
    ['uppercase "</STYLE>" breakout', 'body{}</STYLE><script>alert(1)</script>'],
    ['CSS comment splitting "java/**/script:"', '.x{background:url(java/**/script:alert(1))}'],
    ['CSS comment splitting "expre/**/ssion("', '.x{width:expre/**/ssion(alert(1))}'],
    ['CSS comment splitting "-moz-/**/binding:"', '.x{-moz-/**/binding:url(evil.xml)}'],
    ['quoted url() with javascript:', '.x{background:url("javascript:alert(1)")}'],
    ['single-quoted url() with javascript:', ".x{background:url('javascript:alert(1)')}"],
    ['unquoted url() with javascript:', '.x{background:url(javascript:alert(1))}'],
    ['malformed url() (missing close paren) still carries the scheme', '.x{background:url(javascript:alert(1)}'],
  ];

  it.each(obfuscatedCases)('rejects: %s', (_label, css) => {
    const result = validateCustomCss(css);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

describe('validateCustomCss — allows normal/advanced email CSS', () => {
  const safeCases: [string, string][] = [
    ['plain class rule', '.brand { color: #002D38; }'],
    ['media query', '@media only screen and (max-width:600px) { .stack { display: block !important; } }'],
    ['attribute selector', 'a[href^="mailto:"] { color: #0082AD; }'],
    ['pseudo-class', '.btn:hover { opacity: 0.9; }'],
    ['MSO properties', 'table { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }'],
    ['vendor prefix', '.x { -webkit-text-size-adjust: 100%; }'],
    ['external https background image', '.icon { background-image: url(https://cdn.example.com/icon.png); }'],
    ['multiple rules', '.a{color:red} .b{color:blue}'],
  ];

  it.each(safeCases)('allows: %s', (_label, css) => {
    expect(validateCustomCss(css)).toEqual({ valid: true, errors: [] });
  });

  it('an empty string is valid (no violations)', () => {
    expect(validateCustomCss('')).toEqual({ valid: true, errors: [] });
  });
});

describe('detectCustomCssWarnings', () => {
  it('flags a bare structural selector with a compatibility-sensitive declaration', () => {
    const warnings = detectCustomCssWarnings('table { display: none; }');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].selector).toBe('table');
    expect(warnings[0].property).toBe('display');
  });

  it('flags mso-table-lspace/rspace/border-collapse/border-spacing as Outlook-specific', () => {
    const warnings = detectCustomCssWarnings('table { border-collapse: separate; }');
    expect(warnings[0].affectedClients).toMatch(/Outlook/);
  });

  it('does NOT flag a scoped/class selector (not a bare tag)', () => {
    expect(detectCustomCssWarnings('.my-table { display: none; }')).toHaveLength(0);
    expect(detectCustomCssWarnings('#id td { display: none; }')).toHaveLength(0);
  });

  it('does NOT flag a bare tag selector with a harmless declaration', () => {
    expect(detectCustomCssWarnings('table { color: red; }')).toHaveLength(0);
  });

  it('does NOT flag rules inside an @media block (a scoped, intentional override)', () => {
    expect(detectCustomCssWarnings('@media (max-width:600px) { table { width: 100%; } }')).toHaveLength(0);
  });

  it('flags each risky property on a comma-separated selector list', () => {
    const warnings = detectCustomCssWarnings('table, td { display: block; }');
    expect(warnings.map((w) => w.selector).sort()).toEqual(['table', 'td']);
  });

  it('returns an empty array for CSS with no structural selectors', () => {
    expect(detectCustomCssWarnings('.brand { color: #002D38; }')).toHaveLength(0);
  });

  it('returns an empty array for empty CSS', () => {
    expect(detectCustomCssWarnings('')).toHaveLength(0);
  });

  it('never blocks — is purely additive information, independent of validateCustomCss', () => {
    const css = 'table { display: none; }';
    expect(validateCustomCss(css).valid).toBe(true);
    expect(detectCustomCssWarnings(css).length).toBeGreaterThan(0);
  });
});
