"""Optional AI-backed Email Command provider (OpenAI structured outputs).
Same shape as yukti/ai_provider.py::OpenAIYuktiProvider: isolated behind
the EmailCommandProvider.resolve(message, context) contract,
instantiated ONLY when get_default_email_command_provider() decides it's
configured — the `openai` package has zero effect on the deterministic-
only deployment path otherwise.

Security posture, by construction:
  - The model is given ONLY the current selected module's type/props
    (already filtered to the allow-listed prop keys, see views.py) and the
    document platform/width — never other modules' content, never
    request/session metadata, never anything resembling a credential.
  - The response schema constrains `action.type` to the SAME allow-list
    ai_command.py's ActionType defines, and every returned action is
    re-validated by ai_command.validate_action() before it is ever
    returned to the client — nothing the model says is trusted just
    because it came back in the right shape.
"""

import json
import logging
import time

from django.conf import settings
from django.core.cache import cache

from .ai_command import (
    MAX_GENERATED_MODULES,
    ActionType,
    CommandResult,
    EmailCommandProvider,
    EmailCommandProviderUnavailable,
)
from . import module_capabilities

logger = logging.getLogger('emailbuilder.ai_command_openai')

_SYSTEM_PROMPT = (
    'You are the AI Engineer inside an email builder. You translate one short user '
    'instruction into AT MOST ONE structured action. You never write raw HTML, CSS, or '
    'JavaScript, and you never invent image URLs — to reference an image, use the '
    '{"assetId": <id>} form from the image the user already selected, never a bare URL '
    'string. You may only propose: inserting one or more modules of a type given in the '
    'allowed module types, updating an allowed property of the currently selected module, '
    'deleting or duplicating the currently selected module, applying a style change to '
    'every module of one type, or a document-level change (enable/disable Email Reset CSS, '
    'set/enable/disable/clear Custom CSS, set the email title, set the email subject, or '
    'set/clear the favicon URL — action types SET_RESET_CSS_ENABLED, SET_CUSTOM_CSS_ENABLED, '
    'SET_CUSTOM_CSS, CLEAR_CUSTOM_CSS, SET_EMAIL_TITLE, SET_EMAIL_SUBJECT, SET_FAVICON, '
    'CLEAR_FAVICON). If the instruction is ambiguous, unsupported, or targets something '
    'other than the current selection, return action type NONE and ask a brief clarifying '
    'question in `reply`. Reply in the same language the user wrote in.'
)


def _action_schema():
    """Built lazily (not at import time) from the SAME generated module
    manifest ai_command.py's own validate_action() reads — mirrors
    ai_command_local.py::_action_schema() exactly; the two optional
    providers never maintain two different notions of "which module
    types/props exist."""
    all_types = sorted(module_capabilities.get_all_module_types())
    return {
        'name': 'email_ai_command',
        'strict': True,
        'schema': {
            'type': 'object',
            'properties': {
                'reply': {'type': 'string', 'description': 'Brief explanation or clarifying question, in the user\'s language.'},
                'confidence': {'type': 'number'},
                'action': {
                    'type': 'object',
                    'properties': {
                        'type': {'type': 'string', 'enum': list(ActionType.values)},
                        'target': {'type': ['string', 'null'], 'enum': ['selected', None]},
                        'module_type': {'type': ['string', 'null'], 'enum': all_types + [None]},
                        'modules': {
                            'type': ['array', 'null'],
                            'items': {
                                'type': 'object',
                                'properties': {
                                    'module_type': {'type': 'string', 'enum': all_types},
                                    'patch': {'type': 'object'},
                                },
                                'required': ['module_type', 'patch'],
                                'additionalProperties': False,
                            },
                            'maxItems': MAX_GENERATED_MODULES,
                        },
                        'patch': {'type': ['object', 'null']},
                        # Sub-phase 2 — document-level CSS actions.
                        'enabled': {'type': ['boolean', 'null']},
                        'css': {'type': ['string', 'null']},
                        # Sub-phase 4 — document-level title/subject/favicon.
                        # `value` carries the title or subject text;
                        # validate_action() maps it to the right key
                        # ('title'/'subject') per action type.
                        'value': {'type': ['string', 'null']},
                        'url': {'type': ['string', 'null']},
                    },
                    'required': ['type', 'target', 'module_type', 'modules', 'patch', 'enabled', 'css', 'value', 'url'],
                    'additionalProperties': False,
                },
            },
            'required': ['reply', 'confidence', 'action'],
            'additionalProperties': False,
        },
    }


