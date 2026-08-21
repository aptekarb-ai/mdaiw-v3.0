import type { CtaModuleProps, EmailModuleType } from '../edm';
import { resolveSpacing } from '../edm';
import { escapeAttribute, escapeHtml, sanitizeUrl } from '../sanitize';
import {
  GENERIC_ONLY, cell, createResponsiveSettings, moduleTableRow, textLine, type ModuleDefinition, type SchemaField,
} from '../registryCore';

type CtaLayout = 'centered' | 'banner' | 'text-cta' | 'dual';

interface CtaVariant {
  type: EmailModuleType;
  label: string;
  description: string;
  tags: string[];
  layout: CtaLayout;
}

const VARIANTS: CtaVariant[] = [
  { type: 'cta-centered', label: 'Centered CTA', description: 'A single centered call-to-action button with a short heading.', tags: ['cta', 'button', 'centered'], layout: 'centered' },
  { type: 'cta-banner', label: 'CTA Banner', description: 'A full-width colored banner with a heading and button.', tags: ['cta', 'banner', 'button'], layout: 'banner' },
  { type: 'cta-text-cta', label: 'Text + CTA', description: 'A line of text with a button aligned to the right.', tags: ['cta', 'text', 'button'], layout: 'text-cta' },
  { type: 'cta-dual', label: 'Dual CTA', description: 'Two buttons side by side — a primary and a secondary action.', tags: ['cta', 'dual', 'two buttons'], layout: 'dual' },
];

function editableFields(layout: CtaLayout): SchemaField[] {
  const fields: SchemaField[] = [
    { key: 'heading', label: 'Heading', kind: 'text', group: 'content' },
    { key: 'text', label: 'Text', kind: 'textarea', group: 'content' },
    { key: 'ctaText', label: 'Button text', kind: 'text', group: 'content' },
    { key: 'ctaHref', label: 'Button link', kind: 'url', group: 'content' },
  ];
  if (layout === 'dual') {
    fields.push(
      { key: 'secondaryCtaText', label: 'Secondary button text', kind: 'text', group: 'content' },
      { key: 'secondaryCtaHref', label: 'Secondary button link', kind: 'url', group: 'content' },
    );
  }
  fields.push(
    { key: 'backgroundColor', label: 'Background color', kind: 'color', group: 'style' },
    { key: 'textColor', label: 'Text color', kind: 'color', group: 'style' },
  );
  return fields;
}

function buttonPreview(text: string, primary = true) {
  return (
    <span style={{
      display: 'inline-block', padding: '10px 20px', margin: '0 4px',
      background: primary ? '#76C043' : 'transparent',
      border: primary ? 'none' : '1px solid #0082AD',
      color: primary ? '#002D38' : '#0082AD',
      borderRadius: 6, fontWeight: 700, fontSize: 13,
    }}
    >
      {text}
    </span>
  );
}

function buttonHtml(text: string, href: string, primary = true): string {
  const style = primary
    ? 'background-color:#76C043; color:#002D38;'
    : 'background-color:transparent; color:#0082AD; border:1px solid #0082AD;';
  // display:inline-block (not margin) lets the parent cell's
  // text-align:center/right center or align this table — no CSS margin
  // needed. Horizontal gap between two of these (the "dual" layout) is
  // added by the caller via a padded wrapping <span>, never margin here.
  return (
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="display:inline-block;">'
    + `<tr><td style="border-radius:6px; ${style}"><a href="${escapeAttribute(sanitizeUrl(href))}" target="_blank" rel="noopener noreferrer" style="display:inline-block; padding:10px 20px; font-family:Arial,Helvetica,sans-serif; font-size:13px; font-weight:bold; text-decoration:none; border-radius:6px; color:inherit;">${escapeHtml(text)}</a></td></tr>`
    + '</table>'
  );
}

// Horizontal gap between adjacent inline-block elements via padding on a
// wrapping <span> (spans carry no default margin) — never CSS margin.
function withHorizontalGap(html: string, gapPx: number): string {
  return `<span style="display:inline-block; padding:0 ${gapPx}px;">${html}</span>`;
}

