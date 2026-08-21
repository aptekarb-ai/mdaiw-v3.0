import type { EmailModuleType, ProductGridModuleProps, ProductItem } from '../edm';
import { DEFAULT_SPACING, resolveSpacing } from '../edm';
import { px } from '../dimensions';
import { escapeAttribute, escapeHtml, sanitizeUrl } from '../sanitize';
import { GENERIC_ONLY, ImagePreview, cell, createResponsiveSettings, moduleTable, textLine, type ModuleDefinition } from '../registryCore';

function defaultItem(index: number): ProductItem {
  return {
    imageSrc: '',
    imageAlt: `Product ${index + 1}`,
    name: `Product Name ${index + 1}`,
    price: '$00.00',
    ctaText: 'Shop Now',
    ctaHref: '',
  };
}

function chunk<T>(items: T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size));
  return rows;
}

function productCardHtml(item: ProductItem, widthPercent: number): string {
  return cell(
    `<img src="${escapeAttribute(sanitizeUrl(item.imageSrc))}" alt="${escapeAttribute(item.imageAlt)}" width="100%" style="display:block; width:100%; height:auto; border:0;" />`
    + textLine(escapeHtml(item.name), 'padding-top:12px; font-family:Arial,Helvetica,sans-serif; font-size:14px; font-weight:bold; color:#333333;', 4)
    + textLine(escapeHtml(item.price), 'font-family:Arial,Helvetica,sans-serif; font-size:14px; color:#0082AD; font-weight:bold;', 10)
    + `<a href="${escapeAttribute(sanitizeUrl(item.ctaHref))}" style="display:inline-block; padding:8px 16px; background-color:#0082AD; color:#FFFFFF; font-family:Arial,Helvetica,sans-serif; font-size:12px; font-weight:bold; text-decoration:none; border-radius:6px;">${escapeHtml(item.ctaText)}</a>`,
    `width:${widthPercent}%; vertical-align:top; padding:0 8px; text-align:center;`,
  );
}

function productRowHtml(item: ProductItem): string {
  const imgCell = cell(
    `<img src="${escapeAttribute(sanitizeUrl(item.imageSrc))}" alt="${escapeAttribute(item.imageAlt)}" width="160" style="display:block; width:160px; max-width:100%; height:auto; border:0;" />`,
    'width:40%; vertical-align:top;',
  );
  const infoCell = cell(
    textLine(escapeHtml(item.name), 'font-family:Arial,Helvetica,sans-serif; font-size:16px; font-weight:bold; color:#333333;', 6)
    + textLine(escapeHtml(item.price), 'font-family:Arial,Helvetica,sans-serif; font-size:16px; color:#0082AD; font-weight:bold;', 12)
    + `<a href="${escapeAttribute(sanitizeUrl(item.ctaHref))}" style="display:inline-block; padding:10px 18px; background-color:#0082AD; color:#FFFFFF; font-family:Arial,Helvetica,sans-serif; font-size:13px; font-weight:bold; text-decoration:none; border-radius:6px;">${escapeHtml(item.ctaText)}</a>`,
    'width:60%; vertical-align:top;',
  );
  return `<tr>${imgCell}${infoCell}</tr>`;
}

function productPreviewCard(item: ProductItem) {
  return (
    <div key={item.name} style={{ textAlign: 'center' }}>
      <ImagePreview src={item.imageSrc} alt={item.imageAlt} width={px(140)} align="center" />
      <p style={{ margin: '8px 0 2px', fontSize: 13, fontWeight: 600 }}>{item.name}</p>
      <p style={{ margin: '0 0 6px', fontSize: 13, color: 'var(--color-primary-blue)', fontWeight: 700 }}>{item.price}</p>
      <span style={{ display: 'inline-block', padding: '6px 12px', background: '#0082AD', color: '#FFFFFF', borderRadius: 6, fontSize: 11, fontWeight: 600 }}>
        {item.ctaText}
      </span>
    </div>
  );
}

interface ProductVariant {
  type: EmailModuleType;
  label: string;
  description: string;
  tags: string[];
  count: number;
  perRow: number;
  layout: 'card' | 'row';
}

