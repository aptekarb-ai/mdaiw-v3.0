"""Intent providers.

`IntentProvider` is the interface the view depends on.
`RuleBasedIntentProvider` is the deterministic, no-external-API
implementation and the permanent fallback. `OpenAIYuktiProvider`
(yukti/ai_provider.py) is an optional second implementation behind the same
`resolve()` signature — `get_default_provider()` below is the only place
that decides which one(s) actually run, based on configuration, so the
view, the frontend contract, and the allow-list validation that wraps every
provider response never need to know which provider answered.
"""

import re

from django.conf import settings

from .intents import ActionType, FIELDS_REQUIRING_CONFIRMATION, Intent

_FIELD_PHRASES = {
    'username': 'username',
    'work email': 'work_email',
    'email': 'work_email',
    'employee id': 'employee_id',
    'employee number': 'employee_id',
    'first name': 'first_name',
    'last name': 'last_name',
    'designation': 'designation',
    'job title': 'designation',
    'department': 'department',
    'location': 'location',
    'reporting manager': 'manager_name',
    'manager': 'manager_name',
    'date of joining': 'date_of_joining',
    'joining date': 'date_of_joining',
    'phone number': 'phone',
    'phone': 'phone',
    'mobile number': 'phone',
    'date of birth': 'date_of_birth',
    'dob': 'date_of_birth',
}

# Longest phrase first, so "date of joining" matches before "joining date"
# fragments and "work email" matches before the bare "email" fallback.
_ORDERED_FIELD_PHRASES = sorted(_FIELD_PHRASES.items(), key=lambda pair: -len(pair[0]))

_FIELD_LABELS = {
    'username': 'username',
    'work_email': 'work email',
    'employee_id': 'Employee ID',
    'first_name': 'first name',
    'last_name': 'last name',
    'designation': 'designation',
    'department': 'department',
    'location': 'location',
    'manager_name': 'reporting manager',
    'date_of_joining': 'date of joining',
    'phone': 'phone number',
    'date_of_birth': 'date of birth',
}

_MODULE_ROUTES = {
    'dashboard': '/dashboard',
    'profile': '/profile',
    'settings': '/settings',
    'employees': '/employees',
    'performance': '/performance',
    'recognition': '/recognition',
    'landing pages': '/landing-pages',
    'landing page builder': '/landing-pages',
    'email builder': '/email-builder',
    'personal finance': '/personal-finance',
    'ai assistants': '/ai-assistants',
    'reports': '/reports',
    'administration': '/administration',
}

_STEP_NAMES = {
    'account details': 1,
    'account': 1,
    'employee details': 2,
    'employee': 2,
    'face enrollment': 3,
    'face': 3,
    'review': 4,
    'review and submit': 4,
}

_FILL_PATTERN = re.compile(
    r'\b(?:my|set my|update my|change my)\s+(?P<field>[a-z ]+?)\s+(?:is|to)\s+(?P<value>.+)$',
    re.IGNORECASE,
)
_STEP_PATTERN = re.compile(r'\bstep\s+(?P<step>[1-4])\b', re.IGNORECASE)

# Matches "login", "log in", or "sign in" as whole words/phrases — deliberately
# broad rather than an exact-phrase allow-list, so paraphrases like "Can you
# help me to login" or "I want to sign in" are still recognized. Checked only
# after the face-login checks above have already had a chance to claim
# face-specific phrasing (e.g. "sign in with my face", "log in with face").
_LOGIN_INTENT_PATTERN = re.compile(r'\blog\s*in\b|\bsign\s*in\b', re.IGNORECASE)


class IntentProvider:
    def resolve(self, message, context):
        raise NotImplementedError


def _clean_value(raw_value):
    return raw_value.strip().strip('.').strip('"').strip("'").strip()


def _normalize_field_value(field, value):
    if field == 'employee_id':
        return value.upper().replace(' ', '-')
    return value


