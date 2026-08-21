export type YuktiIntent =
  | 'GENERAL_HELP'
  | 'OPEN_LOGIN'
  | 'OPEN_REGISTRATION'
  | 'START_FACE_LOGIN'
  | 'EXPLAIN_PASSWORD_LOGIN'
  | 'EXPLAIN_FACE_LOGIN'
  | 'EXPLAIN_REGISTRATION_FIELD'
  | 'FILL_REGISTRATION_FIELD'
  | 'GO_TO_REGISTRATION_STEP'
  | 'NAVIGATE_MODULE'
  | 'READ_VALIDATION_ERRORS'
  | 'CANCEL_CURRENT_ACTION'
  | 'UNKNOWN';

export type YuktiActionType =
  | 'NAVIGATE'
  | 'FOCUS_FIELD'
  | 'FILL_FIELD'
  | 'GO_TO_STEP'
  | 'START_FACE_LOGIN'
  | 'READ_ERRORS'
  | 'CANCEL'
  | 'OPEN_YUKTI'
  | 'CLOSE_YUKTI'
  | 'SUGGEST_FIELD_VALUE';

export interface YuktiNavigateAction {
  type: 'NAVIGATE';
  target: string;
}

export interface YuktiFocusFieldAction {
  type: 'FOCUS_FIELD';
  field: string;
}

export interface YuktiFillFieldAction {
  type: 'FILL_FIELD';
  field: string;
  value: string;
}

// A lower-trust AI-provider suggestion — same shape as FILL_FIELD, but
// always confirmed before it touches the form, regardless of which field it
// targets (unlike FILL_FIELD's per-field confirmation allow-list, which is
// for the deterministic router's already-vetted pattern matches).
export interface YuktiSuggestFieldValueAction {
  type: 'SUGGEST_FIELD_VALUE';
  field: string;
  value: string;
}

export interface YuktiGoToStepAction {
  type: 'GO_TO_STEP';
  step: number;
}

export interface YuktiSimpleAction {
  type: 'START_FACE_LOGIN' | 'READ_ERRORS' | 'CANCEL' | 'OPEN_YUKTI' | 'CLOSE_YUKTI';
}

export type YuktiAction =
  | YuktiNavigateAction
  | YuktiFocusFieldAction
  | YuktiFillFieldAction
  | YuktiSuggestFieldValueAction
  | YuktiGoToStepAction
  | YuktiSimpleAction;

export interface YuktiRequestContext {
  route: string;
  registration_step?: number | null;
  authenticated?: boolean;
  visible_error_codes?: string[];
}

export interface YuktiIntentResponse {
  success: true;
  intent: YuktiIntent;
  confidence: number;
  requires_confirmation: boolean;
  spoken_response: string;
  action: YuktiAction | null;
  language?: string | null;
}

export type YuktiMessageRole = 'user' | 'assistant';

export interface YuktiMessage {
  id: string;
  role: YuktiMessageRole;
  text: string;
  createdAt: number;
}

// Fields Yukti is ever allowed to touch. Mirrors
// backend/yukti/intents.py::FILLABLE_REGISTRATION_FIELDS — password and
// confirm_password are structurally absent, not filtered out.
export const YUKTI_FILLABLE_REGISTRATION_FIELDS = [
  'username',
  'work_email',
  'employee_id',
  'first_name',
  'last_name',
  'designation',
  'department',
  'location',
  'manager_name',
  'date_of_joining',
  'phone',
  'date_of_birth',
] as const;

export type YuktiFillableRegistrationField = (typeof YUKTI_FILLABLE_REGISTRATION_FIELDS)[number];
