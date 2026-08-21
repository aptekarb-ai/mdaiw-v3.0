import type {
  ArticleTeaserModuleProps, ContentBlockModuleProps, EmailModuleType, FeatureListModuleProps,
  IconTextRow, IconTextRowsModuleProps, QuoteModuleProps,
} from '../edm';
import { DEFAULT_SPACING, resolveSpacing } from '../edm';
import { px, resolveDimension, widthAttr, widthCssValue } from '../dimensions';
import { escapeAttribute, escapeHtml, sanitizeUrl } from '../sanitize';
import {
  GENERIC_ONLY, ImagePreview, cell, createResponsiveSettings, moduleTableRow, textLine, type AnyModuleDefinition,
  type ModuleDefinition, type ModuleImagePosition, type RepeatableFieldConfig, type SchemaField,
} from '../registryCore';

// --- Heading + Text (+ optional image, + optional CTA) -----------------

type ContentLayout = 'none' | 'left' | 'right' | 'top';

interface ContentVariant {
  type: EmailModuleType;
  label: string;
  description: string;
  tags: string[];
  layout: ContentLayout;
  withCta: boolean;
}

const CONTENT_VARIANTS: ContentVariant[] = [
  { type: 'content-heading-text', label: 'Heading + Text', description: 'A heading with a paragraph beneath it.', tags: ['content', 'heading', 'text'], layout: 'none', withCta: false },
  { type: 'content-heading-text-cta', label: 'Heading + Text + CTA', description: 'A heading, paragraph and call-to-action button.', tags: ['content', 'heading', 'text', 'cta'], layout: 'none', withCta: true },
  { type: 'content-image-left', label: 'Image Left + Content', description: 'Image on the left, heading and text on the right.', tags: ['content', 'image left'], layout: 'left', withCta: true },
  { type: 'content-image-right', label: 'Image Right + Content', description: 'Heading and text on the left, image on the right.', tags: ['content', 'image right'], layout: 'right', withCta: true },
  { type: 'content-image-top', label: 'Image Top + Content', description: 'Image above a heading and paragraph.', tags: ['content', 'image top'], layout: 'top', withCta: true },
];

function contentEditableFields(withImage: boolean, withCta: boolean): SchemaField[] {
  const fields: SchemaField[] = [
    { key: 'heading', label: 'Heading', kind: 'text', group: 'content' },
    { key: 'text', label: 'Text', kind: 'textarea', group: 'content' },
  ];
  if (withImage) {
    fields.push(
      { key: 'image.src', label: 'Image URL', kind: 'url', group: 'content' },
      { key: 'image.alt', label: 'Image alt text', kind: 'text', group: 'content' },
    );
  }
  if (withCta) {
    fields.push(
      { key: 'ctaText', label: 'Button text', kind: 'text', group: 'content' },
      { key: 'ctaHref', label: 'Button link', kind: 'url', group: 'content' },
    );
  }
  fields.push({ key: 'align', label: 'Text alignment', kind: 'align', group: 'style' });
  return fields;
}

