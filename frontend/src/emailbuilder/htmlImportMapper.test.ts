import { describe, expect, it } from 'vitest';
import { extractImportedTitle, mapImportedHtml } from './htmlImportMapper';
import { renderEmailHead } from './emailHead';
import { createEmptyContent } from './edm';
import type { EmailModule } from './edm';

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

function findingsOf(category: string, result: ReturnType<typeof mapImportedHtml>) {
  return result.findings.filter((f) => f.category === category);
}

describe('mapImportedHtml — simple text/heading/paragraph', () => {
  it('maps a plain paragraph to a Text module', () => {
    const result = mapImportedHtml(parse('<html><body><table><tr><td><p>Hello world</p></td></tr></table></body></html>'));
    expect(result.modules).toHaveLength(1);
    expect(result.modules[0].type).toBe('text');
    expect((result.modules[0].props as { text: string }).text).toContain('Hello world');
  });

  it('maps a heading and reads text-align/color from inline style', () => {
    const html = '<table><tr><td><h1 style="color:#112233; text-align:center;">Big Heading</h1></td></tr></table>';
    const result = mapImportedHtml(parse(html));
    const module = result.modules[0];
    expect(module.type).toBe('text');
    const props = module.props as { text: string; color: string; align: string };
    expect(props.text).toContain('Big Heading');
    expect(props.color).toBe('#112233');
    expect(props.align).toBe('center');
  });
});

describe('mapImportedHtml — image mapping', () => {
  it('maps an <img> with an absolute https src', () => {
    const html = '<table><tr><td><img src="https://example.com/a.png" alt="A"></td></tr></table>';
    const result = mapImportedHtml(parse(html));
    expect(result.modules).toHaveLength(1);
    expect(result.modules[0].type).toBe('image');
    const props = result.modules[0].props as { src: string; alt: string };
    expect(props.src).toBe('https://example.com/a.png');
    expect(props.alt).toBe('A');
  });
});

describe('mapImportedHtml — button predicate (positive/negative)', () => {
  it('maps a styled <a> (background-color + padding all sides) to a Button module', () => {
    const html = '<table><tr><td><a href="https://example.com/cta" style="background-color:#76c043; padding:12px 24px 12px 24px; color:#ffffff;">Shop Now</a></td></tr></table>';
    const result = mapImportedHtml(parse(html));
    expect(result.modules).toHaveLength(1);
    expect(result.modules[0].type).toBe('button');
    const props = result.modules[0].props as { text: string; href: string; backgroundColor: string };
    expect(props.text).toBe('Shop Now');
    expect(props.href).toBe('https://example.com/cta');
    expect(props.backgroundColor).toBe('#76c043');
  });

  it('does NOT classify an unstyled <a> as a Button (negative predicate) — degrades to text with a finding', () => {
    const html = '<table><tr><td><p>Visit <a href="https://example.com">our site</a> today.</p></td></tr></table>';
    const result = mapImportedHtml(parse(html));
    expect(result.modules.every((m) => m.type !== 'button')).toBe(true);
    expect(findingsOf('unsupported', result).some((f) => f.reason.includes('Inline/standalone hyperlinks'))).toBe(true);
  });

  it('does NOT classify an <a> with background-color but NO padding as a Button', () => {
    const html = '<table><tr><td><a href="https://example.com" style="background-color:#76c043;">Link</a></td></tr></table>';
    const result = mapImportedHtml(parse(html));
    expect(result.modules.every((m) => m.type !== 'button')).toBe(true);
  });

  it('does NOT classify an <a> with padding but NO background-color as a Button', () => {
    const html = '<table><tr><td><a href="https://example.com" style="padding:12px 24px 12px 24px;">Link</a></td></tr></table>';
    const result = mapImportedHtml(parse(html));
    expect(result.modules.every((m) => m.type !== 'button')).toBe(true);
  });

  it('maps a single-cell nested "bulletproof button" table to a Button, not a nested layout', () => {
    const html = `<table><tr><td>
      <table><tr><td><a href="https://example.com/go" style="background-color:#002d38; padding:10px 20px 10px 20px; color:#fff;">Go</a></td></tr></table>
    </td></tr></table>`;
    const result = mapImportedHtml(parse(html));
    expect(result.modules).toHaveLength(1);
    expect(result.modules[0].type).toBe('button');
    expect(findingsOf('structural-conversion', result)).toHaveLength(0);
  });
});

