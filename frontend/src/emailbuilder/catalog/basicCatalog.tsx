import type {
  ButtonModuleProps, ButtonWidthMode, CompositeModuleProps, DividerModuleProps, EmailModuleType, ImageModuleProps,
  SpacerModuleProps, TextModuleProps,
} from '../edm';
import { DEFAULT_SPACING, resolveSpacing } from '../edm';
import { percent, px, resolveDimension, resolveResponsiveValue, widthAttr, widthCssValue } from '../dimensions';
import { escapeAttribute, escapeHtml, sanitizeUrl } from '../sanitize';
import { DEFAULT_FONT_ID, fontStackFor } from '../fonts';
import {
  GENERIC_ONLY, ImagePreview, cell, createResponsiveSettings, moduleTable, moduleTableRow, paddingStyle,
  textLine, type AnyModuleDefinition, type ModuleDefinition,
} from '../registryCore';
import { canRenderVmlButton, renderVmlButton } from '../vml';

const textDefinition: ModuleDefinition<TextModuleProps> = {
  type: 'text',
  label: 'Text',
  category: 'content',
  icon: 'file',
  description: 'A single paragraph or heading of body text.',
  tags: ['text', 'paragraph', 'copy', 'heading'],
  keywords: ['text', 'paragraph', 'copy', 'heading', 'typography'],
  columnCount: null,
  imagePosition: null,
  platformCompatibility: GENERIC_ONLY,
  propertyEditor: 'text',
  // Feature 14 V2 — this bespoke-editor module has no `propertyEditor:
  // 'schema'` form, but still declares editableFields purely as
  // capability-manifest metadata for the Email AI Engineer; the manual
  // Properties panel is unaffected (it does not read this array).
  editableFields: [
    { key: 'text', label: 'Text', kind: 'textarea', valueType: 'text', group: 'content' },
    { key: 'align', label: 'Alignment', kind: 'align', valueType: 'align', group: 'style' },
    { key: 'color', label: 'Text color', kind: 'color', valueType: 'color', group: 'style' },
    { key: 'backgroundColor', label: 'Background color', kind: 'color', valueType: 'color', group: 'style' },
    { key: 'fontSize', label: 'Font size (px)', kind: 'number', valueType: 'number', group: 'style', min: 8, max: 72 },
  ],
  createDefaultProps: () => ({
    text: 'Add your heading or paragraph text here.',
    align: 'left',
    fontFamily: DEFAULT_FONT_ID,
    fontSize: 16,
    fontWeight: 400,
    color: '#333333',
    lineHeight: 24,
    backgroundColor: '',
    width: { desktop: percent(100) },
  }),
  createDefaultSettings: () => createResponsiveSettings(DEFAULT_SPACING),
  // viewport-aware (instruction 37: Mobile preview chrome must show
  // Mobile font sizes/alignment) — resolves each of Feature 07's
  // optional mobile typography overrides via the shared
  // resolveResponsiveValue, same inheritance rule as every other
  // Desktop/Mobile field.
  renderPreview: (module, viewport = 'desktop') => {
    const { props } = module;
    const fontSize = resolveResponsiveValue(props.fontSize, props.mobileFontSize, viewport);
    const lineHeight = resolveResponsiveValue(props.lineHeight, props.mobileLineHeight, viewport);
    const align = resolveResponsiveValue(props.align, props.mobileAlign, viewport);
    return (
      <p
        style={{
          margin: 0,
          textAlign: align,
          fontFamily: fontStackFor(props.fontFamily),
          fontSize,
          fontWeight: props.fontWeight,
          color: props.color,
          lineHeight: `${lineHeight}px`,
          backgroundColor: props.backgroundColor || undefined,
        }}
      >
        {props.text}
      </p>
    );
  },
  renderEmailHtml: (module) => {
    const { props, settings } = module;
    const resolvedWidth = resolveDimension(props.width ?? { desktop: percent(100) }, 'desktop');
    const background = props.backgroundColor ? `background-color:${props.backgroundColor}; ` : '';
    const style = `${paddingStyle(resolveSpacing(settings, 'desktop'))} text-align:${props.align}; font-family:${fontStackFor(props.fontFamily)}; `
      + `font-size:${props.fontSize}px; font-weight:${props.fontWeight}; color:${props.color}; `
      + `line-height:${props.lineHeight}px; ${background}width:${widthCssValue(resolvedWidth)};`;
    return moduleTableRow(cell(escapeHtml(props.text).replace(/\n/g, '<br>'), style, { width: widthAttr(resolvedWidth) }));
  },
};

