import { describe, expect, it } from 'vitest';
import {
  canRenderVmlButton, estimateVmlBackgroundHeightPx,
  renderVmlBackground, renderVmlButton, supportsVmlBackgroundPattern, supportsVmlButtonPattern,
} from './vml';
import { createModule } from './moduleFactory';
import { renderEmailBody } from './htmlRenderer';
import type {
  ArticleTeaserModuleProps, ButtonModuleProps, CompositeModuleProps, CtaModuleProps, ContentBlockModuleProps,
  EmailDocumentContent, EmailModule, FooterModuleProps, HeaderModuleProps, HeroModuleProps,
  ProductGridModuleProps, SocialModuleProps,
} from './edm';

function contentOf(modules: EmailModule[]): EmailDocumentContent {
  return { version: 1, modules };
}

// Sub-phase 6 closure — the capability is now manifest-driven (each
// module definition's OWN `supportsBulletproofCta`/
// `supportsBulletproofBackground` field), never a hardcoded list here.
// This covers every family the reconciliation identified as a genuine
// clickable CTA/button. Sub-phase 6's final reconciliation added the
// bordered/rounded "pill" link modules (social-icon-row, social-follow-us,
// footer-social-legal) to this list too: Classic Outlook's Word engine
// ignores CSS border-radius regardless of background fill, so an unfilled
// bordered pill degrades to a square-cornered rectangle just like an
// unfilled button would — "no background fill" alone was not sufficient
// justification to exclude them. Genuinely excluded: plain text/nav
// links with no visual container at all (header-logo-nav, the
// article-teaser "Read More" link, footer's unsubscribe/preference links).
describe('VML capability predicates', () => {
  it('recognizes every genuine CTA/button-rendering module family, including bordered pill links', () => {
    const buttonLikeTypes = [
      'button', 'cta-centered', 'cta-banner', 'cta-text-cta', 'cta-dual',
      'content-heading-text-cta', 'content-image-left', 'content-image-right', 'content-image-top',
      'hero-image-cta', 'hero-background-image', 'hero-text-only', 'hero-image-left', 'hero-image-right', 'hero-centered-promo',
      'header-logo-cta', 'product-single', 'product-two-cards', 'product-three-cards', 'product-image-price-cta', 'product-grid',
      'image-text', 'text-image', 'social-icon-row', 'social-follow-us', 'footer-social-legal',
    ] as const;
    for (const type of buttonLikeTypes) {
      expect(supportsVmlButtonPattern(type), type).toBe(true);
    }
  });

  it('does NOT flag plain text/navigation links (no bordered/rounded container at all) as CTA buttons', () => {
    const nonButtonTypes = [
      'text', 'header-logo-nav',
      'content-article-teaser', 'footer-preference-unsubscribe', 'footer-simple-legal', 'footer-address-contact',
      'content-icon-text-rows', 'divider', 'spacer',
    ] as const;
    for (const type of nonButtonTypes) {
      expect(supportsVmlButtonPattern(type), type).toBe(false);
    }
  });

  it('only hero-background-image supports the VML background pattern', () => {
    expect(supportsVmlBackgroundPattern('hero-background-image')).toBe(true);
    expect(supportsVmlBackgroundPattern('hero-image-cta')).toBe(false);
    expect(supportsVmlBackgroundPattern('button')).toBe(false);
  });

  it('declines a full-width button — no untested VML percentage-width pattern', () => {
    expect(canRenderVmlButton({ widthMode: 'full' })).toBe(false);
    expect(canRenderVmlButton({ widthMode: 'auto' })).toBe(true);
    expect(canRenderVmlButton({ widthMode: 'fixed' })).toBe(true);
    expect(canRenderVmlButton({})).toBe(true); // widthMode omitted defaults to 'auto'-safe
  });
});

