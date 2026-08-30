import type { EmailModuleType, LayoutModuleProps } from '../edm';
import { ZERO_SPACING, resolveDesktopGutterPx, resolveMobileGutterPx, resolveSpacing } from '../edm';
import { widthCssValue } from '../dimensions';
import {
  GENERIC_ONLY, NESTED_MODULE_PARENT_PLACEHOLDER, cell, createResponsiveSettings, moduleTable, moduleTableRow,
  paddingStyle, renderModuleWithOuterStructure, resolveModuleDefinition, wrapModuleComment,
  type ModuleDefinition,
} from '../registryCore';
import { columnResponsiveClassName, gutterResponsiveClassName } from '../responsiveStyles';
import { createEmptyColumns, resolveColumnPixelWidths } from '../layoutModel';
import { DEFAULT_EMAIL_WIDTH } from '../widthOptions';
import { escapeAttribute, sanitizeUrl } from '../sanitize';
import { estimateColumnVmlContentAllowancePx, renderVmlBackground } from '../vml';

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
    renderEmailHtml: (module, availableWidthPx) => {
      const columns = module.columns ?? createEmptyColumns(module.props.columnWidths.length);
      const gutterPx = resolveDesktopGutterPx(module.settings);

      // Structural Width Contract correction — the layout's OWN internal
      // padding (the "Internal Padding" control shown for every module,
      // previously silently ignored by this one renderer) now
      // participates in the SAME single width equation every other part
      // of this file already follows:
      //   P  = availableWidthPx (parent width, already narrowed by this
      //        module's own Outer Spacer Columns via
      //        renderModuleWithOuterStructure — never document.width)
      //   C  = P - paddingLeft - paddingRight   (content/column region)
      //   A  = C - gutterPx * (N - 1)           (available for columns)
      // resolveColumnPixelWidths (below) performs the A -> Ci step; this
      // is the ONE place P -> C happens, so the Properties panel (which
      // calls the exact same resolveSpacing + this same
      // resolveColumnPixelWidths via ColumnEditor.tsx) and this renderer
      // can never diverge. Never below 0 — a pathologically narrow parent
      // with large padding clamps to a 0px content region rather than
      // going negative.
      const layoutSpacing = resolveSpacing(module.settings, 'desktop');
      const parentWidthPx = availableWidthPx ?? DEFAULT_EMAIL_WIDTH;
      const contentWidthPx = Math.max(0, parentWidthPx - layoutSpacing.paddingLeft - layoutSpacing.paddingRight);

      // Independently Configurable Desktop/Mobile Gutter — the Mobile
      // gutter is a fully separate value that may be nonzero even when
      // Desktop's is 0 (or vice versa) — emit the gutter <td> whenever
      // EITHER viewport needs one, same OR-active convention as
      // wrapWithOuterSpacing's outer spacer cells, so the responsive
      // <style> block always has a real <td> to target. Whether the
      // Mobile gutter actually renders as vertical spacing is decided
      // entirely by responsiveStyles.ts (hideGutterOnMobile) — this file
      // only decides whether the CELL exists, never its Mobile behavior.
      const mobileGutterPx = resolveMobileGutterPx(module.settings);
      const gutterActive = gutterPx > 0 || mobileGutterPx > 0;

      // Column Width + Gutter Rendering Correction — the ONE deterministic
      // pixel resolver (layoutModel.ts's resolveColumnPixelWidths) turns
      // the semantic ratios (module.props.columnWidths — untouched by
      // this, still the persisted source of truth) into exact column
      // pixel widths, with the configured DESKTOP gutter subtracted from
      // `contentWidthPx` (the parent width ABOVE, already narrowed by
      // both this module's own Outer Spacer Columns AND its own internal
      // padding — never a hard-coded document.width) BEFORE ratio
      // allocation. This is what makes paddingLeft + columns + gutters +
      // paddingRight sum to exactly parentWidthPx instead of the old
      // `width="N%"` + separate fixed-px gutter <td> in the same row
      // summing to MORE than the parent (100% + gutter). The gutter
      // itself is never zeroed to solve this — its configured pixel
      // value is preserved and actually subtracted correctly.
      // Defensive fallback only — the centralized entry point
      // (registryCore.tsx's renderModuleWithOuterStructure, the ONLY
      // caller in production/exported HTML) always supplies a real
      // value; this covers direct definition.renderEmailHtml(module)
      // calls some tests use to inspect a single module's raw output.
      const { columnPx } = resolveColumnPixelWidths(module.props.columnWidths, gutterPx, contentWidthPx);

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
        const widthPx = columnPx[index] ?? 0;
        const spacing = resolveSpacing(column.settings, 'desktop');
        const valign = column.settings.verticalAlign;
        // E5 — generic per-column background, shared by every registered
        // layout/ratio through this one column-settings shape (never a
        // per-layout special case). backgroundColor always stays the CSS
        // fallback rendered BEHIND the image (declared first, so
        // background-image paints over it when the image loads, and it
        // alone still shows if the image fails/is absent).
        const safeBackgroundImageUrl = column.settings.backgroundImage
          ? escapeAttribute(sanitizeUrl(column.settings.backgroundImage))
          : '';
        const background = (
          (column.settings.backgroundColor ? `background-color:${column.settings.backgroundColor};` : '')
          + (safeBackgroundImageUrl ? `background-image:url('${safeBackgroundImageUrl}'); background-size:cover; background-position:center;` : '')
        );
        // The `background` HTML attribute is the "normal email clients"
        // half of the pairing (paired with the CSS above) — only emitted
        // when an image is actually configured, so a column with none
        // renders byte-identical to before this field existed.
        const backgroundAttr = safeBackgroundImageUrl ? ` background="${safeBackgroundImageUrl}"` : '';
        const innerContent = column.modules.length === 0
          ? '&nbsp;'
          : column.modules.map((nested) => {
            nestedModuleIndex += 1;
            const nestedDefinition = resolveModuleDefinition(nested.type);
            const nestedLabel = `${NESTED_MODULE_PARENT_PLACEHOLDER}.${nestedModuleIndex}: `
              + (nestedDefinition?.label ?? nested.type).toUpperCase();
            return wrapModuleComment(renderModuleWithOuterStructure(nested, widthPx), nestedLabel);
          }).join('');
        // Column Width + Gutter Rendering Correction — the width-bearing
        // structural <td> below carries ONLY width/valign/background and
        // explicit padding:0. User-configured column padding is applied
        // on an INNER single-cell table instead (the exact same nested-
        // table pattern wrapWithOuterSpacing already uses for outer
        // spacer columns) — padding on the SAME cell as a declared pixel
        // width would grow that cell beyond its allocated share in
        // standard content-box table-cell rendering, which this app
        // deliberately does not override via box-sizing:border-box
        // (Outlook does not reliably honor it).
        let innerHtml = moduleTableRow(cell(innerContent, paddingStyle(spacing)));
        // E5 — Classic Outlook (the Word rendering engine) does not
        // reliably honor CSS background-image or the `background`
        // attribute on a <td>, so it needs the same VML "ghost table"
        // fallback Hero's own background variant already uses (reused
        // via the SAME renderVmlBackground function — never a second VML
        // system), gated on the SAME settings.outlookVml opt-in every
        // other module's VML already uses. Uses the column's own
        // gutter-aware resolved pixel width (widthPx, computed above by
        // the SAME resolveColumnPixelWidths call the width attribute
        // uses) — never a second, independent width. If there's no image
        // configured, or outlookVml is off, this emits no VML at all.
        if (safeBackgroundImageUrl && module.settings.outlookVml) {
          innerHtml = renderVmlBackground(
            {
              imageSrc: column.settings.backgroundImage!,
              backgroundColor: column.settings.backgroundColor,
              paddingTop: spacing.paddingTop,
              paddingBottom: spacing.paddingBottom,
              contentAllowancePx: estimateColumnVmlContentAllowancePx(column.modules.length),
            },
            widthPx,
            innerHtml,
          );
        }
        // class is appended AFTER width/valign (never before) so the
        // existing `<td width="N" valign="...` literal-prefix tests
        // stay byte-identical whether or not Feature 07 needs a class here.
        // Both the HTML width attribute AND the inline CSS pixel width
        // are emitted (Classic Outlook honors the attribute; modern
        // clients honor the CSS) — never a bare percentage. The
        // background HTML attribute (when present) is appended after
        // class, for the same "never changes the existing literal
        // prefix" reason.
        const columnCell = (
          `<td width="${widthPx}" valign="${valign}" class="${columnResponsiveClassName(module.id, index)}"${backgroundAttr} `
          + `style="width:${widthPx}px; vertical-align:${valign}; padding:0; ${background}">`
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

      const columnsTable = moduleTable(`<tr>${cells}</tr>`);

      // Structural Width Contract correction — the parent/central layout
      // structure's OWN padding (distinct from each column's own
      // independent padding/background — see the per-column handling
      // above, and distinct from the whole-module Layout Background,
      // which now lives at registryCore.tsx's renderModuleWithOuterStructure
      // instead — see the Layout Background scope correction below).
      // Applied on an outer wrapping <td> around the columns table —
      // never on any width-bearing column <td> itself — so padding can
      // never make a structural column wider than its declared width
      // (the exact same inner-wrapper strategy already used for each
      // column's own padding above). Skipped entirely (byte-identical to
      // before this correction) when there is no padding configured —
      // the overwhelming default case.
      const hasLayoutPadding = layoutSpacing.paddingTop > 0 || layoutSpacing.paddingRight > 0
        || layoutSpacing.paddingBottom > 0 || layoutSpacing.paddingLeft > 0;

      if (!hasLayoutPadding) {
        return columnsTable;
      }

      // Layout Background scope correction — the whole-module background
      // (color/image, including Outer Spacer Columns) is applied ONE
      // level up, at registryCore.tsx's renderModuleWithOuterStructure —
      // this file only ever sees the width AFTER outer-spacer narrowing,
      // so it structurally cannot reach the spacer <td>s a background
      // scoped to the FULL module row needs to cover. Padding still wraps
      // here (it only ever affects the CENTRAL region's own width math,
      // never the outer spacers) — see computeLayoutAvailableWidthPx's
      // own docstring for the P -> C step this mirrors.
      return moduleTableRow(cell(columnsTable, paddingStyle(layoutSpacing)));
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