describe('mapImportedHtml — divider and list', () => {
  it('maps <hr> to a Divider module', () => {
    const result = mapImportedHtml(parse('<table><tr><td><hr></td></tr></table>'));
    expect(result.modules).toHaveLength(1);
    expect(result.modules[0].type).toBe('divider');
  });

  it('maps a <ul> to a Text module with items joined by newline, and reports normalization', () => {
    const html = '<table><tr><td><ul><li>One</li><li>Two</li><li>Three</li></ul></td></tr></table>';
    const result = mapImportedHtml(parse(html));
    expect(result.modules).toHaveLength(1);
    expect(result.modules[0].type).toBe('text');
    const props = result.modules[0].props as { text: string };
    expect(props.text).toBe('One\nTwo\nThree');
    expect(findingsOf('normalized', result).some((f) => f.source === '<ul>')).toBe(true);
  });
});

describe('mapImportedHtml — transparent containers (closed allowlist)', () => {
  it('unwraps <section>/<article>/<main>/<figure>/<figcaption>/<header>/<footer> — children still map, wrapper produces no finding', () => {
    for (const tag of ['section', 'article', 'main', 'header', 'footer']) {
      const html = `<table><tr><td><${tag}><p>Inside ${tag}</p></${tag}></td></tr></table>`;
      const result = mapImportedHtml(parse(html));
      expect(result.modules).toHaveLength(1);
      expect(result.modules[0].type).toBe('text');
      expect((result.modules[0].props as { text: string }).text).toContain(`Inside ${tag}`);
    }
  });

  it('unwraps <figure><figcaption> — image and caption both survive', () => {
    const html = '<table><tr><td><figure><img src="https://example.com/pic.png"><figcaption><p>A caption</p></figcaption></figure></td></tr></table>';
    const result = mapImportedHtml(parse(html));
    expect(result.modules.some((m) => m.type === 'image')).toBe(true);
    expect(result.modules.some((m) => m.type === 'text' && (m.props as { text: string }).text.includes('A caption'))).toBe(true);
  });

  it('unwrapping <header>/<footer> does NOT itself create a header-*/footer-* module — only content-based predicates ever do, and none is implemented for plain unwrapping', () => {
    const html = '<table><tr><td><header><p>Just text in a header wrapper</p></header></td></tr></table>';
    const result = mapImportedHtml(parse(html));
    expect(result.modules.every((m) => !m.type.startsWith('header-') && !m.type.startsWith('footer-'))).toBe(true);
  });

  it('does NOT generically unwrap an unknown/custom tag — its content does not survive', () => {
    const html = '<table><tr><td><x-widget><p>Should not survive</p></x-widget></td></tr></table>';
    const result = mapImportedHtml(parse(html));
    expect(result.modules).toHaveLength(0);
    expect(findingsOf('unsupported', result).some((f) => f.source === '<x-widget>')).toBe(true);
  });
});

describe('mapImportedHtml — dangerous subtree isolation', () => {
  it('strips a <script> and its contents while a SIBLING safe element still imports (scoped stripping, not parent-wide)', () => {
    const html = '<table><tr><td><div><script>alert(1)</script><p>Safe sibling text</p></div></td></tr></table>';
    const result = mapImportedHtml(parse(html));
    expect(result.modules.some((m) => m.type === 'text' && (m.props as { text: string }).text.includes('Safe sibling text'))).toBe(true);
    expect(findingsOf('security', result).some((f) => f.source === '<script>')).toBe(true);
  });

  it('strips <iframe>, <object>, <embed>, <form> each with a security finding', () => {
    for (const tag of ['iframe', 'object', 'embed', 'form']) {
      const html = `<table><tr><td><${tag}></${tag}><p>Still here</p></td></tr></table>`;
      const result = mapImportedHtml(parse(html));
      expect(findingsOf('security', result).some((f) => f.source === `<${tag}>`)).toBe(true);
      expect(result.modules.some((m) => m.type === 'text' && (m.props as { text: string }).text.includes('Still here'))).toBe(true);
    }
  });
});

describe('mapImportedHtml — data:/cid:/relative image resources (never silently rehosted)', () => {
  it('does not create an Image module for a data: URI, and reports it as unresolved-resource', () => {
    const html = '<table><tr><td><img src="data:image/png;base64,AAAA"></td></tr></table>';
    const result = mapImportedHtml(parse(html));
    expect(result.modules).toHaveLength(0);
    const found = findingsOf('unresolved-resource', result);
    expect(found).toHaveLength(1);
    expect(found[0].reason).toMatch(/unsupported for this import version/i);
  });

  it('does not create an Image module for a cid: reference', () => {
    const html = '<table><tr><td><img src="cid:image001.png@01D12345"></td></tr></table>';
    const result = mapImportedHtml(parse(html));
    expect(result.modules).toHaveLength(0);
    expect(findingsOf('unresolved-resource', result)[0].reason).toMatch(/attachment/i);
  });

  it('does not create an Image module for a relative URL', () => {
    const html = '<table><tr><td><img src="/images/a.png"></td></tr></table>';
    const result = mapImportedHtml(parse(html));
    expect(result.modules).toHaveLength(0);
    expect(findingsOf('unresolved-resource', result)).toHaveLength(1);
  });
});

