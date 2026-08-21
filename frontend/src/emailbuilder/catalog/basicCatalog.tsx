import type {
  ButtonModuleProps, CompositeModuleProps, DividerModuleProps, EmailModuleType, ImageModuleProps,
  SpacerModuleProps, TextModuleProps,
} from '../edm';
import { DEFAULT_SPACING, resolveSpacing } from '../edm';
import { percent, px, resolveDimension, widthAttr, widthCssValue } from '../dimensions';
import { escapeAttribute, escapeHtml, sanitizeUrl } from '../sanitize';
import {
  GENERIC_ONLY, ImagePreview, cell, createResponsiveSettings, moduleTable, moduleTableRow, paddingStyle,
  textLine, type AnyModuleDefinition, type ModuleDefinition,
} from '../registryCore';

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
  createDefaultProps: () => ({
    text: 'Add your heading or paragraph text here.',
    align: 'left',
    fontSize: 16,
    fontWeight: 400,
    color: '#333333',
    lineHeight: 24,
  }),
  createDefaultSettings: () => createResponsiveSettings(DEFAULT_SPACING),
  renderPreview: (module) => (
    <p
      style={{
        margin: 0,
        textAlign: module.props.align,
        fontSize: module.props.fontSize,
        fontWeight: module.props.fontWeight,
        color: module.props.color,
        lineHeight: `${module.props.lineHeight}px`,
      }}
    >
      {module.props.text}
    </p>
  ),
  renderEmailHtml: (module) => {
    const { props, settings } = module;
    const style = `${paddingStyle(resolveSpacing(settings, 'desktop'))} text-align:${props.align}; font-family:Arial,Helvetica,sans-serif; `
      + `font-size:${props.fontSize}px; font-weight:${props.fontWeight}; color:${props.color}; `
      + `line-height:${props.lineHeight}px;`;
    return moduleTableRow(cell(escapeHtml(props.text).replace(/\n/g, '<br>'), style));
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
  }),
  createDefaultSettings: () => createResponsiveSettings(DEFAULT_SPACING),
  renderPreview: (module, viewport = 'desktop') => (
    <ImagePreview
      src={module.props.src}
      alt={module.props.alt}
      width={resolveDimension(module.props.width, viewport)}
      align={module.props.align}
    />
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
    const style = `${paddingStyle(resolveSpacing(settings, 'desktop'))} text-align:${props.align};`;
    return moduleTableRow(cell(linked, style));
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
  createDefaultProps: () => ({
    text: 'Shop Now',
    href: '',
    align: 'center',
    backgroundColor: '#0082AD',
    textColor: '#FFFFFF',
    fontSize: 15,
    borderRadius: 6,
  }),
  createDefaultSettings: () => createResponsiveSettings(DEFAULT_SPACING),
  renderPreview: (module) => (
    <div style={{ textAlign: module.props.align }}>
      <span
        style={{
          display: 'inline-block',
          padding: '12px 24px',
          background: module.props.backgroundColor,
          color: module.props.textColor,
          fontSize: module.props.fontSize,
          borderRadius: module.props.borderRadius,
          fontWeight: 600,
        }}
      >
        {module.props.text}
      </span>
    </div>
  ),
  renderEmailHtml: (module) => {
    const { props, settings } = module;
    // Table-based button — safe in Outlook Classic, unlike a flex/anchor
    // button — per the Module-4 Outlook-compatibility rule. Content-
    // sized by design (instruction: "Button: auto/content-sized, unless
    // module explicitly needs width") — no width control.
    const button = (
      // align="center" (HTML attribute, not CSS margin) — the
      // Outlook-safe way to center a block-level table.
      '<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center">'
      + '<tr><td style="'
      + `border-radius:${props.borderRadius}px; background-color:${props.backgroundColor};`
      + '">'
      + `<a href="${escapeAttribute(sanitizeUrl(props.href))}" target="_blank" rel="noopener noreferrer" `
      + `style="display:inline-block; padding:12px 24px; font-family:Arial,Helvetica,sans-serif; `
      + `font-size:${props.fontSize}px; font-weight:bold; color:${props.textColor}; text-decoration:none; `
      + `border-radius:${props.borderRadius}px;">${escapeHtml(props.text)}</a>`
      + '</td></tr></table>'
    );
    const style = `${paddingStyle(resolveSpacing(settings, 'desktop'))} text-align:${props.align};`;
    return moduleTableRow(cell(button, style));
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
  createDefaultProps: () => ({ color: '#D9E2E5', thickness: 1 }),
  createDefaultSettings: () => createResponsiveSettings(DEFAULT_SPACING),
  renderPreview: (module) => (
    <hr style={{ border: 'none', borderTop: `${module.props.thickness}px solid ${module.props.color}`, margin: 0 }} />
  ),
  renderEmailHtml: (module) => {
    const { props, settings } = module;
    const spacing = resolveSpacing(settings, 'desktop');
    // The border lives on a nested single-cell table's <td> — no <div>
    // at all — kept as its own inner table (rather than putting the
    // border directly on the padded outer <td>) so the line still sits
    // centered within the module's padding, exactly as before.
    const borderCell = `<td style="border-top:${props.thickness}px solid ${props.color}; font-size:0; line-height:0;">&nbsp;</td>`;
    const line = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${borderCell}</tr></table>`;
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
  createDefaultProps: () => ({ height: 24 }),
  createDefaultSettings: () => createResponsiveSettings({ paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0 }),
  renderPreview: (module) => <div style={{ height: module.props.height }} />,
  renderEmailHtml: (module) => (
    // Table-cell height + non-breaking line-height, not an empty div —
    // the email-safe spacer pattern.
    moduleTable(`<tr><td height="${module.props.height}" style="font-size:${module.props.height}px; line-height:${module.props.height}px;">&nbsp;</td></tr>`)
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
    createDefaultProps: () => ({
      // Empty src for the same reason as the standalone Image module —
      // no external network dependency; ImagePreview shows a builder
      // placeholder until a real URL is set.
      image: { src: '', alt: 'Image', width: { desktop: px(280) } },
      text: { text: 'Add a short description next to your image.', align: 'left' },
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
        <p style={{ margin: 0, textAlign: module.props.text.align }}>{module.props.text.text}</p>
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
      const textCell = cell(
        textLine(
          escapeHtml(props.text.text).replace(/\n/g, '<br>'),
          `text-align:${props.text.align}; font-family:Arial,Helvetica,sans-serif; font-size:15px; color:#333333;`,
        ),
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