describe('renderVmlButton', () => {
  const input = {
    href: 'https://example.com/buy',
    text: 'Shop Now',
    backgroundColor: '#0082AD',
    textColor: '#FFFFFF',
    fontSize: 15,
    borderRadius: 6,
    widthMode: 'fixed' as const,
    fixedWidth: 200,
    paddingHorizontal: 24,
    paddingVertical: 12,
  };
  const plainHtml = '<a href="https://example.com/buy">Shop Now</a>';

  it('wraps VML strictly inside [if mso] ... [endif]', () => {
    const html = renderVmlButton(input, plainHtml);
    const vmlBlock = html.split('<!--[if mso]>')[1].split('<![endif]-->')[0];
    expect(vmlBlock).toContain('<v:roundrect');
    expect(vmlBlock).toContain('</v:roundrect>');
  });

  it('wraps the plain HTML fallback strictly inside [if !mso]<!-- ... <![endif]', () => {
    const html = renderVmlButton(input, plainHtml);
    expect(html).toContain(`<!--[if !mso]><!-->\n${plainHtml}\n<!--<![endif]-->`);
  });

  it('carries the real href/text/colors — never a fabricated value', () => {
    const html = renderVmlButton(input, plainHtml);
    expect(html).toContain('href="https://example.com/buy"');
    expect(html).toContain('>Shop Now<');
    expect(html).toContain('fillcolor="#0082AD"');
    expect(html).toContain('color:#FFFFFF');
  });

  it('uses the exact fixedWidth when widthMode is fixed', () => {
    const html = renderVmlButton(input, plainHtml);
    expect(html).toContain('width:200px');
  });

  it('a filled button uses stroke="f" with the real fillcolor, never strokecolor', () => {
    const html = renderVmlButton(input, plainHtml);
    expect(html).toContain('stroke="f"');
    expect(html).not.toContain('strokecolor');
  });

  it('an outline/border-only button (empty backgroundColor) uses stroke="t" with the real border color/width', () => {
    const outline = { ...input, backgroundColor: '', borderColor: '#0082AD', borderWidth: 2 };
    const html = renderVmlButton(outline, plainHtml);
    expect(html).toContain('stroke="t"');
    expect(html).toContain('strokecolor="#0082AD"');
    expect(html).toContain('strokeweight="2px"');
    expect(html).toContain('fillcolor="none"');
  });

  it('an outline button with backgroundColor "transparent" is also treated as unfilled', () => {
    const outline = { ...input, backgroundColor: 'transparent', borderColor: '#0082AD', borderWidth: 1 };
    const html = renderVmlButton(outline, plainHtml);
    expect(html).toContain('stroke="t"');
    expect(html).toContain('fillcolor="none"');
  });

  it('an outline button with no explicit borderColor falls back to the text color for the stroke', () => {
    const outline = { ...input, backgroundColor: '', borderColor: undefined, borderWidth: undefined };
    const html = renderVmlButton(outline, plainHtml);
    expect(html).toContain(`strokecolor="${input.textColor}"`);
    expect(html).toContain('strokeweight="1px"');
  });

  it('computes a deterministic (not fabricated) width estimate for auto width mode', () => {
    const auto = { ...input, widthMode: 'auto' as const, fixedWidth: undefined };
    const html1 = renderVmlButton(auto, plainHtml);
    const html2 = renderVmlButton(auto, plainHtml);
    expect(html1).toBe(html2); // deterministic
    expect(html1).toMatch(/width:\d+px/);
  });

  it('computes arcsize from the real borderRadius, 0 for a square button', () => {
    const square = { ...input, borderRadius: 0 };
    const html = renderVmlButton(square, plainHtml);
    expect(html).toContain('arcsize="0%"');
    const rounded = renderVmlButton(input, plainHtml);
    expect(rounded).toMatch(/arcsize="\d+%"/);
    expect(rounded).not.toContain('arcsize="0%"');
  });

  it('computes a pill arcsize (capped at 50%) for a borderRadius that would otherwise exceed it', () => {
    const pill = { ...input, borderRadius: 999 };
    const html = renderVmlButton(pill, plainHtml);
    expect(html).toContain('arcsize="50%"');
  });

  it('handles long CTA text with a deterministic, non-fabricated wider width estimate', () => {
    const auto = { ...input, widthMode: 'auto' as const, fixedWidth: undefined };
    const short = renderVmlButton(auto, plainHtml);
    const long = { ...auto, text: 'Shop Our Entire Summer Collection Today' };
    const html = renderVmlButton(long, plainHtml);
    const shortWidth = Number(short.match(/width:(\d+)px/)?.[1]);
    const longWidth = Number(html.match(/width:(\d+)px/)?.[1]);
    expect(longWidth).toBeGreaterThan(shortWidth);
    expect(html).toContain('>Shop Our Entire Summer Collection Today<');
  });

  it('escapes button text and href — never raw injected markup', () => {
    const unsafe = { ...input, text: '<script>alert(1)</script>', href: 'javascript:alert(1)' };
    const html = renderVmlButton(unsafe, plainHtml);
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('javascript:alert');
  });
});