function contentBlockDefinition(variant: ContentVariant): ModuleDefinition<ContentBlockModuleProps> {
  const withImage = variant.layout !== 'none';
  const imagePosition: ModuleImagePosition | null = variant.layout === 'none' ? null : variant.layout;
  return {
    type: variant.type,
    label: variant.label,
    category: 'content',
    icon: withImage ? 'landing-page' : 'file',
    description: variant.description,
    tags: variant.tags,
    keywords: ['content', 'heading', 'text', ...variant.tags],
    columnCount: withImage ? 2 : null,
    imagePosition,
    platformCompatibility: GENERIC_ONLY,
    propertyEditor: 'schema',
    editableFields: contentEditableFields(withImage, variant.withCta),
    createDefaultProps: () => ({
      heading: 'A short, clear heading',
      text: 'Supporting copy that explains this section in a sentence or two.',
      image: { src: '', alt: 'Content image', width: { desktop: px(260) } },
      ctaText: 'Read More',
      ctaHref: '',
      align: 'left',
    }),
    createDefaultSettings: () => createResponsiveSettings(DEFAULT_SPACING, { mobileStack: true }),
    renderPreview: (module, viewport = 'desktop') => {
      const { props } = module;
      const stacked = viewport === 'mobile' && module.settings.mobileStack !== false;
      const textBlock = (
        <div style={{ textAlign: props.align }}>
          <h3 style={{ margin: '0 0 6px', fontSize: 18 }}>{props.heading}</h3>
          <p style={{ margin: variant.withCta ? '0 0 12px' : 0 }}>{props.text}</p>
          {variant.withCta && (
            <span style={{ display: 'inline-block', padding: '8px 16px', background: '#0082AD', color: '#FFFFFF', borderRadius: 6, fontSize: 13, fontWeight: 600 }}>
              {props.ctaText}
            </span>
          )}
        </div>
      );
      if (variant.layout === 'none') return textBlock;
      const imageBlock = (
        <ImagePreview
          src={props.image.src}
          alt={props.image.alt}
          width={resolveDimension(props.image.width, viewport)}
          align="center"
        />
      );
      if (variant.layout === 'top' || stacked) {
        return <div>{imageBlock}<div style={{ marginTop: 12 }}>{textBlock}</div></div>;
      }
      return (
        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          <div style={{ flex: '0 0 40%' }}>{variant.layout === 'left' ? imageBlock : textBlock}</div>
          <div style={{ flex: '1 1 60%' }}>{variant.layout === 'left' ? textBlock : imageBlock}</div>
        </div>
      );
    },
    renderEmailHtml: (module) => {
      const { props, settings } = module;
      const spacing = resolveSpacing(settings, 'desktop');
      const paddingCss = `padding:${spacing.paddingTop}px ${spacing.paddingRight}px ${spacing.paddingBottom}px ${spacing.paddingLeft}px;`;
      const headingHtml = textLine(escapeHtml(props.heading), `text-align:${props.align}; font-family:Arial,Helvetica,sans-serif; font-size:20px; color:#002D38;`, 8);
      const textHtml = textLine(
        escapeHtml(props.text).replace(/\n/g, '<br>'),
        `text-align:${props.align}; font-family:Arial,Helvetica,sans-serif; font-size:15px; color:#333333;`,
        variant.withCta ? 16 : 0,
      );
      const ctaHtml = variant.withCta
        ? `<a href="${escapeAttribute(sanitizeUrl(props.ctaHref))}" style="display:inline-block; padding:10px 18px; background-color:#0082AD; color:#FFFFFF; font-family:Arial,Helvetica,sans-serif; font-size:13px; font-weight:bold; text-decoration:none; border-radius:6px;">${escapeHtml(props.ctaText)}</a>`
        : '';
      const textCellHtml = `${headingHtml}${textHtml}${ctaHtml}`;

      if (variant.layout === 'none') {
        return moduleTableRow(cell(textCellHtml, paddingCss));
      }

      const resolvedWidth = resolveDimension(props.image.width, 'desktop');
      const imgHtml = `<img src="${escapeAttribute(sanitizeUrl(props.image.src))}" alt="${escapeAttribute(props.image.alt)}" width="${widthAttr(resolvedWidth)}" style="display:block; width:100%; max-width:${widthCssValue(resolvedWidth)}; height:auto; border:0;" />`;

      if (variant.layout === 'top') {
        const topTable = (
          '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">'
          + `<tr><td>${imgHtml}</td></tr>`
          + `<tr><td style="padding-top:16px;">${textCellHtml}</td></tr>`
          + '</table>'
        );
        return moduleTableRow(cell(topTable, paddingCss));
      }

      const imgCell = cell(imgHtml, 'width:40%; vertical-align:top;');
      const textCell = cell(textCellHtml, 'width:60%; vertical-align:top;');
      const cells = variant.layout === 'left' ? `${imgCell}${textCell}` : `${textCell}${imgCell}`;
      const inner = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${cells}</tr></table>`;
      return moduleTableRow(cell(inner, paddingCss));
    },
  };
}

// --- Quote / Testimonial -------------------------------------------------

const quoteDefinition: ModuleDefinition<QuoteModuleProps> = {
  type: 'content-quote',
  label: 'Quote / Testimonial',
  category: 'content',
  icon: 'file',
  description: 'A pull-quote or customer testimonial with an attributed author.',
  tags: ['quote', 'testimonial', 'review'],
  keywords: ['quote', 'testimonial', 'review', 'content'],
  columnCount: null,
  imagePosition: null,
  platformCompatibility: GENERIC_ONLY,
  propertyEditor: 'schema',
  editableFields: [
    { key: 'quoteText', label: 'Quote', kind: 'textarea', group: 'content' },
    { key: 'authorName', label: 'Author name', kind: 'text', group: 'content' },
    { key: 'authorRole', label: 'Author role', kind: 'text', group: 'content' },
  ],
  createDefaultProps: () => ({
    quoteText: '"This product completely changed how our team works together."',
    authorName: 'Jordan Rivera',
    authorRole: 'Operations Lead',
    align: 'center',
  }),
  createDefaultSettings: () => createResponsiveSettings(DEFAULT_SPACING),
  renderPreview: (module) => (
    <div style={{ textAlign: module.props.align }}>
      <p style={{ margin: '0 0 12px', fontSize: 17, fontStyle: 'italic', color: 'var(--color-primary-dark)' }}>{module.props.quoteText}</p>
      <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{module.props.authorName}</p>
      <p style={{ margin: 0, fontSize: 12, color: 'var(--color-text-subtle)' }}>{module.props.authorRole}</p>
    </div>
  ),
  renderEmailHtml: (module) => {
    const { props, settings } = module;
    const spacing = resolveSpacing(settings, 'desktop');
    const html = (
      textLine(escapeHtml(props.quoteText), "font-family:Georgia,'Times New Roman',serif; font-size:18px; font-style:italic; color:#002D38;", 12)
      + textLine(escapeHtml(props.authorName), 'font-family:Arial,Helvetica,sans-serif; font-size:13px; font-weight:bold; color:#333333;')
      + textLine(escapeHtml(props.authorRole), 'font-family:Arial,Helvetica,sans-serif; font-size:12px; color:#66777D;')
    );
    return moduleTableRow(cell(html, `padding:${spacing.paddingTop}px ${spacing.paddingRight}px ${spacing.paddingBottom}px ${spacing.paddingLeft}px; text-align:${props.align};`));
  },
};

// --- Article Teaser ------------------------------------------------------

const articleTeaserDefinition: ModuleDefinition<ArticleTeaserModuleProps> = {
  type: 'content-article-teaser',
  label: 'Article Teaser',
  category: 'content',
  icon: 'landing-page',
  description: 'An eyebrow label, heading, image and short teaser text with a Read More link.',
  tags: ['article', 'teaser', 'blog', 'news'],
  keywords: ['article', 'teaser', 'blog', 'news', 'content', 'image top'],
  columnCount: null,
  imagePosition: 'top',
  platformCompatibility: GENERIC_ONLY,
  propertyEditor: 'schema',
  editableFields: [
    { key: 'eyebrow', label: 'Eyebrow label', kind: 'text', group: 'content' },
    { key: 'heading', label: 'Heading', kind: 'text', group: 'content' },
    { key: 'text', label: 'Teaser text', kind: 'textarea', group: 'content' },
    { key: 'image.src', label: 'Image URL', kind: 'url', group: 'content' },
    { key: 'image.alt', label: 'Image alt text', kind: 'text', group: 'content' },
    { key: 'ctaText', label: 'Link text', kind: 'text', group: 'content' },
    { key: 'ctaHref', label: 'Link URL', kind: 'url', group: 'content' },
  ],
  createDefaultProps: () => ({
    eyebrow: 'Latest News',
    heading: 'A headline that draws the reader in',
    text: 'A short teaser paragraph summarizing the article.',
    image: { src: '', alt: 'Article image', width: { desktop: px(600) } },
    ctaText: 'Read More',
    ctaHref: '',
  }),
  createDefaultSettings: () => createResponsiveSettings(DEFAULT_SPACING),
  renderPreview: (module, viewport = 'desktop') => {
    const { props } = module;
    return (
      <div>
        <ImagePreview
          src={props.image.src}
          alt={props.image.alt}
          width={resolveDimension(props.image.width, viewport)}
          align="center"
        />
        <p style={{ margin: '12px 0 4px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--color-primary-blue)' }}>{props.eyebrow}</p>
        <h3 style={{ margin: '0 0 6px', fontSize: 18 }}>{props.heading}</h3>
        <p style={{ margin: '0 0 8px' }}>{props.text}</p>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-primary-blue)' }}>{props.ctaText} →</span>
      </div>
    );
  },
  renderEmailHtml: (module) => {
    const { props, settings } = module;
    const spacing = resolveSpacing(settings, 'desktop');
    const resolvedWidth = resolveDimension(props.image.width, 'desktop');
    const html = (
      `<img src="${escapeAttribute(sanitizeUrl(props.image.src))}" alt="${escapeAttribute(props.image.alt)}" width="${widthAttr(resolvedWidth)}" style="display:block; width:100%; max-width:${widthCssValue(resolvedWidth)}; height:auto; border:0;" />`
      + textLine(escapeHtml(props.eyebrow), 'padding-top:16px; font-family:Arial,Helvetica,sans-serif; font-size:11px; font-weight:bold; text-transform:uppercase; color:#0082AD;', 4)
      + textLine(escapeHtml(props.heading), 'font-family:Arial,Helvetica,sans-serif; font-size:20px; color:#002D38;', 8)
      + textLine(escapeHtml(props.text), 'font-family:Arial,Helvetica,sans-serif; font-size:15px; color:#333333;', 10)
      + `<a href="${escapeAttribute(sanitizeUrl(props.ctaHref))}" style="font-family:Arial,Helvetica,sans-serif; font-size:13px; font-weight:bold; color:#0082AD; text-decoration:none;">${escapeHtml(props.ctaText)} &rarr;</a>`
    );
    return moduleTableRow(cell(html, `padding:${spacing.paddingTop}px ${spacing.paddingRight}px ${spacing.paddingBottom}px ${spacing.paddingLeft}px;`));
  },
};

// A small round bullet marker as a single-cell nested table — not a
// sized/positioned <div> — used by both list modules below.
function bulletDotCell(color: string): string {
  return (
    '<td width="24" valign="top" style="padding-top:4px; padding-bottom:14px;">'
    + '<table role="presentation" cellpadding="0" cellspacing="0" border="0">'
    + `<tr><td width="8" height="8" style="width:8px; height:8px; font-size:0; line-height:0; background-color:${color}; border-radius:50%;">&nbsp;</td></tr>`
    + '</table>'
    + '</td>'
  );
}

// --- Feature List (bulleted heading + text rows) -------------------------

const featureListDefinition: ModuleDefinition<FeatureListModuleProps> = {
  type: 'content-feature-list',
  label: 'Feature List',
  category: 'content',
  icon: 'check-circle',
  description: 'A heading with a stacked list of feature title/description pairs.',
  tags: ['feature list', 'benefits', 'list'],
  keywords: ['feature', 'list', 'benefits', 'content'],
  columnCount: null,
  imagePosition: null,
  platformCompatibility: GENERIC_ONLY,
  propertyEditor: 'schema',
  editableFields: [
    { key: 'heading', label: 'Heading', kind: 'text', group: 'content' },
  ],
  createDefaultProps: () => ({
    heading: 'Why customers choose us',
    items: [
      { title: 'Fast setup', text: 'Get started in minutes, not days.' },
      { title: 'Reliable support', text: 'Our team responds within one business day.' },
      { title: 'Flexible plans', text: 'Scale up or down whenever you need to.' },
    ],
  }),
  createDefaultSettings: () => createResponsiveSettings(DEFAULT_SPACING),
  renderPreview: (module) => (
    <div>
      <h3 style={{ margin: '0 0 12px', fontSize: 18 }}>{module.props.heading}</h3>
      {module.props.items.map((item) => (
        <div key={item.title} style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <span className="mdaiw-icon mdaiw-icon--check-circle" aria-hidden="true" style={{ width: 16, height: 16, flexShrink: 0, marginTop: 2 }} />
          <div>
            <p style={{ margin: 0, fontWeight: 600, fontSize: 14 }}>{item.title}</p>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-subtle)' }}>{item.text}</p>
          </div>
        </div>
      ))}
    </div>
  ),
  renderEmailHtml: (module) => {
    const { props, settings } = module;
    const spacing = resolveSpacing(settings, 'desktop');
    const rows = props.items.map((item) => (
      '<tr>'
      + bulletDotCell('#76C043')
      + `<td valign="top" style="padding-bottom:14px; padding-left:8px; font-family:Arial,Helvetica,sans-serif;">`
      + textLine(escapeHtml(item.title), 'font-size:14px; font-weight:bold; color:#333333;')
      + textLine(escapeHtml(item.text), 'font-size:13px; color:#66777D;')
      + '</td>'
      + '</tr>'
    )).join('');
    const html = (
      textLine(escapeHtml(props.heading), 'font-family:Arial,Helvetica,sans-serif; font-size:20px; color:#002D38;', 12)
      + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table>`
    );
    return moduleTableRow(cell(html, `padding:${spacing.paddingTop}px ${spacing.paddingRight}px ${spacing.paddingBottom}px ${spacing.paddingLeft}px;`));
  },
};

