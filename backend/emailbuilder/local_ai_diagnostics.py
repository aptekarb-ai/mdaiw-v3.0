"""D4-E0 — Local AI runtime/model diagnostics.

Read-only, best-effort, bounded-timeout health check for the optional
local/self-hosted AI provider (ai_command_local.py). Never raises, never
blocks the deterministic AI Engineer — a local runtime being down, slow,
or misconfigured degrades this module's OWN output to a safe
"unavailable" status, never an exception the caller must catch specially.

Two independent questions this module answers:
  1. Is the configured local endpoint actually reachable right now, and
     is the configured model present on it? (network reality — a bounded
     GET against the SAME OpenAI-compatible base_url ai_command_local.py
     already targets, never a second, differently-configured client.)
  2. What can we infer about that model's CAPABILITIES from its name,
     against a small, extensible, DATA-DRIVEN registry of known
     open-weight model families? (never a network probe for this part —
     a model's true tool-calling/vision/context-window behavior cannot
     be safely inferred by calling it with a real prompt as a side effect
     of a diagnostics check, and this app must never require one specific
     model to function — see MODEL_CAPABILITY_PROFILES below.)

MDAIW works with ANY OpenAI-compatible local model — this registry is a
best-effort ENRICHMENT for the diagnostics surface, never a gate. An
unrecognized model name still gets a conservative, honest 'unknown'
profile rather than blocking use; ai_command_local.py itself never reads
this module at all, so a diagnostics blind spot here can never affect
whether the AI Engineer actually works.

Never exposes the configured API key's value anywhere in this module's
output — only whether one is set (see get_local_ai_diagnostics).
"""

import logging

from django.conf import settings

logger = logging.getLogger('emailbuilder.local_ai_diagnostics')

# Bounded — this is a diagnostics check, never a request a user waits on
# for an actual AI Engineer turn (ai_command_local.py has its own,
# separate, longer EMAILBUILDER_AI_COMMAND_TIMEOUT_SECONDS for real
# inference calls).
_HEALTH_CHECK_TIMEOUT_SECONDS = 3.0
_MAX_LISTED_MODELS = 20

# --- model capability profiles ------------------------------------------
# Substring-matched (case-insensitive) against the configured model name,
# first match wins — entries are ordered from most-specific to least-
# specific so e.g. "qwen2.5-coder:7b" matches the "qwen2.5-coder" entry
# before falling through to the more generic "qwen2.5" entry. Adding a
# new model family is a pure data addition — never touches
# infer_model_capabilities()'s logic.
_UNKNOWN_MODEL_PROFILE = {
    'natural_language': True,  # every OpenAI-chat-compatible model does this by definition
    'multilingual': 'unknown',
    'coding': 'unknown',
    'tool_calling': 'unknown',
    # ai_command_local.py always REQUESTS strict json_schema structured
    # output — a server/model that cannot honor it fails the API call
    # outright (see that module's own docstring on this known,
    # disclosed limitation), which degrades to the deterministic router
    # rather than silently mismatching, so 'structured_output': True is
    # the honest default even for an unrecognized model name.
    'structured_output': True,
    'vision': 'unknown',
    'context_window': None,
}

MODEL_CAPABILITY_PROFILES = (
    ('llama3.2-vision', {'natural_language': True, 'multilingual': True, 'coding': True, 'tool_calling': True, 'structured_output': True, 'vision': True, 'context_window': 128000}),
    ('llama3.2', {'natural_language': True, 'multilingual': True, 'coding': True, 'tool_calling': True, 'structured_output': True, 'vision': False, 'context_window': 128000}),
    ('llama3.1', {'natural_language': True, 'multilingual': True, 'coding': True, 'tool_calling': True, 'structured_output': True, 'vision': False, 'context_window': 128000}),
    ('llama3', {'natural_language': True, 'multilingual': True, 'coding': True, 'tool_calling': False, 'structured_output': True, 'vision': False, 'context_window': 8192}),
    ('qwen2.5-coder', {'natural_language': True, 'multilingual': True, 'coding': True, 'tool_calling': True, 'structured_output': True, 'vision': False, 'context_window': 32768}),
    ('qwen2.5', {'natural_language': True, 'multilingual': True, 'coding': True, 'tool_calling': True, 'structured_output': True, 'vision': False, 'context_window': 32768}),
    ('qwen2-vl', {'natural_language': True, 'multilingual': True, 'coding': True, 'tool_calling': True, 'structured_output': True, 'vision': True, 'context_window': 32768}),
    ('mixtral', {'natural_language': True, 'multilingual': True, 'coding': True, 'tool_calling': True, 'structured_output': True, 'vision': False, 'context_window': 32768}),
    ('mistral', {'natural_language': True, 'multilingual': True, 'coding': True, 'tool_calling': True, 'structured_output': True, 'vision': False, 'context_window': 32768}),
    ('gemma2', {'natural_language': True, 'multilingual': True, 'coding': True, 'tool_calling': False, 'structured_output': True, 'vision': False, 'context_window': 8192}),
    ('phi4', {'natural_language': True, 'multilingual': True, 'coding': True, 'tool_calling': True, 'structured_output': True, 'vision': False, 'context_window': 16384}),
    ('phi3', {'natural_language': True, 'multilingual': True, 'coding': True, 'tool_calling': False, 'structured_output': True, 'vision': False, 'context_window': 4096}),
    ('deepseek-coder', {'natural_language': True, 'multilingual': True, 'coding': True, 'tool_calling': False, 'structured_output': True, 'vision': False, 'context_window': 16384}),
    ('deepseek', {'natural_language': True, 'multilingual': True, 'coding': True, 'tool_calling': True, 'structured_output': True, 'vision': False, 'context_window': 32768}),
    ('codellama', {'natural_language': True, 'multilingual': False, 'coding': True, 'tool_calling': False, 'structured_output': True, 'vision': False, 'context_window': 16384}),
)


