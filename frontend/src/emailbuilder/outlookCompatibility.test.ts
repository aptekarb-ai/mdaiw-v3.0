import { describe, expect, it } from 'vitest';
import {
  MSO_SPACER_ROW_CLASS, renderOutlookFontFallbackCss, renderOutlookOfficeSettingsBlock, renderOutlookSpacerRowCss,
} from './outlookCompatibility';
import { moduleResponsiveClassName } from './registryCore';
import { createModule } from './moduleFactory';
import type { EmailDocumentContent, EmailModule, TextModuleProps } from './edm';

function contentOf(modules: EmailModule[]): EmailDocumentContent {
  return { version: 1, modules };
}

describe('renderOutlookOfficeSettingsBlock', () => {
  it('emits the exact OfficeDocumentSettings block, [if gte mso 9]-scoped', () => {
    const block = renderOutlookOfficeSettingsBlock();
    expect(block).toContain('<!--[if gte mso 9]>');
    expect(block).toContain('<xml>');
    expect(block).toContain('<o:OfficeDocumentSettings>');
    expect(block).toContain('<o:AllowPNG/>');
    expect(block).toContain('<o:PixelsPerInch>96</o:PixelsPerInch>');
    expect(block).toContain('</o:OfficeDocumentSettings>');
    expect(block).toContain('</xml>');
    expect(block).toContain('<![endif]-->');
  });

  it('is a pure function — identical output every call', () => {
    expect(renderOutlookOfficeSettingsBlock()).toBe(renderOutlookOfficeSettingsBlock());
  });
});

describe('renderOutlookSpacerRowCss — scoped spacer-row treatment (item 2)', () => {
  it('emits nothing when the document has no Spacer module', () => {
    const text = createModule('text', 0);
    expect(renderOutlookSpacerRowCss(contentOf([text]))).toBe('');
  });

  it('emits a [if mso]-scoped rule targeting ONLY .mso-spacer when a Spacer module exists', () => {
    const spacer = createModule('spacer', 0);
    const css = renderOutlookSpacerRowCss(contentOf([spacer]));
    expect(css).toContain('<!--[if mso]>');
    expect(css).toContain(`.${MSO_SPACER_ROW_CLASS}`);
    expect(css).toContain('font-size: 0 !important');
    expect(css).toContain('line-height: 0 !important');
    expect(css).toContain('<![endif]-->');
  });

  it('never emits a global, unscoped tr selector', () => {
    const spacer = createModule('spacer', 0);
    const css = renderOutlookSpacerRowCss(contentOf([spacer]));
    expect(css).not.toMatch(/(^|[^.\w-])tr\s*\{/);
  });

  it('detects a Spacer module nested one level inside a Layout column', () => {
    const layout = createModule('layout-2col-50-50', 0);
    const spacer = createModule('spacer', 0);
    layout.columns![0].modules.push(spacer);
    expect(renderOutlookSpacerRowCss(contentOf([layout]))).not.toBe('');
  });

  it('the Spacer module itself carries the mso-spacer class on its own cell only', async () => {
    const { renderEmailBody } = await import('./htmlRenderer');
    const spacer = createModule('spacer', 0);
    const text = createModule('text', 1);
    const html = renderEmailBody({ width: 700, content: contentOf([spacer, text]) });
    const classMatches = html.match(/class="mso-spacer"/g) ?? [];
    expect(classMatches).toHaveLength(1);
  });

  it('ordinary text/button/image/header/footer/multi-column modules never carry the mso-spacer class', async () => {
    const { renderEmailBody } = await import('./htmlRenderer');
    const types = [
      'text', 'button', 'image', 'header-logo-nav', 'footer-social-legal', 'layout-3col',
    ] as const;
    for (const type of types) {
      const module = createModule(type, 0);
      const html = renderEmailBody({ width: 700, content: contentOf([module]) });
      expect(html, type).not.toContain('mso-spacer');
    }
  });
});

describe('renderOutlookFontFallbackCss — scoped font fallback (item 3)', () => {
  it('emits nothing when every module uses an mso-safe font (the registry default today)', () => {
    const text = createModule('text', 0) as unknown as EmailModule<TextModuleProps>;
    for (const fontId of ['arial', 'georgia', 'times', 'verdana', 'helvetica', 'tahoma', 'trebuchet']) {
      text.props = { ...text.props, fontFamily: fontId };
      expect(renderOutlookFontFallbackCss(contentOf([text])), fontId).toBe('');
    }
  });

  it('emits a scoped override for a module using a synthetic non-mso-safe font id', () => {
    const text = createModule('text', 0) as unknown as EmailModule<TextModuleProps>;
    text.props = { ...text.props, fontFamily: 'a-hypothetical-web-font-not-in-the-registry' };
    const css = renderOutlookFontFallbackCss(contentOf([text]));
    expect(css).toContain('<!--[if mso]>');
    expect(css).toContain(`.${moduleResponsiveClassName(text.id)}`);
    expect(css).toContain('font-family: Arial, Helvetica, sans-serif !important');
    expect(css).toContain('<![endif]-->');
  });

  it('does NOT touch other modules that use a safe font when one module needs a fallback', () => {
    const unsafe = createModule('text', 0) as unknown as EmailModule<TextModuleProps>;
    unsafe.props = { ...unsafe.props, fontFamily: 'not-a-real-font-id' };
    const safe = createModule('text', 1) as unknown as EmailModule<TextModuleProps>;
    safe.props = { ...safe.props, fontFamily: 'arial' };
    const css = renderOutlookFontFallbackCss(contentOf([unsafe, safe]));
    expect(css).toContain(moduleResponsiveClassName(unsafe.id));
    expect(css).not.toContain(moduleResponsiveClassName(safe.id));
  });

  it('is scoped to the module class, never a blanket "*" or bare tag selector', () => {
    const text = createModule('text', 0) as unknown as EmailModule<TextModuleProps>;
    text.props = { ...text.props, fontFamily: 'unknown-web-font' };
    const css = renderOutlookFontFallbackCss(contentOf([text]));
    expect(css).not.toMatch(/^\* \{/m);
    expect(css).not.toMatch(/(^|\s)body\s*\{/);
  });
});
