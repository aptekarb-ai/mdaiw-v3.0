"""AI-backed Yukti provider (OpenAI structured outputs).

Isolated behind the same `IntentProvider.resolve(message, context)` contract
as `RuleBasedIntentProvider` — the view never knows which provider answered.
`get_default_provider()` in `providers.py` decides whether this provider is
even instantiated at all, based on configuration; when it is not configured
(no `YUKTI_AI_PROVIDER` / no `OPENAI_API_KEY`), this module is never
imported or called, so the `openai` package being installed has zero effect
on the deterministic-only deployment path.

Security posture, by construction, not by convention:
  - The password guard runs before anything is sent anywhere — a
    password-shaped message never reaches the network call at all.
  - The prompt sent to the provider contains only `ai_knowledge.
    APPLICATION_KNOWLEDGE` (a fixed, hand-reviewed text) plus the sanitized
    context this module itself builds — never raw form state, camera
    frames, embeddings, tokens, or exceptions.
  - The provider's structured JSON response is re-validated against the
    exact same `Intent`/`ActionType` allow-lists the deterministic router's
    output goes through (see `yukti/views.py::_validate_action`) — nothing
    the model says is trusted just because it came back in the right shape.
"""

import json
import logging
import re
import time

from django.conf import settings
from django.core.cache import cache

from .ai_knowledge import APPLICATION_KNOWLEDGE
from .intents import AI_ACTION_TYPE_ALIASES, ActionType, Intent
from .providers import IntentProvider, _result

logger = logging.getLogger('yukti.ai_provider')

_ALLOWED_AI_ACTION_TYPES = [
    'NONE',
    'NAVIGATE',
    'OPEN_YUKTI',
    'CLOSE_YUKTI',
    'FOCUS_FIELD',
    'SUGGEST_FIELD_VALUE',
    'OPEN_FACE_LOGIN',
    'GO_TO_REGISTRATION_STEP',
    'READ_VALIDATION_ERRORS',
    'CANCEL_CURRENT_ACTION',
]

_RESPONSE_JSON_SCHEMA = {
    'name': 'yukti_response',
    'strict': True,
    'schema': {
        'type': 'object',
        'properties': {
            'reply': {'type': 'string', 'description': 'What Yukti says, in the language the user used.'},
            'language': {
                'type': 'string',
                'description': 'BCP-47 language tag of the reply, e.g. en-IN, hi-IN, es-ES.',
            },
            'intent': {'type': 'string', 'enum': list(Intent.values)},
            'confidence': {'type': 'number'},
            'requires_confirmation': {'type': 'boolean'},
            'action': {
                'type': ['object', 'null'],
                'properties': {
                    'type': {'type': 'string', 'enum': _ALLOWED_AI_ACTION_TYPES},
                    'target': {'type': ['string', 'null']},
                    'field': {'type': ['string', 'null']},
                    'value': {'type': ['string', 'null']},
                    'step': {'type': ['integer', 'null']},
                },
                'required': ['type', 'target', 'field', 'value', 'step'],
                'additionalProperties': False,
            },
        },
        'required': ['reply', 'language', 'intent', 'confidence', 'requires_confirmation', 'action'],
        'additionalProperties': False,
    },
}

# Matches the same way RuleBasedIntentProvider's own password guard does —
# kept independent (not imported from providers.py) so this module's
# redaction never silently drifts if the deterministic router's pattern
# changes, and vice versa. Deliberately broad: any message that even
# mentions "password" is treated as password-adjacent and never reaches the
# network call.
_PASSWORD_LIKE_PATTERN = re.compile(r'password', re.IGNORECASE)

_SAFE_PASSWORD_REPLY = (
    'For your security, please type your password directly into the password field. '
    'Do not share it with Yukti.'
)

PAGE_NAMES_BY_ROUTE = {
    '/': 'Home',
    '/login': 'Login',
    '/register': 'Registration',
    '/face-login': 'Face Recognition Login',
    '/face-enrollment': 'Face Enrollment Recovery',
    '/dashboard': 'Dashboard',
    '/profile': 'Profile',
    '/settings': 'Settings',
}


class AIProviderUnavailable(Exception):
    """Raised for any condition that should fall back to the deterministic
    router — not configured, rate-limited, timed out, or the provider call
    otherwise failed. Never carries the underlying provider exception's raw
    text outward (see `providers.py::FallbackYuktiProvider`, which logs the
    cause but never returns it to the client)."""


def is_password_like(message):
    return bool(_PASSWORD_LIKE_PATTERN.search(message or ''))


def build_safe_context(context):
    """Whitelist-only context passed to the model. Every field is validated
    by type; anything absent or the wrong type is dropped rather than
    guessed at. Never includes anything from the "never give Yukti" list
    (passwords, tokens, embeddings, frames, session/CSRF identifiers,
    exceptions, or source code) because the frontend never sends those here
    in the first place (see YuktiProvider.tsx) and this function does not
    accept freeform extra keys even if it did.
    """
    context = context if isinstance(context, dict) else {}
    route = context.get('route') if isinstance(context.get('route'), str) else None
    visible_errors = context.get('visible_error_codes')
    safe_errors = (
        [code for code in visible_errors if isinstance(code, str)][:10]
        if isinstance(visible_errors, list)
        else []
    )
    return {
        'route': route,
        'page_name': PAGE_NAMES_BY_ROUTE.get(route, 'Unknown page') if route else None,
        'registration_step': (
            context.get('registration_step') if isinstance(context.get('registration_step'), int) else None
        ),
        'authenticated': bool(context.get('authenticated')) if isinstance(context.get('authenticated'), bool) else False,
        'visible_error_codes': safe_errors,
    }


