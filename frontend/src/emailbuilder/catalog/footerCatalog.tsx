import type { EmailModuleType, FooterModuleProps, SocialPlatformLink } from '../edm';
import { resolveSpacing } from '../edm';
import { escapeAttribute, escapeHtml, sanitizeUrl } from '../sanitize';
import {
  GENERIC_ONLY, cell, createResponsiveSettings, moduleTableRow, textLine, type ModuleDefinition,
  type RepeatableFieldConfig, type SchemaField,
} from '../registryCore';
import { renderVmlButton } from '../vml';
import { SOCIAL_PLATFORM_PRESETS } from './socialCatalog';

const MAX_FOOTER_SOCIAL_LINKS = 6;

const footerSocialField: RepeatableFieldConfig<SocialPlatformLink> = {
  path: 'socialPlatforms',
  group: 'content',
  label: 'Social links',
  itemLabel: (item, index) => item.label.trim() || `Link ${index + 1}`,
  createItem: () => ({ label: 'Facebook', href: '' }),
  maxItems: MAX_FOOTER_SOCIAL_LINKS,
  addLabel: 'Add social link',
  itemSchema: [
    { key: 'label', label: 'Platform', kind: 'text', valueType: 'text', group: 'content' },
    { key: 'href', label: 'URL', kind: 'url', valueType: 'url', group: 'content' },
  ],
  renderItemFields: (item, update) => (
    <>
      <label className="properties-panel__field">
        <span>Platform</span>
        <select value={SOCIAL_PLATFORM_PRESETS.includes(item.label) ? item.label : 'Other'} onChange={(e) => update({ label: e.target.value === 'Other' ? '' : e.target.value })}>
          {SOCIAL_PLATFORM_PRESETS.map((preset) => <option key={preset} value={preset}>{preset}</option>)}
          <option value="Other">Other</option>
        </select>
        {!SOCIAL_PLATFORM_PRESETS.includes(item.label) && (
          <input type="text" value={item.label} placeholder="Platform name" onChange={(e) => update({ label: e.target.value })} />
        )}
      </label>
      <label className="properties-panel__field">
        <span>URL</span>
        <input type="text" value={item.href} placeholder="https://" onChange={(e) => update({ href: e.target.value })} />
      </label>
    </>
  ),
};

const DEFAULT_SOCIAL: SocialPlatformLink[] = [
  { label: 'Facebook', href: '' },
  { label: 'Instagram', href: '' },
  { label: 'LinkedIn', href: '' },
];

interface FooterVariant {
  type: EmailModuleType;
  label: string;
  description: string;
  tags: string[];
  showAddress: boolean;
  showSocial: boolean;
  emphasizeUnsubscribe: boolean;
}

const VARIANTS: FooterVariant[] = [
  { type: 'footer-simple-legal', label: 'Simple Legal Footer', description: 'Company name and a short legal/copyright line.', tags: ['footer', 'legal', 'copyright'], showAddress: false, showSocial: false, emphasizeUnsubscribe: false },
  { type: 'footer-social-legal', label: 'Social + Legal Footer', description: 'Social links above a legal/copyright line.', tags: ['footer', 'social', 'legal'], showAddress: false, showSocial: true, emphasizeUnsubscribe: false },
  { type: 'footer-address-contact', label: 'Address / Contact Footer', description: 'Company name, mailing address and legal line.', tags: ['footer', 'address', 'contact'], showAddress: true, showSocial: false, emphasizeUnsubscribe: false },
  { type: 'footer-preference-unsubscribe', label: 'Preference / Unsubscribe Footer', description: 'Legal line with a prominent unsubscribe/preferences link.', tags: ['footer', 'unsubscribe', 'preferences', 'compliance'], showAddress: false, showSocial: false, emphasizeUnsubscribe: true },
];

function editableFields(variant: FooterVariant): SchemaField[] {
  const fields: SchemaField[] = [
    { key: 'companyName', label: 'Company name', kind: 'text', group: 'content' },
    { key: 'legalText', label: 'Legal / copyright text', kind: 'textarea', group: 'content' },
  ];
  if (variant.showAddress) {
    fields.push({ key: 'address', label: 'Mailing address', kind: 'textarea', group: 'content' });
  }
  fields.push(
    { key: 'unsubscribeText', label: 'Unsubscribe link text', kind: 'text', group: 'content' },
    { key: 'unsubscribeHref', label: 'Unsubscribe link URL', kind: 'url', group: 'content' },
    { key: 'preferenceText', label: 'Preference center link text', kind: 'text', group: 'content' },
    { key: 'preferenceHref', label: 'Preference center link URL', kind: 'url', group: 'content' },
    { key: 'align', label: 'Alignment', kind: 'align', group: 'style' },
  );
  return fields;
}

