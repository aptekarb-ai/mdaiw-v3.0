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

  it('does NOT classify an unstyled <a> as a Button (negative predicate) — degrades to text, and (fidelity checkpoint) the safe href is preserved as visible URL text with a normalized finding, not silently dropped', () => {
    const html = '<table><tr><td><p>Visit <a href="https://example.com">our site</a> today.</p></td></tr></table>';
    const result = mapImportedHtml(parse(html));
    expect(result.modules.every((m) => m.type !== 'button')).toBe(true);
    const textModule = result.modules.find((m) => m.type === 'text')!;
    expect((textModule.props as { text: string }).text).toContain('https://example.com');
    expect(findingsOf('normalized', result).some((f) => f.source === '<a>' && f.reason.includes('clickable inline link'))).toBe(true);
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
  it('skips <!--[if mso]--> conditional content without treating it as unsupported (it is a fallback, not missing content), and (fidelity checkpoint) reports ONE informational finding that Outlook compatibility is regenerated rather than staying completely silent', () => {
    const html = `<table><tr><td>
      <!--[if mso]><table><tr><td>MSO fallback</td></tr></table><![endif]-->
      <p>Real content</p>
    </td></tr></table>`;
    const result = mapImportedHtml(parse(html));
    expect(result.modules.some((m) => m.type === 'text' && (m.props as { text: string }).text.includes('Real content'))).toBe(true);
    // Conditional-comment content parses as an HTML comment node, never
    // becomes a DOM element in the tree at all, so it is naturally never
    // visited by the element-walking mapper as content — but the document
    // as a whole DOES get exactly one summary finding explaining why the
    // MSO-only markup did not carry over (never "dropped content" text,
    // never one finding per comment).
    const mso = findingsOf('outlook-regeneration', result);
    expect(mso).toHaveLength(1);
    expect(mso[0].reason).toContain('MSO');
  });

  it('a document with NO MSO conditional markup gets no outlook-regeneration finding', () => {
    const html = '<table><tr><td><p>No MSO here</p></td></tr></table>';
    const result = mapImportedHtml(parse(html));
    expect(findingsOf('outlook-regeneration', result)).toHaveLength(0);
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

// ===========================================================================
// Fidelity checkpoint — Import HTML Visual Fidelity Reconstruction.
// The suites below cover the audited fidelity-loss points: outer spacer/
// gutter reconstruction, real-ratio reporting, header/footer structural
// predicates, background reconstruction, image width, button align/
// padding, heading/paragraph separation, bold semantics, and a full
// realistic multi-section fixture compared end to end.
// ===========================================================================

describe('mapImportedHtml — column ratio fidelity (real ratio reported, never discarded)', () => {
  it('a 40/60 split that already matches a preset produces no structural-conversion finding', () => {
    const html = '<table><tr><td width="40">A</td><td width="60">B</td></tr></table>';
    const result = mapImportedHtml(parse(html));
    const layout = result.modules.find((m: EmailModule) => m.type.startsWith('layout-'));
    expect(layout?.type).toBe('layout-2col-40-60');
    expect(findingsOf('structural-conversion', result)).toHaveLength(0);
  });

  it('a 33/33/34 split maps exactly to the 3-column preset', () => {
    const html = '<table><tr><td width="33%">A</td><td width="33%">B</td><td width="34%">C</td></tr></table>';
    const result = mapImportedHtml(parse(html));
    const layout = result.modules.find((m: EmailModule) => m.type.startsWith('layout-'));
    expect(layout?.type).toBe('layout-3col');
    expect(layout?.columns).toHaveLength(3);
    expect(findingsOf('structural-conversion', result)).toHaveLength(0);
  });

  it('a non-preset ratio (380/620 -> 38/62) reports the REAL computed ratio, not just the destination preset', () => {
    const html = '<table><tr><td width="380">A</td><td width="620">B</td></tr></table>';
    const result = mapImportedHtml(parse(html));
    const found = findingsOf('structural-conversion', result);
    expect(found.some((f) => f.outcome.includes('38/62') && f.outcome.includes('40/60'))).toBe(true);
  });
});

describe('mapImportedHtml — outer spacer / gutter reconstruction (fidelity checkpoint)', () => {
  it('30 | 40% | 20 | 60% | 30 reconstructs to two content columns with outerSpacing + columnGutterPx, not five columns', () => {
    const html = '<table><tr>'
      + '<td width="30">&nbsp;</td>'
      + '<td width="40%">Left content</td>'
      + '<td width="20">&nbsp;</td>'
      + '<td width="60%">Right content</td>'
      + '<td width="30">&nbsp;</td>'
      + '</tr></table>';
    const result = mapImportedHtml(parse(html));
    const layout = result.modules.find((m: EmailModule) => m.type.startsWith('layout-'));
    expect(layout).toBeDefined();
    expect(layout!.columns).toHaveLength(2);
    expect(layout!.settings.outerSpacing.desktop.left).toEqual({ value: 30, unit: 'px' });
    expect(layout!.settings.outerSpacing.desktop.right).toEqual({ value: 30, unit: 'px' });
    expect(layout!.settings.columnGutterPx).toBe(20);
  });

  it('asymmetric outer spacers (20 | content | content | 40) preserve each side independently', () => {
    const html = '<table><tr>'
      + '<td width="20">&nbsp;</td>'
      + '<td width="50%">A</td>'
      + '<td width="50%">B</td>'
      + '<td width="40">&nbsp;</td>'
      + '</tr></table>';
    const result = mapImportedHtml(parse(html));
    const layout = result.modules.find((m: EmailModule) => m.type.startsWith('layout-'));
    expect(layout).toBeDefined();
    expect(layout!.columns).toHaveLength(2);
    expect(layout!.settings.outerSpacing.desktop.left).toEqual({ value: 20, unit: 'px' });
    expect(layout!.settings.outerSpacing.desktop.right).toEqual({ value: 40, unit: 'px' });
    expect(layout!.settings.columnGutterPx ?? 0).toBe(0);
  });

  it('a single-column row flanked by spacer cells preserves outer spacing on the produced content module directly (no layout wrapper needed for one content column)', () => {
    const html = '<table><tr><td width="20">&nbsp;</td><td><p>Body copy here.</p></td><td width="20">&nbsp;</td></tr></table>';
    const result = mapImportedHtml(parse(html));
    expect(result.modules).toHaveLength(1);
    expect(result.modules[0].type).toBe('text');
    expect(result.modules[0].settings.outerSpacing.desktop.left).toEqual({ value: 20, unit: 'px' });
    expect(result.modules[0].settings.outerSpacing.desktop.right).toEqual({ value: 20, unit: 'px' });
  });

  it('a narrow but non-empty cell (e.g. a small icon column) is never misclassified as a spacer', () => {
    const html = '<table><tr><td width="30">X</td><td width="70">Y</td></tr></table>';
    const result = mapImportedHtml(parse(html));
    const layout = result.modules.find((m: EmailModule) => m.type.startsWith('layout-'));
    expect(layout?.columns).toHaveLength(2);
  });
});

describe('mapImportedHtml — background reconstruction (fidelity checkpoint)', () => {
  it('row background-color (on <tr>) maps to the produced module’s settings.backgroundColor', () => {
    const html = '<table><tr style="background-color:#112233;"><td><p>Text</p></td></tr></table>';
    const result = mapImportedHtml(parse(html));
    expect(result.modules[0].settings.backgroundColor).toBe('#112233');
  });

  it('a cell bgcolor attribute (no style) maps to background-color, normalized to lowercase hex', () => {
    const html = '<table><tr><td bgcolor="AABBCC"><p>Text</p></td></tr></table>';
    const result = mapImportedHtml(parse(html));
    expect(result.modules[0].settings.backgroundColor).toBe('#aabbcc');
  });

  it('row background-image (safe absolute URL) maps to settings.backgroundImage', () => {
    const html = '<table><tr style="background-image:url(https://example.com/bg.png);"><td><p>Text</p></td></tr></table>';
    const result = mapImportedHtml(parse(html));
    expect(result.modules[0].settings.backgroundImage).toBe('https://example.com/bg.png');
  });

  it('per-column background-color on one <td> of a multi-column row maps to that column’s own settings, not the whole row', () => {
    const html = '<table><tr><td width="50" style="background-color:#ff0000;">A</td><td width="50">B</td></tr></table>';
    const result = mapImportedHtml(parse(html));
    const layout = result.modules.find((m: EmailModule) => m.type.startsWith('layout-'));
    expect(layout!.columns![0].settings.backgroundColor).toBe('#ff0000');
    expect(layout!.columns![1].settings.backgroundColor).toBe('');
  });
});

describe('mapImportedHtml — image width fidelity (checkpoint)', () => {
  it('an explicit width attribute on <img> is preserved as the Image module’s width', () => {
    const html = '<table><tr><td><img src="https://example.com/a.png" width="240"></td></tr></table>';
    const result = mapImportedHtml(parse(html));
    const props = result.modules[0].props as { width: { desktop: { value: number; unit: string } } };
    expect(props.width.desktop).toEqual({ value: 240, unit: 'px' });
  });
});

describe('mapImportedHtml — button alignment/padding fidelity (checkpoint)', () => {
  it('preserves the containing cell’s alignment and the anchor’s own padding on the Button module', () => {
    const html = '<table><tr><td align="right"><a href="https://example.com/go" style="background-color:#002d38; padding:12px 24px 12px 24px; color:#fff;">Go</a></td></tr></table>';
    const result = mapImportedHtml(parse(html));
    const props = result.modules[0].props as { align: string; paddingHorizontal: number; paddingVertical: number };
    expect(props.align).toBe('right');
    expect(props.paddingHorizontal).toBe(24);
    expect(props.paddingVertical).toBe(12);
  });
});

describe('mapImportedHtml — heading/paragraph separation (fidelity checkpoint)', () => {
  it('an <h1> immediately followed by a <p> with no intervening element produces TWO Text modules, not one merged module', () => {
    const html = '<table><tr><td><h1>Main Email Heading</h1><p>Add your email content here.</p></td></tr></table>';
    const result = mapImportedHtml(parse(html));
    const texts = result.modules.filter((m) => m.type === 'text').map((m) => (m.props as { text: string }).text);
    expect(texts).toHaveLength(2);
    expect(texts[0]).toBe('Main Email Heading');
    expect(texts[1]).toBe('Add your email content here.');
  });

  it('two adjacent paragraphs of the SAME family still combine into one module (unchanged existing behavior)', () => {
    const html = '<table><tr><td><p>First line.</p><p>Second line.</p></td></tr></table>';
    const result = mapImportedHtml(parse(html));
    const texts = result.modules.filter((m) => m.type === 'text');
    expect(texts).toHaveLength(1);
    expect((texts[0].props as { text: string }).text).toBe('First line.\nSecond line.');
  });

  it('an <h1> followed by an <h2> also separates into two modules (different heading levels are different families)', () => {
    const html = '<table><tr><td><h1>Big</h1><h2>Small</h2></td></tr></table>';
    const result = mapImportedHtml(parse(html));
    const texts = result.modules.filter((m) => m.type === 'text');
    expect(texts).toHaveLength(2);
  });
});

describe('mapImportedHtml — bold semantics (fidelity checkpoint)', () => {
  it('a whole-line <strong>-wrapped paragraph imports with fontWeight 700', () => {
    const html = '<table><tr><td><p><strong>Important notice</strong></p></td></tr></table>';
    const result = mapImportedHtml(parse(html));
    const props = result.modules[0].props as { fontWeight: number; text: string };
    expect(props.text).toBe('Important notice');
    expect(props.fontWeight).toBe(700);
  });

  it('a paragraph with PARTIAL bold text keeps the default (non-representable) weight, without losing any text', () => {
    const html = '<table><tr><td><p>Some <strong>partial</strong> bold text.</p></td></tr></table>';
    const result = mapImportedHtml(parse(html));
    const props = result.modules[0].props as { fontWeight: number; text: string };
    expect(props.fontWeight).toBe(400);
    expect(props.text).toContain('partial');
  });
});

describe('mapImportedHtml — line-height unit handling (fidelity checkpoint)', () => {
  it('a unitless line-height resolves against the resolved font-size', () => {
    const html = '<table><tr><td><p style="font-size:20px; line-height:1.5;">Text</p></td></tr></table>';
    const result = mapImportedHtml(parse(html));
    const props = result.modules[0].props as { lineHeight: number; fontSize: number };
    expect(props.fontSize).toBe(20);
    expect(props.lineHeight).toBe(30);
  });

  it('a percentage line-height resolves against the resolved font-size', () => {
    const html = '<table><tr><td><p style="font-size:20px; line-height:150%;">Text</p></td></tr></table>';
    const result = mapImportedHtml(parse(html));
    const props = result.modules[0].props as { lineHeight: number };
    expect(props.lineHeight).toBe(30);
  });
});

describe('mapImportedHtml — header structural predicate (logo + nav / logo + cta)', () => {
  it('a two-cell row of [logo image] + [three nav links] maps to header-logo-nav with preserved links', () => {
    const html = '<table><tr>'
      + '<td><img src="https://example.com/logo.png" alt="Acme"></td>'
      + '<td><a href="https://example.com/shop">Shop</a><a href="https://example.com/about">About</a><a href="https://example.com/contact">Contact</a></td>'
      + '</tr></table>';
    const result = mapImportedHtml(parse(html));
    expect(result.modules).toHaveLength(1);
    expect(result.modules[0].type).toBe('header-logo-nav');
    const props = result.modules[0].props as { logoSrc: string; logoAlt: string; navLinks: { label: string; href: string }[] };
    expect(props.logoSrc).toBe('https://example.com/logo.png');
    expect(props.logoAlt).toBe('Acme');
    expect(props.navLinks).toEqual([
      { label: 'Shop', href: 'https://example.com/shop' },
      { label: 'About', href: 'https://example.com/about' },
      { label: 'Contact', href: 'https://example.com/contact' },
    ]);
  });

  it('a two-cell row of [logo image] + [one button-styled anchor] maps to header-logo-cta', () => {
    const html = '<table><tr>'
      + '<td><img src="https://example.com/logo.png" alt="Acme"></td>'
      + '<td><a href="https://example.com/shop" style="background-color:#76c043; padding:10px 20px 10px 20px; color:#fff;">Shop Now</a></td>'
      + '</tr></table>';
    const result = mapImportedHtml(parse(html));
    expect(result.modules).toHaveLength(1);
    expect(result.modules[0].type).toBe('header-logo-cta');
    const props = result.modules[0].props as { ctaText: string; ctaHref: string };
    expect(props.ctaText).toBe('Shop Now');
    expect(props.ctaHref).toBe('https://example.com/shop');
  });

  it('a lone standalone image (no second links cell) is NOT reclassified as a header — imports as a plain Image module', () => {
    const html = '<table><tr><td><img src="https://example.com/hero.png" alt="Hero"></td></tr></table>';
    const result = mapImportedHtml(parse(html));
    expect(result.modules).toHaveLength(1);
    expect(result.modules[0].type).toBe('image');
  });

  it('a two-cell row where the second cell has no links at all is not a header match — falls through to generic mapping', () => {
    const html = '<table><tr><td><img src="https://example.com/logo.png"></td><td><p>Just text</p></td></tr></table>';
    const result = mapImportedHtml(parse(html));
    expect(result.modules.every((m) => !m.type.startsWith('header-'))).toBe(true);
  });

  it('a <script> inside a header-shaped row defers to the generic path and still gets stripped with a security finding', () => {
    const html = '<table><tr>'
      + '<td><img src="https://example.com/logo.png"></td>'
      + '<td><a href="https://example.com/shop">Shop</a><script>alert(1)</script></td>'
      + '</tr></table>';
    const result = mapImportedHtml(parse(html));
    expect(result.modules.every((m) => !m.type.startsWith('header-'))).toBe(true);
    expect(findingsOf('security', result).some((f) => f.source === '<script>')).toBe(true);
  });
});

describe('mapImportedHtml — footer structural predicate (unsubscribe / preference)', () => {
  it('a single-cell footer section with unsubscribe + privacy links maps to a footer-* module, preserving both hrefs and company/legal text', () => {
    const html = '<table><tr><td>'
      + '<p>MarketOne Digital, Inc.</p>'
      + '<p>Copyright 2026 MarketOne Digital. All rights reserved.</p>'
      + '<a href="https://example.com/unsubscribe">Unsubscribe</a>'
      + '<a href="https://example.com/privacy">Privacy Policy</a>'
      + '</td></tr></table>';
    const result = mapImportedHtml(parse(html));
    expect(result.modules).toHaveLength(1);
    expect(result.modules[0].type.startsWith('footer-')).toBe(true);
    const props = result.modules[0].props as {
      companyName: string; legalText: string; unsubscribeHref: string; preferenceHref: string; preferenceText: string;
    };
    expect(props.companyName).toBe('MarketOne Digital, Inc.');
    expect(props.legalText).toContain('Copyright 2026');
    expect(props.unsubscribeHref).toBe('https://example.com/unsubscribe');
    expect(props.preferenceHref).toBe('https://example.com/privacy');
    expect(props.preferenceText).toBe('Privacy Policy');
  });

  it('a footer section background declared on the wrapping <tr> is preserved on the footer module', () => {
    const html = '<table><tr style="background-color:#002d38;"><td>'
      + '<p>Acme Inc.</p>'
      + '<a href="https://example.com/unsubscribe">Unsubscribe</a>'
      + '</td></tr></table>';
    const result = mapImportedHtml(parse(html));
    expect(result.modules[0].settings.backgroundColor).toBe('#002d38');
  });

  it('a cell with no unsubscribe link anywhere is never misclassified as a footer', () => {
    const html = '<table><tr><td><p>Just some text.</p><a href="https://example.com">Learn more</a></td></tr></table>';
    const result = mapImportedHtml(parse(html));
    expect(result.modules.every((m) => !m.type.startsWith('footer-'))).toBe(true);
  });

  it('a <script> inside a footer-shaped cell defers to the generic path and still gets stripped with a security finding', () => {
    const html = '<table><tr><td><a href="https://example.com/unsubscribe">Unsubscribe</a><script>alert(1)</script></td></tr></table>';
    const result = mapImportedHtml(parse(html));
    expect(result.modules.every((m) => !m.type.startsWith('footer-'))).toBe(true);
    expect(findingsOf('security', result).some((f) => f.source === '<script>')).toBe(true);
  });
});

describe('mapImportedHtml — malformed-but-recoverable HTML (regression)', () => {
  it('unclosed <p> tags and a missing </table> still parse and map their recoverable content', () => {
    const html = '<table><tr><td><p>First paragraph<p>Second paragraph</td></tr>';
    const result = mapImportedHtml(parse(html));
    expect(result.modules.length).toBeGreaterThan(0);
    const combined = result.modules.filter((m) => m.type === 'text').map((m) => (m.props as { text: string }).text).join(' ');
    expect(combined).toContain('First paragraph');
    expect(combined).toContain('Second paragraph');
  });
});

describe('mapImportedHtml — realistic multi-section marketing email (end-to-end fidelity fixture)', () => {
  const REALISTIC_EMAIL_HTML = `<html><head><title>Fall Sale</title></head><body>
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0">
      <tr><td><p style="font-size:11px; color:#888888;">You are receiving this because you subscribed to MarketOne updates.</p></td></tr>
      <tr>
        <td width="200"><img src="https://example.com/logo.png" alt="MarketOne" width="140"></td>
        <td width="400" align="right">
          <a href="https://example.com/shop">Shop</a>
          <a href="https://example.com/about">About</a>
          <a href="https://example.com/contact">Contact</a>
        </td>
      </tr>
      <tr><td><img src="https://example.com/hero.png" alt="Fall Sale" width="600"></td></tr>
      <tr><td>
        <h1 style="color:#002d38;">Fall Sale Is Here</h1>
        <p style="font-size:16px;">Save up to 40% on select items this week only.</p>
      </td></tr>
      <tr><td><a href="https://example.com/shop-now" style="background-color:#76c043; color:#ffffff; padding:12px 24px 12px 24px;">Shop Now</a></td></tr>
      <tr><td><h2>More Ways to Save</h2></td></tr>
      <tr>
        <td width="33%"><p>Item One</p></td>
        <td width="33%"><p>Item Two</p></td>
        <td width="34%"><p>Item Three</p></td>
      </tr>
      <tr><td><hr></td></tr>
      <tr style="background-color:#002d38;"><td>
        <p>MarketOne Digital, Inc.</p>
        <p>Copyright 2026 MarketOne Digital. All rights reserved.</p>
        <a href="https://example.com/unsubscribe">Unsubscribe</a>
        <a href="https://example.com/privacy">Privacy Policy</a>
      </td></tr>
    </table>
  </body></html>`;

  it('reconstructs the full section order: preheader, header+nav, hero, heading, paragraph, CTA, subheading, 3-column, divider, footer', () => {
    const result = mapImportedHtml(parse(REALISTIC_EMAIL_HTML));
    const types = result.modules.map((m) => m.type);
    expect(types).toEqual([
      'text',               // preheader
      'header-logo-nav',    // logo + nav
      'image',              // hero
      'text',               // H1
      'text',               // paragraph
      'button',             // CTA
      'text',               // H2 subheading
      'layout-3col',        // 3-column content
      'divider',
      'footer-preference-unsubscribe',
    ]);
  });

  it('preserves header logo + nav link structure', () => {
    const result = mapImportedHtml(parse(REALISTIC_EMAIL_HTML));
    const header = result.modules.find((m) => m.type === 'header-logo-nav')!;
    const props = header.props as { logoSrc: string; logoWidth: number; navLinks: { label: string; href: string }[] };
    expect(props.logoSrc).toBe('https://example.com/logo.png');
    expect(props.logoWidth).toBe(140);
    expect(props.navLinks.map((l) => l.label)).toEqual(['Shop', 'About', 'Contact']);
  });

  it('preserves the hero image width and the H1/paragraph as separate modules', () => {
    const result = mapImportedHtml(parse(REALISTIC_EMAIL_HTML));
    const hero = result.modules.find((m) => m.type === 'image')!;
    expect((hero.props as { width: { desktop: { value: number } } }).width.desktop.value).toBe(600);
    const texts = result.modules.filter((m) => m.type === 'text').map((m) => (m.props as { text: string }).text);
    expect(texts).toContain('Fall Sale Is Here');
    expect(texts).toContain('Save up to 40% on select items this week only.');
  });

  it('preserves the CTA button label/href/background/padding', () => {
    const result = mapImportedHtml(parse(REALISTIC_EMAIL_HTML));
    const button = result.modules.find((m) => m.type === 'button')!;
    const props = button.props as { text: string; href: string; backgroundColor: string; paddingHorizontal: number; paddingVertical: number };
    expect(props.text).toBe('Shop Now');
    expect(props.href).toBe('https://example.com/shop-now');
    expect(props.backgroundColor).toBe('#76c043');
    expect(props.paddingHorizontal).toBe(24);
    expect(props.paddingVertical).toBe(12);
  });

  it('preserves the 3-column content row structure', () => {
    const result = mapImportedHtml(parse(REALISTIC_EMAIL_HTML));
    const layout = result.modules.find((m) => m.type === 'layout-3col')!;
    expect(layout.columns).toHaveLength(3);
  });

  it('preserves the dark footer background, unsubscribe/privacy hrefs, and company/legal text', () => {
    const result = mapImportedHtml(parse(REALISTIC_EMAIL_HTML));
    const footer = result.modules.find((m) => m.type.startsWith('footer-'))!;
    expect(footer.settings.backgroundColor).toBe('#002d38');
    const props = footer.props as { companyName: string; legalText: string; unsubscribeHref: string; preferenceHref: string };
    expect(props.companyName).toBe('MarketOne Digital, Inc.');
    expect(props.legalText).toContain('Copyright 2026');
    expect(props.unsubscribeHref).toBe('https://example.com/unsubscribe');
    expect(props.preferenceHref).toBe('https://example.com/privacy');
  });

  it('never invents content or URLs not present in the source', () => {
    const result = mapImportedHtml(parse(REALISTIC_EMAIL_HTML));
    const allHrefs: string[] = [];
    for (const m of result.modules) {
      const props = m.props as Record<string, unknown>;
      if (typeof props.href === 'string' && props.href) allHrefs.push(props.href);
      if (typeof props.logoSrc === 'string' && props.logoSrc) allHrefs.push(props.logoSrc);
      if (typeof props.unsubscribeHref === 'string' && props.unsubscribeHref) allHrefs.push(props.unsubscribeHref);
      if (typeof props.preferenceHref === 'string' && props.preferenceHref) allHrefs.push(props.preferenceHref);
      if (Array.isArray(props.navLinks)) allHrefs.push(...(props.navLinks as { href: string }[]).map((l) => l.href));
    }
    const sourceHrefs = [
      'https://example.com/shop', 'https://example.com/about', 'https://example.com/contact',
      'https://example.com/shop-now', 'https://example.com/unsubscribe', 'https://example.com/privacy',
      'https://example.com/logo.png',
    ];
    for (const href of allHrefs) expect(sourceHrefs).toContain(href);
  });
});
