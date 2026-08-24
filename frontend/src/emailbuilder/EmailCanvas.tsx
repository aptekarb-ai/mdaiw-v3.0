import { useEffect, useRef, useState, type DragEvent } from 'react';
import type { EmailModule, EmailModuleType } from './edm';
import { resolveOuterSpacing, resolveSpacing } from './edm';
import { getModuleDefinition } from './moduleRegistry';
import type { BuilderViewMode } from './registryCore';
import { NEW_MODULE_DRAG_MIME, REORDER_DRAG_MIME, SAVED_MODULE_DRAG_MIME, type NestedModuleDragPayload } from './dragTypes';
import { outerSpacingPx } from './dimensions';
import type { SavedEmailModule } from './types';
import { LayoutCanvasModule } from './LayoutCanvasModule';
import './EmailCanvas.css';

export type { BuilderViewMode };

const MOBILE_CANVAS_WIDTH = 375;

interface EmailCanvasProps {
  modules: EmailModule[];
  selectedModuleId: string | null;
  width: number;
  viewMode: BuilderViewMode;
  // Module-4 Final Gap Closure, Correction 3 (Feature 03 zoom) — a visual
  // editor-viewport scale (50-150, see EmailBuilderWorkspacePage.tsx's
  // ZOOM_MIN/ZOOM_MAX), applied via CSS transform to `.email-canvas__surface`
  // ONLY. Never touches `canvasWidth` below, never reaches
  // renderPreview/definition output, never passed to Code/Preview/Export.
  zoomLevel: number;
  savedModules: SavedEmailModule[];
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  onDropNewModule: (type: EmailModuleType, index: number) => void;
  onDropSavedModule: (saved: SavedEmailModule, index: number) => void;
  onSaveModule: (id: string) => void;
  onAddFirstModule: () => void;
  // Feature 05 — nested column interaction, only relevant for modules
  // with a `columns` array (see LayoutCanvasModule.tsx). `activeColumn`
  // drives both the active-column highlight and instruction 12's "click
  // a library module to insert into the selected column" routing (owned
  // by the workspace page, not this component).
  activeColumn: { layoutId: string; columnId: string } | null;
  onSelectColumn: (layoutId: string, columnId: string) => void;
  onSelectNestedModule: (moduleId: string) => void;
  onInsertNestedModule: (layoutId: string, columnId: string, type: EmailModuleType, index?: number) => void;
  onInsertNestedSavedModule: (layoutId: string, columnId: string, saved: SavedEmailModule, index?: number) => void;
  onReorderNested: (layoutId: string, columnId: string, fromIndex: number, toIndex: number) => void;
  onMoveNested: (from: NestedModuleDragPayload, toLayoutId: string, toColumnId: string, toIndex: number) => void;
  onDuplicateNested: (layoutId: string, columnId: string, moduleId: string) => void;
  onDeleteNested: (layoutId: string, columnId: string, moduleId: string) => void;
}

type DropInfo =
  | { kind: 'reorder'; index: number }
  | { kind: 'new'; index: number }
  | { kind: 'saved'; index: number };

function readDropIndex(event: DragEvent, fallback: number): DropInfo | null {
  if (event.dataTransfer.types.includes(REORDER_DRAG_MIME)) {
    const raw = event.dataTransfer.getData(REORDER_DRAG_MIME);
    const from = Number(raw);
    if (Number.isNaN(from)) return null;
    return { kind: 'reorder', index: from };
  }
  if (event.dataTransfer.types.includes(SAVED_MODULE_DRAG_MIME)) {
    return { kind: 'saved', index: fallback };
  }
  if (event.dataTransfer.types.includes(NEW_MODULE_DRAG_MIME)) {
    return { kind: 'new', index: fallback };
  }
  return null;
}

