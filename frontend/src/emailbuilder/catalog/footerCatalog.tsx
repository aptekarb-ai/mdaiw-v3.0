import type { EmailModuleType, FooterModuleProps, SocialPlatformLink } from '../edm';
import { resolveSpacing } from '../edm';
import { escapeAttribute, escapeHtml, sanitizeUrl } from '../sanitize';
import {
  GENERIC_ONLY, cell, createResponsiveSettings, moduleTableRow, textLine, type ModuleDefinition, type SchemaField,
} from '../registryCore';

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
    editableFields: editableFields(variant),
    createDefaultProps: () => ({
      companyName: 'MarketOne Digital, Inc.',
      address: '123 Market Street, Suite 400, San Francisco, CA 94105',
      legalText: '© 2026 MarketOne Digital. All rights reserved.',
      unsubscribeText: 'Unsubscribe',
      unsubscribeHref: '',
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
        </div>
      );
    },
    renderEmailHtml: (module) => {
      const { props, settings } = module;
      const spacing = resolveSpacing(settings, 'desktop');
      const socialLinksTable = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center"><tr>${props.socialPlatforms.map((p) => `<td style="padding:0 4px;"><a href="${escapeAttribute(sanitizeUrl(p.href))}" style="display:inline-block; padding:6px 12px; border:1px solid #B8C8CD; border-radius:999px; font-family:Arial,Helvetica,sans-serif; font-size:11px; color:#333333; text-decoration:none;">${escapeHtml(p.label)}</a></td>`).join('')}</tr></table>`;
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
      const html = (
        socialHtml
        + textLine(escapeHtml(props.companyName), 'font-family:Arial,Helvetica,sans-serif; font-size:12px; font-weight:bold; color:#333333;', 4)
        + addressHtml
        + textLine(escapeHtml(props.legalText), 'font-family:Arial,Helvetica,sans-serif; font-size:11px; color:#829096;', 6)
        + `<a href="${escapeAttribute(sanitizeUrl(props.unsubscribeHref))}" style="font-family:Arial,Helvetica,sans-serif; font-size:11px; ${unsubscribeStyle}">${escapeHtml(props.unsubscribeText)}</a>`
      );
      return moduleTableRow(cell(html, `padding:${spacing.paddingTop}px ${spacing.paddingRight}px ${spacing.paddingBottom}px ${spacing.paddingLeft}px; text-align:${props.align};`));
    },
  };
}

export const FOOTER_DEFINITIONS: ModuleDefinition<FooterModuleProps>[] = VARIANTS.map(footerDefinition);
export const FOOTER_TYPES_ORDER: EmailModuleType[] = FOOTER_DEFINITIONS.map((d) => d.type);
