import { useState, type ReactNode } from 'react';
import {
  DEFAULT_PADDING, ZERO_PADDING,
  type ButtonModuleProps, type CompositeModuleProps, type DividerModuleProps, type EmailModule,
  type EmailModuleSettings, type EmailModuleType, type HorizontalAlign, type ImageModuleProps,
  type LayoutModuleProps, type ModuleCategory, type SpacerModuleProps, type TextModuleProps,
} from './edm';
import { escapeAttribute, escapeHtml, sanitizeUrl } from './sanitize';

// A module definition owns everything the builder needs for one module
// type: how to create it, how to preview it on the (React/div) canvas,
// and how to export it as table-first email HTML. Feature 04's module
// library adds hundreds more entries to this object — it never needs to
// touch the canvas/renderer/properties-panel code itself.
export interface ModuleDefinition<Props = Record<string, unknown>> {
  type: EmailModuleType;
  label: string;
  category: ModuleCategory;
  icon: string;
  propertyEditor: 'text' | 'image' | 'button' | 'composite' | 'basic';
  createDefaultProps: () => Props;
  createDefaultSettings: () => EmailModuleSettings;
  renderPreview: (module: EmailModule<Props>) => ReactNode;
  renderEmailHtml: (module: EmailModule<Props>) => string;
}

function paddingStyle(settings: EmailModuleSettings): string {
  return `padding:${settings.paddingTop}px ${settings.paddingRight}px ${settings.paddingBottom}px ${settings.paddingLeft}px;`;
}

function cell(content: string, extraStyle = ''): string {
  return `<td style="${extraStyle}">${content}</td>`;
}

// Every module's exported HTML is one presentation table row — table-first,
// no structural divs, per the Module-4 email HTML rules.
function moduleTable(innerRowHtml: string): string {
  return (
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">'
    + `<tr>${innerRowHtml}</tr>`
    + '</table>'
  );
}

// Builder-canvas-only: shown whenever no image URL is set yet, or the
// given URL fails to load — a polished placeholder instead of the
// browser's native broken-image icon (and instead of the image's own
// `alt` text visually doubling as body copy, which read as "duplicate
// content" next to a composite module's real text). Never affects the
// exported email HTML, which always uses the real <img src alt> pair.
function ImagePreview({ src, alt, width, align }: {
  src: string; alt: string; width: number; align: HorizontalAlign;
}) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <div className="email-canvas__image-placeholder" style={{ textAlign: align }}>
        <span className="mdaiw-icon mdaiw-icon--camera" aria-hidden="true" />
        <span className="email-canvas__image-placeholder-label">Image</span>
        <span className="email-canvas__image-placeholder-hint">Add an image URL from Properties</span>
      </div>
    );
  }

  return (
    <div style={{ textAlign: align }}>
      <img
        src={src}
        alt={alt}
        style={{ maxWidth: '100%', width, height: 'auto', display: 'inline-block' }}
        onError={() => setFailed(true)}
      />
    </div>
  );
}

const textDefinition: ModuleDefinition<TextModuleProps> = {
  type: 'text',
  label: 'Text',
  category: 'content',
  icon: 'file',
  propertyEditor: 'text',
  createDefaultProps: () => ({
    text: 'Add your heading or paragraph text here.',
    align: 'left',
    fontSize: 16,
    fontWeight: 400,
    color: '#333333',
    lineHeight: 24,
  }),
  createDefaultSettings: () => ({ ...DEFAULT_PADDING }),
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
    const style = `${paddingStyle(settings)} text-align:${props.align}; font-family:Arial,Helvetica,sans-serif; `
      + `font-size:${props.fontSize}px; font-weight:${props.fontWeight}; color:${props.color}; `
      + `line-height:${props.lineHeight}px;`;
    return moduleTable(cell(escapeHtml(props.text).replace(/\n/g, '<br>'), style));
  },
};

