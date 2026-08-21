"""Allow-lists shared between the intent provider and the view.

Everything here is a closed set. The view validates every provider response
against these before it is ever returned to the client — the frontend then
validates again against its own allow-list before executing anything. Two
independent gates, neither trusts the other.
"""

from django.db import models


class Intent(models.TextChoices):
    GENERAL_HELP = 'GENERAL_HELP', 'General help'
    OPEN_LOGIN = 'OPEN_LOGIN', 'Open login'
    OPEN_REGISTRATION = 'OPEN_REGISTRATION', 'Open registration'
    START_FACE_LOGIN = 'START_FACE_LOGIN', 'Start Face Recognition login'
    EXPLAIN_PASSWORD_LOGIN = 'EXPLAIN_PASSWORD_LOGIN', 'Explain password login'
    EXPLAIN_FACE_LOGIN = 'EXPLAIN_FACE_LOGIN', 'Explain Face Recognition login'
    EXPLAIN_REGISTRATION_FIELD = 'EXPLAIN_REGISTRATION_FIELD', 'Explain a registration field'
    FILL_REGISTRATION_FIELD = 'FILL_REGISTRATION_FIELD', 'Fill a registration field'
    GO_TO_REGISTRATION_STEP = 'GO_TO_REGISTRATION_STEP', 'Go to a registration step'
    NAVIGATE_MODULE = 'NAVIGATE_MODULE', 'Navigate to a module'
    READ_VALIDATION_ERRORS = 'READ_VALIDATION_ERRORS', 'Read validation errors'
    CANCEL_CURRENT_ACTION = 'CANCEL_CURRENT_ACTION', 'Cancel current action'
    UNKNOWN = 'UNKNOWN', 'Unknown'


class ActionType(models.TextChoices):
    NAVIGATE = 'NAVIGATE', 'Navigate'
    FOCUS_FIELD = 'FOCUS_FIELD', 'Focus field'
    FILL_FIELD = 'FILL_FIELD', 'Fill field'
    GO_TO_STEP = 'GO_TO_STEP', 'Go to step'
    START_FACE_LOGIN = 'START_FACE_LOGIN', 'Start Face Recognition login'
    READ_ERRORS = 'READ_ERRORS', 'Read validation errors'
    CANCEL = 'CANCEL', 'Cancel'
    OPEN_YUKTI = 'OPEN_YUKTI', 'Open Yukti'
    CLOSE_YUKTI = 'CLOSE_YUKTI', 'Close Yukti'
    # Distinct from FILL_FIELD: a lower-trust "suggestion" the AI provider
    # emits, always confirmed before it touches the form regardless of which
    # field it targets (FILL_FIELD's per-field confirmation allow-list is
    # for the deterministic router's already-vetted pattern matches).
    SUGGEST_FIELD_VALUE = 'SUGGEST_FIELD_VALUE', 'Suggest field value'


# AI-provider action-type names from the public schema (see
# yukti/ai_provider.py) that map onto an existing internal ActionType with
# identical validation/execution semantics — kept so the frontend contract
# and every existing deterministic-router test stay untouched while the AI
# provider still gets the exact schema names requested for it.
AI_ACTION_TYPE_ALIASES = {
    'OPEN_FACE_LOGIN': ActionType.START_FACE_LOGIN,
    'GO_TO_REGISTRATION_STEP': ActionType.GO_TO_STEP,
    'READ_VALIDATION_ERRORS': ActionType.READ_ERRORS,
    'CANCEL_CURRENT_ACTION': ActionType.CANCEL,
    'NONE': None,
}


# Routes Yukti is allowed to send a user to. Deliberately excludes
# /face-enrollment (requires a per-user enrollment token Yukti never has
# access to) and anything outside the app's own route table.
ALLOWED_NAVIGATION_TARGETS = frozenset(
    {
        '/login',
        '/register',
        '/face-login',
        '/dashboard',
        '/profile',
        '/settings',
        '/employees',
        '/performance',
        '/recognition',
        '/landing-pages',
        '/email-builder',
        '/personal-finance',
        '/ai-assistants',
        '/reports',
        '/administration',
    }
)

# Registration fields Yukti may focus or fill. Password fields are
# structurally absent from this set — there is no code path that can add
# them, not a filter that removes them.
FILLABLE_REGISTRATION_FIELDS = frozenset(
    {
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
    }
)

# Login-page fields Yukti may focus. Never includes "password".
FOCUSABLE_LOGIN_FIELDS = frozenset({'username'})

# Fields sensitive or error-prone enough to require explicit confirmation
# before the value is actually applied to the form.
FIELDS_REQUIRING_CONFIRMATION = frozenset(
    {'work_email', 'employee_id', 'phone', 'date_of_joining', 'date_of_birth', 'manager_name'}
)

REGISTRATION_STEPS = frozenset({1, 2, 3, 4})
