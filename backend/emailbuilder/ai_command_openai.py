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
    MAX_COMPOSITION_CHILDREN_PER_COLUMN,
    MAX_COMPOSITION_ITEMS,
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
    'every module of one type, a document-level change (enable/disable Email Reset CSS, '
    'set/enable/disable/clear Custom CSS, set the email title, set the email subject, or '
    'set/clear the favicon URL — action types SET_RESET_CSS_ENABLED, SET_CUSTOM_CSS_ENABLED, '
    'SET_CUSTOM_CSS, CLEAR_CUSTOM_CSS, SET_EMAIL_TITLE, SET_EMAIL_SUBJECT, SET_FAVICON, '
    'CLEAR_FAVICON), or a full email COMPOSITION when the user describes an entire email to '
    'create (action type COMPOSE_EMAIL, with an ordered `items` array — each item an allowed '
    'module type plus a `patch` of allowed properties for that type; a LAYOUT module type may '
    'additionally carry `children`, one group per column index, each group\'s `modules` a list '
    'of the SAME item shape but never itself a layout type — one level of nesting only; a '
    'module with a repeatable list may additionally carry `repeatable_items`, an array of '
    'objects using that module\'s own item fields). Never invent a brand name, price, date, or '
    'claim not present in the user\'s own instruction — short generic scaffolding text (e.g. '
    '"Shop Now", "Learn More") is fine, but do not fabricate specific facts. If the '
    'instruction is ambiguous, unsupported, or targets something other than the current '
    'selection, return action type NONE and ask a brief clarifying question in `reply`. Reply '
    'in the same language the user wrote in. The context JSON may include editor_mode (which '
    'tab the user is on), selected_column (which column is focused — informational only, you '
    'cannot yet target a column directly, only the currently selected module), and '
    'selected_validation_issue (a specific compatibility/accessibility issue the user was just '
    'looking at), and import_reconstruction (present only when this conversation exists to review '
    'an imported HTML email\'s reconstruction into this builder — a bounded summary of the '
    'detected source regions and the reconstruction fidelity report; never the raw imported HTML, '
    'and never a request to invent content not present in that summary). Prior turns of this SAME '
    'conversation may be included as ordinary user/'
    'assistant messages before the current one — use them to resolve a follow-up like "make it '
    'darker" or "can you fix it" against what was just discussed, but never assume anything '
    'about a different conversation or document. '
    'Three specific validation issues need extra care. (1) "VML is not processed by New '
    'Outlook": VML only renders in Classic Outlook — never claim it will make New Outlook, '
    'Gmail, Apple Mail, or any other client show VML content; if the selected module already '
    'has a real HTML/CSS fallback alongside its VML (this app\'s renderer always generates '
    'one), say so and explain that no code change is needed, rather than proposing one anyway. '
    '(2) "Weak text contrast": compute a real WCAG AA-compliant replacement (contrast ratio at '
    'least 4.5:1 for normal text) from the exact foreground/background colors given in context '
    '— prefer the smallest change, adjusting only the text color unless that alone cannot reach '
    'the ratio, and state the old color, the proposed color, the old ratio, and the resulting '
    'ratio in your reply before proposing the action. (3) "Placeholder link" (href="#"): never '
    'invent a destination URL just to clear the warning, the same rule as image URLs above — if '
    'the user, an earlier turn of this conversation, or the document\'s own brief already gives '
    'a real destination, propose it and ask for confirmation; otherwise return action type NONE '
    'and ask the user for the destination URL, leaving the issue unresolved until they answer.'
)