const imageDefinition: ModuleDefinition<ImageModuleProps> = {
  type: 'image',
  label: 'Image',
  category: 'images',
  icon: 'camera',
  description: 'A single standalone image, optionally linked.',
  tags: ['image', 'photo', 'picture'],
  keywords: ['image', 'photo', 'picture', 'graphic'],
  columnCount: null,
  imagePosition: null,
  platformCompatibility: GENERIC_ONLY,
  propertyEditor: 'image',
  // Feature 14 V2 — `src` is explicitly `image_asset` (never inferred):
  // the AI may only set it via the asset-ownership-resolution flow or an
  // allow-listed external URL, never an arbitrary AI-invented string.
  editableFields: [
    { key: 'src', label: 'Image URL', kind: 'url', valueType: 'image_asset', group: 'content' },
    { key: 'alt', label: 'Alt text', kind: 'text', valueType: 'text', group: 'content' },
    { key: 'href', label: 'Link URL', kind: 'url', valueType: 'url', group: 'content' },
    { key: 'align', label: 'Alignment', kind: 'align', valueType: 'align', group: 'style' },
    { key: 'backgroundColor', label: 'Background color', kind: 'color', valueType: 'color', group: 'style' },
  ],
  createDefaultProps: () => ({
    // Empty by design (no external network dependency for a fresh
    // module) — the builder shows a polished placeholder until the user
    // supplies a real URL via Properties. See registryCore's ImagePreview.
    src: '',
    alt: 'Image',
    // Fluid by default (instruction: "Image width: 100%") — the user
    // can switch to a fixed px width per viewport from Properties.
    width: { desktop: percent(100) },
    align: 'center',
    href: '',
    backgroundColor: '',
  }),
  createDefaultSettings: () => createResponsiveSettings(DEFAULT_SPACING),
  renderPreview: (module, viewport = 'desktop') => (
    <div style={{ backgroundColor: module.props.backgroundColor || undefined }}>
      <ImagePreview
        src={module.props.src}
        alt={module.props.alt}
        width={resolveDimension(module.props.width, viewport)}
        align={module.props.align}
      />
    </div>
  ),
  renderEmailHtml: (module) => {
    const { props, settings } = module;
    // Desktop is the source of truth for today's single static HTML
    // export — see edm.ts's EmailModuleSettings docstring.
    const resolved = resolveDimension(props.width, 'desktop');
    const imgTag = `<img src="${escapeAttribute(sanitizeUrl(props.src))}" alt="${escapeAttribute(props.alt)}" `
      + `width="${widthAttr(resolved)}" style="display:block; width:${widthCssValue(resolved)}; max-width:100%; height:auto; border:0;" />`;
    const linked = props.href
      ? `<a href="${escapeAttribute(sanitizeUrl(props.href))}" target="_blank" rel="noopener noreferrer">${imgTag}</a>`
      : imgTag;
    const background = props.backgroundColor ? `background-color:${props.backgroundColor}; ` : '';
    const style = `${paddingStyle(resolveSpacing(settings, 'desktop'))} text-align:${props.align}; ${background}`;
    return moduleTableRow(cell(linked, style, { bgcolor: props.backgroundColor || undefined }));
  },
};