describe('mapImportedHtml — srcset (approved amendment: never silently ignored)', () => {
  it('img with both src and srcset: uses src, creates the module, and reports the srcset loss', () => {
    const html = '<table><tr><td><img src="https://example.com/a.png" srcset="https://example.com/a-1x.png 1x, https://example.com/a-2x.png 2x"></td></tr></table>';
    const result = mapImportedHtml(parse(html));
    expect(result.modules).toHaveLength(1);
    expect(result.modules[0].type).toBe('image');
    expect((result.modules[0].props as { src: string }).src).toBe('https://example.com/a.png');
    const normalized = findingsOf('normalized', result);
    expect(normalized.some((f) => f.reason.includes('responsive source sets'))).toBe(true);
  });

  it('img with srcset only (no src): creates no module, reports unresolved-resource', () => {
    const html = '<table><tr><td><img srcset="https://example.com/a-1x.png 1x"></td></tr></table>';
    const result = mapImportedHtml(parse(html));
    expect(result.modules).toHaveLength(0);
    expect(findingsOf('unresolved-resource', result).some((f) => f.source === '<img srcset>')).toBe(true);
  });
});

describe('mapImportedHtml — <style>/@import CSS (never blindly persisted)', () => {
  it('a <style> block is dropped and reported, never copied into any module or custom_css-equivalent field', () => {
    const html = '<html><head><style>.foo{color:red}</style></head><body><table><tr><td><p>Text</p></td></tr></table></body></html>';
    const result = mapImportedHtml(parse(html));
    // Only the <p> maps — the <style> block contributes nothing.
    expect(result.modules).toHaveLength(1);
    expect(result.modules[0].type).toBe('text');
  });
});

describe('mapImportedHtml — Outlook conditional/VML source handling', () => {
  it('skips <!--[if mso]--> conditional content without treating it as unsupported (it is a fallback, not missing content)', () => {
    const html = `<table><tr><td>
      <!--[if mso]><table><tr><td>MSO fallback</td></tr></table><![endif]-->
      <p>Real content</p>
    </td></tr></table>`;
    const result = mapImportedHtml(parse(html));
    expect(result.modules.some((m) => m.type === 'text' && (m.props as { text: string }).text.includes('Real content'))).toBe(true);
    // Conditional-comment content parses as an HTML comment node, never
    // becomes a DOM element in the tree at all, so it is naturally never
    // visited by the element-walking mapper — no finding is generated
    // for it (it is not "dropped content", it is fallback markup the
    // destination module regenerates itself).
    expect(result.findings.some((f) => f.reason.includes('MSO'))).toBe(false);
  });
});

describe('mapImportedHtml — column normalization (exact registry-driven algorithm)', () => {
  it('exact match: td widths that already sum to a supported split produce NO structural-conversion finding', () => {
    const html = '<table><tr><td width="30">A</td><td width="70">B</td></tr></table>';
    const result = mapImportedHtml(parse(html));
    const layout = result.modules.find((m: EmailModule) => m.type.startsWith('layout-'));
    expect(layout?.type).toBe('layout-2col-30-70');
    expect(findingsOf('structural-conversion', result)).toHaveLength(0);
  });

  it('nearest-match: an off-split width vector normalizes to the closest supported layout and reports it', () => {
    // 380/620 -> normalized 38/62 -> nearest is 40/60 (distance 4),
    // clearly closer than every other 2-column candidate.
    const html = '<table><tr><td width="380">A</td><td width="620">B</td></tr></table>';
    const result = mapImportedHtml(parse(html));
    const layout = result.modules.find((m: EmailModule) => m.type.startsWith('layout-'));
    expect(layout?.type).toBe('layout-2col-40-60');
    expect(findingsOf('structural-conversion', result)).toHaveLength(1);
  });

  it('tie-break: an equidistant vector resolves deterministically via catalog declaration order', () => {
    // 350/650 -> normalized 35/65 -> equidistant (10) between 40/60 and
    // 30/70; 40/60 is declared earlier in layoutCatalog.tsx, so it wins.
    const html = '<table><tr><td width="350">A</td><td width="650">B</td></tr></table>';
    const result = mapImportedHtml(parse(html));
    const layout = result.modules.find((m: EmailModule) => m.type.startsWith('layout-'));
    expect(layout?.type).toBe('layout-2col-40-60');
  });

  it('irregular colspan geometry (partial, ambiguous) is rejected, not guessed', () => {
    const html = '<table><tr><td colspan="2">A</td><td>B</td></tr></table>';
    const result = mapImportedHtml(parse(html));
    expect(result.modules.some((m: EmailModule) => m.type.startsWith('layout-'))).toBe(false);
    expect(findingsOf('unsupported', result).some((f) => f.source.includes('<tr>'))).toBe(true);
  });

  it('no candidate for the column count (7 columns) is rejected, not guessed into a wrong layout', () => {
    const cells = Array.from({ length: 7 }, (_, i) => `<td>${i}</td>`).join('');
    const html = `<table><tr>${cells}</tr></table>`;
    const result = mapImportedHtml(parse(html));
    expect(result.modules.some((m: EmailModule) => m.type.startsWith('layout-'))).toBe(false);
    expect(findingsOf('unsupported', result).some((f) => f.source.includes('7 columns'))).toBe(true);
  });

  it('with no width/colspan info at all, columns split equally — a defined outcome, not a rejection', () => {
    const html = '<table><tr><td>A</td><td>B</td><td>C</td></tr></table>';
    const result = mapImportedHtml(parse(html));
    const layout = result.modules.find((m: EmailModule) => m.type.startsWith('layout-'));
    expect(layout?.type).toBe('layout-3col');
  });
});