describe('renderVmlBackground', () => {
  const input = { imageSrc: 'https://cdn.example.com/hero.jpg', backgroundColor: '#002D38', paddingTop: 32, paddingBottom: 32 };
  const plainHtml = '<table><tr><td>content</td></tr></table>';

  it('wraps VML strictly inside [if gte mso 9] ... [endif]', () => {
    const html = renderVmlBackground(input, 700, plainHtml);
    expect(html).toContain('<!--[if gte mso 9]>');
    expect(html).toContain('<v:rect');
    expect(html).toContain('<v:fill type="tile"');
    expect(html).toContain('<v:textbox');
  });

  it('carries the plain HTML fallback between the VML open and close blocks', () => {
    const html = renderVmlBackground(input, 700, plainHtml);
    const afterOpen = html.split('<v:textbox inset="0,0,0,0">\n<![endif]-->\n')[1];
    expect(afterOpen.startsWith(plainHtml)).toBe(true);
  });

  it('uses the real image src, never a fabricated URL', () => {
    const html = renderVmlBackground(input, 700, plainHtml);
    expect(html).toContain('src="https://cdn.example.com/hero.jpg"');
  });

  it('estimates height deterministically from real padding, documented as an estimate', () => {
    const height = estimateVmlBackgroundHeightPx(input);
    expect(height).toBe(input.paddingTop + input.paddingBottom + 120);
    const html = renderVmlBackground(input, 700, plainHtml);
    expect(html).toContain(`height:${height}px`);
  });

  it('rejects an unsafe image scheme via the shared sanitizeUrl gate', () => {
    const html = renderVmlBackground({ ...input, imageSrc: 'javascript:alert(1)' }, 700, plainHtml);
    expect(html).not.toContain('javascript:alert');
  });
});

describe('VML integration — button module, full rendered document', () => {
  it('renders no VML when outlookVml is unset (existing behavior unchanged)', () => {
    const button = createModule('button', 0) as unknown as EmailModule<ButtonModuleProps>;
    const html = renderEmailBody({ width: 700, content: contentOf([button]) });
    expect(html).not.toContain('v:roundrect');
  });

  it('renders real VML paired with the HTML fallback when outlookVml is enabled', () => {
    const button = createModule('button', 0) as unknown as EmailModule<ButtonModuleProps>;
    button.settings = { ...button.settings, outlookVml: true };
    const html = renderEmailBody({ width: 700, content: contentOf([button]) });
    expect(html).toContain('v:roundrect');
    expect(html).toContain('<!--[if !mso]><!-->');
    expect(html).toContain('<a href=');
  });

  it('declines VML for a full-width button even when outlookVml is enabled', () => {
    const button = createModule('button', 0) as unknown as EmailModule<ButtonModuleProps>;
    button.settings = { ...button.settings, outlookVml: true };
    button.props = { ...button.props, widthMode: 'full' };
    const html = renderEmailBody({ width: 700, content: contentOf([button]) });
    expect(html).not.toContain('v:roundrect');
  });
});

