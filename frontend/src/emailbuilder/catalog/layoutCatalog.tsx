import type { EmailModuleType, LayoutModuleProps } from '../edm';
import { ZERO_SPACING, resolveColumnGutter, resolveSpacing } from '../edm';
import { widthCssValue } from '../dimensions';
import {
  GENERIC_ONLY, NESTED_MODULE_PARENT_PLACEHOLDER, createResponsiveSettings, moduleTable, paddingStyle,
  renderModuleWithOuterStructure, resolveModuleDefinition, wrapModuleComment,
  type ModuleDefinition,
} from '../registryCore';
import { columnResponsiveClassName, gutterResponsiveClassName } from '../responsiveStyles';
import { createEmptyColumns } from '../layoutModel';

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
    // Feature 14 V2 — deliberately empty, not omitted: layout modules
    // have no flat AI-editable scalar prop (their one prop,
    // columnWidths, is an array edited via the dedicated Column Widths
    // editor, not a SchemaField). Column-width AI editing is explicitly
    // deferred; this stays [] rather than fabricating coverage.
    editableFields: [],
    createDefaultProps: () => ({ columnWidths }),
    createDefaultSettings: () => createResponsiveSettings(ZERO_SPACING, { mobileStack: true }),
    createDefaultColumns: () => createEmptyColumns(columnWidths.length),
    // The canvas renders an interactive column/drop-zone UI for layout
    // modules directly (see LayoutCanvasModule.tsx) instead of calling
    // this — EmailCanvas.tsx branches on `module.columns` before ever
    // reaching definition.renderPreview for a layout type. This stays
    // here only as the Module Library card's small structural preview
    // (see ModulePanel.tsx's ModuleCardPreview), which never needs
    // interactivity — just the column ratio bars.
    renderPreview: (module) => (
      <span className="module-panel__layout-preview" aria-hidden="true">
        {module.props.columnWidths.map((width, index) => (
          <span key={`${module.id}-col-${index}`} className="module-panel__layout-bar" style={{ flexGrow: width }} />
        ))}
      </span>
    ),
    // Table-first nested layout — see docs/module-4 Feature-05 brief
    // section 26-28. One inner presentation table; each column is its own
    // <td width="N%" valign="...">, with a FIXED-px spacer <td> between
    // adjacent columns only when the gutter is > 0 (0 emits nothing, same
    // convention as wrapWithOuterSpacing's outer spacer cells). Nested
    // modules render through renderModuleWithOuterStructure — the SAME
    // centralized outer-module-structure entry point every top-level
    // module goes through in htmlRenderer.ts — so a nested module's own
    // Left/Right Outer Spacer settings are honored exactly like a
    // top-level module's, independently of the parent Layout's own outer
    // spacer values. No div-wrapping special case.
    renderEmailHtml: (module) => {
      const columns = module.columns ?? createEmptyColumns(module.props.columnWidths.length);
      const gutterDimension = resolveColumnGutter(module.settings, 'desktop');
      const gutterPx = gutterDimension.unit === 'px' ? Math.round(gutterDimension.value) : 0;

      // Feature 07 — mobile gutter override may want a gutter even when
      // Desktop's is 0 (or vice versa collapse a nonzero Desktop gutter
      // to 0) — emit the gutter <td> whenever EITHER viewport needs one,
      // same OR-active convention as wrapWithOuterSpacing's outer spacer
      // cells, so the responsive <style> block always has a real <td> to
      // target.
      const mobileGutterDimension = resolveColumnGutter(module.settings, 'mobile');
      const mobileGutterPx = mobileGutterDimension.unit === 'px' ? Math.round(mobileGutterDimension.value) : 0;
      const gutterActive = gutterPx > 0 || mobileGutterPx > 0;

      // Module-4 Final Gap Closure, Correction 2 (Feature 05) — the
      // Desktop visual sequence as an array of ORIGINAL column indexes.
      // This is the real static-export/Preview/Code/Export renderer, so
      // (unlike mobileColumnOrder) this DOES change the actual emitted
      // <td> order — never the canonical `columns`/`columnWidths` data,
      // which stay untouched; every cell below still looks up its width/
      // class/valign/background/content by its ORIGINAL index.
      const desktopOrderedIndexes = module.settings.desktopColumnDirection === 'rtl'
        ? columns.map((_, index) => index).reverse()
        : columns.map((_, index) => index);

      // Sub-phase 3, item 8 — a single counter running across ALL
      // columns (not reset per column), so every nested module gets a
      // genuinely unique MODULE-__PARENT__.N comment regardless of which
      // column it lives in — column 2's first module is .3, not another
      // .1, if column 1 already has two. htmlRenderer.ts resolves
      // __PARENT__ to the layout's own top-level number once rendering
      // reaches it (layoutCatalog.tsx has no way to know that number
      // itself — see registryCore.tsx's resolveNestedModuleParentPlaceholder).
      // Numbered in canonical (original) column order regardless of
      // Desktop direction — this is an authoring/debug label, not a
      // user-facing visual sequence.
      let nestedModuleIndex = 0;
      const cells = desktopOrderedIndexes.map((index, position) => {
        const column = columns[index];
        const width = module.props.columnWidths[index] ?? 0;
        const spacing = resolveSpacing(column.settings, 'desktop');
        const valign = column.settings.verticalAlign;
        const background = column.settings.backgroundColor ? `background-color:${column.settings.backgroundColor};` : '';
        const innerHtml = column.modules.length === 0
          ? '&nbsp;'
          : column.modules.map((nested) => {
            nestedModuleIndex += 1;
            const nestedDefinition = resolveModuleDefinition(nested.type);
            const nestedLabel = `${NESTED_MODULE_PARENT_PLACEHOLDER}.${nestedModuleIndex}: `
              + (nestedDefinition?.label ?? nested.type).toUpperCase();
            return wrapModuleComment(renderModuleWithOuterStructure(nested), nestedLabel);
          }).join('');
        // class is appended AFTER width/valign (never before) so the
        // existing `<td width="N%" valign="...` literal-prefix tests
        // stay byte-identical whether or not Feature 07 needs a class here.
        const columnCell = (
          `<td width="${width}%" valign="${valign}" class="${columnResponsiveClassName(module.id, index)}" `
          + `style="width:${width}%; vertical-align:${valign}; ${background}${paddingStyle(spacing)}">`
          + `${innerHtml}</td>`
        );
        const isLastRendered = position === desktopOrderedIndexes.length - 1;
        // The gutter's OWN identity (for the mobile-collapse CSS rule in
        // responsiveStyles.ts, which is keyed by original column index)
        // is the smaller of the two original indexes it sits between —
        // true regardless of which direction they're rendered in, since
        // a reversal always keeps the same two columns adjacent, just
        // visited in the opposite sequence.
        const nextIndex = !isLastRendered ? desktopOrderedIndexes[position + 1] : null;
        const gutterIndex = nextIndex !== null ? Math.min(index, nextIndex) : null;
        const gutterCell = gutterIndex !== null && gutterActive
          ? `<td width="${gutterPx}" class="${gutterResponsiveClassName(module.id, gutterIndex)}" `
            + `style="width:${widthCssValue({ value: gutterPx, unit: 'px' })}; font-size:0; line-height:0;">&nbsp;</td>`
          : '';
        return columnCell + gutterCell;
      }).join('');

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