const buttonDefinition: ModuleDefinition<ButtonModuleProps> = {
  type: 'button',
  label: 'Button',
  category: 'cta',
  icon: 'send',
  description: 'A single call-to-action button.',
  tags: ['button', 'cta', 'link'],
  keywords: ['button', 'cta', 'call to action', 'link'],
  columnCount: null,
  imagePosition: null,
  platformCompatibility: GENERIC_ONLY,
  propertyEditor: 'button',
  supportsBulletproofCta: true,
  editableFields: [
    { key: 'text', label: 'Button text', kind: 'text', valueType: 'text', group: 'content' },
    { key: 'href', label: 'Link URL', kind: 'url', valueType: 'url', group: 'content' },
    { key: 'align', label: 'Alignment', kind: 'align', valueType: 'align', group: 'style' },
    { key: 'backgroundColor', label: 'Background color', kind: 'color', valueType: 'color', group: 'style' },
    { key: 'textColor', label: 'Text color', kind: 'color', valueType: 'color', group: 'style' },
    { key: 'fontSize', label: 'Font size (px)', kind: 'number', valueType: 'number', group: 'style', min: 8, max: 72 },
    { key: 'borderRadius', label: 'Corner radius (px)', kind: 'number', valueType: 'number', group: 'style', min: 0, max: 50 },
  ],
  createDefaultProps: () => ({
    text: 'Shop Now',
    href: '',
    align: 'center',
    backgroundColor: '#0082AD',
    textColor: '#FFFFFF',
    fontSize: 15,
    borderRadius: 6,
    widthMode: 'auto',
    fixedWidth: 200,
    borderColor: '',
    borderWidth: 0,
    paddingHorizontal: 24,
    paddingVertical: 12,
  }),
  createDefaultSettings: () => createResponsiveSettings(DEFAULT_SPACING),
  // viewport-aware (instruction 37/29) — mobileWidthMode resolves the
  // same way every other Desktop/Mobile override does.
  renderPreview: (module, viewport = 'desktop') => {
    const { props } = module;
    const widthMode: ButtonWidthMode = resolveResponsiveValue(props.widthMode ?? 'auto', props.mobileWidthMode, viewport);
    const paddingH = props.paddingHorizontal ?? 24;
    const paddingV = props.paddingVertical ?? 12;
    return (
      <div style={{ textAlign: module.props.align }}>
        <span
          style={{
            display: widthMode === 'full' ? 'block' : 'inline-block',
            boxSizing: 'border-box',
            width: widthMode === 'fixed' ? props.fixedWidth : widthMode === 'full' ? '100%' : undefined,
            padding: `${paddingV}px ${paddingH}px`,
            background: props.backgroundColor,
            color: props.textColor,
            fontSize: props.fontSize,
            borderRadius: props.borderRadius,
            border: props.borderWidth ? `${props.borderWidth}px solid ${props.borderColor || 'transparent'}` : undefined,
            fontWeight: 600,
            textAlign: 'center',
          }}
        >
          {props.text}
        </span>
      </div>
    );
  },
  renderEmailHtml: (module) => {
    const { props, settings } = module;
    const widthMode: ButtonWidthMode = props.widthMode ?? 'auto';
    const paddingH = props.paddingHorizontal ?? 24;
    const paddingV = props.paddingVertical ?? 12;
    const border = props.borderWidth ? `border:${props.borderWidth}px solid ${props.borderColor || props.backgroundColor}; ` : '';
    const tdStyle = `border-radius:${props.borderRadius}px; background-color:${props.backgroundColor}; ${border}`;
    const linkStyle = `display:${widthMode === 'full' ? 'block' : 'inline-block'}; box-sizing:border-box; `
      + (widthMode === 'fixed' ? `width:${props.fixedWidth ?? 200}px; ` : '')
      + `padding:${paddingV}px ${paddingH}px; font-family:Arial,Helvetica,sans-serif; `
      + `font-size:${props.fontSize}px; font-weight:bold; color:${props.textColor}; text-decoration:none; `
      + `border-radius:${props.borderRadius}px; text-align:center;`;
    const link = `<a href="${escapeAttribute(sanitizeUrl(props.href))}" target="_blank" rel="noopener noreferrer" style="${linkStyle}">${escapeHtml(props.text)}</a>`;
    // Table-based button — safe in Outlook Classic, unlike a flex/anchor
    // button — per the Module-4 Outlook-compatibility rule.
    // align="center" (HTML attribute, not CSS margin) — the Outlook-safe
    // way to center a block-level table; a Full Width button instead
    // gets width="100%" on the table itself so the <a> can fill it.
    const table = widthMode === 'full'
      ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td width="100%" bgcolor="${props.backgroundColor}" style="${tdStyle}">${link}</td></tr></table>`
      : `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center"><tr><td bgcolor="${props.backgroundColor}" style="${tdStyle}">${link}</td></tr></table>`;
    const style = `${paddingStyle(resolveSpacing(settings, 'desktop'))} text-align:${props.align};`;
    const plainRow = moduleTableRow(cell(table, style));

    // Sub-phase 6, work package A — VML bulletproof-button pairing. Only
    // applies when the module opted in (settings.outlookVml) AND the
    // width mode is one VML can render reliably (see
    // vml.ts::canRenderVmlButton) — 'full' width silently keeps the
    // existing plain-only output rather than shipping an untested VML
    // pattern.
    if (settings.outlookVml && canRenderVmlButton({ widthMode })) {
      const vmlHtml = renderVmlButton({
        href: props.href,
        text: props.text,
        backgroundColor: props.backgroundColor,
        textColor: props.textColor,
        fontSize: props.fontSize,
        borderRadius: props.borderRadius,
        widthMode,
        fixedWidth: props.fixedWidth,
        paddingHorizontal: paddingH,
        paddingVertical: paddingV,
      }, table);
      return moduleTableRow(cell(vmlHtml, style));
    }

    return plainRow;
  },
};