describe('VML integration — hero-background-image module, full rendered document', () => {
  it('renders no VML when outlookVml is unset (existing behavior unchanged)', () => {
    const hero = createModule('hero-background-image', 0) as unknown as EmailModule<HeroModuleProps>;
    const html = renderEmailBody({ width: 700, content: contentOf([hero]) });
    expect(html).not.toContain('v:rect');
  });

  it('renders real VML background paired with the HTML fallback when outlookVml is enabled', () => {
    const hero = createModule('hero-background-image', 0) as unknown as EmailModule<HeroModuleProps>;
    hero.settings = { ...hero.settings, outlookVml: true };
    hero.props = { ...hero.props, imageSrc: 'https://cdn.example.com/hero.jpg' };
    const html = renderEmailBody({ width: 700, content: contentOf([hero]) });
    expect(html).toContain('<!--[if gte mso 9]>');
    expect(html).toContain('<v:rect');
    expect(html).toContain('background="https://cdn.example.com/hero.jpg"');
  });

  it('also VML-wraps its own CTA button, nested inside the background ghost-table', () => {
    const hero = createModule('hero-background-image', 0) as unknown as EmailModule<HeroModuleProps>;
    hero.settings = { ...hero.settings, outlookVml: true };
    hero.props = { ...hero.props, imageSrc: 'https://cdn.example.com/hero.jpg', ctaHref: 'https://example.com/shop', ctaText: 'Shop Now' };
    const html = renderEmailBody({ width: 700, content: contentOf([hero]) });
    expect(html).toContain('<v:rect');
    expect(html).toContain('<v:roundrect');
    expect(html).toContain('href="https://example.com/shop"');
  });
});

describe('VML integration — image-text / text-image composite module (nested text.ctaText)', () => {
  it('renders no VML when outlookVml is unset, or when no ctaText is set', () => {
    const module = createModule('image-text', 0) as unknown as EmailModule<CompositeModuleProps>;
    const html = renderEmailBody({ width: 700, content: contentOf([module]) });
    expect(html).not.toContain('v:roundrect');

    module.settings = { ...module.settings, outlookVml: true };
    const htmlNoCta = renderEmailBody({ width: 700, content: contentOf([module]) });
    expect(htmlNoCta).not.toContain('v:roundrect');
  });

  it('renders VML paired with the HTML fallback when outlookVml is enabled and a real CTA is set', () => {
    const module = createModule('text-image', 0) as unknown as EmailModule<CompositeModuleProps>;
    module.settings = { ...module.settings, outlookVml: true };
    module.props = { ...module.props, text: { ...module.props.text, ctaText: 'Shop Now', ctaHref: 'https://example.com/shop' } };
    const html = renderEmailBody({ width: 700, content: contentOf([module]) });
    expect(html).toContain('<v:roundrect');
    expect(html).toContain('href="https://example.com/shop"');
    expect(html).toContain('<!--[if !mso]><!-->');
  });
});

