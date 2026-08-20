// Native HTML5 drag/drop (no external dnd dependency — see the Feature 03
// report for why). Two distinct MIME keys let a single canvas drop handler
// tell "new module from the panel" apart from "reordering an existing
// canvas module" without any extra state.
export const NEW_MODULE_DRAG_MIME = 'application/x-email-module-type';
export const REORDER_DRAG_MIME = 'application/x-email-module-index';