const dividerDefinition: ModuleDefinition<DividerModuleProps> = {
  type: 'divider',
  label: 'Divider',
  category: 'content',
  icon: 'close',
  description: 'A thin horizontal rule that separates content.',
  tags: ['divider', 'rule', 'separator'],
  keywords: ['divider', 'rule', 'separator', 'line'],
  columnCount: null,
  imagePosition: null,
  platformCompatibility: GENERIC_ONLY,
  propertyEditor: 'basic',
  editableFields: [
    { key: 'color', label: 'Color', kind: 'color', valueType: 'color', group: 'style' },
    { key: 'thickness', label: 'Thickness (px)', kind: 'number', valueType: 'number', group: 'style', min: 1, max: 12 },
    { key: 'align', label: 'Alignment', kind: 'align', valueType: 'align', group: 'style' },
  ],
  createDefaultProps: () => ({ color: '#D9E2E5', thickness: 1, width: { desktop: percent(100) }, align: 'center' }),
  createDefaultSettings: () => createResponsiveSettings(DEFAULT_SPACING),
  renderPreview: (module) => (
    <div style={{ textAlign: module.props.align ?? 'center' }}>
      <hr
        style={{
          border: 'none',
          borderTop: `${module.props.thickness}px solid ${module.props.color}`,
          margin: 0,
          width: widthCssValue(resolveDimension(module.props.width ?? { desktop: percent(100) }, 'desktop')),
          display: 'inline-block',
        }}
      />
    </div>
  ),
  renderEmailHtml: (module) => {
    const { props, settings } = module;
    const spacing = resolveSpacing(settings, 'desktop');
    const resolvedWidth = resolveDimension(props.width ?? { desktop: percent(100) }, 'desktop');
    // The border lives on a nested single-cell table's <td> — no <div>
    // at all — kept as its own inner table (rather than putting the
    // border directly on the padded outer <td>) so the line still sits
    // centered within the module's padding, exactly as before. `align`
    // on the inner table (HTML attribute, not CSS margin) positions a
    // narrower-than-100% line left/center/right.
    const borderCell = cell('&nbsp;', `border-top:${props.thickness}px solid ${props.color}; font-size:0; line-height:0;`, { width: widthAttr(resolvedWidth) });
    const line = `<table role="presentation" width="${widthAttr(resolvedWidth)}" cellpadding="0" cellspacing="0" border="0" align="${props.align ?? 'center'}"><tr>${borderCell}</tr></table>`;
    return moduleTableRow(cell(line, paddingStyle(spacing)));
  },
};

