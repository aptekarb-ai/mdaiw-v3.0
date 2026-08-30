import { useState, type DragEvent, type KeyboardEvent } from 'react';
import type { EmailColumn, EmailModule, EmailModuleType } from './edm';
import { resolveDesktopGutterPx, resolveOuterSpacing, resolveSpacing } from './edm';
import { getModuleDefinition } from './moduleRegistry';
import { computeLayoutAvailableWidthPx, type BuilderViewMode } from './registryCore';
import { outerSpacingPx } from './dimensions';
import { isLayoutModuleType, resolveColumnPixelWidths } from './layoutModel';
import {
  NESTED_MODULE_DRAG_MIME, NEW_MODULE_DRAG_MIME, SAVED_MODULE_DRAG_MIME, type NestedModuleDragPayload,
} from './dragTypes';
import type { SavedEmailModule } from './types';
import './LayoutCanvasModule.css';

interface LayoutCanvasModuleProps {
  layout: EmailModule;
  viewport: BuilderViewMode;
  canvasWidth: number;
  // Front-Stage Width Contract correction — the REAL document width
  // (EmailCanvasProps.width — never canvasWidth, which is a fixed 375px
  // Mobile visual-emulation value with no relationship to how the real
  // exported HTML actually resolves column pixel widths). Desktop is
  // always the structural source of truth for column/gutter math — even
  // when this layout is shown non-stacked on the Mobile canvas (an
  // explicit "Stack columns on Mobile" opt-out), the real exported HTML
  // applies ZERO Mobile CSS override in that case (see
  // responsiveStyles.ts's layoutRules — mobileStack:false short-circuits
  // before any rule is emitted), so the true rendered pixel widths are
  // still these Desktop ones, not a value rescaled to 375px.
  documentWidth: number;
  selectedModuleId: string | null;
  activeColumnId: string | null;
  savedModules: SavedEmailModule[];
  onSelectColumn: (columnId: string) => void;
  onSelectNestedModule: (moduleId: string) => void;
  onInsertNewModule: (columnId: string, type: EmailModuleType, index?: number) => void;
  onInsertSavedModule: (columnId: string, saved: SavedEmailModule, index?: number) => void;
  onReorderNested: (columnId: string, fromIndex: number, toIndex: number) => void;
  onMoveNested: (from: NestedModuleDragPayload, toColumnId: string, toIndex: number) => void;
  onDuplicateNested: (columnId: string, moduleId: string) => void;
  onDeleteNested: (columnId: string, moduleId: string) => void;
}

function readNestedDrop(event: DragEvent): 'nested' | 'saved' | 'new' | null {
  if (event.dataTransfer.types.includes(NESTED_MODULE_DRAG_MIME)) return 'nested';
  if (event.dataTransfer.types.includes(SAVED_MODULE_DRAG_MIME)) return 'saved';
  if (event.dataTransfer.types.includes(NEW_MODULE_DRAG_MIME)) return 'new';
  return null;
}

