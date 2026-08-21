import { describe, expect, it } from 'vitest';
import { renderEmailBody } from './htmlRenderer';
import { createModule } from './moduleFactory';
import type {
  CtaModuleProps, EmailModule, FooterModuleProps, HeaderModuleProps, HeroModuleProps, ProductGridModuleProps,
  SocialModuleProps,
} from './edm';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper accepts modules narrowed to any specific Props type
function withModules(modules: EmailModule<any>[], width = 700) {
  return { width, content: { version: 1 as const, modules } };
}

function assertTableFirst(html: string) {
  expect(html).toContain('<table');
  expect(html).toContain('role="presentation"');
  expect(html).toContain('cellpadding="0"');
  expect(html).toContain('cellspacing="0"');
  expect(html).not.toMatch(/display:\s*flex/);
  expect(html).not.toMatch(/display:\s*grid/);
  expect(html).not.toContain('<div class');
}

describe('Feature 04 catalog renderers — table-first email HTML', () => {
  it('multi-column layouts (4/5/6 col) render one <td> per column', () => {
    for (const [type, expectedCount] of [['layout-4col', 4], ['layout-5col', 5], ['layout-6col', 6]] as const) {
      const html = renderEmailBody(withModules([createModule(type, 0)]));
      assertTableFirst(html);
      const cellCount = (html.match(/<td width="/g) ?? []).length;
      expect(cellCount, type).toBe(expectedCount);
    }
  });

  it('header modules render a logo <img> and are table-first', () => {
    const header = createModule('header-logo-nav', 0) as unknown as EmailModule<HeaderModuleProps>;
    header.props = { ...header.props, logoSrc: 'https://example.com/logo.png', logoAlt: 'Acme' };
    const html = renderEmailBody(withModules([header]));
    assertTableFirst(html);
    expect(html).toContain('<img');
    expect(html).toContain('alt="Acme"');
    expect(html).toContain('Shop');
  });

  it('a header module escapes nav link labels', () => {
    const header = createModule('header-logo-nav', 0) as unknown as EmailModule<HeaderModuleProps>;
    header.props = { ...header.props, navLinks: [{ label: '<script>alert(1)</script>', href: '' }] };
    const html = renderEmailBody(withModules([header]));
    expect(html).not.toContain('<script>alert(1)</script>');
  });

  it('hero modules render a headline, CTA button and are table-first', () => {
    const hero = createModule('hero-image-cta', 0) as unknown as EmailModule<HeroModuleProps>;
    hero.props = { ...hero.props, headline: 'Big Sale', ctaText: 'Shop Now', ctaHref: 'https://example.com' };
    const html = renderEmailBody(withModules([hero]));
    assertTableFirst(html);
    expect(html).toContain('Big Sale');
    expect(html).toContain('Shop Now');
    expect(html).toContain('href="https://example.com"');
  });

  it('hero CTA rejects a javascript: URL', () => {
    const hero = createModule('hero-text-only', 0) as unknown as EmailModule<HeroModuleProps>;
    hero.props = { ...hero.props, ctaHref: 'javascript:alert(1)' };
    const html = renderEmailBody(withModules([hero]));
    expect(html).not.toContain('javascript:alert');
  });

  it('product modules render each item\'s name/price/CTA and are table-first', () => {
    const product = createModule('product-three-cards', 0) as unknown as EmailModule<ProductGridModuleProps>;
    const html = renderEmailBody(withModules([product]));
    assertTableFirst(html);
    expect(product.props.items).toHaveLength(3);
    for (const item of product.props.items) {
      expect(html).toContain(item.name);
      expect(html).toContain(item.price);
    }
  });

  it('product grid item text is escaped', () => {
    const product = createModule('product-single', 0) as unknown as EmailModule<ProductGridModuleProps>;
    product.props = { items: [{ ...product.props.items[0], name: '<script>alert(1)</script>' }] };
    const html = renderEmailBody(withModules([product]));
    expect(html).not.toContain('<script>alert(1)</script>');
  });

  it('CTA modules render the button(s) and are table-first', () => {
    const dual = createModule('cta-dual', 0) as unknown as EmailModule<CtaModuleProps>;
    dual.props = { ...dual.props, ctaText: 'Primary', secondaryCtaText: 'Secondary' };
    const html = renderEmailBody(withModules([dual]));
    assertTableFirst(html);
    expect(html).toContain('Primary');
    expect(html).toContain('Secondary');
  });

  it('footer modules render legal text and an unsubscribe link, and are table-first', () => {
    const footer = createModule('footer-preference-unsubscribe', 0) as unknown as EmailModule<FooterModuleProps>;
    footer.props = { ...footer.props, unsubscribeHref: 'https://example.com/unsub' };
    const html = renderEmailBody(withModules([footer]));
    assertTableFirst(html);
    expect(html).toContain(footer.props.legalText);
    expect(html).toContain('href="https://example.com/unsub"');
  });

  it('footer unsubscribe link rejects a javascript: URL', () => {
    const footer = createModule('footer-simple-legal', 0) as unknown as EmailModule<FooterModuleProps>;
    footer.props = { ...footer.props, unsubscribeHref: 'javascript:alert(1)' };
    const html = renderEmailBody(withModules([footer]));
    expect(html).not.toContain('javascript:alert');
  });

  it('social modules render each platform as a link and are table-first', () => {
    const social = createModule('social-follow-us', 0) as unknown as EmailModule<SocialModuleProps>;
    const html = renderEmailBody(withModules([social]));
    assertTableFirst(html);
    for (const platform of social.props.platforms) {
      expect(html).toContain(platform.label);
    }
  });

  it('social platform links are sanitized against javascript: URLs', () => {
    const social = createModule('social-icon-row', 0) as unknown as EmailModule<SocialModuleProps>;
    social.props = { ...social.props, platforms: [{ label: 'Evil', href: 'javascript:alert(1)' }] };
    const html = renderEmailBody(withModules([social]));
    expect(html).not.toContain('javascript:alert');
  });
});