const spacerDefinition: ModuleDefinition<SpacerModuleProps> = {
  type: 'spacer',
  label: 'Spacer',
  category: 'content',
  icon: 'menu',
  description: 'Vertical blank space between modules.',
  tags: ['spacer', 'space', 'gap'],
  keywords: ['spacer', 'space', 'gap', 'blank', 'utility'],
  columnCount: null,
  imagePosition: null,
  platformCompatibility: GENERIC_ONLY,
  propertyEditor: 'basic',
  editableFields: [
    { key: 'height', label: 'Height (px)', kind: 'number', valueType: 'number', group: 'style', min: 4, max: 200 },
  ],
  createDefaultProps: () => ({ height: 24, mobileHeight: undefined }),
  createDefaultSettings: () => createResponsiveSettings({ paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0 }),
  renderPreview: (module, viewport = 'desktop') => {
    const height = viewport === 'mobile' && module.props.mobileHeight !== undefined
      ? module.props.mobileHeight
      : module.props.height;
    return <div style={{ height }} />;
  },
  renderEmailHtml: (module) => (
    // Table-cell height + non-breaking line-height, not an empty div —
    // the email-safe spacer pattern. Desktop height is the static-export
    // source of truth (mobileHeight is canvas-preview + data-model only,
    // same convention as every other Desktop/Mobile property this pass —
    // see edm.ts's EmailModuleSettings docstring). The inline
    // font-size/line-height (matching `height`) is what non-Outlook
    // clients use; the `mso-spacer` class additionally picks up a
    // SCOPED MSO-only zero-metrics override (see
    // outlookCompatibility.ts's renderOutlookSpacerRowCss) — Classic
    // Outlook's Word engine can add extra vertical space around a
    // non-zero font-size/line-height even with an explicit `height`
    // attribute, so it gets the stricter zero treatment; every other
    // client keeps the height-matched values already here.
    moduleTable(`<tr><td height="${module.props.height}" class="mso-spacer" style="font-size:${module.props.height}px; line-height:${module.props.height}px;">&nbsp;</td></tr>`)
  ),
};

