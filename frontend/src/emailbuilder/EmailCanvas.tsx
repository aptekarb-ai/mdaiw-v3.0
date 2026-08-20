import { useState, type DragEvent } from 'react';
import type { EmailModule, EmailModuleType } from './edm';
import { getModuleDefinition } from './moduleRegistry';
import { NEW_MODULE_DRAG_MIME, REORDER_DRAG_MIME } from './dragTypes';
import './EmailCanvas.css';

export type BuilderViewMode = 'desktop' | 'mobile';

const MOBILE_CANVAS_WIDTH = 375;

interface EmailCanvasProps {
  modules: EmailModule[];
  selectedModuleId: string | null;
  width: number;
  viewMode: BuilderViewMode;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  onDropNewModule: (type: EmailModuleType, index: number) => void;
  onAddFirstModule: () => void;
}

function readDropIndex(event: DragEvent, fallback: number): { index: number; isReorder: boolean } | null {
  if (event.dataTransfer.types.includes(REORDER_DRAG_MIME)) {
    const raw = event.dataTransfer.getData(REORDER_DRAG_MIME);
    const from = Number(raw);
    if (Number.isNaN(from)) return null;
    return { index: from, isReorder: true };
  }
  if (event.dataTransfer.types.includes(NEW_MODULE_DRAG_MIME)) {
    return { index: fallback, isReorder: false };
  }
  return null;
}

export function EmailCanvas({
  modules, selectedModuleId, width, viewMode, onSelect, onDelete, onDuplicate, onReorder, onDropNewModule,
  onAddFirstModule,
}: EmailCanvasProps) {
  const canvasWidth = viewMode === 'mobile' ? MOBILE_CANVAS_WIDTH : width;
  // Builder-UI-only drag feedback — an insertion line showing where a
  // dropped module will land. Never part of the exported email HTML.
  const [dropIndicator, setDropIndicator] = useState<number | null>(null);

  function clearIndicator() {
    setDropIndicator(null);
  }

  function handleRowDrop(event: DragEvent, targetIndex: number) {
    event.preventDefault();
    event.stopPropagation();
    clearIndicator();
    const dropped = readDropIndex(event, targetIndex);
    if (!dropped) return;
    if (dropped.isReorder) {
      onReorder(dropped.index, targetIndex);
    } else {
      const type = event.dataTransfer.getData(NEW_MODULE_DRAG_MIME) as EmailModuleType;
      onDropNewModule(type, targetIndex);
    }
  }

  function handleCanvasDrop(event: DragEvent) {
    event.preventDefault();
    clearIndicator();
    const dropped = readDropIndex(event, modules.length);
    if (!dropped || dropped.isReorder) return;
    const type = event.dataTransfer.getData(NEW_MODULE_DRAG_MIME) as EmailModuleType;
    onDropNewModule(type, modules.length);
  }

  const sortedModules = modules.slice().sort((a, b) => a.order - b.order);

  return (
    <div className="email-canvas" data-view-mode={viewMode}>
      <div
        className="email-canvas__surface"
        style={{ width: canvasWidth }}
        onDragOver={(event) => {
          event.preventDefault();
          if (event.dataTransfer.types.includes(NEW_MODULE_DRAG_MIME)) setDropIndicator(modules.length);
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
                        aria-label={`Delete ${definition.label}`}
                        title="Delete"
                        onClick={() => onDelete(module.id)}
                      >
                        <span className="mdaiw-icon mdaiw-icon--delete" aria-hidden="true" />
                      </button>
                    </div>
                  )}
                  <div
                    className="email-canvas__module-content"
                    style={{
                      paddingTop: module.settings.paddingTop,
                      paddingRight: module.settings.paddingRight,
                      paddingBottom: module.settings.paddingBottom,
                      paddingLeft: module.settings.paddingLeft,
                    }}
                  >
                    {definition.renderPreview(module)}
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