export function EmailCanvas({
  modules, selectedModuleId, width, viewMode, zoomLevel, savedModules, onSelect, onDelete, onDuplicate, onReorder,
  onDropNewModule, onDropSavedModule, onSaveModule, onAddFirstModule,
  activeColumn, onSelectColumn, onSelectNestedModule, onInsertNestedModule, onInsertNestedSavedModule,
  onReorderNested, onMoveNested, onDuplicateNested, onDeleteNested,
}: EmailCanvasProps) {
  const canvasWidth = viewMode === 'mobile' ? MOBILE_CANVAS_WIDTH : width;
  // Builder-UI-only drag feedback — an insertion line showing where a
  // dropped module will land. Never part of the exported email HTML.
  const [dropIndicator, setDropIndicator] = useState<number | null>(null);

  // Module-4 Final Gap Closure, Correction 3 (Feature 03 zoom) — CSS
  // `transform: scale()` is a paint-only effect: it does NOT change the
  // element's layout box, so the flex scroll container (`.email-canvas`)
  // would reserve space for the UNSCALED surface and clip/mis-scroll a
  // zoomed-in (>100%) or leave excess space around a zoomed-out (<100%)
  // one. `.email-canvas__zoom-wrapper` below is the "small outer sizing
  // wrapper" that fixes this: it gets an explicit width/height equal to
  // the surface's NATURAL (unscaled) size times the zoom factor, so the
  // scroll container's bounds and the flex `justify-content: center`
  // centering are both correct at every zoom level. Width is always known
  // exactly (`canvasWidth`); height is dynamic (content-dependent), so it's
  // measured via ResizeObserver off the actual unscaled surface — `zoom`
  // itself never changes that measured value, only how it's displayed.
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const [surfaceHeight, setSurfaceHeight] = useState<number | null>(null);

  useEffect(() => {
    const node = surfaceRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setSurfaceHeight(entry.contentRect.height);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [modules, viewMode]);

  const zoomFactor = zoomLevel / 100;
  const isZoomed = zoomFactor !== 1;

  function clearIndicator() {
    setDropIndicator(null);
  }

  function applyDrop(event: DragEvent, dropped: DropInfo, targetIndex: number) {
    if (dropped.kind === 'reorder') {
      onReorder(dropped.index, targetIndex);
    } else if (dropped.kind === 'saved') {
      const savedId = Number(event.dataTransfer.getData(SAVED_MODULE_DRAG_MIME));
      const saved = savedModules.find((item) => item.id === savedId);
      if (saved) onDropSavedModule(saved, targetIndex);
    } else {
      const type = event.dataTransfer.getData(NEW_MODULE_DRAG_MIME) as EmailModuleType;
      onDropNewModule(type, targetIndex);
    }
  }

  function handleRowDrop(event: DragEvent, targetIndex: number) {
    event.preventDefault();
    event.stopPropagation();
    clearIndicator();
    const dropped = readDropIndex(event, targetIndex);
    if (!dropped) return;
    applyDrop(event, dropped, targetIndex);
  }

  function handleCanvasDrop(event: DragEvent) {
    event.preventDefault();
    clearIndicator();
    const dropped = readDropIndex(event, modules.length);
    if (!dropped || dropped.kind === 'reorder') return;
    applyDrop(event, dropped, modules.length);
  }

  const sortedModules = modules.slice().sort((a, b) => a.order - b.order);

  return (
    <div className="email-canvas" data-view-mode={viewMode}>
      <div
        className="email-canvas__zoom-wrapper"
        style={isZoomed ? {
          width: canvasWidth * zoomFactor,
          height: surfaceHeight !== null ? surfaceHeight * zoomFactor : undefined,
        } : undefined}
      >
      <div
        ref={surfaceRef}
        className="email-canvas__surface"
        style={isZoomed
          ? { width: canvasWidth, transform: `scale(${zoomFactor})`, transformOrigin: 'top center' }
          : { width: canvasWidth }}
        onDragOver={(event) => {
          event.preventDefault();
          if (
            event.dataTransfer.types.includes(NEW_MODULE_DRAG_MIME)
            || event.dataTransfer.types.includes(SAVED_MODULE_DRAG_MIME)
          ) {
            setDropIndicator(modules.length);
          }
        }}
        onDragLeave={(event) => {
          if (event.currentTarget === event.target) clearIndicator();
        }}
        onDrop={handleCanvasDrop}
      >
        {modules.length === 0 ? (
          <div className="email-canvas__empty">
            <span className="mdaiw-icon mdaiw-icon--email" aria-hidden="true" />
            <p>Start building your email</p>
            <p className="email-canvas__empty-hint">
              Drag a module here or choose one from the left panel.
            </p>
            <button type="button" className="email-canvas__empty-cta" onClick={onAddFirstModule}>
              + Add your first module
            </button>
          </div>
        ) : (
          sortedModules.map((module, index) => {
            const definition = getModuleDefinition(module.type);
            const selected = module.id === selectedModuleId;
            return (
              <div key={module.id} className="email-canvas__row">
                {dropIndicator === index && <div className="email-canvas__drop-indicator" />}
                <div
                  className={
                    selected ? 'email-canvas__module email-canvas__module--selected' : 'email-canvas__module'
                  }
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelect(module.id);
                  }}
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setDropIndicator(index);
                  }}
                  onDrop={(event) => handleRowDrop(event, index)}
                >
                  {selected && (
                    <div className="email-canvas__module-toolbar" onClick={(event) => event.stopPropagation()}>
                      <span
                        className="email-canvas__module-handle"
                        draggable
                        title="Drag to reorder"
                        aria-label={`Drag to reorder ${definition.label}`}
                        onDragStart={(event) => {
                          event.dataTransfer.setData(REORDER_DRAG_MIME, String(index));
                          event.dataTransfer.effectAllowed = 'move';
                        }}
                      >
                        <span className="mdaiw-icon mdaiw-icon--menu" aria-hidden="true" />
                      </span>
                      <button
                        type="button"
                        aria-label={`Duplicate ${definition.label}`}
                        title="Duplicate"
                        onClick={() => onDuplicate(module.id)}
                      >
                        <span className="mdaiw-icon mdaiw-icon--file" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Save ${definition.label} as reusable module`}
                        title="Save as reusable module"
                        onClick={() => onSaveModule(module.id)}
                      >
                        <span className="mdaiw-icon mdaiw-icon--upload" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete ${definition.label}`}
                        title="Delete"
                        onClick={() => onDelete(module.id)}
                      >
                        <span className="mdaiw-icon mdaiw-icon--delete" aria-hidden="true" />
                      </button>
                    </div>
                  )}
                  {(() => {
                    // Mirrors the exported email's OUTER TABLE > TR >
                    // optional left spacer / content / optional right
                    // spacer structure — a dedicated spacer REGION beside
                    // the content, never a CSS margin shifting the module
                    // (see registryCore.ts's wrapWithOuterSpacing, the
                    // real source of truth this approximates for the
                    // builder canvas). Resolves the CURRENT viewport's
                    // outer spacing — switching Desktop/Mobile visibly
                    // changes this without touching the other viewport's
                    // stored values (see edm.ts's resolveOuterSpacing). A
                    // side with value 0 omits its spacer region entirely,
                    // same as the exported HTML omitting that spacer <td>.
                    const resolvedOuter = resolveOuterSpacing(module.settings, viewMode);
                    const leftPx = outerSpacingPx(resolvedOuter.left, canvasWidth);
                    const rightPx = outerSpacingPx(resolvedOuter.right, canvasWidth);
                    const spacing = resolveSpacing(module.settings, viewMode);
                    return (
                      <div className="email-canvas__module-outer-row">
                        {leftPx > 0 && (
                          <div className="email-canvas__module-spacer-region" style={{ width: leftPx }} />
                        )}
                        <div
                          className="email-canvas__module-content"
                          style={{
                            paddingTop: spacing.paddingTop,
                            paddingRight: spacing.paddingRight,
                            paddingBottom: spacing.paddingBottom,
                            paddingLeft: spacing.paddingLeft,
                          }}
                        >
                          {module.columns ? (
                            <LayoutCanvasModule
                              layout={module}
                              viewport={viewMode}
                              canvasWidth={canvasWidth}
                              selectedModuleId={selectedModuleId}
                              activeColumnId={activeColumn?.layoutId === module.id ? activeColumn.columnId : null}
                              savedModules={savedModules}
                              onSelectColumn={(columnId) => onSelectColumn(module.id, columnId)}
                              onSelectNestedModule={onSelectNestedModule}
                              onInsertNewModule={(columnId, type, index) => onInsertNestedModule(module.id, columnId, type, index)}
                              onInsertSavedModule={(columnId, saved, index) => onInsertNestedSavedModule(module.id, columnId, saved, index)}
                              onReorderNested={(columnId, fromIndex, toIndex) => onReorderNested(module.id, columnId, fromIndex, toIndex)}
                              onMoveNested={(from, toColumnId, toIndex) => onMoveNested(from, module.id, toColumnId, toIndex)}
                              onDuplicateNested={(columnId, moduleId) => onDuplicateNested(module.id, columnId, moduleId)}
                              onDeleteNested={(columnId, moduleId) => onDeleteNested(module.id, columnId, moduleId)}
                            />
                          ) : (
                            definition.renderPreview(module, viewMode)
                          )}
                        </div>
                        {rightPx > 0 && (
                          <div className="email-canvas__module-spacer-region" style={{ width: rightPx }} />
                        )}
                      </div>
                    );
                  })()}
                </div>
              </div>
            );
          })
        )}
        {modules.length > 0 && dropIndicator === modules.length && (
          <div className="email-canvas__drop-indicator" />
        )}
      </div>
      </div>
    </div>
  );
}