def _action_schema():
    """Built lazily (not at import time) from the SAME generated module
    manifest ai_command.py's own validate_action() reads — mirrors
    ai_command_local.py::_action_schema() exactly; the two optional
    providers never maintain two different notions of "which module
    types/props exist."""
    all_types = sorted(module_capabilities.get_all_module_types())
    flat_module_entry = {
        'type': 'object',
        'properties': {
            'module_type': {'type': 'string', 'enum': all_types},
            'patch': {'type': 'object'},
        },
        'required': ['module_type', 'patch'],
        'additionalProperties': False,
    }
    # Sub-phase 7 — see ai_command_local.py::_action_schema's identical
    # composition_item shape docstring; the two optional providers never
    # maintain two different notions of "what a composition item looks
    # like" any more than they do for the flat module-insert shape above.
    composition_item = {
        'type': 'object',
        'properties': {
            'module_type': {'type': 'string', 'enum': all_types},
            'patch': {'type': 'object'},
            'children': {
                'type': ['array', 'null'],
                'items': {
                    'type': 'object',
                    'properties': {
                        'column_index': {'type': 'integer'},
                        'modules': {'type': 'array', 'items': flat_module_entry, 'maxItems': MAX_COMPOSITION_CHILDREN_PER_COLUMN},
                    },
                    'required': ['column_index', 'modules'],
                    'additionalProperties': False,
                },
            },
            'repeatable_items': {'type': ['array', 'null'], 'items': {'type': 'object'}},
        },
        'required': ['module_type', 'patch', 'children', 'repeatable_items'],
        'additionalProperties': False,
    }
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
                            'items': flat_module_entry,
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
                        # Sub-phase 7 — COMPOSE_EMAIL's ordered plan.
                        'items': {
                            'type': ['array', 'null'],
                            'items': composition_item,
                            'maxItems': MAX_COMPOSITION_ITEMS,
                        },
                    },
                    'required': [
                        'type', 'target', 'module_type', 'modules', 'patch', 'enabled', 'css', 'value', 'url', 'items',
                    ],
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


_EDITOR_MODES = {'visual', 'code', 'preview', 'validate', 'ai'}
# Module-4 E10 — mirrors serializers.py's MAX_CONVERSATION_HISTORY_TURNS;
# the request is already bounded there, this is the same defense-in-depth
# posture applied again at the point of use.
_MAX_HISTORY_TURNS = 8


def _build_safe_context(context):
    """Whitelist-only context sent to the model — mirrors
    yukti/ai_provider.py::build_safe_context's shape/intent. The selected
    module's props are pre-filtered to only the keys this feature can ever
    act on, so the model never sees (or can echo back) anything outside
    the allow-list. Module-4 E9/E10 — editor_mode/selected_column/
    selected_validation_issue/conversation_history are the same additive,
    already-bounded-and-validated (serializers.py) fields; this function
    re-checks their shape defensively rather than trusting the caller."""
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

    editor_mode = context.get('editor_mode')
    safe_editor_mode = editor_mode if editor_mode in _EDITOR_MODES else None

    column = context.get('selected_column') if isinstance(context.get('selected_column'), dict) else None
    safe_column = None
    if column and column.get('layout_module_type') in module_capabilities.get_all_module_types() \
            and isinstance(column.get('column_index'), int):
        safe_column = {'layout_module_type': column['layout_module_type'], 'column_index': column['column_index']}

    issue = context.get('selected_validation_issue') if isinstance(context.get('selected_validation_issue'), dict) else None
    safe_issue = None
    if issue and isinstance(issue.get('id'), str) and isinstance(issue.get('title'), str) and isinstance(issue.get('detail'), str):
        safe_issue = {
            'id': issue['id'][:200], 'title': issue['title'][:200], 'detail': issue['detail'][:1000],
            'severity': issue.get('severity') if issue.get('severity') in ('error', 'warning') else None,
            'category': issue.get('category') if isinstance(issue.get('category'), str) else None,
        }

    raw_history = context.get('conversation_history')
    safe_history = []
    if isinstance(raw_history, list):
        for turn in raw_history[-_MAX_HISTORY_TURNS:]:
            if isinstance(turn, dict) and turn.get('role') in ('user', 'assistant') and isinstance(turn.get('content'), str):
                safe_history.append({'role': turn['role'], 'content': turn['content'][:1000]})

    return {
        'selected_module': safe_selected,
        'platform': context.get('platform') if isinstance(context.get('platform'), str) else None,
        'width': context.get('width') if isinstance(context.get('width'), int) else None,
        'editor_mode': safe_editor_mode,
        'selected_column': safe_column,
        'selected_validation_issue': safe_issue,
        'import_reconstruction': _build_safe_import_reconstruction(context.get('import_reconstruction')),
    }, safe_history


