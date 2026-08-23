import type { EmailModuleType, HeaderModuleProps, NavLink } from '../edm';
import { resolveSpacing } from '../edm';
import { px } from '../dimensions';
import { escapeAttribute, escapeHtml, sanitizeUrl } from '../sanitize';
import {
  GENERIC_ONLY, ImagePreview, createResponsiveSettings, type ModuleDefinition, type RepeatableFieldConfig,
  type SchemaField,
} from '../registryCore';

const MAX_NAV_LINKS = 6;

const navLinksField: RepeatableFieldConfig<NavLink> = {
  path: 'navLinks',
  group: 'content',
  label: 'Navigation links',
  itemLabel: (item, index) => item.label.trim() || `Link ${index + 1}`,
  createItem: () => ({ label: 'New Link', href: '' }),
  maxItems: MAX_NAV_LINKS,
  addLabel: 'Add nav link',
  renderItemFields: (item, update) => (
    <>
      <label className="properties-panel__field">
        <span>Label</span>
        <input type="text" value={item.label} onChange={(e) => update({ label: e.target.value })} />
      </label>
      <label className="properties-panel__field">
        <span>URL</span>
        <input type="text" value={item.href} placeholder="https://" onChange={(e) => update({ href: e.target.value })} />
      </label>
    </>
  ),
};

interface HeaderVariant {
  type: EmailModuleType;
  label: string;
  description: string;
  tags: string[];
  showPreheader: boolean;
  showNav: boolean;
  showCta: boolean;
  compact: boolean;
  align: 'left' | 'center';
}

const VARIANTS: HeaderVariant[] = [
  {
    type: 'header-logo-center', label: 'Logo Centered', description: 'Centered logo header row.',
    tags: ['header', 'logo', 'centered'], showPreheader: false, showNav: false, showCta: false, compact: false, align: 'center',
  },
  {
    type: 'header-logo-left', label: 'Logo Left', description: 'Left-aligned logo header row.',
    tags: ['header', 'logo', 'left'], showPreheader: false, showNav: false, showCta: false, compact: false, align: 'left',
  },
  {
    type: 'header-logo-nav', label: 'Logo + Navigation', description: 'Logo with a horizontal navigation link row.',
    tags: ['header', 'logo', 'navigation', 'nav', 'menu'], showPreheader: false, showNav: true, showCta: false, compact: false, align: 'left',
  },
  {
    type: 'header-logo-cta', label: 'Logo + CTA', description: 'Logo with a call-to-action button on the right.',
    tags: ['header', 'logo', 'cta', 'button'], showPreheader: false, showNav: false, showCta: true, compact: false, align: 'left',
  },
  {
    type: 'header-preheader-logo', label: 'Preheader + Logo', description: 'A small preheader text line above the logo.',
    tags: ['header', 'logo', 'preheader'], showPreheader: true, showNav: false, showCta: false, compact: false, align: 'center',
  },
  {
    type: 'header-compact', label: 'Compact Header', description: 'A minimal, low-height logo-only header.',
    tags: ['header', 'logo', 'compact', 'minimal'], showPreheader: false, showNav: false, showCta: false, compact: true, align: 'center',
  },
];

const DEFAULT_NAV_LINKS: NavLink[] = [
  { label: 'Shop', href: '' },
  { label: 'About', href: '' },
  { label: 'Contact', href: '' },
];

function editableFields(variant: HeaderVariant): SchemaField[] {
  const fields: SchemaField[] = [
    // Feature 14 V2 — explicitly image_asset (never inferred): the AI
    // may only set this via the asset-ownership-resolution flow or an
    // allow-listed external URL.
    { key: 'logoSrc', label: 'Logo image URL', kind: 'url', valueType: 'image_asset', group: 'content' },
    { key: 'logoAlt', label: 'Logo alt text', kind: 'text', group: 'content' },
    { key: 'logoHref', label: 'Logo link', kind: 'url', group: 'content' },
  ];
  if (variant.showPreheader) {
    fields.push({ key: 'preheaderText', label: 'Preheader text', kind: 'text', group: 'content' });
  }
  if (variant.showCta) {
    fields.push(
      { key: 'ctaText', label: 'Button text', kind: 'text', group: 'content' },
      { key: 'ctaHref', label: 'Button link', kind: 'url', group: 'content' },
    );
  }
  fields.push(
    { key: 'logoWidth', label: 'Logo width (px)', kind: 'number', group: 'style' },
    { key: 'backgroundColor', label: 'Background color', kind: 'color', group: 'style' },
    { key: 'align', label: 'Alignment', kind: 'align', group: 'style' },
  );
  return fields;
}