def _result(intent, spoken_response, *, confidence, requires_confirmation=False, action=None, language=None):
    return {
        'intent': intent,
        'confidence': confidence,
        'requires_confirmation': requires_confirmation,
        'spoken_response': spoken_response,
        'action': action,
        'language': language,
    }


class RuleBasedIntentProvider(IntentProvider):
    def resolve(self, message, context):
        text = (message or '').strip()
        lowered = text.lower()
        route = (context or {}).get('route') or ''

        if not text:
            return _result(
                Intent.UNKNOWN,
                "I didn't catch that. You can type or say what you'd like help with.",
                confidence=0.2,
            )

        # Password guard comes before every other pattern so no downstream
        # rule can ever turn password-adjacent text into a fill/read action.
        if 'password' in lowered:
            return _result(
                Intent.EXPLAIN_PASSWORD_LOGIN,
                'For your security, please type your password manually. '
                'I can focus the password field, but I cannot read, fill, or hear it.',
                confidence=0.95,
            )

        if any(word in lowered for word in ('cancel', 'never mind', 'nevermind', 'stop that')):
            return _result(
                Intent.CANCEL_CURRENT_ACTION,
                'Cancelled.',
                confidence=0.9,
                action={'type': ActionType.CANCEL},
            )

        fill_match = _FILL_PATTERN.search(lowered)
        if fill_match:
            field_phrase = fill_match.group('field').strip()
            value_start = fill_match.start('value')
            raw_value = _clean_value(text[value_start:])
            field = None
            for phrase, candidate in _ORDERED_FIELD_PHRASES:
                if phrase == field_phrase or field_phrase.endswith(phrase):
                    field = candidate
                    break
            if field:
                value = _normalize_field_value(field, raw_value)
                requires_confirmation = field in FIELDS_REQUIRING_CONFIRMATION
                label = _FIELD_LABELS[field]
                spoken = (
                    f'I heard {value} for your {label}. Should I enter that?'
                    if requires_confirmation
                    else f'Setting your {label} to {value}.'
                )
                return _result(
                    Intent.FILL_REGISTRATION_FIELD,
                    spoken,
                    confidence=0.9,
                    requires_confirmation=requires_confirmation,
                    action={
                        'type': ActionType.FILL_FIELD,
                        'field': field,
                        'value': value,
                    },
                )

        for phrase, field in _ORDERED_FIELD_PHRASES:
            if f'what is my {phrase}' in lowered or f'explain {phrase}' in lowered:
                label = _FIELD_LABELS[field]
                return _result(
                    Intent.EXPLAIN_REGISTRATION_FIELD,
                    f'Your {label} identifies you in the workspace. You can type it or tell me the value.',
                    confidence=0.8,
                    action={'type': ActionType.FOCUS_FIELD, 'field': field},
                )

        step_match = _STEP_PATTERN.search(lowered)
        if step_match:
            step = int(step_match.group('step'))
            return _result(
                Intent.GO_TO_REGISTRATION_STEP,
                f'Moving to step {step}.',
                confidence=0.85,
                action={'type': ActionType.GO_TO_STEP, 'step': step},
            )
        for phrase, step in _STEP_NAMES.items():
            if phrase in lowered and ('go to' in lowered or 'take me' in lowered or 'show' in lowered):
                return _result(
                    Intent.GO_TO_REGISTRATION_STEP,
                    f'Moving to {phrase}.',
                    confidence=0.8,
                    action={'type': ActionType.GO_TO_STEP, 'step': step},
                )

        if any(phrase in lowered for phrase in ('sign in with my face', 'use face recognition',
                                                 'verify my face', 'face login', 'log in with face',
                                                 'start face', 'face recognition login')):
            return _result(
                Intent.START_FACE_LOGIN,
                'Opening Face Recognition sign-in. Please look at the camera when it starts.',
                confidence=0.9,
                action={'type': ActionType.START_FACE_LOGIN},
            )
        if any(phrase in lowered for phrase in ('what is face recognition', 'explain face',
                                                 'how does face', 'how do i use face')):
            return _result(
                Intent.EXPLAIN_FACE_LOGIN,
                'Face Recognition login verifies your identity with your camera after you enroll your face. '
                'It never replaces your password, which always stays available.',
                confidence=0.85,
            )

        # Explicit login intent always wins here, regardless of the current
        # route — including on /register, where a naive "help" catch-all
        # would otherwise misclassify this as registration help. This check
        # intentionally does not consult `route` at all.
        if _LOGIN_INTENT_PATTERN.search(lowered):
            return _result(
                Intent.OPEN_LOGIN,
                'Opening the sign-in page.',
                confidence=0.9,
                action={'type': ActionType.NAVIGATE, 'target': '/login'},
            )
        if any(phrase in lowered for phrase in ('open registration', 'register as a new employee',
                                                 'sign up', 'create an account', 'go to registration',
                                                 'take me to registration')):
            return _result(
                Intent.OPEN_REGISTRATION,
                'I can help you complete your employee registration.',
                confidence=0.95,
                action={'type': ActionType.NAVIGATE, 'target': '/register'},
            )

        for name, target in _MODULE_ROUTES.items():
            if name in lowered and ('open' in lowered or 'go to' in lowered or 'take me' in lowered or 'show' in lowered):
                return _result(
                    Intent.NAVIGATE_MODULE,
                    f'Opening {name.title()}.',
                    confidence=0.85,
                    action={'type': ActionType.NAVIGATE, 'target': target},
                )

        if any(phrase in lowered for phrase in ('what\'s wrong', 'whats wrong', 'read the errors',
                                                 'show errors', 'why isn\'t this working', "why isn't this working")):
            return _result(
                Intent.READ_VALIDATION_ERRORS,
                'Reading the highlighted fields on this page.',
                confidence=0.8,
                action={'type': ActionType.READ_ERRORS},
            )

        if any(phrase in lowered for phrase in ('help', 'what can you do', 'assist')):
            if route == '/register':
                spoken = ('I can help you fill registration fields, move between steps, or explain '
                           'what each field means. I never handle your password.')
            elif route in ('/login', '/face-login'):
                spoken = ('I can fill your username or open Face Recognition sign-in. '
                           'Please type your password yourself.')
            else:
                spoken = 'I can help you navigate MDAIW, sign in, or register. What would you like to do?'
            return _result(Intent.GENERAL_HELP, spoken, confidence=0.7)

        return _result(
            Intent.UNKNOWN,
            "I'm not sure how to help with that yet. You can ask me to open login, "
            'open registration, or help fill a registration field.',
            confidence=0.3,
        )


class FallbackYuktiProvider(IntentProvider):
    """Tries `primary` first; falls back to `fallback` (the deterministic
    router) whenever the primary provider signals it could not answer
    safely (not configured, rate-limited, timed out, or the call itself
    failed) — see `yukti/ai_provider.py::AIProviderUnavailable`. Never
    raises on its own: if the primary is unavailable, the deterministic
    router — which never fails to produce a safe response — always
    answers instead."""

    def __init__(self, primary, fallback):
        self.primary = primary
        self.fallback = fallback

    def resolve(self, message, context):
        from .ai_provider import AIProviderUnavailable

        try:
            return self.primary.resolve(message, context)
        except AIProviderUnavailable:
            return self.fallback.resolve(message, context)


def get_default_provider():
    """Deterministic-only unless an AI provider is both selected
    (`YUKTI_AI_PROVIDER`) and actually configured (its API key present) —
    otherwise behavior is identical to before the AI provider existed."""
    if settings.YUKTI_AI_PROVIDER == 'openai' and settings.OPENAI_API_KEY:
        from .ai_provider import OpenAIYuktiProvider

        return FallbackYuktiProvider(primary=OpenAIYuktiProvider(), fallback=RuleBasedIntentProvider())
    return RuleBasedIntentProvider()