def _normalize_ai_action(raw_action):
    """Map the AI-facing action-type names (see `_ALLOWED_AI_ACTION_TYPES`)
    onto the existing internal `ActionType` values so the rest of the
    pipeline (validation, frontend contract) never has to know two
    providers exist. Drops null-valued optional fields the model was
    required to include for strict-schema compliance."""
    if not isinstance(raw_action, dict):
        return None

    raw_type = raw_action.get('type')
    if raw_type in AI_ACTION_TYPE_ALIASES:
        internal_type = AI_ACTION_TYPE_ALIASES[raw_type]
    elif raw_type in ActionType.values:
        internal_type = raw_type
    else:
        return None

    if internal_type is None:
        return None

    normalized = {'type': internal_type}
    if raw_action.get('target') is not None:
        normalized['target'] = raw_action['target']
    if raw_action.get('field') is not None:
        normalized['field'] = raw_action['field']
    if raw_action.get('value') is not None:
        normalized['value'] = raw_action['value']
    if raw_action.get('step') is not None:
        normalized['step'] = raw_action['step']
    return normalized


def _rate_limited(identifier):
    key = f'yukti-ai:{identifier}'
    try:
        count = cache.incr(key)
    except ValueError:
        cache.set(key, 1, timeout=settings.YUKTI_AI_WINDOW_SECONDS)
        count = 1
    return count > settings.YUKTI_AI_MAX_REQUESTS_PER_WINDOW


class OpenAIYuktiProvider(IntentProvider):
    """Structured-output OpenAI provider. Every call is timeout-bounded and
    rate-limited independently of the general `/api/v1/yukti/intent/`
    throttle (see yukti/views.py), so a spike in traffic degrades to the
    free deterministic router rather than the paid API."""

    def __init__(self, client_factory=None):
        # Deferred import + injectable factory: the `openai` package is
        # never imported at all unless this provider is actually
        # instantiated (see get_default_provider()), and tests can inject a
        # fake client without needing a real network call or API key.
        self._client_factory = client_factory or self._default_client_factory

    @staticmethod
    def _default_client_factory():
        from openai import OpenAI

        return OpenAI(api_key=settings.OPENAI_API_KEY, timeout=settings.YUKTI_AI_TIMEOUT_SECONDS)

    def resolve(self, message, context):
        text = (message or '').strip()
        if not text:
            raise AIProviderUnavailable('empty message')

        if is_password_like(text):
            # Never sent to the network — this mirrors
            # RuleBasedIntentProvider's own password guard so the AI path
            # can never be used to route password content externally.
            return _result(Intent.EXPLAIN_PASSWORD_LOGIN, _SAFE_PASSWORD_REPLY, confidence=0.95)

        if not settings.OPENAI_API_KEY:
            raise AIProviderUnavailable('no API key configured')

        identifier = context.get('_rate_limit_identifier', 'anonymous') if isinstance(context, dict) else 'anonymous'
        if _rate_limited(identifier):
            raise AIProviderUnavailable('rate limited')

        safe_context = build_safe_context(context)

        try:
            client = self._client_factory()
            started = time.perf_counter()
            completion = client.chat.completions.create(
                model=settings.YUKTI_AI_MODEL,
                max_completion_tokens=settings.YUKTI_AI_MAX_OUTPUT_TOKENS,
                timeout=settings.YUKTI_AI_TIMEOUT_SECONDS,
                response_format={'type': 'json_schema', 'json_schema': _RESPONSE_JSON_SCHEMA},
                messages=[
                    {'role': 'system', 'content': APPLICATION_KNOWLEDGE},
                    {
                        'role': 'system',
                        'content': (
                            'Current application context (JSON, trusted, not user input): '
                            + json.dumps(safe_context)
                        ),
                    },
                    {'role': 'user', 'content': text},
                ],
            )
            elapsed_ms = (time.perf_counter() - started) * 1000
        except Exception as exc:  # noqa: BLE001 - never leak provider/network internals to the client
            logger.warning('yukti.ai_provider.call_failed error=%s', type(exc).__name__)
            raise AIProviderUnavailable('provider call failed') from exc

        try:
            raw = json.loads(completion.choices[0].message.content)
        except (json.JSONDecodeError, IndexError, AttributeError, TypeError) as exc:
            raise AIProviderUnavailable('malformed provider response') from exc

        logger.info('yukti.ai_provider.success duration=%.1fms', elapsed_ms)

        intent = raw.get('intent')
        if intent not in Intent.values:
            intent = Intent.UNKNOWN

        language = raw.get('language')
        safe_language = language[:35] if isinstance(language, str) and language else None

        return _result(
            intent,
            str(raw.get('reply') or ''),
            confidence=float(raw.get('confidence') or 0.0),
            requires_confirmation=bool(raw.get('requires_confirmation', False)),
            action=_normalize_ai_action(raw.get('action')),
            language=safe_language,
        )