function compositeDefinition(
  type: 'image-text' | 'text-image', label: string,
): ModuleDefinition<CompositeModuleProps> {
  const imageFirst = type === 'image-text';
  return {
    type,
    label,
    category: 'images',
    icon: 'landing-page',
    description: `Image and text side by side, image on the ${imageFirst ? 'left' : 'right'}.`,
    tags: ['image', 'text', imageFirst ? 'image left' : 'image right', 'composite'],
    keywords: ['image', 'text', imageFirst ? 'image left' : 'image right', '2 column'],
    columnCount: 2,
    imagePosition: imageFirst ? 'left' : 'right',
    platformCompatibility: GENERIC_ONLY,
    propertyEditor: 'composite',
    // Sub-phase 6 closure — the CTA is optional content (only rendered
    // when props.text.ctaText is set), but when present it IS a real
    // filled button (see renderEmailHtml below) — same capability posture
    // as every other conditionally-rendered CTA in this registry.
    supportsBulletproofCta: true,
    editableFields: [
      { key: 'image.src', label: 'Image URL', kind: 'url', valueType: 'image_asset', group: 'content' },
      { key: 'image.alt', label: 'Image alt text', kind: 'text', valueType: 'text', group: 'content' },
      { key: 'text.text', label: 'Text', kind: 'textarea', valueType: 'text', group: 'content' },
      { key: 'text.ctaText', label: 'Button text', kind: 'text', valueType: 'text', group: 'content' },
      { key: 'text.ctaHref', label: 'Button link', kind: 'url', valueType: 'url', group: 'content' },
      { key: 'text.align', label: 'Text alignment', kind: 'align', valueType: 'align', group: 'style' },
      { key: 'text.color', label: 'Text color', kind: 'color', valueType: 'color', group: 'style' },
      { key: 'text.fontSize', label: 'Font size (px)', kind: 'number', valueType: 'number', group: 'style', min: 8, max: 72 },
    ],
    createDefaultProps: () => ({
      // Empty src for the same reason as the standalone Image module —
      // no external network dependency; ImagePreview shows a builder
      // placeholder until a real URL is set.
      image: { src: '', alt: 'Image', width: { desktop: px(280) } },
      text: {
        text: 'Add a short description next to your image.', align: 'left',
        fontFamily: DEFAULT_FONT_ID, fontSize: 15, color: '#333333', ctaText: '', ctaHref: '',
      },
    }),
    createDefaultSettings: () => createResponsiveSettings(DEFAULT_SPACING, { mobileOrder: 'image-first', mobileStack: true }),
    // Mobile view stacks image-over-text (mobileOrder decides which
    // comes first) instead of the desktop side-by-side split — matches
    // the exported HTML's mobile intent captured in settings.mobileOrder.
    renderPreview: (module, viewport = 'desktop') => {
      const stacked = viewport === 'mobile' && module.settings.mobileStack !== false;
      const imageCol = (
        <ImagePreview
          src={module.props.image.src}
          alt={module.props.image.alt}
          width={resolveDimension(module.props.image.width, viewport)}
          align="center"
        />
      );
      const textCol = (
        <div>
          <p
            style={{
              margin: 0,
              textAlign: module.props.text.align,
              fontFamily: fontStackFor(module.props.text.fontFamily),
              fontSize: module.props.text.fontSize ?? 15,
              color: module.props.text.color ?? '#333333',
            }}
          >
            {module.props.text.text}
          </p>
          {module.props.text.ctaText && (
            <p style={{ margin: '10px 0 0', textAlign: module.props.text.align }}>
              <span style={{ display: 'inline-block', padding: '8px 16px', background: '#0082AD', color: '#FFFFFF', borderRadius: 6, fontSize: 12, fontWeight: 600 }}>
                {module.props.text.ctaText}
              </span>
            </p>
          )}
        </div>
      );
      if (stacked) {
        const imageLeadsOnMobile = (module.settings.mobileOrder ?? (imageFirst ? 'image-first' : 'content-first')) === 'image-first';
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {imageLeadsOnMobile ? imageCol : textCol}
            {imageLeadsOnMobile ? textCol : imageCol}
          </div>
        );
      }
      return (
        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          <div style={{ flex: '0 0 40%' }}>{imageFirst ? imageCol : textCol}</div>
          <div style={{ flex: '1 1 60%' }}>{imageFirst ? textCol : imageCol}</div>
        </div>
      );
    },
    renderEmailHtml: (module) => {
      const { props, settings } = module;
      const resolvedWidth = resolveDimension(props.image.width, 'desktop');
      const imgCell = cell(
        `<img src="${escapeAttribute(sanitizeUrl(props.image.src))}" alt="${escapeAttribute(props.image.alt)}" `
        + `width="${widthAttr(resolvedWidth)}" style="display:block; width:100%; max-width:${widthCssValue(resolvedWidth)}; height:auto; border:0;" />`,
        'width:40%; vertical-align:top;',
      );
      const plainCtaHtml = props.text.ctaText
        ? `<a href="${escapeAttribute(sanitizeUrl(props.text.ctaHref))}" style="display:inline-block; padding:8px 16px; background-color:#0082AD; color:#FFFFFF; font-family:Arial,Helvetica,sans-serif; font-size:12px; font-weight:bold; text-decoration:none; border-radius:6px;">${escapeHtml(props.text.ctaText)}</a>`
        : '';
      // Sub-phase 6 closure — same VML bulletproof-button pairing as the
      // standalone Button module (vml.ts::canRenderVmlButton/renderVmlButton),
      // gated on settings.outlookVml. This CTA has no width-mode concept
      // (always content-width), so canRenderVmlButton's 'full' decline
      // never applies here.
      const ctaHtml = (props.text.ctaText && settings.outlookVml)
        ? renderVmlButton({
          href: props.text.ctaHref ?? '',
          text: props.text.ctaText,
          backgroundColor: '#0082AD',
          textColor: '#FFFFFF',
          fontSize: 12,
          borderRadius: 6,
          paddingHorizontal: 16,
          paddingVertical: 8,
        }, plainCtaHtml)
        : plainCtaHtml;
      const textCell = cell(
        textLine(
          escapeHtml(props.text.text).replace(/\n/g, '<br>'),
          `text-align:${props.text.align}; font-family:${fontStackFor(props.text.fontFamily)}; font-size:${props.text.fontSize ?? 15}px; color:${props.text.color ?? '#333333'};`,
          ctaHtml ? 10 : 0,
        ) + (ctaHtml ? textLine(ctaHtml, `text-align:${props.text.align};`) : ''),
        'width:60%; vertical-align:top;',
      );
      const cells = imageFirst ? `${imgCell}${textCell}` : `${textCell}${imgCell}`;
      const wrapped = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${cells}</tr></table>`;
      return moduleTableRow(cell(wrapped, paddingStyle(resolveSpacing(settings, 'desktop'))));
    },
  };
}

export const BASIC_DEFINITIONS: AnyModuleDefinition[] = [
  textDefinition,
  imageDefinition,
  compositeDefinition('image-text', 'Image + Text'),
  compositeDefinition('text-image', 'Text + Image'),
  buttonDefinition,
  dividerDefinition,
  spacerDefinition,
];

export const BASIC_TYPES_ORDER: EmailModuleType[] = BASIC_DEFINITIONS.map((d) => d.type);