# R4-A (Import HTML AI Reconstruction) — same defensive-re-check posture
# as every other _build_safe_context branch above: the serializer
# (serializers.py::ImportReconstructionContextSerializer) already bounds
# this on the way in, but this function never trusts the caller's shape
# either. Caps are re-applied here too (never assume the caller's own
# cap held) — MAX_REGIONS/MAX_SAMPLE_FINDINGS mirror
# importReconstructionContext.ts's own constants, kept in sync manually.
_MAX_IMPORT_REGIONS = 20
_MAX_IMPORT_SAMPLE_FINDINGS = 3
_IMPORT_FIDELITY_CATEGORY_IDS = ('structure', 'content', 'typography', 'spacing', 'images', 'links', 'responsive', 'outlook')
_IMPORT_FIDELITY_STATUSES = ('preserved', 'normalized', 'approximated', 'removed', 'unsupported')


def _build_safe_import_finding(raw):
    if not isinstance(raw, dict):
        return None
    if not all(isinstance(raw.get(key), str) for key in ('category', 'source', 'location', 'reason')):
        return None
    return {
        'category': raw['category'][:60], 'source': raw['source'][:200],
        'location': raw['location'][:100], 'reason': raw['reason'][:500],
    }


def _build_safe_import_reconstruction(raw):
    if not isinstance(raw, dict):
        return None

    regions = []
    raw_regions = raw.get('regions')
    if isinstance(raw_regions, list):
        for region in raw_regions[:_MAX_IMPORT_REGIONS]:
            if not isinstance(region, dict) or not isinstance(region.get('role'), str):
                continue
            regions.append({
                'role': region['role'][:40],
                'confidence': region.get('confidence') if isinstance(region.get('confidence'), (int, float)) else None,
                'source_position': region.get('source_position')[:100] if isinstance(region.get('source_position'), str) else None,
                'content_preview': region.get('content_preview')[:200] if isinstance(region.get('content_preview'), str) else None,
                'column_ratio': region.get('column_ratio') if isinstance(region.get('column_ratio'), list) else None,
                'has_image': bool(region.get('has_image')),
                'has_links': bool(region.get('has_links')),
                'background_color': region.get('background_color')[:20] if isinstance(region.get('background_color'), str) else None,
                'align': region.get('align')[:10] if isinstance(region.get('align'), str) else None,
            })

    categories = []
    raw_categories = raw.get('fidelity_categories')
    if isinstance(raw_categories, list):
        for category in raw_categories:
            if not isinstance(category, dict):
                continue
            if category.get('id') not in _IMPORT_FIDELITY_CATEGORY_IDS or category.get('status') not in _IMPORT_FIDELITY_STATUSES:
                continue
            if not isinstance(category.get('summary'), str):
                continue
            sample_findings = category.get('sample_findings')
            safe_findings = []
            if isinstance(sample_findings, list):
                safe_findings = [f for f in (_build_safe_import_finding(x) for x in sample_findings[:_MAX_IMPORT_SAMPLE_FINDINGS]) if f]
            categories.append({
                'id': category['id'], 'status': category['status'], 'summary': category['summary'][:300],
                'finding_count': category.get('finding_count') if isinstance(category.get('finding_count'), int) else len(safe_findings),
                'sample_findings': safe_findings,
            })

    return {
        'document_width': raw.get('document_width') if isinstance(raw.get('document_width'), int) else None,
        'module_count': raw.get('module_count') if isinstance(raw.get('module_count'), int) else None,
        'region_count': raw.get('region_count') if isinstance(raw.get('region_count'), int) else None,
        'regions': regions,
        'fidelity_categories': categories,
        'has_mso_conditional_content': bool(raw.get('has_mso_conditional_content')),
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

        safe_context, safe_history = _build_safe_context(context)

        # Module-4 E10 — real multi-turn: the bounded prior turns of THIS
        # SAME document's conversation are replayed as genuine user/
        # assistant messages (not summarized into the context blob), so
        # the model can resolve a follow-up like "make it darker" against
        # what it itself said/proposed a turn ago. Still capped at
        # _MAX_HISTORY_TURNS — never the full, unbounded conversation.
        history_messages = [{'role': turn['role'], 'content': turn['content']} for turn in safe_history]

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
                    *history_messages,
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