describe('VML integration — cta-dual module (two independent CTAs, one filled + one outline)', () => {
  it('renders no VML for either button when outlookVml is unset', () => {
    const module = createModule('cta-dual', 0) as unknown as EmailModule<CtaModuleProps>;
    const html = renderEmailBody({ width: 700, content: contentOf([module]) });
    expect(html).not.toContain('v:roundrect');
  });

  it('renders two independent VML buttons — filled primary (stroke="f") and outline secondary (stroke="t")', () => {
    const module = createModule('cta-dual', 0) as unknown as EmailModule<CtaModuleProps>;
    module.settings = { ...module.settings, outlookVml: true };
    module.props = {
      ...module.props,
      ctaHref: 'https://example.com/primary', ctaText: 'Get Started',
      secondaryCtaHref: 'https://example.com/secondary', secondaryCtaText: 'Learn More',
    };
    const html = renderEmailBody({ width: 700, content: contentOf([module]) });
    expect(html.match(/<v:roundrect/g)).toHaveLength(2);
    expect(html).toContain('stroke="f"');
    expect(html).toContain('stroke="t"');
    expect(html).toContain('href="https://example.com/primary"');
    expect(html).toContain('href="https://example.com/secondary"');
  });

  it('escapes an unsafe URL on either CTA — never a fabricated or raw-injected href', () => {
    const module = createModule('cta-dual', 0) as unknown as EmailModule<CtaModuleProps>;
    module.settings = { ...module.settings, outlookVml: true };
    module.props = { ...module.props, ctaHref: 'javascript:alert(1)', secondaryCtaHref: 'javascript:alert(2)' };
    const html = renderEmailBody({ width: 700, content: contentOf([module]) });
    expect(html).not.toContain('javascript:alert');
  });
});

describe('VML integration — content-heading-text-cta module (and the withCta content-image variants)', () => {
  it('renders VML paired with the HTML fallback when outlookVml is enabled', () => {
    const module = createModule('content-heading-text-cta', 0) as unknown as EmailModule<ContentBlockModuleProps>;
    module.settings = { ...module.settings, outlookVml: true };
    module.props = { ...module.props, ctaHref: 'https://example.com/read', ctaText: 'Read More' };
    const html = renderEmailBody({ width: 700, content: contentOf([module]) });
    expect(html).toContain('<v:roundrect');
    expect(html).toContain('<!--[if !mso]><!-->');
  });

  it('the CTA-less Heading + Text variant never renders VML even when outlookVml is enabled', () => {
    const module = createModule('content-heading-text', 0) as unknown as EmailModule<ContentBlockModuleProps>;
    module.settings = { ...module.settings, outlookVml: true };
    const html = renderEmailBody({ width: 700, content: contentOf([module]) });
    expect(html).not.toContain('v:roundrect');
  });

  it('content-image-left renders VML for its CTA (representative of the image-left/right/top withCta variants)', () => {
    const module = createModule('content-image-left', 0) as unknown as EmailModule<ContentBlockModuleProps>;
    module.settings = { ...module.settings, outlookVml: true };
    module.props = { ...module.props, ctaHref: 'https://example.com/shop', ctaText: 'Shop Now' };
    const html = renderEmailBody({ width: 700, content: contentOf([module]) });
    expect(html).toContain('<v:roundrect');
  });
});

describe('VML integration — header-logo-cta module; header-logo-nav plain links are never converted', () => {
  it('renders VML for the CTA button when outlookVml is enabled', () => {
    const module = createModule('header-logo-cta', 0) as unknown as EmailModule<HeaderModuleProps>;
    module.settings = { ...module.settings, outlookVml: true };
    module.props = { ...module.props, ctaHref: 'https://example.com/shop', ctaText: 'Shop Now' };
    const html = renderEmailBody({ width: 700, content: contentOf([module]) });
    expect(html).toContain('<v:roundrect');
  });

  it('header-logo-nav renders its navLinks as plain text links — never VML-wrapped, even with outlookVml enabled', () => {
    const module = createModule('header-logo-nav', 0) as unknown as EmailModule<HeaderModuleProps>;
    module.settings = { ...module.settings, outlookVml: true };
    const html = renderEmailBody({ width: 700, content: contentOf([module]) });
    expect(html).not.toContain('v:roundrect');
  });
});

describe('VML integration — hero variants share the same button pairing (centered/left/right/text-only)', () => {
  it.each([
    ['hero-image-cta', 'center'],
    ['hero-text-only', 'center'],
    ['hero-image-left', 'left'],
    ['hero-image-right', 'left'],
    ['hero-centered-promo', 'center'],
  ] as const)('%s renders VML for its CTA regardless of alignment', (type, _align) => {
    const module = createModule(type, 0) as unknown as EmailModule<HeroModuleProps>;
    module.settings = { ...module.settings, outlookVml: true };
    module.props = { ...module.props, ctaHref: 'https://example.com/learn', ctaText: 'Learn More' };
    const html = renderEmailBody({ width: 700, content: contentOf([module]) });
    expect(html).toContain('<v:roundrect');
  });
});