describe('mapImportedHtml — nested table flattening (one-level column-nesting limit)', () => {
  it('a nested (non-button) table inside a cell is flattened to stacked content with a structural-conversion finding, never a second layout level', () => {
    const html = `<table><tr><td>
      <table><tr><td><p>Nested A</p></td><td><p>Nested B</p></td></tr></table>
    </td></tr></table>`;
    const result = mapImportedHtml(parse(html));
    expect(result.modules.some((m: EmailModule) => m.type.startsWith('layout-'))).toBe(false);
    expect(result.modules.filter((m) => m.type === 'text').length).toBe(2);
    expect(findingsOf('structural-conversion', result).some((f) => f.source.includes('nested'))).toBe(true);
  });
});

describe('extractImportedTitle — <title> handling', () => {
  it('extracts a present, non-empty title, trimmed', () => {
    const title = extractImportedTitle(parse('<html><head><title>  My Email  </title></head><body></body></html>'));
    expect(title).toBe('My Email');
  });

  it('returns empty string for an empty <title>', () => {
    const title = extractImportedTitle(parse('<html><head><title></title></head><body></body></html>'));
    expect(title).toBe('');
  });

  it('returns empty string when <title> is absent entirely', () => {
    const title = extractImportedTitle(parse('<html><head></head><body></body></html>'));
    expect(title).toBe('');
  });

  it('malicious markup inside <title> never becomes a real element — <title> has a text-only content model, so no <script> element is ever created from it, and the extracted value is plain text', () => {
    const doc = parse('<html><head><title>Hi <script>alert(1)</script> there<b>!</b></title></head><body></body></html>');
    // <title>'s HTML content model is text-only — nothing inside it is
    // ever parsed into real child elements, so this must be zero
    // regardless of what text the title contains.
    expect(doc.getElementsByTagName('script').length).toBe(0);
    const title = extractImportedTitle(doc);
    expect(typeof title).toBe('string');
    expect(title).toContain('Hi');
    // Escaping this value into <title>...</title> at render time is
    // proven separately (reusing the existing renderer, not a new
    // sanitization system) — see htmlRenderer.test.ts's adversarial case.
  });

  it('a malicious sibling element next to <title> in <head> does not affect extraction and is not itself dangerous (head content is never rendered as body content)', () => {
    const doc = parse('<html><head><script>alert(1)</script><title>Real Title</title></head><body></body></html>');
    expect(extractImportedTitle(doc)).toBe('Real Title');
  });

  // Additional implementation-verification requirement — proves the
  // FULL pipeline (extracted title -> stored email_title -> rendered
  // <title>) stays plain text end-to-end, reusing the EXISTING renderer
  // escaping (emailHead.ts's `escapeHtml(title)`, already covered
  // adversarially in emailHead.test.ts's "escapes a title containing
  // HTML-significant characters" case) — no second sanitization/
  // rendering system is introduced for this.
  it('an imported title containing HTML-like text, once rendered by the EXISTING renderer, cannot become executable/interpreted markup', () => {
    const imported = extractImportedTitle(parse('<html><head><title>&lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt;</title></head><body></body></html>'));
    const head = renderEmailHead({ title: imported, faviconUrl: '', content: createEmptyContent() });
    expect(head).not.toContain('<script>alert(1)</script>');
    expect(head).toContain('&lt;script&gt;');
  });
});