// --- Icon + Text rows ------------------------------------------------------

const MAX_ICON_TEXT_ROWS = 8;

const iconTextRowsField: RepeatableFieldConfig<IconTextRow> = {
  path: 'items',
  group: 'content',
  label: 'Rows',
  itemLabel: (item, index) => item.title.trim() || `Row ${index + 1}`,
  createItem: () => ({ title: 'New row', text: '' }),
  maxItems: MAX_ICON_TEXT_ROWS,
  addLabel: 'Add row',
  renderItemFields: (item, update) => (
    <>
      <label className="properties-panel__field">
        <span>Title</span>
        <input type="text" value={item.title} onChange={(e) => update({ title: e.target.value })} />
      </label>
      <label className="properties-panel__field">
        <span>Text</span>
        <input type="text" value={item.text} onChange={(e) => update({ text: e.target.value })} />
      </label>
    </>
  ),
};

const iconTextRowsDefinition: ModuleDefinition<IconTextRowsModuleProps> = {
  type: 'content-icon-text-rows',
  label: 'Icon + Text Rows',
  category: 'content',
  icon: 'check-circle',
  description: 'A stack of short title/text rows, each marked with a check icon.',
  tags: ['icon', 'text rows', 'checklist'],
  keywords: ['icon', 'text', 'rows', 'checklist', 'content'],
  columnCount: null,
  imagePosition: null,
  platformCompatibility: GENERIC_ONLY,
  propertyEditor: 'schema',
  editableFields: [],
  repeatableField: iconTextRowsField,
  createDefaultProps: () => ({
    items: [
      { title: 'Step one', text: 'Create your account.' },
      { title: 'Step two', text: 'Set up your workspace.' },
      { title: 'Step three', text: 'Invite your team.' },
    ],
  }),
  createDefaultSettings: () => createResponsiveSettings(DEFAULT_SPACING),
  renderPreview: (module) => (
    <div>
      {module.props.items.map((item) => (
        <div key={item.title} style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <span className="mdaiw-icon mdaiw-icon--check-circle" aria-hidden="true" style={{ width: 16, height: 16, flexShrink: 0, marginTop: 2 }} />
          <div>
            <p style={{ margin: 0, fontWeight: 600, fontSize: 14 }}>{item.title}</p>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-subtle)' }}>{item.text}</p>
          </div>
        </div>
      ))}
    </div>
  ),
  renderEmailHtml: (module) => {
    const { settings } = module;
    const spacing = resolveSpacing(settings, 'desktop');
    const rows = module.props.items.map((item) => (
      '<tr>'
      + bulletDotCell('#0082AD')
      + `<td valign="top" style="padding-bottom:14px; padding-left:8px; font-family:Arial,Helvetica,sans-serif;">`
      + textLine(escapeHtml(item.title), 'font-size:14px; font-weight:bold; color:#333333;')
      + textLine(escapeHtml(item.text), 'font-size:13px; color:#66777D;')
      + '</td>'
      + '</tr>'
    )).join('');
    const html = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table>`;
    return moduleTableRow(cell(html, `padding:${spacing.paddingTop}px ${spacing.paddingRight}px ${spacing.paddingBottom}px ${spacing.paddingLeft}px;`));
  },
};

export const CONTENT_DEFINITIONS: AnyModuleDefinition[] = [
  ...CONTENT_VARIANTS.map(contentBlockDefinition),
  quoteDefinition,
  articleTeaserDefinition,
  featureListDefinition,
  iconTextRowsDefinition,
];

export const CONTENT_TYPES_ORDER: EmailModuleType[] = CONTENT_DEFINITIONS.map((d) => d.type);