describe('VML integration — multi-CTA product modules (independent per-item VML)', () => {
  it('product-single (one item) renders exactly one VML button', () => {
    const module = createModule('product-single', 0) as unknown as EmailModule<ProductGridModuleProps>;
    module.settings = { ...module.settings, outlookVml: true };
    const html = renderEmailBody({ width: 700, content: contentOf([module]) });
    expect(html.match(/<v:roundrect/g)).toHaveLength(1);
  });

  it('product-two-cards (two items) renders two independent VML buttons, each with its own real href', () => {
    const module = createModule('product-two-cards', 0) as unknown as EmailModule<ProductGridModuleProps>;
    module.settings = { ...module.settings, outlookVml: true };
    module.props = {
      ...module.props,
      items: module.props.items.map((item, i) => ({ ...item, ctaHref: `https://example.com/product-${i}` })),
    };
    const html = renderEmailBody({ width: 700, content: contentOf([module]) });
    expect(html.match(/<v:roundrect/g)).toHaveLength(2);
    expect(html).toContain('href="https://example.com/product-0"');
    expect(html).toContain('href="https://example.com/product-1"');
  });

  it('product-grid (four items) renders four independent VML buttons', () => {
    const module = createModule('product-grid', 0) as unknown as EmailModule<ProductGridModuleProps>;
    module.settings = { ...module.settings, outlookVml: true };
    const html = renderEmailBody({ width: 700, content: contentOf([module]) });
    expect(html.match(/<v:roundrect/g)).toHaveLength(4);
  });

  it('renders no VML for any item when outlookVml is unset', () => {
    const module = createModule('product-grid', 0) as unknown as EmailModule<ProductGridModuleProps>;
    const html = renderEmailBody({ width: 700, content: contentOf([module]) });
    expect(html).not.toContain('v:roundrect');
  });
});

