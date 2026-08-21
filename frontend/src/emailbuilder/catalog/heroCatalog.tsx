import type { EmailModuleType, HeroModuleProps } from '../edm';
import { resolveSpacing } from '../edm';
import { px } from '../dimensions';
import { escapeAttribute, escapeHtml, sanitizeUrl } from '../sanitize';
import {
  GENERIC_ONLY, ImagePreview, cell, createResponsiveSettings, moduleTableRow, textLine, type ModuleDefinition,
  type ModuleImagePosition, type SchemaField,
} from '../registryCore';

type HeroLayout = 'image-top' | 'background' | 'text-only' | 'image-left' | 'image-right' | 'centered';

interface HeroVariant {
  type: EmailModuleType;
  label: string;
  description: string;
  tags: string[];
  layout: HeroLayout;
  imagePosition: ModuleImagePosition | null;
}

const VARIANTS: HeroVariant[] = [
  {
    type: 'hero-image-cta', label: 'Image + Headline + CTA', description: 'Full-width image with a headline and button beneath it.',
    tags: ['hero', 'image', 'headline', 'cta', 'banner'], layout: 'image-top', imagePosition: 'top',
  },
  {
    type: 'hero-background-image', label: 'Background Image Hero', description: 'Headline text over a full-width background image.',
    tags: ['hero', 'background', 'image', 'banner', 'promo'], layout: 'background', imagePosition: 'background',
  },
  {
    type: 'hero-text-only', label: 'Text-Only Hero', description: 'A bold headline and CTA with no image.',
    tags: ['hero', 'text', 'headline', 'banner'], layout: 'text-only', imagePosition: null,
  },
  {
    type: 'hero-image-left', label: 'Image Left Hero', description: 'Hero image on the left, headline and CTA on the right.',
    tags: ['hero', 'image left', 'headline', 'banner'], layout: 'image-left', imagePosition: 'left',
  },
  {
    type: 'hero-image-right', label: 'Image Right Hero', description: 'Headline and CTA on the left, hero image on the right.',
    tags: ['hero', 'image right', 'headline', 'banner'], layout: 'image-right', imagePosition: 'right',
  },
  {
    type: 'hero-centered-promo', label: 'Centered Promotional Hero', description: 'Centered headline, subtext and CTA — no image.',
    tags: ['hero', 'centered', 'promo', 'banner'], layout: 'centered', imagePosition: null,
  },
];

function editableFields(hasImage: boolean): SchemaField[] {
  const fields: SchemaField[] = [
    { key: 'headline', label: 'Headline', kind: 'text', group: 'content' },
    { key: 'subtext', label: 'Subtext', kind: 'textarea', group: 'content' },
    { key: 'ctaText', label: 'Button text', kind: 'text', group: 'content' },
    { key: 'ctaHref', label: 'Button link', kind: 'url', group: 'content' },
  ];
  if (hasImage) {
    fields.push(
      { key: 'imageSrc', label: 'Image URL', kind: 'url', group: 'content' },
      { key: 'imageAlt', label: 'Image alt text', kind: 'text', group: 'content' },
    );
  }
  fields.push(
    { key: 'backgroundColor', label: 'Background color', kind: 'color', group: 'style' },
    { key: 'textColor', label: 'Text color', kind: 'color', group: 'style' },
  );
  return fields;
}

