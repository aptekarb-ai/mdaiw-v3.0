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
