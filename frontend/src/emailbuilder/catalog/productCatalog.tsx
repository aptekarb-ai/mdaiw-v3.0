import type { EmailModuleType, ProductGridModuleProps, ProductItem } from '../edm';
import { DEFAULT_SPACING, resolveSpacing } from '../edm';
import { px } from '../dimensions';
import { escapeAttribute, escapeHtml, sanitizeUrl } from '../sanitize';
import {
  GENERIC_ONLY, ImagePreview, cell, createResponsiveSettings, moduleTable, textLine, type ModuleDefinition,
  type RepeatableFieldConfig,
} from '../registryCore';

const DEFAULT_CTA_BG = '#0082AD';
const DEFAULT_CTA_TEXT = '#FFFFFF';

function productItemsField(count: number): RepeatableFieldConfig<ProductItem> {
  return {
    path: 'items',
    group: 'content',
    label: 'Products',
    itemLabel: (item, index) => item.name.trim() || `Product ${index + 1}`,
    createItem: () => defaultItem(count),
    minItems: count,
    maxItems: count,
    renderItemFields: (item, update) => (
      <>
        <label className="properties-panel__field">
          <span>Image URL</span>
          <input type="text" value={item.imageSrc} onChange={(e) => update({ imageSrc: e.target.value })} />
        </label>
        <label className="properties-panel__field">
          <span>Alt text</span>
          <input type="text" value={item.imageAlt} onChange={(e) => update({ imageAlt: e.target.value })} />
        </label>
        <label className="properties-panel__field">
          <span>Product name</span>
          <input type="text" value={item.name} onChange={(e) => update({ name: e.target.value })} />
        </label>
        <label className="properties-panel__field">
          <span>Price</span>
          <input type="text" value={item.price} onChange={(e) => update({ price: e.target.value })} />
        </label>
        <label className="properties-panel__field">
          <span>Description (optional)</span>
          <textarea rows={2} value={item.description ?? ''} onChange={(e) => update({ description: e.target.value })} />
        </label>
        <label className="properties-panel__field">
          <span>Button text</span>
          <input type="text" value={item.ctaText} onChange={(e) => update({ ctaText: e.target.value })} />
        </label>
        <label className="properties-panel__field">
          <span>Button link</span>
          <input type="text" value={item.ctaHref} placeholder="https://" onChange={(e) => update({ ctaHref: e.target.value })} />
        </label>
      </>
    ),
  };
}

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

function productCardHtml(item: ProductItem, widthPercent: number, textAlign: string, ctaBg: string, ctaText: string): string {
  const descriptionHtml = item.description
    ? textLine(escapeHtml(item.description), 'font-family:Arial,Helvetica,sans-serif; font-size:12px; color:#66777D;', 8)
    : '';
  return cell(
    `<img src="${escapeAttribute(sanitizeUrl(item.imageSrc))}" alt="${escapeAttribute(item.imageAlt)}" width="100%" style="display:block; width:100%; height:auto; border:0;" />`
    + textLine(escapeHtml(item.name), 'padding-top:12px; font-family:Arial,Helvetica,sans-serif; font-size:14px; font-weight:bold; color:#333333;', 4)
    + textLine(escapeHtml(item.price), 'font-family:Arial,Helvetica,sans-serif; font-size:14px; color:#0082AD; font-weight:bold;', 10)
    + descriptionHtml
    + `<a href="${escapeAttribute(sanitizeUrl(item.ctaHref))}" style="display:inline-block; padding:8px 16px; background-color:${ctaBg}; color:${ctaText}; font-family:Arial,Helvetica,sans-serif; font-size:12px; font-weight:bold; text-decoration:none; border-radius:6px;">${escapeHtml(item.ctaText)}</a>`,
    `width:${widthPercent}%; vertical-align:top; padding:0 8px; text-align:${textAlign};`,
  );
}

function productRowHtml(item: ProductItem, textAlign: string, ctaBg: string, ctaText: string): string {
  const imgCell = cell(
    `<img src="${escapeAttribute(sanitizeUrl(item.imageSrc))}" alt="${escapeAttribute(item.imageAlt)}" width="160" style="display:block; width:160px; max-width:100%; height:auto; border:0;" />`,
    'width:40%; vertical-align:top;',
  );
  const descriptionHtml = item.description
    ? textLine(escapeHtml(item.description), 'font-family:Arial,Helvetica,sans-serif; font-size:13px; color:#66777D;', 10)
    : '';
  const infoCell = cell(
    textLine(escapeHtml(item.name), `text-align:${textAlign}; font-family:Arial,Helvetica,sans-serif; font-size:16px; font-weight:bold; color:#333333;`, 6)
    + textLine(escapeHtml(item.price), `text-align:${textAlign}; font-family:Arial,Helvetica,sans-serif; font-size:16px; color:#0082AD; font-weight:bold;`, 12)
    + descriptionHtml
    + `<a href="${escapeAttribute(sanitizeUrl(item.ctaHref))}" style="display:inline-block; padding:10px 18px; background-color:${ctaBg}; color:${ctaText}; font-family:Arial,Helvetica,sans-serif; font-size:13px; font-weight:bold; text-decoration:none; border-radius:6px;">${escapeHtml(item.ctaText)}</a>`,
    `width:60%; vertical-align:top; text-align:${textAlign};`,
  );
  return `<tr>${imgCell}${infoCell}</tr>`;
}