def infer_model_capabilities(model_name):
    """Data-driven, substring-matched, never a network call. Returns a
    NEW dict every time (never a shared mutable reference into a profile
    tuple entry) so a caller can safely mutate its own copy."""
    if isinstance(model_name, str):
        lowered = model_name.lower()
        for needle, profile in MODEL_CAPABILITY_PROFILES:
            if needle in lowered:
                return dict(profile)
    return dict(_UNKNOWN_MODEL_PROFILE)


# --- runtime health check -------------------------------------------------

def _http_get_json(url, timeout, headers):
    """Minimal GET via `httpx` — already an installed transitive
    dependency of the `openai` SDK this app depends on, never a new
    third-party package added for this."""
    import httpx

    response = httpx.get(url, timeout=timeout, headers=headers)
    response.raise_for_status()
    return response.json()


def check_local_ai_health(base_url=None, model=None, api_key=None, timeout=None):
    """Never raises. Returns a structured status dict:

        {
          'configured': bool,
          'reachable': bool,
          'configured_model_available': bool | None,  # None = could not
              # be determined (unreachable, or the server's /models
              # response didn't list any models)
          'available_models': [str, ...],  # capped, [] if unknown/unreachable
          'error': str | None,  # a short, safe, non-leaking category —
              # never a raw exception message, stack trace, or internal
              # path/URL detail
        }

    Never includes the API key value anywhere in the return — only
    get_local_ai_diagnostics() surfaces whether one is configured, as a
    plain boolean, never here at all."""
    base_url = base_url if base_url is not None else settings.EMAILBUILDER_LOCAL_AI_BASE_URL
    model = model if model is not None else settings.EMAILBUILDER_LOCAL_AI_MODEL
    api_key = api_key if api_key is not None else settings.EMAILBUILDER_LOCAL_AI_API_KEY
    timeout = timeout if timeout is not None else _HEALTH_CHECK_TIMEOUT_SECONDS

    if not base_url:
        return {
            'configured': False, 'reachable': False, 'configured_model_available': None,
            'available_models': [], 'error': None,
        }

    headers = {'Authorization': f'Bearer {api_key}'} if api_key else {}
    models_url = base_url.rstrip('/') + '/models'
    try:
        payload = _http_get_json(models_url, timeout, headers)
    except Exception as exc:  # noqa: BLE001 - diagnostics must never raise; never leak network/internal details
        logger.info('emailbuilder.local_ai_diagnostics.health_check_failed error=%s', type(exc).__name__)
        return {
            'configured': True, 'reachable': False, 'configured_model_available': None,
            'available_models': [], 'error': 'unreachable',
        }

    available_models = []
    if isinstance(payload, dict) and isinstance(payload.get('data'), list):
        for entry in payload['data'][:_MAX_LISTED_MODELS]:
            if isinstance(entry, dict) and isinstance(entry.get('id'), str):
                available_models.append(entry['id'])

    configured_model_available = model in available_models if (model and available_models) else None

    return {
        'configured': True, 'reachable': True, 'configured_model_available': configured_model_available,
        'available_models': available_models, 'error': None,
    }


def get_local_ai_diagnostics():
    """The full diagnostics payload the admin/developer surface (D4-E0
    item 14) reads — see LocalAIDiagnosticsView (views.py). Never
    exposes the configured API key's value, only whether one is set."""
    health = check_local_ai_health()
    model = settings.EMAILBUILDER_LOCAL_AI_MODEL
    capabilities = infer_model_capabilities(model) if model else None
    return {
        'configured': health['configured'],
        'reachable': health['reachable'],
        'runtime': settings.EMAILBUILDER_LOCAL_AI_RUNTIME or None,
        'model': model or None,
        'configured_model_available': health['configured_model_available'],
        'available_models': health['available_models'],
        'api_key_configured': bool(settings.EMAILBUILDER_LOCAL_AI_API_KEY),
        'capabilities': capabilities,
        'error': health['error'],
        # Always true — the deterministic router (RuleBasedEmailCommandProvider,
        # wrapped by CanonicalIntentEmailCommandProvider) never depends on
        # this or any other optional provider being available. See
        # ai_command.py::get_default_email_command_provider()'s own docstring.
        'deterministic_fallback_ready': True,
    }