const imageDefinition: ModuleDefinition<ImageModuleProps> = {
  type: 'image',
  label: 'Image',
  category: 'images',
  icon: 'camera',
  propertyEditor: 'image',
  createDefaultProps: () => ({
    // Empty by design (no external network dependency for a fresh
    // module) — the builder shows a polished placeholder until the user
    // supplies a real URL via Properties. See ImagePreview above.
    src: '',
    alt: 'Image',
    width: 600,
    align: 'center',
    href: '',
  }),
  createDefaultSettings: () => ({ ...DEFAULT_PADDING }),
  renderPreview: (module) => (
    <ImagePreview
      src={module.props.src}
      alt={module.props.alt}
      width={module.props.width}
      align={module.props.align}
    />
  ),
  renderEmailHtml: (module) => {
    const { props, settings } = module;
    const imgTag = `<img src="${escapeAttribute(sanitizeUrl(props.src))}" alt="${escapeAttribute(props.alt)}" `
      + `width="${props.width}" style="display:block; width:100%; max-width:${props.width}px; height:auto; border:0;" />`;
    const linked = props.href
      ? `<a href="${escapeAttribute(sanitizeUrl(props.href))}" target="_blank" rel="noopener noreferrer">${imgTag}</a>`
      : imgTag;
    const style = `${paddingStyle(settings)} text-align:${props.align};`;
    return moduleTable(cell(linked, style));
  },
};

const buttonDefinition: ModuleDefinition<ButtonModuleProps> = {
  type: 'button',
  label: 'Button',
  category: 'cta',
  icon: 'send',
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
  createDefaultSettings: () => ({ ...DEFAULT_PADDING }),
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
    // button — per the Module-4 Outlook-compatibility rule.
    const button = (
      '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;">'
      + '<tr><td style="'
      + `border-radius:${props.borderRadius}px; background-color:${props.backgroundColor};`
      + '">'
      + `<a href="${escapeAttribute(sanitizeUrl(props.href))}" target="_blank" rel="noopener noreferrer" `
      + `style="display:inline-block; padding:12px 24px; font-family:Arial,Helvetica,sans-serif; `
      + `font-size:${props.fontSize}px; font-weight:bold; color:${props.textColor}; text-decoration:none; `
      + `border-radius:${props.borderRadius}px;">${escapeHtml(props.text)}</a>`
      + '</td></tr></table>'
    );
    const style = `${paddingStyle(settings)} text-align:${props.align};`;
    return moduleTable(cell(button, style));
  },
};

function layoutDefinition(
  type: EmailModuleType, label: string, columnWidths: number[],
): ModuleDefinition<LayoutModuleProps> {
  return {
    type,
    label,
    category: 'layout',
    icon: 'landing-page',
    propertyEditor: 'basic',
    createDefaultProps: () => ({ columnWidths }),
    createDefaultSettings: () => ({ ...ZERO_PADDING }),
    renderPreview: (module) => (
      <div className="email-canvas__layout-columns">
        {module.props.columnWidths.map((width, index) => (
          <div
            key={`${module.id}-col-${index}`}
            className="email-canvas__layout-column"
            style={{ flex: `0 0 ${width}%` }}
          >
            + Add content
          </div>
        ))}
      </div>
    ),
    renderEmailHtml: (module) => {
      const cells = module.props.columnWidths
        .map((width) => `<td width="${width}%" style="width:${width}%; vertical-align:top;">&nbsp;</td>`)
        .join('');
      return moduleTable(cells);
    },
  };
}

const dividerDefinition: ModuleDefinition<DividerModuleProps> = {
  type: 'divider',
  label: 'Divider',
  category: 'content',
  icon: 'close',
  propertyEditor: 'basic',
  createDefaultProps: () => ({ color: '#D9E2E5', thickness: 1 }),
  createDefaultSettings: () => ({ ...DEFAULT_PADDING }),
  renderPreview: (module) => (
    <hr style={{ border: 'none', borderTop: `${module.props.thickness}px solid ${module.props.color}`, margin: 0 }} />
  ),
  renderEmailHtml: (module) => {
    const { props, settings } = module;
    const style = `${paddingStyle(settings)} font-size:0; line-height:0;`;
    const line = `<div style="border-top:${props.thickness}px solid ${props.color}; font-size:0; line-height:0;">&nbsp;</div>`;
    return moduleTable(cell(line, style));
  },
};

