import json

from django.conf import settings
from django.core.cache import cache
from django.http import JsonResponse
from django.views.decorators.http import require_POST

from .intents import (
    ActionType,
    ALLOWED_NAVIGATION_TARGETS,
    FILLABLE_REGISTRATION_FIELDS,
    FOCUSABLE_LOGIN_FIELDS,
    Intent,
    REGISTRATION_STEPS,
)
from .providers import get_default_provider

MAX_MESSAGE_LENGTH = 500

_SAFE_FALLBACK = {
    'intent': Intent.UNKNOWN,
    'confidence': 0.0,
    'requires_confirmation': False,
    'spoken_response': "I'm not sure how to help with that yet. You can ask me to open login, "
    'open registration, or help fill a registration field.',
    'action': None,
}


def _client_ip(request):
    return request.META.get('REMOTE_ADDR', '') or 'unknown'


def _rate_limited(request):
    key = f'yukti-intent:{_client_ip(request)}'
    try:
        count = cache.incr(key)
    except ValueError:
        cache.set(key, 1, timeout=settings.YUKTI_INTENT_WINDOW_SECONDS)
        count = 1
    return count > settings.YUKTI_INTENT_MAX_REQUESTS


def _validate_action(action):
    """Return a safe action dict, or None if it fails the allow-list.

    Trusts nothing about `action` beyond its shape — this runs on both the
    deterministic router's own output and the AI provider's (already
    alias-normalized, see `_normalize_ai_action`) output alike, so a
    misbehaving or compromised provider can still never produce anything
    this function wouldn't also accept from the trusted router.
    """
    if action is None:
        return None

    action_type = action.get('type')
    if action_type not in ActionType.values:
        return None

    if action_type == ActionType.NAVIGATE:
        target = action.get('target')
        if target not in ALLOWED_NAVIGATION_TARGETS:
            return None
        return {'type': action_type, 'target': target}

    if action_type in (ActionType.FILL_FIELD, ActionType.SUGGEST_FIELD_VALUE):
        field = action.get('field')
        if field not in FILLABLE_REGISTRATION_FIELDS:
            return None
        return {'type': action_type, 'field': field, 'value': action.get('value', '')}

    if action_type == ActionType.FOCUS_FIELD:
        field = action.get('field')
        if field not in FILLABLE_REGISTRATION_FIELDS and field not in FOCUSABLE_LOGIN_FIELDS:
            return None
        return {'type': action_type, 'field': field}

    if action_type == ActionType.GO_TO_STEP:
        step = action.get('step')
        if step not in REGISTRATION_STEPS:
            return None
        return {'type': action_type, 'step': step}

    if action_type in (
        ActionType.START_FACE_LOGIN,
        ActionType.READ_ERRORS,
        ActionType.CANCEL,
        ActionType.OPEN_YUKTI,
        ActionType.CLOSE_YUKTI,
    ):
        return {'type': action_type}

    return None


@require_POST
def intent_view(request):
    if _rate_limited(request):
        return JsonResponse(
            {
                'success': False,
                'code': 'RATE_LIMITED',
                'message': 'Too many requests. Please wait a moment and try again.',
            },
            status=429,
        )

    try:
        payload = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        payload = {}

    message = payload.get('message')
    context = payload.get('context') if isinstance(payload.get('context'), dict) else {}

    if not isinstance(message, str) or not message.strip():
        return JsonResponse(
            {'success': False, 'code': 'MESSAGE_REQUIRED', 'message': 'A message is required.'},
            status=400,
        )

    message = message[:MAX_MESSAGE_LENGTH]
    visible_errors = context.get('visible_error_codes')
    safe_context = {
        'route': context.get('route') if isinstance(context.get('route'), str) else None,
        'registration_step': context.get('registration_step')
        if isinstance(context.get('registration_step'), int)
        else None,
        'authenticated': bool(context.get('authenticated')) if isinstance(context.get('authenticated'), bool) else False,
        'visible_error_codes': (
            [code for code in visible_errors if isinstance(code, str)][:10]
            if isinstance(visible_errors, list)
            else []
        ),
        # Used only by the optional AI provider's own separate throttle
        # (yukti/ai_provider.py) — never logged or sent anywhere else.
        '_rate_limit_identifier': _client_ip(request),
    }

    provider = get_default_provider()
    try:
        result = provider.resolve(message, safe_context)
    except Exception:  # noqa: BLE001 - never leak provider internals to the client
        result = _SAFE_FALLBACK

    intent = result.get('intent')
    if intent not in Intent.values:
        result = _SAFE_FALLBACK
        intent = result['intent']

    validated_action = _validate_action(result.get('action'))

    return JsonResponse(
        {
            'success': True,
            'intent': intent,
            'confidence': result.get('confidence', 0.0),
            'requires_confirmation': bool(result.get('requires_confirmation', False)),
            'spoken_response': result.get('spoken_response', ''),
            'action': validated_action,
            'language': result.get('language'),
        }
    )