// Feature 05 — interactive nested-column canvas for a layout module.
// EmailCanvas.tsx renders this INSTEAD OF definition.renderPreview() for
// any module with a `columns` array; the layout's own outer selection
// chrome (toolbar/border/drag-to-reorder-among-top-level-modules) stays
// exactly as EmailCanvas.tsx already renders it for every module — this
// component only owns what's genuinely inside the layout: columns, drop
// zones and nested module rows.
export function LayoutCanvasModule({
  layout, viewport, canvasWidth, documentWidth, selectedModuleId, activeColumnId, savedModules,
  onSelectColumn, onSelectNestedModule, onInsertNewModule, onInsertSavedModule,
  onReorderNested, onMoveNested, onDuplicateNested, onDeleteNested,
}: LayoutCanvasModuleProps) {
  const [dropTarget, setDropTarget] = useState<{ columnId: string; index: number } | null>(null);
  const columns = layout.columns ?? [];
  const columnWidths = (layout.props as { columnWidths: number[] }).columnWidths;
  const stacked = viewport === 'mobile' && layout.settings.mobileStack !== false;
  // Front-Stage Width Contract correction — the non-stacked (side-by-side)
  // canvas preview now reuses the EXACT SAME width-resolution chain the
  // Properties panel and the real HTML renderer already use
  // (computeLayoutAvailableWidthPx -> resolveColumnPixelWidths — never a
  // second/approximate algorithm), so the builder canvas can no longer
  // diverge from what gets exported. Always Desktop-gutter-based — the
  // gutter only ever becomes Mobile VERTICAL spacing once actually
  // stacked (irrelevant here; stacked mode uses its own CSS gap below,
  // untouched by this correction).
  const gutterPx = resolveDesktopGutterPx(layout.settings);
  const layoutAvailableWidthPx = computeLayoutAvailableWidthPx(layout, documentWidth);
  const { columnPx } = resolveColumnPixelWidths(columnWidths, gutterPx, layoutAvailableWidthPx);

  // Module-4 Final Gap Closure, Correction 2 (Feature 05) — the Desktop
  // visual sequence, as an array of ORIGINAL column indexes (never a
  // mutation of `columns` itself). Reused as the Mobile-stacked default
  // too (see below) — matches the existing, documented rule that an
  // absent mobileColumnOrder inherits whatever order Desktop actually
  // renders in (MOBILE_COLUMN_ORDER_LIMITATION in responsiveStyles.ts).
  const desktopOrderedIndexes = layout.settings.desktopColumnDirection === 'rtl'
    ? columns.map((_, index) => index).reverse()
    : columns.map((_, index) => index);

  const orderedIndexes = (() => {
    if (!stacked) return desktopOrderedIndexes;
    // An explicit, still-valid mobileColumnOrder always wins on Mobile,
    // regardless of the Desktop direction setting.
    const order = layout.settings.mobileColumnOrder;
    if (!order || order.length !== columns.length) return desktopOrderedIndexes;
    return order;
  })();

  function applyDrop(event: DragEvent, column: EmailColumn, targetIndex: number) {
    event.preventDefault();
    event.stopPropagation();
    setDropTarget(null);
    const kind = readNestedDrop(event);
    if (!kind) return;

    if (kind === 'nested') {
      const raw = event.dataTransfer.getData(NESTED_MODULE_DRAG_MIME);
      let payload: NestedModuleDragPayload | null = null;
      try {
        payload = JSON.parse(raw) as NestedModuleDragPayload;
      } catch {
        payload = null;
      }
      if (!payload) return;
      if (payload.layoutId === layout.id && payload.columnId === column.id) {
        const fromIndex = column.modules.findIndex((m) => m.id === payload!.moduleId);
        if (fromIndex >= 0) onReorderNested(column.id, fromIndex, targetIndex);
      } else {
        onMoveNested(payload, column.id, targetIndex);
      }
      return;
    }

    if (kind === 'saved') {
      const savedId = Number(event.dataTransfer.getData(SAVED_MODULE_DRAG_MIME));
      const saved = savedModules.find((item) => item.id === savedId);
      if (saved && !isLayoutModuleType(saved.module_type)) {
        onInsertSavedModule(column.id, saved, targetIndex);
      }
      return;
    }

    const type = event.dataTransfer.getData(NEW_MODULE_DRAG_MIME) as EmailModuleType;
    if (type && !isLayoutModuleType(type)) {
      onInsertNewModule(column.id, type, targetIndex);
    }
  }

  function handleColumnKeyDown(event: KeyboardEvent<HTMLDivElement>, columnId: string) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelectColumn(columnId);
    }
  }

  return (
    <div
      className={stacked ? 'layout-canvas layout-canvas--stacked' : 'layout-canvas'}
      style={stacked ? undefined : { gap: gutterPx }}
    >
      {orderedIndexes.map((columnIndex) => {
        const column = columns[columnIndex];
        if (!column) return null;
        const resolvedWidthPx = columnPx[columnIndex] ?? 0;
        const spacing = resolveSpacing(column.settings, viewport);
        const isActiveColumn = activeColumnId === column.id;
        const isEmpty = column.modules.length === 0;

        return (
          <div
            key={column.id}
            className={
              isActiveColumn ? 'layout-canvas__column layout-canvas__column--active' : 'layout-canvas__column'
            }
            style={{
              flex: stacked ? '0 0 100%' : `0 0 ${resolvedWidthPx}px`,
              width: stacked ? undefined : `${resolvedWidthPx}px`,
              maxWidth: stacked ? '100%' : `${resolvedWidthPx}px`,
              backgroundColor: column.settings.backgroundColor || undefined,
              justifyContent: column.settings.verticalAlign === 'middle'
                ? 'center'
                : column.settings.verticalAlign === 'bottom' ? 'flex-end' : 'flex-start',
              paddingTop: spacing.paddingTop,
              paddingRight: spacing.paddingRight,
              paddingBottom: spacing.paddingBottom,
              paddingLeft: spacing.paddingLeft,
            }}
            role="button"
            tabIndex={0}
            aria-label={`Column ${columnIndex + 1}${isEmpty ? ', empty' : `, ${column.modules.length} module${column.modules.length === 1 ? '' : 's'}`}`}
            onClick={(event) => {
              event.stopPropagation();
              onSelectColumn(column.id);
            }}
            onKeyDown={(event) => handleColumnKeyDown(event, column.id)}
            onDragOver={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (readNestedDrop(event)) setDropTarget({ columnId: column.id, index: column.modules.length });
            }}
            onDragLeave={(event) => {
              if (event.currentTarget === event.target) setDropTarget(null);
            }}
            onDrop={(event) => applyDrop(event, column, column.modules.length)}
          >
            {isEmpty ? (
              <button
                type="button"
                className="layout-canvas__add-content"
                onClick={(event) => {
                  event.stopPropagation();
                  onSelectColumn(column.id);
                }}
              >
                + Add content
              </button>
            ) : (
              column.modules.slice().sort((a, b) => a.order - b.order).map((nested, nestedIndex) => {
                const definition = getModuleDefinition(nested.type);
                const selected = nested.id === selectedModuleId;
                return (
                  <div key={nested.id} className="layout-canvas__nested-row">
                    {dropTarget?.columnId === column.id && dropTarget.index === nestedIndex && (
                      <div className="layout-canvas__drop-indicator" />
                    )}
                    <div
                      className={
                        selected
                          ? 'layout-canvas__nested-module layout-canvas__nested-module--selected'
                          : 'layout-canvas__nested-module'
                      }
                      onClick={(event) => {
                        event.stopPropagation();
                        onSelectNestedModule(nested.id);
                      }}
                      onDragOver={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        if (readNestedDrop(event)) setDropTarget({ columnId: column.id, index: nestedIndex });
                      }}
                      onDrop={(event) => applyDrop(event, column, nestedIndex)}
                    >
                      {selected && (
                        <div className="layout-canvas__nested-toolbar" onClick={(event) => event.stopPropagation()}>
                          <span
                            className="layout-canvas__nested-handle"
                            draggable
                            title="Drag to reorder or move to another column"
                            aria-label={`Drag to move ${definition?.label ?? nested.type}`}
                            onDragStart={(event) => {
                              const payload: NestedModuleDragPayload = {
                                layoutId: layout.id, columnId: column.id, moduleId: nested.id,
                              };
                              event.dataTransfer.setData(NESTED_MODULE_DRAG_MIME, JSON.stringify(payload));
                              event.dataTransfer.effectAllowed = 'move';
                            }}
                          >
                            <span className="mdaiw-icon mdaiw-icon--menu" aria-hidden="true" />
                          </span>
                          <button
                            type="button"
                            aria-label="Move component up"
                            title="Move component up"
                            disabled={nestedIndex === 0}
                            onClick={() => onReorderNested(column.id, nestedIndex, nestedIndex - 1)}
                          >
                            <span className="mdaiw-icon mdaiw-icon--chevron-down layout-canvas__move-icon--up" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            aria-label="Move component down"
                            title="Move component down"
                            disabled={nestedIndex === column.modules.length - 1}
                            onClick={() => onReorderNested(column.id, nestedIndex, nestedIndex + 1)}
                          >
                            <span className="mdaiw-icon mdaiw-icon--chevron-down" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            aria-label={`Duplicate ${definition?.label ?? nested.type}`}
                            title="Duplicate"
                            onClick={() => onDuplicateNested(column.id, nested.id)}
                          >
                            <span className="mdaiw-icon mdaiw-icon--file" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            aria-label={`Delete ${definition?.label ?? nested.type}`}
                            title="Delete"
                            onClick={() => onDeleteNested(column.id, nested.id)}
                          >
                            <span className="mdaiw-icon mdaiw-icon--delete" aria-hidden="true" />
                          </button>
                        </div>
                      )}
                      {(() => {
                        // Same spacer-REGION approach the top-level
                        // canvas uses (EmailCanvas.tsx) — a dedicated
                        // spacer element beside the content, never a CSS
                        // margin — for the nested module's OWN outer
                        // spacer, resolved for the current viewport,
                        // independent of the parent Layout's own outer
                        // spacer.
                        const resolvedOuter = resolveOuterSpacing(nested.settings, viewport);
                        const leftPx = outerSpacingPx(resolvedOuter.left, canvasWidth);
                        const rightPx = outerSpacingPx(resolvedOuter.right, canvasWidth);
                        return (
                          <div className="layout-canvas__nested-outer-row">
                            {leftPx > 0 && (
                              <div className="layout-canvas__nested-spacer-region" style={{ width: leftPx }} />
                            )}
                            <div className="layout-canvas__nested-content">
                              {definition?.renderPreview(nested, viewport)}
                            </div>
                            {rightPx > 0 && (
                              <div className="layout-canvas__nested-spacer-region" style={{ width: rightPx }} />
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                );
              })
            )}
            {dropTarget?.columnId === column.id && dropTarget.index === column.modules.length && !isEmpty && (
              <div className="layout-canvas__drop-indicator" />
            )}
          </div>
        );
      })}
    </div>
  );
}
