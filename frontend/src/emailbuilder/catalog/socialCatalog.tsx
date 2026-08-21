import type { EmailModuleType, SocialModuleProps, SocialPlatformLink } from '../edm';
import { DEFAULT_SPACING, resolveSpacing } from '../edm';
import { escapeAttribute, escapeHtml, sanitizeUrl } from '../sanitize';
import { GENERIC_ONLY, cell, createResponsiveSettings, moduleTableRow, textLine, type ModuleDefinition } from '../registryCore';

// No brand social-network SVGs are supplied to this project (see
// MDAIW_Module1_HTML_Assets — no Facebook/Instagram/LinkedIn/X marks), so
// these render as plain text-link pills rather than fabricated brand
// icons. Real icon assets can replace this rendering later without
// touching the EDM shape.
const DEFAULT_PLATFORMS: SocialPlatformLink[] = [
  { label: 'Facebook', href: '' },
  { label: 'Instagram', href: '' },
  { label: 'LinkedIn', href: '' },
  { label: 'X', href: '' },
];

interface SocialVariant {
  type: EmailModuleType;
  label: string;
  description: string;
  tags: string[];
  showHeading: boolean;
}

const VARIANTS: SocialVariant[] = [
  { type: 'social-icon-row', label: 'Social Icon Row', description: 'A row of social platform links.', tags: ['social', 'icons', 'follow'], showHeading: false },
  { type: 'social-follow-us', label: 'Follow Us Block', description: 'A "Follow us" heading with a row of social platform links.', tags: ['social', 'follow us', 'heading'], showHeading: true },
];

function socialDefinition(variant: SocialVariant): ModuleDefinition<SocialModuleProps> {
  return {
    type: variant.type,
    label: variant.label,
    category: 'social',
    icon: 'audio-wave',
    description: variant.description,
    tags: variant.tags,
    keywords: ['social', 'follow', 'facebook', 'instagram', 'linkedin', ...variant.tags],
    columnCount: null,
    imagePosition: null,
    platformCompatibility: GENERIC_ONLY,
    propertyEditor: 'schema',
    editableFields: variant.showHeading ? [{ key: 'headingText', label: 'Heading', kind: 'text', group: 'content' }] : [],
    createDefaultProps: () => ({
      headingText: 'Follow us',
      platforms: DEFAULT_PLATFORMS,
      align: 'center',
    }),
    createDefaultSettings: () => createResponsiveSettings(DEFAULT_SPACING),
    renderPreview: (module) => (
      <div style={{ textAlign: module.props.align }}>
        {variant.showHeading && <p style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 600 }}>{module.props.headingText}</p>}
        <div style={{ display: 'inline-flex', gap: 8 }}>
          {module.props.platforms.map((platform) => (
            <span
              key={platform.label}
              style={{
                display: 'inline-block', padding: '6px 12px', borderRadius: 'var(--radius-pill)',
                border: '1px solid var(--color-border-strong)', fontSize: 12, fontWeight: 600,
              }}
            >
              {platform.label}
            </span>
          ))}
        </div>
      </div>
    ),
    renderEmailHtml: (module) => {
      const { props, settings } = module;
      const spacing = resolveSpacing(settings, 'desktop');
      const headingHtml = variant.showHeading
        ? textLine(escapeHtml(props.headingText), 'font-family:Arial,Helvetica,sans-serif; font-size:14px; font-weight:bold; color:#333333;', 12)
        : '';
      const cellsHtml = props.platforms
        .map((platform) => (
          '<td style="padding:0 4px;">'
          + `<a href="${escapeAttribute(sanitizeUrl(platform.href))}" style="display:inline-block; padding:6px 14px; border:1px solid #B8C8CD; border-radius:999px; font-family:Arial,Helvetica,sans-serif; font-size:12px; font-weight:bold; color:#333333; text-decoration:none;">${escapeHtml(platform.label)}</a>`
          + '</td>'
        ))
        .join('');
      // align="center" (HTML attribute, not CSS margin) centers this
      // block-level table.
      const row = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center"><tr>${cellsHtml}</tr></table>`;
      return moduleTableRow(cell(`${headingHtml}${row}`, `padding:${spacing.paddingTop}px ${spacing.paddingRight}px ${spacing.paddingBottom}px ${spacing.paddingLeft}px; text-align:${props.align};`));
    },
  };
}

export const SOCIAL_DEFINITIONS: ModuleDefinition<SocialModuleProps>[] = VARIANTS.map(socialDefinition);
export const SOCIAL_TYPES_ORDER: EmailModuleType[] = SOCIAL_DEFINITIONS.map((d) => d.type);
