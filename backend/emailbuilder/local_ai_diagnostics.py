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
profile rather than blocking use.

D4-E1 item 11 — ai_command_local.py now WRITES session-scoped call
statistics here (record_call_result/record_fallback, both best-effort,
fire-and-forget, never raising) but never reads anything back from this
module to decide whether/how to answer a turn — the write is one-way,
so a diagnostics bookkeeping bug here can never affect whether the AI
Engineer actually works.

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
        'session_stats': get_session_stats(),
    }


# --- D4-E1 item 11 — session-scoped call statistics -----------------------
# A one-way WRITE dependency from ai_command_local.py into this module
# (record_call_result(), called fire-and-forget after every real request)
# — this module still never reads anything back to influence whether the
# AI Engineer works (see this file's own module docstring): a stats-
# recording failure here is caught and ignored by the caller, never
# raised, never blocks a turn. Plain in-process counters, reset on
# process restart — "current test session," not a persisted metric;
# no database write, no new model, matching this checkpoint's explicit
# "extend the existing diagnostics" instruction rather than building a
# new persistence layer for what is fundamentally live operational
# telemetry, not a durable record.
_session_stats = {
    'total_calls': 0,
    'total_latency_ms': 0.0,
    'structured_action_attempts': 0,
    'structured_action_successes': 0,
    'validator_repair_corrections': 0,
    'scope_gate_corrections': 0,
    'deterministic_fallback_count': 0,
    # D4-E2 item 10 — how many turns the deterministic router answered
    # WITHOUT ever calling the optional LLM tier (DeterministicFirstEmailCommandProvider
    # short-circuiting on a non-NO_MATCH deterministic result), vs how many
    # genuinely needed it. Together these are the direct evidence for
    # "deterministic-first materially reduces latency/LLM usage."
    'llm_calls_avoided_by_deterministic': 0,
    'llm_calls_required': 0,
    # D4-E2 item 5 — how many residual LLM-routed actions had a field
    # value overridden by apply_semantic_consistency_gate().
    'semantic_gate_corrections': 0,
    # D4-E2 Local-LLM Reachability + Performance Hardening item 7 — the
    # local LLM tier's three MUTUALLY EXCLUSIVE outcomes per attempted
    # call, tracked distinctly (see EmailCommandProviderTimeout's own
    # docstring for why timeout is its own category, not folded into
    # deterministic_fallback_count, which stays as the pre-existing
    # "the local provider degraded to deterministic for ANY reason"
    # signal). max_llm_latency_ms is only ever updated by a SUCCESSFUL
    # completion (a timed-out call has no real "latency" to report — it
    # ran into the configured ceiling, not a natural completion time).
    'llm_successful_completions': 0,
    'llm_timeouts': 0,
    'llm_failures': 0,
    'max_llm_latency_ms': 0.0,
    # D4-E3 item 5 — how many responses (deterministic explain-branch OR
    # LLM-tier knowledge injection) were grounded in at least one curated
    # KnowledgeRule, vs how many were not. Proves the imported open-source
    # email-engineering skills are actually being RETRIEVED and USED
    # during real conversations, not merely sitting in the registry
    # unused — see rules.py/retrieval.py.
    'knowledge_grounded_responses': 0,
}

# Kept OUTSIDE _session_stats (list, not a number) so
# reset_session_stats_for_tests()'s generic int/float reset loop below
# stays simple — reset explicitly alongside it instead. Bounded — this is
# a diagnostics/testability surface, never meant to reconstruct a full
# conversation transcript.
_MAX_RECENT_KNOWLEDGE_RULE_IDS = 20
_recent_knowledge_rule_ids = []


def record_call_result(*, latency_ms, proposed_action_type, validated_successfully, repaired, scope_gated):
    """Called once per completed (non-raising) LocalEmailCommandProvider.resolve()
    call. Best-effort — never raises; a bookkeeping bug here must never
    break a real AI Engineer turn."""
    try:
        _session_stats['total_calls'] += 1
        _session_stats['total_latency_ms'] += float(latency_ms or 0)
        if proposed_action_type and proposed_action_type != 'NONE':
            _session_stats['structured_action_attempts'] += 1
            if validated_successfully:
                _session_stats['structured_action_successes'] += 1
        if repaired:
            _session_stats['validator_repair_corrections'] += 1
        if scope_gated:
            _session_stats['scope_gate_corrections'] += 1
    except Exception:  # noqa: BLE001 - diagnostics bookkeeping must never break a real turn
        logger.info('emailbuilder.local_ai_diagnostics.record_call_result_failed')


def record_fallback():
    """Called once whenever LocalEmailCommandProvider.resolve() is about
    to raise EmailCommandProviderUnavailable (i.e. every real trigger of
    the deterministic fallback for the local path) — see
    ai_command_local.py's own call sites."""
    try:
        _session_stats['deterministic_fallback_count'] += 1
    except Exception:  # noqa: BLE001
        logger.info('emailbuilder.local_ai_diagnostics.record_fallback_failed')


