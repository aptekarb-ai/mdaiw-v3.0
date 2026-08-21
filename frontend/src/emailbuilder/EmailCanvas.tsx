import { useState, type DragEvent } from 'react';
import type { EmailModule, EmailModuleType } from './edm';
import { resolveOuterSpacing, resolveSpacing } from './edm';
import { getModuleDefinition } from './moduleRegistry';
import type { BuilderViewMode } from './registryCore';
import { NEW_MODULE_DRAG_MIME, REORDER_DRAG_MIME, SAVED_MODULE_DRAG_MIME } from './dragTypes';
import type { DimensionValue } from './dimensions';
import type { SavedEmailModule } from './types';
import './EmailCanvas.css';

// Builder-canvas-only approximation of an outer-spacing dimension as a
// pixel margin, for visual feedback while editing. The exported email
// HTML computes the real spacer <td> from the same DimensionValue — see
// registryCore.ts's wrapWithOuterSpacing, the actual source of truth.
function outerSpacingPx(dimension: DimensionValue, canvasWidth: number): number {
  return dimension.unit === '%' ? Math.round((dimension.value / 100) * canvasWidth) : dimension.value;
}

export type { BuilderViewMode };

const MOBILE_CANVAS_WIDTH = 375;

interface EmailCanvasProps {
  modules: EmailModule[];
  selectedModuleId: string | null;
  width: number;
  viewMode: BuilderViewMode;
  savedModules: SavedEmailModule[];
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  onDropNewModule: (type: EmailModuleType, index: number) => void;
  onDropSavedModule: (saved: SavedEmailModule, index: number) => void;
  onSaveModule: (id: string) => void;
  onAddFirstModule: () => void;
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
  modules, selectedModuleId, width, viewMode, savedModules, onSelect, onDelete, onDuplicate, onReorder,
  onDropNewModule, onDropSavedModule, onSaveModule, onAddFirstModule,
}: EmailCanvasProps) {
  const canvasWidth = viewMode === 'mobile' ? MOBILE_CANVAS_WIDTH : width;
  // Builder-UI-only drag feedback — an insertion line showing where a
  // dropped module will land. Never part of the exported email HTML.
  const [dropIndicator, setDropIndicator] = useState<number | null>(null);

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
        className="email-canvas__surface"
        style={{ width: canvasWidth }}
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
                  <div
                    className="email-canvas__module-outer-spacing"
                    style={(() => {
                      // Builder-only approximation: % outer spacing is
                      // shown against the current canvas width so it
                      // stays visually meaningful at both Desktop and
                      // Mobile canvas sizes. Real px is exact either way.
                      // Resolves the CURRENT viewport's outer spacing —
                      // switching Desktop/Mobile visibly changes this
                      // without touching the other viewport's stored
                      // values (see edm.ts's resolveOuterSpacing).
                      const resolvedOuter = resolveOuterSpacing(module.settings, viewMode);
                      return {
                        marginLeft: outerSpacingPx(resolvedOuter.left, canvasWidth),
                        marginRight: outerSpacingPx(resolvedOuter.right, canvasWidth),
                      };
                    })()}
                  >
                    <div
                      className="email-canvas__module-content"
                      style={(() => {
                        const spacing = resolveSpacing(module.settings, viewMode);
                        return {
                          paddingTop: spacing.paddingTop,
                          paddingRight: spacing.paddingRight,
                          paddingBottom: spacing.paddingBottom,
                          paddingLeft: spacing.paddingLeft,
                        };
                      })()}
                    >
                      {definition.renderPreview(module, viewMode)}
                    </div>
                  </div>
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
  );
}