function productPreviewCard(item: ProductItem, ctaBg: string, ctaText: string) {
  return (
    <div key={item.name} style={{ textAlign: 'center' }}>
      <ImagePreview src={item.imageSrc} alt={item.imageAlt} width={px(140)} align="center" />
      <p style={{ margin: '8px 0 2px', fontSize: 13, fontWeight: 600 }}>{item.name}</p>
      <p style={{ margin: '0 0 6px', fontSize: 13, color: 'var(--color-primary-blue)', fontWeight: 700 }}>{item.price}</p>
      {item.description && <p style={{ margin: '0 0 6px', fontSize: 11, color: 'var(--color-text-subtle)' }}>{item.description}</p>}
      <span style={{ display: 'inline-block', padding: '6px 12px', background: ctaBg, color: ctaText, borderRadius: 6, fontSize: 11, fontWeight: 600 }}>
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
    propertyEditor: 'schema',
    editableFields: [
      { key: 'textAlign', label: 'Text alignment', kind: 'align', group: 'style' },
      { key: 'ctaBackgroundColor', label: 'Button background color', kind: 'color', group: 'style' },
      { key: 'ctaTextColor', label: 'Button text color', kind: 'color', group: 'style' },
    ],
    repeatableField: productItemsField(variant.count),
    createDefaultProps: () => ({
      items: Array.from({ length: variant.count }, (_, i) => defaultItem(i)),
      textAlign: 'left',
      ctaBackgroundColor: DEFAULT_CTA_BG,
      ctaTextColor: DEFAULT_CTA_TEXT,
    }),
    createDefaultSettings: () => createResponsiveSettings(DEFAULT_SPACING),
    renderPreview: (module) => {
      const ctaBg = module.props.ctaBackgroundColor || DEFAULT_CTA_BG;
      const ctaText = module.props.ctaTextColor || DEFAULT_CTA_TEXT;
      const textAlign = module.props.textAlign ?? 'left';
      if (variant.layout === 'row') {
        const item = module.props.items[0];
        return (
          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
            <div style={{ flex: '0 0 35%' }}><ImagePreview src={item.imageSrc} alt={item.imageAlt} width={px(140)} align="center" /></div>
            <div style={{ flex: '1 1 65%', textAlign }}>
              <p style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 700 }}>{item.name}</p>
              <p style={{ margin: '0 0 10px', fontSize: 15, color: 'var(--color-primary-blue)', fontWeight: 700 }}>{item.price}</p>
              {item.description && <p style={{ margin: '0 0 10px', fontSize: 13, color: 'var(--color-text-subtle)' }}>{item.description}</p>}
              <span style={{ display: 'inline-block', padding: '8px 16px', background: ctaBg, color: ctaText, borderRadius: 6, fontSize: 13, fontWeight: 600 }}>{item.ctaText}</span>
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
              {row.map((item) => <div key={item.name} style={{ flex: 1 }}>{productPreviewCard(item, ctaBg, ctaText)}</div>)}
            </div>
          ))}
        </div>
      );
    },
    renderEmailHtml: (module) => {
      const { props, settings } = module;
      const spacing = resolveSpacing(settings, 'desktop');
      const containerStyle = `padding:${spacing.paddingTop}px ${spacing.paddingRight}px ${spacing.paddingBottom}px ${spacing.paddingLeft}px;`;
      const textAlign = props.textAlign ?? 'left';
      const ctaBg = props.ctaBackgroundColor || DEFAULT_CTA_BG;
      const ctaText = props.ctaTextColor || DEFAULT_CTA_TEXT;

      if (variant.layout === 'row') {
        const row = productRowHtml(props.items[0], textAlign, ctaBg, ctaText);
        return moduleTable(`<tr><td style="${containerStyle}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${row}</table></td></tr>`);
      }

      const widthPercent = Math.floor(100 / variant.perRow);
      const rowsHtml = chunk(props.items, variant.perRow)
        .map((row) => `<tr>${row.map((item) => productCardHtml(item, widthPercent, textAlign, ctaBg, ctaText)).join('')}</tr>`)
        .join('');
      return moduleTable(`<tr><td style="${containerStyle}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rowsHtml}</table></td></tr>`);
    },
  };
}

export const PRODUCT_DEFINITIONS: ModuleDefinition<ProductGridModuleProps>[] = VARIANTS.map(productDefinition);
export const PRODUCT_TYPES_ORDER: EmailModuleType[] = PRODUCT_DEFINITIONS.map((d) => d.type);