function footerDefinition(variant: FooterVariant): ModuleDefinition<FooterModuleProps> {
  return {
    type: variant.type,
    label: variant.label,
    category: 'footer',
    icon: 'shield-check',
    description: variant.description,
    tags: variant.tags,
    keywords: ['footer', 'legal', 'unsubscribe', 'compliance', ...variant.tags],
    columnCount: null,
    imagePosition: null,
    platformCompatibility: GENERIC_ONLY,
    propertyEditor: 'schema',
    // Sub-phase 6 final reconciliation — showSocial variants (only
    // footer-social-legal today) render the same bordered/rounded "pill"
    // links as socialCatalog.tsx, which DOES need the VML outline
    // fallback (see socialLinksTable below; "no background fill" does not
    // exempt a rounded-bordered control from Classic Outlook's
    // border-radius limitation). unsubscribe/preference links remain
    // plain underlined text (`text-decoration:underline`), never wrapped.
    ...(variant.showSocial ? { supportsBulletproofCta: true } : {}),
    editableFields: editableFields(variant),
    repeatableField: variant.showSocial ? footerSocialField : undefined,
    createDefaultProps: () => ({
      companyName: 'MarketOne Digital, Inc.',
      address: '123 Market Street, Suite 400, San Francisco, CA 94105',
      legalText: '© 2026 MarketOne Digital. All rights reserved.',
      unsubscribeText: 'Unsubscribe',
      unsubscribeHref: '',
      preferenceText: '',
      preferenceHref: '',
      socialPlatforms: variant.showSocial ? DEFAULT_SOCIAL : [],
      align: 'center',
    }),
    createDefaultSettings: () => createResponsiveSettings({ paddingTop: 24, paddingRight: 24, paddingBottom: 24, paddingLeft: 24 }),
    renderPreview: (module) => {
      const { props } = module;
      return (
        <div style={{ textAlign: props.align, fontSize: 12, color: 'var(--color-text-subtle)' }}>
          {variant.showSocial && (
            <div style={{ display: 'inline-flex', gap: 8, marginBottom: 10 }}>
              {props.socialPlatforms.map((platform) => (
                <span key={platform.label} style={{ padding: '4px 10px', borderRadius: 'var(--radius-pill)', border: '1px solid var(--color-border-strong)' }}>
                  {platform.label}
                </span>
              ))}
            </div>
          )}
          <p style={{ margin: '0 0 4px', fontWeight: 600 }}>{props.companyName}</p>
          {variant.showAddress && <p style={{ margin: '0 0 4px' }}>{props.address}</p>}
          <p style={{ margin: '0 0 4px' }}>{props.legalText}</p>
          <p style={{ margin: 0, fontWeight: variant.emphasizeUnsubscribe ? 700 : 400, textDecoration: 'underline' }}>{props.unsubscribeText}</p>
          {props.preferenceText && (
            <p style={{ margin: '4px 0 0', textDecoration: 'underline' }}>{props.preferenceText}</p>
          )}
        </div>
      );
    },
    renderEmailHtml: (module) => {
      const { props, settings } = module;
      const spacing = resolveSpacing(settings, 'desktop');
      const socialCellsHtml = props.socialPlatforms.map((p) => {
        const plainPill = `<a href="${escapeAttribute(sanitizeUrl(p.href))}" style="display:inline-block; padding:6px 12px; border:1px solid #B8C8CD; border-radius:999px; font-family:Arial,Helvetica,sans-serif; font-size:11px; color:#333333; text-decoration:none;">${escapeHtml(p.label)}</a>`;
        // Sub-phase 6 final reconciliation — same shared outline/pill VML
        // pairing as socialCatalog.tsx.
        const pillHtml = settings.outlookVml
          ? renderVmlButton({
            href: p.href,
            text: p.label,
            backgroundColor: '',
            textColor: '#333333',
            fontSize: 11,
            borderRadius: 999,
            paddingHorizontal: 12,
            paddingVertical: 6,
            borderColor: '#B8C8CD',
            borderWidth: 1,
          }, plainPill)
          : plainPill;
        return `<td style="padding:0 4px;">${pillHtml}</td>`;
      }).join('');
      const socialLinksTable = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center"><tr>${socialCellsHtml}</tr></table>`;
      // align="center" on the inner table (HTML attribute, not CSS
      // margin) centers it; the outer single-cell table's padding-bottom
      // supplies the 12px gap before the content below, in place of the
      // trailing margin this used to carry.
      const socialHtml = variant.showSocial
        ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="padding-bottom:12px;">${socialLinksTable}</td></tr></table>`
        : '';
      const addressHtml = variant.showAddress
        ? textLine(escapeHtml(props.address), 'font-family:Arial,Helvetica,sans-serif; font-size:12px; color:#66777D;', 6)
        : '';
      const unsubscribeStyle = variant.emphasizeUnsubscribe
        ? 'font-weight:bold; text-decoration:underline; color:#0082AD;'
        : 'text-decoration:underline; color:#66777D;';
      const preferenceHtml = props.preferenceText
        ? textLine(
          `<a href="${escapeAttribute(sanitizeUrl(props.preferenceHref))}" style="text-decoration:underline; color:#66777D;">${escapeHtml(props.preferenceText)}</a>`,
          'padding-top:4px; font-family:Arial,Helvetica,sans-serif; font-size:11px;',
        )
        : '';
      const html = (
        socialHtml
        + textLine(escapeHtml(props.companyName), 'font-family:Arial,Helvetica,sans-serif; font-size:12px; font-weight:bold; color:#333333;', 4)
        + addressHtml
        + textLine(escapeHtml(props.legalText), 'font-family:Arial,Helvetica,sans-serif; font-size:11px; color:#829096;', 6)
        + `<a href="${escapeAttribute(sanitizeUrl(props.unsubscribeHref))}" style="font-family:Arial,Helvetica,sans-serif; font-size:11px; ${unsubscribeStyle}">${escapeHtml(props.unsubscribeText)}</a>`
        + preferenceHtml
      );
      return moduleTableRow(cell(html, `padding:${spacing.paddingTop}px ${spacing.paddingRight}px ${spacing.paddingBottom}px ${spacing.paddingLeft}px; text-align:${props.align};`));
    },
  };
}

export const FOOTER_DEFINITIONS: ModuleDefinition<FooterModuleProps>[] = VARIANTS.map(footerDefinition);
export const FOOTER_TYPES_ORDER: EmailModuleType[] = FOOTER_DEFINITIONS.map((d) => d.type);