describe('VML integration — bordered/rounded "pill" links (social-icon-row, social-follow-us, footer-social-legal)', () => {
  it('social-icon-row: renders no VML when outlookVml is unset (existing behavior unchanged)', () => {
    const module = createModule('social-icon-row', 0) as unknown as EmailModule<SocialModuleProps>;
    const html = renderEmailBody({ width: 700, content: contentOf([module]) });
    expect(html).not.toContain('v:roundrect');
  });

  it('social-icon-row: renders an independent outline VML pill per platform when outlookVml is enabled', () => {
    const module = createModule('social-icon-row', 0) as unknown as EmailModule<SocialModuleProps>;
    module.settings = { ...module.settings, outlookVml: true };
    module.props = {
      ...module.props,
      platforms: [
        { label: 'Facebook', href: 'https://facebook.com/example' },
        { label: 'Instagram', href: 'https://instagram.com/example' },
        { label: 'LinkedIn', href: 'https://linkedin.com/example' },
      ],
    };
    const html = renderEmailBody({ width: 700, content: contentOf([module]) });
    // Multiple pill links in one module — each gets its own VML shape.
    expect(html.match(/<v:roundrect/g)).toHaveLength(3);
    expect(html).toContain('href="https://facebook.com/example"');
    expect(html).toContain('href="https://instagram.com/example"');
    expect(html).toContain('href="https://linkedin.com/example"');
    // Transparent outline pill — unfilled, real border color/width, real
    // pill geometry (arcsize capped at 50% by borderRadius:999).
    expect(html).toContain('stroke="t"');
    expect(html).toContain('strokecolor="#B8C8CD"');
    expect(html).toContain('strokeweight="1px"');
    expect(html).toContain('fillcolor="none"');
    expect(html).toContain('arcsize="50%"');
    expect(html).not.toContain('stroke="f"');
  });

  it('social-icon-row: escapes an unsafe platform URL — never a raw-injected href', () => {
    const module = createModule('social-icon-row', 0) as unknown as EmailModule<SocialModuleProps>;
    module.settings = { ...module.settings, outlookVml: true };
    module.props = { ...module.props, platforms: [{ label: 'Facebook', href: 'javascript:alert(1)' }] };
    const html = renderEmailBody({ width: 700, content: contentOf([module]) });
    expect(html).not.toContain('javascript:alert');
  });

  it('social-icon-row: VML is strictly [if mso]-scoped; the plain-HTML pill fallback is strictly [if !mso]-scoped (Classic vs. New Outlook separation)', () => {
    const module = createModule('social-icon-row', 0) as unknown as EmailModule<SocialModuleProps>;
    module.settings = { ...module.settings, outlookVml: true };
    const html = renderEmailBody({ width: 700, content: contentOf([module]) });
    const msoBlocks = [...html.matchAll(/<!--\[if mso\]>([\s\S]*?)<!\[endif\]-->/g)].map((m) => m[1]);
    const pillMsoBlocks = msoBlocks.filter((block) => block.includes('<v:roundrect'));
    expect(pillMsoBlocks.length).toBe(module.props.platforms.length);
    const nonMsoBlocks = [...html.matchAll(/<!--\[if !mso\]><!-->([\s\S]*?)<!--<!\[endif\]-->/g)].map((m) => m[1]);
    for (const block of nonMsoBlocks) expect(block).not.toContain('v:roundrect');
    // New Outlook (ignores [if mso] entirely) still gets a real, clickable
    // plain <a> pill per platform.
    const newOutlookView = html.replace(/<!--\[if mso\]>[\s\S]*?<!\[endif\]-->/g, '');
    expect(newOutlookView).not.toContain('v:roundrect');
    expect((newOutlookView.match(/<a href="[^"]*"[^>]*border-radius:999px/g) ?? []).length).toBe(module.props.platforms.length);
  });

  it('social-follow-us: same shared pill VML pairing applies', () => {
    const module = createModule('social-follow-us', 0) as unknown as EmailModule<SocialModuleProps>;
    module.settings = { ...module.settings, outlookVml: true };
    const html = renderEmailBody({ width: 700, content: contentOf([module]) });
    expect(html.match(/<v:roundrect/g)?.length).toBe(module.props.platforms.length);
  });

  it('footer-social-legal: renders VML for the social pills but leaves the unsubscribe/preference text links as plain underlined text', () => {
    const module = createModule('footer-social-legal', 0) as unknown as EmailModule<FooterModuleProps>;
    module.settings = { ...module.settings, outlookVml: true };
    module.props = { ...module.props, preferenceText: 'Manage preferences', preferenceHref: 'https://example.com/prefs' };
    const html = renderEmailBody({ width: 700, content: contentOf([module]) });
    expect(html.match(/<v:roundrect/g)?.length).toBe(module.props.socialPlatforms.length);
    // The unsubscribe/preference anchors are never wrapped in VML — they
    // carry no border/border-radius styling at all.
    expect(html).toContain('text-decoration:underline');
    const nonMsoBlocks = [...html.matchAll(/<!--\[if !mso\]><!-->([\s\S]*?)<!--<!\[endif\]-->/g)].map((m) => m[1]);
    const unsubscribeIsWrapped = nonMsoBlocks.some((b) => b.includes('Manage preferences'));
    expect(unsubscribeIsWrapped).toBe(false);
  });

  it('footer-social-legal: renders no VML when outlookVml is unset (existing behavior unchanged)', () => {
    const module = createModule('footer-social-legal', 0) as unknown as EmailModule<FooterModuleProps>;
    const html = renderEmailBody({ width: 700, content: contentOf([module]) });
    expect(html).not.toContain('v:roundrect');
  });
});

describe('VML — plain text/navigation links (no bordered/rounded container) are never converted into VML', () => {
  it('header-logo-nav plain nav links stay plain HTML even with outlookVml enabled', () => {
    const module = createModule('header-logo-nav', 0) as unknown as EmailModule<HeaderModuleProps>;
    module.settings = { ...module.settings, outlookVml: true };
    const html = renderEmailBody({ width: 700, content: contentOf([module]) });
    expect(html).not.toContain('v:roundrect');
  });

  it('footer-preference-unsubscribe plain underlined links stay plain HTML', () => {
    const module = createModule('footer-preference-unsubscribe', 0) as unknown as EmailModule<FooterModuleProps>;
    const html = renderEmailBody({ width: 700, content: contentOf([module]) });
    expect(html).not.toContain('v:roundrect');
  });

  it('content-article-teaser\'s "Read More" link stays a plain text link', () => {
    const module = createModule('content-article-teaser', 0) as unknown as EmailModule<ArticleTeaserModuleProps>;
    const html = renderEmailBody({ width: 700, content: contentOf([module]) });
    expect(html).not.toContain('v:roundrect');
  });
});

describe('VML — Classic Outlook / New Outlook conditional-comment separation (structural, not just content)', () => {
  it('cta-dual: every v:roundrect is strictly inside [if mso]...[endif], every plain <a> fallback strictly inside [if !mso]<!--...<!--[endif]', () => {
    const module = createModule('cta-dual', 0) as unknown as EmailModule<CtaModuleProps>;
    module.settings = { ...module.settings, outlookVml: true };
    module.props = { ...module.props, ctaHref: 'https://example.com/primary', secondaryCtaHref: 'https://example.com/secondary' };
    const html = renderEmailBody({ width: 700, content: contentOf([module]) });
    // The document also has its own unrelated outer [if mso] width-table
    // wrapper (a separate, pre-existing bulletproof-email technique) — so
    // only the mso blocks containing a v:roundrect are the button ones;
    // there must be exactly 2 (one per CTA).
    const msoBlocks = [...html.matchAll(/<!--\[if mso\]>([\s\S]*?)<!\[endif\]-->/g)].map((m) => m[1]);
    const buttonMsoBlocks = msoBlocks.filter((block) => block.includes('<v:roundrect'));
    expect(buttonMsoBlocks).toHaveLength(2);
    // The critical Outlook-safety property: no plain-HTML fallback block
    // ever ALSO contains a v:roundrect (would double-render the button).
    const nonMsoBlocks = [...html.matchAll(/<!--\[if !mso\]><!-->([\s\S]*?)<!--<!\[endif\]-->/g)].map((m) => m[1]);
    expect(nonMsoBlocks.length).toBeGreaterThan(0);
    for (const block of nonMsoBlocks) expect(block).not.toContain('v:roundrect');
  });

  it('product-grid: New Outlook (which never processes [if mso] comments) still receives a real plain <a> per item', () => {
    const module = createModule('product-grid', 0) as unknown as EmailModule<ProductGridModuleProps>;
    module.settings = { ...module.settings, outlookVml: true };
    module.props = {
      ...module.props,
      items: module.props.items.map((item, i) => ({ ...item, ctaHref: `https://example.com/product-${i}` })),
    };
    const html = renderEmailBody({ width: 700, content: contentOf([module]) });
    // Simulate what New Outlook (a Chromium engine that ignores MSO
    // conditional comments entirely) sees: strip every [if mso]...[endif]
    // block and confirm four real, clickable <a> buttons remain.
    const newOutlookView = html.replace(/<!--\[if mso\]>[\s\S]*?<!\[endif\]-->/g, '');
    expect(newOutlookView.match(/<a href="https:\/\/example\.com\/product-\d"/g)).toHaveLength(4);
    expect(newOutlookView).not.toContain('v:roundrect');
    expect(newOutlookView).toContain('<!--[if !mso]><!-->');
  });
});