function heroDefinition(variant: HeroVariant): ModuleDefinition<HeroModuleProps> {
  const hasImage = variant.layout !== 'text-only' && variant.layout !== 'centered';
  return {
    type: variant.type,
    label: variant.label,
    category: 'hero',
    icon: hasImage ? 'camera' : 'landing-page',
    description: variant.description,
    tags: variant.tags,
    keywords: ['hero', 'banner', 'promo', ...variant.tags],
    columnCount: variant.layout === 'image-left' || variant.layout === 'image-right' ? 2 : 1,
    imagePosition: variant.imagePosition,
    platformCompatibility: GENERIC_ONLY,
    propertyEditor: 'schema',
    editableFields: editableFields(hasImage),
    createDefaultProps: () => ({
      headline: 'Introducing something great',
      subtext: 'A short supporting line that explains the offer or announcement.',
      ctaText: 'Learn More',
      ctaHref: '',
      imageSrc: '',
      imageAlt: 'Hero image',
      backgroundColor: variant.layout === 'background' ? '#002D38' : '#FFFFFF',
      textColor: variant.layout === 'background' ? '#FFFFFF' : '#002D38',
      align: variant.layout === 'image-left' || variant.layout === 'image-right' ? 'left' : 'center',
    }),
    createDefaultSettings: () => createResponsiveSettings({ paddingTop: 32, paddingRight: 32, paddingBottom: 32, paddingLeft: 32 }),
    renderPreview: (module) => {
      const { props } = module;
      const headline = <h2 style={{ margin: '0 0 8px', fontSize: 26, color: props.textColor }}>{props.headline}</h2>;
      const subtext = <p style={{ margin: '0 0 16px', color: props.textColor, opacity: 0.85 }}>{props.subtext}</p>;
      const button = (
        <span style={{
          display: 'inline-block', padding: '12px 24px', background: '#76C043', color: '#002D38',
          borderRadius: 6, fontWeight: 700, fontSize: 14,
        }}
        >
          {props.ctaText}
        </span>
      );
      const image = <ImagePreview src={props.imageSrc} alt={props.imageAlt} width={px(480)} align="center" />;

      if (variant.layout === 'image-top') {
        return <div style={{ textAlign: 'center', background: props.backgroundColor }}>{image}{headline}{subtext}{button}</div>;
      }
      if (variant.layout === 'background') {
        return (
          <div style={{ background: props.backgroundColor, padding: 24, textAlign: 'center', borderRadius: 8 }}>
            {headline}{subtext}{button}
          </div>
        );
      }
      if (variant.layout === 'image-left' || variant.layout === 'image-right') {
        const textCol = <div style={{ flex: '1 1 60%' }}>{headline}{subtext}{button}</div>;
        const imageCol = <div style={{ flex: '0 0 40%' }}>{image}</div>;
        return (
          <div style={{ display: 'flex', gap: 16, alignItems: 'center', background: props.backgroundColor }}>
            {variant.layout === 'image-left' ? imageCol : textCol}
            {variant.layout === 'image-left' ? textCol : imageCol}
          </div>
        );
      }
      // text-only / centered
      return <div style={{ textAlign: 'center', background: props.backgroundColor }}>{headline}{subtext}{button}</div>;
    },
    renderEmailHtml: (module) => {
      const { props, settings } = module;
      const headlineHtml = textLine(escapeHtml(props.headline), `font-family:Arial,Helvetica,sans-serif; font-size:28px; color:${props.textColor};`, 8);
      const subtextHtml = textLine(escapeHtml(props.subtext), `font-family:Arial,Helvetica,sans-serif; font-size:15px; color:${props.textColor}; opacity:0.85;`, 20);
      const buttonHtml = (
        // align="center" (HTML attribute, not CSS margin) centers this
        // block-level table the Outlook-safe way.
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center">'
        + `<tr><td style="border-radius:6px; background-color:#76C043;"><a href="${escapeAttribute(sanitizeUrl(props.ctaHref))}" target="_blank" rel="noopener noreferrer" style="display:inline-block; padding:12px 24px; font-family:Arial,Helvetica,sans-serif; font-size:14px; font-weight:bold; color:#002D38; text-decoration:none; border-radius:6px;">${escapeHtml(props.ctaText)}</a></td></tr>`
        + '</table>'
      );
      const imgHtml = `<img src="${escapeAttribute(sanitizeUrl(props.imageSrc))}" alt="${escapeAttribute(props.imageAlt)}" width="480" style="display:block; width:100%; max-width:480px; height:auto; border:0;" />`;
      const spacing = resolveSpacing(settings, 'desktop');
      const containerStyle = `padding:${spacing.paddingTop}px ${spacing.paddingRight}px ${spacing.paddingBottom}px ${spacing.paddingLeft}px; background-color:${props.backgroundColor};`;

      if (variant.layout === 'image-left' || variant.layout === 'image-right') {
        const textCell = cell(`${headlineHtml}${subtextHtml}${buttonHtml}`, 'width:60%; vertical-align:middle;');
        const imageCell = cell(imgHtml, 'width:40%; vertical-align:middle;');
        const cells = variant.layout === 'image-left' ? `${imageCell}${textCell}` : `${textCell}${imageCell}`;
        return moduleTableRow(cell(
          `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="${containerStyle}"><tr>${cells}</tr></table>`,
        ));
      }

      if (variant.layout === 'background') {
        // Table-cell `background` attribute + inline background-image —
        // the email-safe "ghost table" technique, not a structural DIV.
        // No VML fallback for Outlook Classic — a documented MVP
        // limitation (see the master prompt's honesty requirements).
        const safeImageUrl = escapeAttribute(sanitizeUrl(props.imageSrc));
        const bgCellStyle = `${containerStyle} background-image:url('${safeImageUrl}'); background-size:cover; background-position:center; text-align:center;`;
        const bgTable = (
          `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">`
          + `<tr><td align="center" background="${safeImageUrl}" style="${bgCellStyle}">`
          + `${headlineHtml}${subtextHtml}${buttonHtml}`
          + '</td></tr></table>'
        );
        return moduleTableRow(cell(bgTable));
      }

      const bodyHtml = variant.layout === 'image-top'
        ? (
          '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">'
          + `<tr><td align="center" style="padding-bottom:20px;">${imgHtml}</td></tr>`
          + `<tr><td>${headlineHtml}${subtextHtml}${buttonHtml}</td></tr>`
          + '</table>'
        )
        : `${headlineHtml}${subtextHtml}${buttonHtml}`;
      return moduleTableRow(cell(bodyHtml, `${containerStyle} text-align:center;`));
    },
  };
}

export const HERO_DEFINITIONS: ModuleDefinition<HeroModuleProps>[] = VARIANTS.map(heroDefinition);
export const HERO_TYPES_ORDER: EmailModuleType[] = HERO_DEFINITIONS.map((d) => d.type);