function headerDefinition(variant: HeaderVariant): ModuleDefinition<HeaderModuleProps> {
  return {
    type: variant.type,
    label: variant.label,
    category: 'header',
    icon: 'id-card',
    description: variant.description,
    tags: variant.tags,
    keywords: ['header', 'logo', 'top', ...variant.tags],
    columnCount: variant.showNav || variant.showCta ? 2 : 1,
    imagePosition: null,
    platformCompatibility: GENERIC_ONLY,
    propertyEditor: 'schema',
    editableFields: editableFields(variant),
    repeatableField: variant.showNav ? navLinksField : undefined,
    createDefaultProps: () => ({
      logoSrc: '',
      logoAlt: 'Company logo',
      logoWidth: 160,
      logoHref: '',
      preheaderText: 'View this email in your browser',
      navLinks: variant.showNav ? DEFAULT_NAV_LINKS : [],
      ctaText: 'Shop Now',
      ctaHref: '',
      backgroundColor: '#FFFFFF',
      align: variant.align,
    }),
    createDefaultSettings: () => createResponsiveSettings({
      paddingTop: variant.compact ? 12 : 24,
      paddingRight: 24,
      paddingBottom: variant.compact ? 12 : 24,
      paddingLeft: 24,
    }),
    renderPreview: (module) => {
      const { props } = module;
      return (
        <div style={{ background: props.backgroundColor }}>
          {variant.showPreheader && (
            <p style={{ margin: '0 0 8px', fontSize: 11, color: 'var(--color-text-subtle)', textAlign: 'center' }}>
              {props.preheaderText}
            </p>
          )}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: props.align === 'center' ? 'center' : 'space-between' }}>
            <ImagePreview src={props.logoSrc} alt={props.logoAlt} width={px(props.logoWidth)} align={props.align} />
            {variant.showNav && (
              <nav style={{ display: 'flex', gap: 16, fontSize: 13, color: 'var(--color-text-dark)' }}>
                {props.navLinks.map((link) => <span key={link.label}>{link.label}</span>)}
              </nav>
            )}
            {variant.showCta && (
              <span style={{
                display: 'inline-block', padding: '8px 16px', background: '#0082AD', color: '#FFFFFF',
                borderRadius: 6, fontSize: 13, fontWeight: 600,
              }}
              >
                {props.ctaText}
              </span>
            )}
          </div>
        </div>
      );
    },
    renderEmailHtml: (module) => {
      const { props, settings } = module;
      const spacing = resolveSpacing(settings, 'desktop');
      const containerStyle = `padding:${spacing.paddingTop}px ${spacing.paddingRight}px ${spacing.paddingBottom}px ${spacing.paddingLeft}px; background-color:${props.backgroundColor};`;
      const logoImg = `<img src="${escapeAttribute(sanitizeUrl(props.logoSrc))}" alt="${escapeAttribute(props.logoAlt)}" width="${props.logoWidth}" style="display:block; width:${props.logoWidth}px; max-width:100%; height:auto; border:0;" />`;
      const logo = props.logoHref
        ? `<a href="${escapeAttribute(sanitizeUrl(props.logoHref))}" target="_blank" rel="noopener noreferrer">${logoImg}</a>`
        : logoImg;

      const preheaderRow = variant.showPreheader
        ? `<tr><td align="center" style="font-family:Arial,Helvetica,sans-serif; font-size:11px; color:#66777D; padding-bottom:8px;">${escapeHtml(props.preheaderText)}</td></tr>`
        : '';

      let mainRow: string;
      if (variant.showNav) {
        const navCells = props.navLinks
          .map((link) => `<td style="padding-left:16px; font-family:Arial,Helvetica,sans-serif; font-size:13px;"><a href="${escapeAttribute(sanitizeUrl(link.href))}" style="color:#333333; text-decoration:none;">${escapeHtml(link.label)}</a></td>`)
          .join('');
        mainRow = `<tr><td align="left" valign="middle">${logo}</td><td align="right" valign="middle"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>${navCells}</tr></table></td></tr>`;
      } else if (variant.showCta) {
        const button = `<a href="${escapeAttribute(sanitizeUrl(props.ctaHref))}" style="display:inline-block; padding:10px 18px; background-color:#0082AD; color:#FFFFFF; font-family:Arial,Helvetica,sans-serif; font-size:13px; font-weight:bold; text-decoration:none; border-radius:6px;">${escapeHtml(props.ctaText)}</a>`;
        mainRow = `<tr><td align="left" valign="middle">${logo}</td><td align="right" valign="middle">${button}</td></tr>`;
      } else {
        mainRow = `<tr><td align="${props.align}">${logo}</td></tr>`;
      }

      return (
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="${containerStyle}">`
        + preheaderRow
        + (variant.showNav || variant.showCta
          ? `<tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${mainRow}</table></td></tr>`
          : mainRow)
        + '</table>'
      );
    },
  };
}

export const HEADER_DEFINITIONS: ModuleDefinition<HeaderModuleProps>[] = VARIANTS.map(headerDefinition);
export const HEADER_TYPES_ORDER: EmailModuleType[] = HEADER_DEFINITIONS.map((d) => d.type);