function ctaDefinition(variant: CtaVariant): ModuleDefinition<CtaModuleProps> {
  return {
    type: variant.type,
    label: variant.label,
    category: 'cta',
    icon: 'send',
    description: variant.description,
    tags: variant.tags,
    keywords: ['cta', 'call to action', 'button', ...variant.tags],
    columnCount: variant.layout === 'text-cta' || variant.layout === 'dual' ? 2 : null,
    imagePosition: null,
    platformCompatibility: GENERIC_ONLY,
    propertyEditor: 'schema',
    editableFields: editableFields(variant.layout),
    createDefaultProps: () => ({
      heading: 'Ready to get started?',
      text: 'Join thousands of teams already using our platform.',
      ctaText: 'Get Started',
      ctaHref: '',
      secondaryCtaText: 'Learn More',
      secondaryCtaHref: '',
      backgroundColor: variant.layout === 'banner' ? '#002D38' : '#FFFFFF',
      textColor: variant.layout === 'banner' ? '#FFFFFF' : '#002D38',
      align: 'center',
    }),
    createDefaultSettings: () => createResponsiveSettings({ paddingTop: 24, paddingRight: 24, paddingBottom: 24, paddingLeft: 24 }),
    renderPreview: (module) => {
      const { props } = module;
      if (variant.layout === 'text-cta') {
        return (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: props.backgroundColor, color: props.textColor }}>
            <p style={{ margin: 0 }}>{props.text}</p>
            {buttonPreview(props.ctaText)}
          </div>
        );
      }
      return (
        <div style={{ textAlign: 'center', background: props.backgroundColor, color: props.textColor, padding: variant.layout === 'banner' ? 16 : 0, borderRadius: variant.layout === 'banner' ? 8 : 0 }}>
          {variant.layout !== 'centered' || props.heading ? <h3 style={{ margin: '0 0 6px', fontSize: 18 }}>{props.heading}</h3> : null}
          {props.text && <p style={{ margin: '0 0 12px' }}>{props.text}</p>}
          {buttonPreview(props.ctaText)}
          {variant.layout === 'dual' && buttonPreview(props.secondaryCtaText, false)}
        </div>
      );
    },
    renderEmailHtml: (module) => {
      const { props, settings } = module;
      const spacing = resolveSpacing(settings, 'desktop');
      const containerStyle = `padding:${spacing.paddingTop}px ${spacing.paddingRight}px ${spacing.paddingBottom}px ${spacing.paddingLeft}px; background-color:${props.backgroundColor};`;
      const headingHtml = props.heading
        ? textLine(escapeHtml(props.heading), `font-family:Arial,Helvetica,sans-serif; font-size:20px; color:${props.textColor};`, 8)
        : '';
      const textHtml = props.text
        ? textLine(escapeHtml(props.text), `font-family:Arial,Helvetica,sans-serif; font-size:14px; color:${props.textColor};`, 16)
        : '';

      if (variant.layout === 'text-cta') {
        const fallbackText = textLine(escapeHtml(props.text), `font-family:Arial,Helvetica,sans-serif; font-size:14px; color:${props.textColor};`);
        const textCell = cell(`${headingHtml}${textHtml || fallbackText}`, 'width:65%; vertical-align:middle;');
        const buttonCell = cell(buttonHtml(props.ctaText, props.ctaHref), 'width:35%; vertical-align:middle; text-align:right;');
        return moduleTableRow(cell(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="${containerStyle}"><tr>${textCell}${buttonCell}</tr></table>`));
      }

      const buttons = variant.layout === 'dual'
        ? `${withHorizontalGap(buttonHtml(props.ctaText, props.ctaHref), 4)}${withHorizontalGap(buttonHtml(props.secondaryCtaText, props.secondaryCtaHref, false), 4)}`
        : buttonHtml(props.ctaText, props.ctaHref);
      return moduleTableRow(cell(`${headingHtml}${textHtml}${buttons}`, `${containerStyle} text-align:center;`));
    },
  };
}

export const CTA_DEFINITIONS: ModuleDefinition<CtaModuleProps>[] = VARIANTS.map(ctaDefinition);
export const CTA_TYPES_ORDER: EmailModuleType[] = CTA_DEFINITIONS.map((d) => d.type);
