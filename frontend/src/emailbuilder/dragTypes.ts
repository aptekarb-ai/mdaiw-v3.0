// Native HTML5 drag/drop (no external dnd dependency — see the Feature 03
// report for why). Two distinct MIME keys let a single canvas drop handler
// tell "new module from the panel" apart from "reordering an existing
// canvas module" without any extra state.
export const NEW_MODULE_DRAG_MIME = 'application/x-email-module-type';
export const REORDER_DRAG_MIME = 'application/x-email-module-index';
// Feature 04 — dragging a Saved Module card carries its saved-module id
// (a string, per dataTransfer's string-only contract); the drop handler
// resolves it against the caller-supplied saved modules list.
export const SAVED_MODULE_DRAG_MIME = 'application/x-email-saved-module-id';
// Feature 05 — dragging an EXISTING nested module (to reorder within its
// column or move it to a different column) carries its current location
// as JSON (dataTransfer only supports string payloads). The drop handler
// reads this to tell "move a nested module" apart from "insert a new one
// from the library" without a second drag subsystem — same MIME-keyed
// pattern as the two constants above.
export const NESTED_MODULE_DRAG_MIME = 'application/x-email-nested-module';

export interface NestedModuleDragPayload {
  layoutId: string;
  columnId: string;
  moduleId: string;
}