const spacerDefinition: ModuleDefinition<SpacerModuleProps> = {
  type: 'spacer',
  label: 'Spacer',
  category: 'content',
  icon: 'menu',
  propertyEditor: 'basic',
  createDefaultProps: () => ({ height: 24 }),
  createDefaultSettings: () => ({ ...ZERO_PADDING }),
  renderPreview: (module) => <div style={{ height: module.props.height }} />,
  renderEmailHtml: (module) => (
    // Table-cell height + non-breaking line-height, not an empty div —
    // the email-safe spacer pattern.
    moduleTable(`<td height="${module.props.height}" style="font-size:${module.props.height}px; line-height:${module.props.height}px;">&nbsp;</td>`)
  ),
};

function compositeDefinition(type: 'image-text' | 'text-image', label: string): ModuleDefinition<CompositeModuleProps> {
  const imageFirst = type === 'image-text';
  return {
    type,
    label,
    category: 'images',
    icon: 'landing-page',
    propertyEditor: 'composite',
    createDefaultProps: () => ({
      // Empty src for the same reason as the standalone Image module —
      // no external network dependency; ImagePreview shows a builder
      // placeholder until a real URL is set.
      image: { src: '', alt: 'Image', width: 280 },
      text: { text: 'Add a short description next to your image.', align: 'left' },
    }),
    createDefaultSettings: () => ({ ...DEFAULT_PADDING, mobileOrder: 'image-first' }),
    renderPreview: (module) => {
      const imageCol = (
        <ImagePreview
          src={module.props.image.src}
          alt={module.props.image.alt}
          width={module.props.image.width}
          align="center"
        />
      );
      const textCol = (
        <p style={{ margin: 0, textAlign: module.props.text.align }}>{module.props.text.text}</p>
      );
      return (
        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          <div style={{ flex: '0 0 40%' }}>{imageFirst ? imageCol : textCol}</div>
          <div style={{ flex: '1 1 60%' }}>{imageFirst ? textCol : imageCol}</div>
        </div>
      );
    },
    renderEmailHtml: (module) => {
      const { props, settings } = module;
      const imgCell = cell(
        `<img src="${escapeAttribute(sanitizeUrl(props.image.src))}" alt="${escapeAttribute(props.image.alt)}" `
        + `width="${props.image.width}" style="display:block; width:100%; max-width:${props.image.width}px; height:auto; border:0;" />`,
        'width:40%; vertical-align:top;',
      );
      const textCell = cell(
        `<p style="margin:0; text-align:${props.text.align}; font-family:Arial,Helvetica,sans-serif; font-size:15px; color:#333333;">`
        + `${escapeHtml(props.text.text).replace(/\n/g, '<br>')}</p>`,
        'width:60%; vertical-align:top;',
      );
      const cells = imageFirst ? `${imgCell}${textCell}` : `${textCell}${imgCell}`;
      const wrapped = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${cells}</tr></table>`;
      return moduleTable(cell(wrapped, paddingStyle(settings)));
    },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the registry is intentionally heterogeneous (each entry has its own Props shape); callers narrow via getModuleDefinition() + a type-specific cast where they need one.
export type AnyModuleDefinition = ModuleDefinition<any>;

export const MODULE_REGISTRY: Record<EmailModuleType, AnyModuleDefinition> = {
  'layout-1col': layoutDefinition('layout-1col', '1 Column', [100]),
  'layout-2col-50-50': layoutDefinition('layout-2col-50-50', '2 Columns 50/50', [50, 50]),
  'layout-2col-40-60': layoutDefinition('layout-2col-40-60', '2 Columns 40/60', [40, 60]),
  'layout-2col-60-40': layoutDefinition('layout-2col-60-40', '2 Columns 60/40', [60, 40]),
  'layout-3col': layoutDefinition('layout-3col', '3 Columns', [33, 33, 34]),
  text: textDefinition,
  image: imageDefinition,
  'image-text': compositeDefinition('image-text', 'Image + Text'),
  'text-image': compositeDefinition('text-image', 'Text + Image'),
  button: buttonDefinition,
  divider: dividerDefinition,
  spacer: spacerDefinition,
};

export const MODULE_PANEL_ORDER: EmailModuleType[] = [
  'layout-1col', 'layout-2col-50-50', 'layout-2col-40-60', 'layout-2col-60-40', 'layout-3col',
  'text', 'image', 'image-text', 'text-image', 'button', 'divider', 'spacer',
];

export function getModuleDefinition(type: EmailModuleType): AnyModuleDefinition {
  return MODULE_REGISTRY[type];
}