def _rate_limited(identifier):
    key = f'emailbuilder-ai-command:{identifier}'
    try:
        count = cache.incr(key)
    except ValueError:
        cache.set(key, 1, timeout=settings.EMAILBUILDER_AI_COMMAND_WINDOW_SECONDS)
        count = 1
    return count > settings.EMAILBUILDER_AI_COMMAND_MAX_REQUESTS_PER_WINDOW


def _build_safe_context(context):
    """Whitelist-only context sent to the model — mirrors
    yukti/ai_provider.py::build_safe_context's shape/intent. The selected
    module's props are pre-filtered to only the keys this feature can ever
    act on, so the model never sees (or can echo back) anything outside
    the allow-list."""
    context = context if isinstance(context, dict) else {}
    selected = context.get('selected_module') if isinstance(context.get('selected_module'), dict) else None
    safe_selected = None
    if selected and selected.get('type') in module_capabilities.get_all_module_types():
        module_type = selected['type']
        raw_props = selected.get('props') if isinstance(selected.get('props'), dict) else {}
        allowed_keys = {field['key'] for field in module_capabilities.get_editable_fields(module_type)}
        safe_selected = {
            'type': module_type,
            'props': {k: v for k, v in raw_props.items() if k in allowed_keys and isinstance(v, (str, int, float))},
        }
    return {
        'selected_module': safe_selected,
        'platform': context.get('platform') if isinstance(context.get('platform'), str) else None,
        'width': context.get('width') if isinstance(context.get('width'), int) else None,
    }


class OpenAIEmailCommandProvider(EmailCommandProvider):
    """Every call is timeout-bounded and rate-limited independently of the
    view's own general throttle, so a traffic spike degrades to the free
    deterministic router rather than the paid API — same posture as
    yukti/ai_provider.py::OpenAIYuktiProvider."""

    def __init__(self, client_factory=None):
        # Deferred import + injectable factory: `openai` is never imported
        # unless this provider is actually instantiated, and tests can
        # inject a fake client without a real network call or API key.
        self._client_factory = client_factory or self._default_client_factory

    @staticmethod
    def _default_client_factory():
        from openai import OpenAI

        return OpenAI(api_key=settings.OPENAI_API_KEY, timeout=settings.EMAILBUILDER_AI_COMMAND_TIMEOUT_SECONDS)

    def resolve(self, message, context):
        text = (message or '').strip()
        if not text:
            raise EmailCommandProviderUnavailable('empty message')
        if not settings.OPENAI_API_KEY:
            raise EmailCommandProviderUnavailable('no API key configured')

        identifier = context.get('_rate_limit_identifier', 'anonymous') if isinstance(context, dict) else 'anonymous'
        if _rate_limited(identifier):
            raise EmailCommandProviderUnavailable('rate limited')

        safe_context = _build_safe_context(context)

        try:
            client = self._client_factory()
            started = time.perf_counter()
            completion = client.chat.completions.create(
                model=settings.EMAILBUILDER_AI_COMMAND_MODEL,
                max_completion_tokens=settings.EMAILBUILDER_AI_COMMAND_MAX_OUTPUT_TOKENS,
                timeout=settings.EMAILBUILDER_AI_COMMAND_TIMEOUT_SECONDS,
                response_format={'type': 'json_schema', 'json_schema': _action_schema()},
                messages=[
                    {'role': 'system', 'content': _SYSTEM_PROMPT},
                    {
                        'role': 'system',
                        'content': 'Current context (JSON, trusted, not user input): ' + json.dumps(safe_context),
                    },
                    {'role': 'user', 'content': text},
                ],
            )
            elapsed_ms = (time.perf_counter() - started) * 1000
        except Exception as exc:  # noqa: BLE001 - never leak provider/network internals to the client
            logger.warning('emailbuilder.ai_command_openai.call_failed error=%s', type(exc).__name__)
            raise EmailCommandProviderUnavailable('provider call failed') from exc

        try:
            raw = json.loads(completion.choices[0].message.content)
        except (json.JSONDecodeError, IndexError, AttributeError, TypeError) as exc:
            raise EmailCommandProviderUnavailable('malformed provider response') from exc

        logger.info('emailbuilder.ai_command_openai.success duration=%.1fms', elapsed_ms)

        raw_action = raw.get('action') if isinstance(raw.get('action'), dict) else {'type': ActionType.NONE}
        return CommandResult(
            reply=str(raw.get('reply') or ''),
            action=raw_action,
            confidence=float(raw.get('confidence') or 0.0),
            provider='openai',
        )