def record_llm_call_avoided():
    """Called once per turn where DeterministicFirstEmailCommandProvider's
    first (deterministic) attempt already produced a non-NO_MATCH result,
    so the optional LLM tier was never invoked at all. Best-effort —
    never raises."""
    try:
        _session_stats['llm_calls_avoided_by_deterministic'] += 1
    except Exception:  # noqa: BLE001
        logger.info('emailbuilder.local_ai_diagnostics.record_llm_call_avoided_failed')


def record_llm_call_required():
    """Called once per turn where the deterministic attempt genuinely
    NO_MATCHed and the LLM tier was actually consulted. Best-effort —
    never raises."""
    try:
        _session_stats['llm_calls_required'] += 1
    except Exception:  # noqa: BLE001
        logger.info('emailbuilder.local_ai_diagnostics.record_llm_call_required_failed')


def record_semantic_gate_corrections(count):
    """Called with the number of fields apply_semantic_consistency_gate()
    overrode on a single LLM-proposed action. Best-effort — never raises."""
    try:
        _session_stats['semantic_gate_corrections'] += int(count or 0)
    except Exception:  # noqa: BLE001
        logger.info('emailbuilder.local_ai_diagnostics.record_semantic_gate_corrections_failed')


def record_llm_success(*, latency_ms):
    """Called once per LocalEmailCommandProvider.resolve() call that
    reaches a real, non-raising completion (a genuine LLM answer was
    obtained — independent of whether the PROPOSED ACTION itself later
    validated; see record_call_result for that finer-grained split).
    Best-effort — never raises."""
    try:
        _session_stats['llm_successful_completions'] += 1
        _session_stats['max_llm_latency_ms'] = max(_session_stats['max_llm_latency_ms'], float(latency_ms or 0))
    except Exception:  # noqa: BLE001
        logger.info('emailbuilder.local_ai_diagnostics.record_llm_success_failed')


def record_llm_timeout():
    """Called once whenever a local-model call raises EmailCommandProviderTimeout
    specifically (see that exception's own docstring) — tracked separately
    from every other failure reason. Best-effort — never raises."""
    try:
        _session_stats['llm_timeouts'] += 1
    except Exception:  # noqa: BLE001
        logger.info('emailbuilder.local_ai_diagnostics.record_llm_timeout_failed')


def record_llm_failure():
    """Called once for any local-model call failure that is NOT a timeout
    (connection refused, malformed response, provider construction
    failure, etc.) — see ai_command_local.py's own call sites. Best-effort
    — never raises."""
    try:
        _session_stats['llm_failures'] += 1
    except Exception:  # noqa: BLE001
        logger.info('emailbuilder.local_ai_diagnostics.record_llm_failure_failed')


def record_knowledge_rules_used(rule_ids):
    """D4-E3 item 5 — called whenever a response (deterministic explain-
    branch OR LLM-tier `knowledge` context injection) was grounded in one
    or more real KnowledgeRule ids. `rule_ids` is a small list of strings
    (rule.id values — never a title/description, never user text) —
    stored bounded/rotating so this stays a live diagnostics/testability
    signal, never an unbounded log. Best-effort — never raises."""
    try:
        ids = [str(r) for r in rule_ids if r]
        if not ids:
            return
        _session_stats['knowledge_grounded_responses'] += 1
        _recent_knowledge_rule_ids.extend(ids)
        del _recent_knowledge_rule_ids[:-_MAX_RECENT_KNOWLEDGE_RULE_IDS]
    except Exception:  # noqa: BLE001
        logger.info('emailbuilder.local_ai_diagnostics.record_knowledge_rules_used_failed')


def get_session_stats():
    total_calls = _session_stats['total_calls']
    attempts = _session_stats['structured_action_attempts']
    return {
        'total_calls': total_calls,
        'average_latency_ms': round(_session_stats['total_latency_ms'] / total_calls, 1) if total_calls else None,
        'structured_action_attempts': attempts,
        'structured_action_successes': _session_stats['structured_action_successes'],
        'structured_action_success_rate': (
            round(_session_stats['structured_action_successes'] / attempts, 3) if attempts else None
        ),
        'validator_repair_corrections': _session_stats['validator_repair_corrections'],
        'scope_gate_corrections': _session_stats['scope_gate_corrections'],
        'deterministic_fallback_count': _session_stats['deterministic_fallback_count'],
        'llm_calls_avoided_by_deterministic': _session_stats['llm_calls_avoided_by_deterministic'],
        'llm_calls_required': _session_stats['llm_calls_required'],
        'semantic_gate_corrections': _session_stats['semantic_gate_corrections'],
        'llm_successful_completions': _session_stats['llm_successful_completions'],
        'llm_timeouts': _session_stats['llm_timeouts'],
        'llm_failures': _session_stats['llm_failures'],
        'max_llm_latency_ms': _session_stats['max_llm_latency_ms'] or None,
        'knowledge_grounded_responses': _session_stats['knowledge_grounded_responses'],
        'recent_knowledge_rule_ids': list(_recent_knowledge_rule_ids),
    }


def reset_session_stats_for_tests():
    """Test-only escape hatch — mirrors module_capabilities.py's own
    reset_cache_for_tests() convention. Never called from application
    code."""
    for key in _session_stats:
        _session_stats[key] = 0 if isinstance(_session_stats[key], int) else 0.0
    _recent_knowledge_rule_ids.clear()
