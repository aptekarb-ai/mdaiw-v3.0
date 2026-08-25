import { describe, expect, it } from 'vitest';
import {
  ATTRIBUTE_ALLOWLIST, CONTENT_TAGS, DANGEROUS_TAGS, TRANSPARENT_CONTAINER_TAGS,
  extractStyleDeclarations, fragmentTargetId, isFragmentHref, isSafeAnchorUrl, isSafeResourceUrl,
  readAllowedAttribute,
} from './htmlImportSanitize';

describe('URL scheme matrix — resource attributes (absolute http/https ONLY)', () => {
  it.each([
    ['https://example.com/a.png', true],
    ['http://example.com/a.png', true],
    ['mailto:someone@example.com', false],
    ['tel:+15551234567', false],
    ['javascript:alert(1)', false],
    ['data:image/png;base64,AAAA', false],
    ['vbscript:msgbox(1)', false],
    ['/relative/a.png', false],
    ['a.png', false],
    ['#fragment', false],
    ['', false],
  ])('isSafeResourceUrl(%s) === %s', (value, expected) => {
    expect(isSafeResourceUrl(value)).toBe(expected);
  });
});

describe('URL scheme matrix — anchor href (http/https/mailto/tel)', () => {
  it.each([
    ['https://example.com', true],
    ['http://example.com', true],
    ['mailto:someone@example.com', true],
    ['tel:+15551234567', true],
    ['javascript:alert(1)', false],
    ['data:text/html,<script>alert(1)</script>', false],
    ['vbscript:msgbox(1)', false],
    ['/relative/page', false],
  ])('isSafeAnchorUrl(%s) === %s', (value, expected) => {
    expect(isSafeAnchorUrl(value)).toBe(expected);
  });
});

describe('fragment-only href detection', () => {
  it('recognizes a fragment href', () => {
    expect(isFragmentHref('#section-2')).toBe(true);
    expect(fragmentTargetId('#section-2')).toBe('section-2');
  });

  it('does not treat a bare "#" or a non-fragment href as a fragment target', () => {
    expect(isFragmentHref('#')).toBe(false);
    expect(isFragmentHref('https://example.com')).toBe(false);
  });
});

describe('closed tag allowlists', () => {
  it('transparent-container allowlist is exactly the approved closed set', () => {
    expect([...TRANSPARENT_CONTAINER_TAGS].sort()).toEqual(
      ['article', 'figcaption', 'figure', 'footer', 'header', 'main', 'section'].sort(),
    );
  });

  it('dangerous-tag set matches the approved active-element list', () => {
    expect([...DANGEROUS_TAGS].sort()).toEqual(['embed', 'form', 'iframe', 'object', 'script'].sort());
  });

  it('an unknown/custom tag is in neither allowlist', () => {
    expect(TRANSPARENT_CONTAINER_TAGS.has('x-widget')).toBe(false);
    expect(CONTENT_TAGS.has('x-widget')).toBe(false);
    expect(DANGEROUS_TAGS.has('x-widget')).toBe(false);
  });
});

describe('attribute allowlist enforcement', () => {
  it('readAllowedAttribute returns the value for an allowlisted attribute', () => {
    const el = document.createElement('img');
    el.setAttribute('src', 'https://example.com/a.png');
    expect(readAllowedAttribute(el, 'src')).toBe('https://example.com/a.png');
  });

  it('readAllowedAttribute never returns a non-allowlisted attribute, even if present on the element', () => {
    const el = document.createElement('div');
    el.setAttribute('onclick', 'alert(1)');
    el.setAttribute('id', 'should-not-be-read');
    el.setAttribute('class', 'should-not-be-read');
    expect(readAllowedAttribute(el, 'onclick')).toBeNull();
    expect(readAllowedAttribute(el, 'id')).toBeNull();
    expect(readAllowedAttribute(el, 'class')).toBeNull();
  });

  it('the allowlist itself is exactly the approved attribute set', () => {
    expect([...ATTRIBUTE_ALLOWLIST].sort()).toEqual(
      ['align', 'alt', 'background', 'bgcolor', 'colspan', 'height', 'href', 'role', 'rowspan', 'src', 'srcset', 'style', 'title', 'valign', 'width'].sort(),
    );
  });
});

describe('extractStyleDeclarations — inline CSS security + parsing', () => {
  it('parses ordinary safe declarations', () => {
    const declarations = extractStyleDeclarations('color:#ffffff; padding: 10px; text-align:center;');
    expect(declarations.get('color')).toBe('#ffffff');
    expect(declarations.get('padding')).toBe('10px');
    expect(declarations.get('text-align')).toBe('center');
  });

  it('discards the WHOLE declaration block when it fails the reused Custom CSS security check', () => {
    const declarations = extractStyleDeclarations('color:#fff; background:url(javascript:alert(1));');
    expect(declarations.size).toBe(0);
  });

  it('rejects an expression() CSS injection attempt', () => {
    const declarations = extractStyleDeclarations('width:expression(alert(1));');
    expect(declarations.size).toBe(0);
  });

  it('rejects an @import attempt embedded in a style attribute', () => {
    const declarations = extractStyleDeclarations('color:#fff; content: "@import url(evil.css)";');
    expect(declarations.size).toBe(0);
  });

  it('returns an empty map for an empty style string', () => {
    expect(extractStyleDeclarations('').size).toBe(0);
    expect(extractStyleDeclarations('   ').size).toBe(0);
  });
});
