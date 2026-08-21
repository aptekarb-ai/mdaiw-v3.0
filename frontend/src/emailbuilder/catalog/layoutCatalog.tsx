import type { EmailModuleType, LayoutModuleProps } from '../edm';
import { ZERO_SPACING } from '../edm';
import { GENERIC_ONLY, createResponsiveSettings, moduleTable, type ModuleDefinition } from '../registryCore';

function layoutDefinition(
  type: EmailModuleType, label: string, columnWidths: number[], tags: string[],
): ModuleDefinition<LayoutModuleProps> {
  return {
    type,
    label,
    category: 'layout',
    icon: 'landing-page',
    description: `${label} structural layout row.`,
    tags,
    keywords: ['layout', 'column', 'columns', 'structure', 'grid', ...tags],
    columnCount: columnWidths.length,
    imagePosition: null,
    platformCompatibility: GENERIC_ONLY,
    propertyEditor: 'basic',
    createDefaultProps: () => ({ columnWidths }),
    createDefaultSettings: () => createResponsiveSettings(ZERO_SPACING, { mobileStack: true }),
    // Mobile view + mobileStack (the email-safe default) previews columns
    // stacked full-width, matching the exported HTML's mobile behaviour
    // intent — the same architecture composite modules use below.
    renderPreview: (module, viewport = 'desktop') => {
      const stacked = viewport === 'mobile' && module.settings.mobileStack !== false;
      return (
        <div className={stacked ? 'email-canvas__layout-columns email-canvas__layout-columns--stacked' : 'email-canvas__layout-columns'}>
          {module.props.columnWidths.map((width, index) => (
            <div
              key={`${module.id}-col-${index}`}
              className="email-canvas__layout-column"
              style={stacked ? undefined : { flex: `0 0 ${width}%` }}
            >
              + Add content
            </div>
          ))}
        </div>
      );
    },
    renderEmailHtml: (module) => {
      const cells = module.props.columnWidths
        .map((width) => `<td width="${width}%" style="width:${width}%; vertical-align:top;">&nbsp;</td>`)
        .join('');
      return moduleTable(`<tr>${cells}</tr>`);
    },
  };
}

export const LAYOUT_DEFINITIONS: ModuleDefinition<LayoutModuleProps>[] = [
  layoutDefinition('layout-1col', '1 Column', [100], ['1 column', 'full width', 'single']),
  layoutDefinition('layout-2col-50-50', '2 Columns 50/50', [50, 50], ['2 column', 'two column', 'even split']),
  layoutDefinition('layout-2col-40-60', '2 Columns 40/60', [40, 60], ['2 column', 'two column', 'asymmetric']),
  layoutDefinition('layout-2col-60-40', '2 Columns 60/40', [60, 40], ['2 column', 'two column', 'asymmetric']),
  layoutDefinition('layout-2col-30-70', '2 Columns 30/70', [30, 70], ['2 column', 'two column', 'asymmetric']),
  layoutDefinition('layout-2col-70-30', '2 Columns 70/30', [70, 30], ['2 column', 'two column', 'asymmetric']),
  layoutDefinition('layout-3col', '3 Columns', [33, 33, 34], ['3 column', 'three column', 'even split']),
  layoutDefinition('layout-4col', '4 Columns', [25, 25, 25, 25], ['4 column', 'four column', 'even split']),
  layoutDefinition('layout-5col', '5 Columns', [20, 20, 20, 20, 20], ['5 column', 'five column', 'even split']),
  layoutDefinition('layout-6col', '6 Columns', [17, 17, 16, 17, 16, 17], ['6 column', 'six column', 'even split']),
];

export const LAYOUT_TYPES_ORDER: EmailModuleType[] = LAYOUT_DEFINITIONS.map((d) => d.type);