const VARIANTS: ProductVariant[] = [
  { type: 'product-single', label: 'Single Product', description: 'One product card with image, name, price and CTA.', tags: ['product', 'single', 'card'], count: 1, perRow: 1, layout: 'card' },
  { type: 'product-two-cards', label: '2 Product Cards', description: 'Two product cards side by side.', tags: ['product', 'grid', 'cards', '2 column'], count: 2, perRow: 2, layout: 'card' },
  { type: 'product-three-cards', label: '3 Product Cards', description: 'Three product cards side by side.', tags: ['product', 'grid', 'cards', '3 column'], count: 3, perRow: 3, layout: 'card' },
  { type: 'product-image-price-cta', label: 'Product Image + Price + CTA', description: 'A single product in a horizontal image-left layout.', tags: ['product', 'image left', 'price', 'cta'], count: 1, perRow: 1, layout: 'row' },
  { type: 'product-grid', label: 'Product Grid', description: 'A 2x2 grid of four product cards.', tags: ['product', 'grid', '4 column'], count: 4, perRow: 2, layout: 'card' },
];

function productDefinition(variant: ProductVariant): ModuleDefinition<ProductGridModuleProps> {
  return {
    type: variant.type,
    label: variant.label,
    category: 'products',
    icon: 'briefcase',
    description: variant.description,
    tags: variant.tags,
    keywords: ['product', 'shop', 'ecommerce', 'price', ...variant.tags],
    columnCount: variant.layout === 'card' ? variant.perRow : 2,
    imagePosition: variant.layout === 'row' ? 'left' : 'top',
    platformCompatibility: GENERIC_ONLY,
    propertyEditor: 'basic',
    createDefaultProps: () => ({ items: Array.from({ length: variant.count }, (_, i) => defaultItem(i)) }),
    createDefaultSettings: () => createResponsiveSettings(DEFAULT_SPACING),
    renderPreview: (module) => {
      if (variant.layout === 'row') {
        const item = module.props.items[0];
        return (
          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
            <div style={{ flex: '0 0 35%' }}><ImagePreview src={item.imageSrc} alt={item.imageAlt} width={px(140)} align="center" /></div>
            <div style={{ flex: '1 1 65%' }}>
              <p style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 700 }}>{item.name}</p>
              <p style={{ margin: '0 0 10px', fontSize: 15, color: 'var(--color-primary-blue)', fontWeight: 700 }}>{item.price}</p>
              <span style={{ display: 'inline-block', padding: '8px 16px', background: '#0082AD', color: '#FFFFFF', borderRadius: 6, fontSize: 13, fontWeight: 600 }}>{item.ctaText}</span>
            </div>
          </div>
        );
      }
      const rows = chunk(module.props.items, variant.perRow);
      return (
        <div>
          {rows.map((row, rowIndex) => (
            // eslint-disable-next-line react/no-array-index-key -- rows are a stable chunking of the module's own items array, index is a fine key here
            <div key={rowIndex} style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
              {row.map((item) => <div key={item.name} style={{ flex: 1 }}>{productPreviewCard(item)}</div>)}
            </div>
          ))}
        </div>
      );
    },
    renderEmailHtml: (module) => {
      const { props, settings } = module;
      const spacing = resolveSpacing(settings, 'desktop');
      const containerStyle = `padding:${spacing.paddingTop}px ${spacing.paddingRight}px ${spacing.paddingBottom}px ${spacing.paddingLeft}px;`;

      if (variant.layout === 'row') {
        const row = productRowHtml(props.items[0]);
        return moduleTable(`<tr><td style="${containerStyle}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${row}</table></td></tr>`);
      }

      const widthPercent = Math.floor(100 / variant.perRow);
      const rowsHtml = chunk(props.items, variant.perRow)
        .map((row) => `<tr>${row.map((item) => productCardHtml(item, widthPercent)).join('')}</tr>`)
        .join('');
      return moduleTable(`<tr><td style="${containerStyle}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rowsHtml}</table></td></tr>`);
    },
  };
}

export const PRODUCT_DEFINITIONS: ModuleDefinition<ProductGridModuleProps>[] = VARIANTS.map(productDefinition);
export const PRODUCT_TYPES_ORDER: EmailModuleType[] = PRODUCT_DEFINITIONS.map((d) => d.type);
