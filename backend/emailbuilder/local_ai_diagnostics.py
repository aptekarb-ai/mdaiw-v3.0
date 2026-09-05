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
    # D4-E3I §3/§14 — how many turns the model actually spent a
    # GET_DOCUMENT_SUMMARY tool call on AND received a real, non-empty
    # document_summary back (a call made while no document_summary was
    # ever supplied by the frontend does not count — see
    # record_document_summary_tool_call()'s own docstring). Proves the
    # new bounded document-context bridge is genuinely being used for
    # holistic questions, not merely wired and idle. Audited against
    # D4-E3I §14's own 9-candidate counter list: 8 of the 9 already have
    # a direct, non-duplicate existing equivalent here —
    # attachment_grounded_plans -> attachment_grounded_responses,
    # professional_knowledge_recommendations -> knowledge_grounded_
    # responses, clarification_requests -> clarifications,
    # unsupported_recommendations -> user_requested_unsupported_
    # operations, deterministic_full_email_plans ->
    # deterministic_cross_module_plans, local_ai_design_reasoning_calls ->
    # llm_calls_required/llm_successful_completions, design_intent_
    # resolutions and preservation_constraints_enforced are prompt/gate-
    # internal behaviors with no discrete "event" to count without
    # inventing an artificial one — this is the one genuinely new,
    # non-duplicate signal this checkpoint's own new mechanism warrants.
    'document_summary_tool_calls': 0,
    # D4-E3G §17 — real runtime evidence for the cross-module planning
    # feature, never vanity metrics: how many turns actually produced a
    # validated MULTI_MODULE_UPDATE plan at all, how many of those were
    # resolved WITHOUT an LLM call (deterministic per-target color/align
    # resolution), how many needed the LLM tier, how many individual
    # operations survived validate_action()'s MULTI_MODULE_UPDATE branch
    # vs. how many were dropped (scope-creep/invalid-target/unsupported-
    # field), and how many turns arrived with resolved_targets present
    # (the frontend found 2+ real cross-module targets) but the backend
    # still could not build ANY valid operation from them.
    'cross_module_plans': 0,
    'deterministic_cross_module_plans': 0,
    'llm_assisted_cross_module_plans': 0,
    'plan_operations_generated': 0,
    'plan_operations_rejected': 0,
    # D4-E3J §3/§17 — one real module was genuinely kept out of a
    # MULTI_MODULE_UPDATE plan this turn because of an explicit
    # preservation/exclusion instruction ("leave the footer alone", "all
    # CTAs except the footer one") — counts BOTH the deterministic
    # subtraction path (CanonicalIntentEmailCommandProvider, before any
    # operation is even built) and the LLM-tier defense-in-depth strip
    # (_strip_excluded_operations, after the model proposed one anyway).
    # Audited against D4-E3J §17's own candidate list: target_resolution_
    # successes/target_confidence_unique have no discrete event to count
    # without inventing one (target confidence today is a ROUTING
    # decision, not a recordable outcome — see the D4-E3J report's own
    # Phase 17 section); module_exclusion_clarifications ->
    # `clarifications` (existing, D4-E3H) already covers "asked instead of
    # guessing" generically; preserved_modules is this SAME signal under a
    # different candidate name. This is the one genuinely new, non-
    # duplicate counter this checkpoint's own new mechanism warrants.
    'module_exclusions_enforced': 0,
    'unresolved_target_references': 0,
    # D4-E3G hardening §16 — a DIFFERENT signal from `plan_operations_
    # rejected` above (which counts fields validate_action()/apply_scope_
    # gate() silently and SAFELY stripped because the user never asked for
    # them — model scope creep). This counts the opposite failure
    # direction: a concept the user DID explicitly ask for, on a real
    # resolved target, that this application's capability manifest simply
    # cannot represent (e.g. "make the hero heading smaller" — no hero
    # module type has a font-size field) — see
    # _command_result_from_multi_module_plan's own docstring for why this
    # is always surfaced as a clarification, never a silent drop.
    'user_requested_unsupported_operations': 0,
    # D4-E3G hardening §16 — the model-scope-creep-specific half of
    # `plan_operations_rejected`: fields apply_scope_gate() stripped from
    # an LLM-proposed MULTI_MODULE_UPDATE operation because the user's own
    # message never asked for them, tracked separately from
    # user_requested_unsupported_operations so the two very different
    # failure directions (deterministic planner: "you asked for something
    # unsupported" vs. LLM tier: "the model tried to change something you
    # never asked for") are never conflated in diagnostics.
    'scope_creep_operations_stripped': 0,
    # D4-E3H §20 — new counters. Several of the checkpoint's requested
    # names already exist under a different, established name in this
    # file (deterministic_resolutions -> llm_calls_avoided_by_deterministic,
    # llm_required -> llm_calls_required, llm_success ->
    # llm_successful_completions, llm_timeout -> llm_timeouts, llm_failure
    # -> llm_failures, unsupported_requests ->
    # user_requested_unsupported_operations, knowledge_grounded_responses/
    # cross_module_plans already exist verbatim) — reused as-is, never
    # duplicated under a second name (see the D4-E3H final report's own
    # explicit mapping table). llm_first_token_latency_ms is NOT added:
    # this provider uses non-streaming completions.create() calls (see
    # ai_command_local.py's own resolve()), so only a single, total
    # latency is ever genuinely measurable — a first-token figure would
    # have to be fabricated, which this app never does for diagnostics.
    'conversation_turns': 0,
    'repair_attempts': 0,
    'repair_successes': 0,
    'clarifications': 0,
    'contextual_reference_resolutions': 0,
    'attachment_grounded_responses': 0,
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


def record_cross_module_plan(*, operation_count, rejected_count, llm_assisted):
    """D4-E3G §17 — called once per turn where validate_action() returned
    a real (non-empty-operations) MULTI_MODULE_UPDATE action — see
    views.py's own call site, the ONE place that has both the raw
    provider result and the post-validate_action() result available.
    `operation_count` is how many operations survived; `rejected_count`
    is how many the raw proposal had beyond that (0 for a clean proposal
    — never negative, never inferred). `llm_assisted` is False only when
    result.provider == 'deterministic' AND the plan was produced without
    ever calling the LLM tier for this turn. Best-effort — never raises."""
    try:
        _session_stats['cross_module_plans'] += 1
        if llm_assisted:
            _session_stats['llm_assisted_cross_module_plans'] += 1
        else:
            _session_stats['deterministic_cross_module_plans'] += 1
        _session_stats['plan_operations_generated'] += int(operation_count or 0)
        _session_stats['plan_operations_rejected'] += int(rejected_count or 0)
    except Exception:  # noqa: BLE001
        logger.info('emailbuilder.local_ai_diagnostics.record_cross_module_plan_failed')


def record_unresolved_target_references():
    """D4-E3G §17 — called once per turn where the request arrived with
    resolved_targets present (the frontend already found 2+ real
    cross-module targets) but the backend still could not build ANY
    valid MULTI_MODULE_UPDATE operation from them (every candidate
    dropped by validate_action(), or neither provider tier proposed one
    at all) — the direct evidence for how often cross-module resolution
    reaches the backend but produces nothing actionable. Best-effort —
    never raises."""
    try:
        _session_stats['unresolved_target_references'] += 1
    except Exception:  # noqa: BLE001
        logger.info('emailbuilder.local_ai_diagnostics.record_unresolved_target_references_failed')


def record_user_requested_unsupported_operations(count):
    """D4-E3G hardening §16 — called with the number of USER-REQUESTED
    concepts a resolved target's own capability manifest could not
    represent at all (never fields the user didn't ask for — that's
    record_scope_creep_stripped below). Best-effort — never raises."""
    try:
        _session_stats['user_requested_unsupported_operations'] += int(count or 0)
    except Exception:  # noqa: BLE001
        logger.info('emailbuilder.local_ai_diagnostics.record_user_requested_unsupported_operations_failed')


def record_scope_creep_stripped(count):
    """D4-E3G hardening §16 — called with the number of fields
    apply_scope_gate() stripped from an LLM-proposed MULTI_MODULE_UPDATE
    operation (never a deterministically-built one — those cannot contain
    scope creep by construction, see build_deterministic_multi_module_
    plan's own docstring). Best-effort — never raises."""
    try:
        _session_stats['scope_creep_operations_stripped'] += int(count or 0)
    except Exception:  # noqa: BLE001
        logger.info('emailbuilder.local_ai_diagnostics.record_scope_creep_stripped_failed')


def record_module_exclusion_enforced(count):
    """D4-E3J §3/§17 — called with the number of real modules kept out of
    (or removed from) a MULTI_MODULE_UPDATE plan this turn because of an
    explicit preservation/exclusion instruction — from either the
    deterministic subtraction path or the LLM-tier defense-in-depth strip
    (see _strip_excluded_operations's own docstring for why both paths
    feed this ONE counter rather than two). Best-effort — never raises."""
    try:
        _session_stats['module_exclusions_enforced'] += int(count or 0)
    except Exception:  # noqa: BLE001
        logger.info('emailbuilder.local_ai_diagnostics.record_module_exclusion_enforced_failed')


def record_conversation_turn():
    """D4-E3H §20 — called exactly once per AI Engineer request, at the
    ONE choke point every request passes through regardless of which
    provider ultimately answers it (see views.py::EmailAICommandView.post's
    own call site) — the denominator every other per-turn counter in this
    module is implicitly a fraction of. Best-effort — never raises."""
    try:
        _session_stats['conversation_turns'] += 1
    except Exception:  # noqa: BLE001
        logger.info('emailbuilder.local_ai_diagnostics.record_conversation_turn_failed')


def record_repair_attempt():
    """D4-E3H §20 — called once per EXTRA repair-loop round the local/
    OpenAI provider actually executes beyond the first completion (i.e.
    once per repair round, not once per turn) — see
    _MAX_REPAIR_ATTEMPTS's own docstring for the bound. Best-effort —
    never raises."""
    try:
        _session_stats['repair_attempts'] += 1
    except Exception:  # noqa: BLE001
        logger.info('emailbuilder.local_ai_diagnostics.record_repair_attempt_failed')


def record_repair_success():
    """D4-E3H §20 — called once when a repair round actually RECOVERED a
    schema-valid action after at least one earlier failed attempt (never
    called for a first-attempt success, which is not a repair at all).
    Best-effort — never raises."""
    try:
        _session_stats['repair_successes'] += 1
    except Exception:  # noqa: BLE001
        logger.info('emailbuilder.local_ai_diagnostics.record_repair_success_failed')


def record_clarification():
    """D4-E3H §20 — called once whenever the LLM tier's FINAL action for
    a turn is NONE (a real clarifying question, honest decline, or pure
    answer with nothing to mutate) — the direct evidence for "does the
    residual reasoning tier actually know when NOT to guess." Best-effort
    — never raises."""
    try:
        _session_stats['clarifications'] += 1
    except Exception:  # noqa: BLE001
        logger.info('emailbuilder.local_ai_diagnostics.record_clarification_failed')


def record_contextual_reference_resolution():
    """D4-E3H §20/§4 — called once when the frontend's own reference
    resolver (referenceResolver.ts's resolveReference/resolveMultipleReferences)
    already resolved an anaphoric/follow-up reference ("it", "the other
    one", "do the same") for this turn — see serializers.py's
    `reference_resolved` field, set by AIEngineerPanel.tsx only when its
    own resolvedModuleOverrideRef/multi-target resolution actually fired.
    Best-effort — never raises."""
    try:
        _session_stats['contextual_reference_resolutions'] += 1
    except Exception:  # noqa: BLE001
        logger.info('emailbuilder.local_ai_diagnostics.record_contextual_reference_resolution_failed')


def record_attachment_grounded_response():
    """D4-E3H §20/§16 — called once when the LLM tier was actually
    consulted WITH import_reconstruction/attachment-derived context
    present in safe_context — the direct evidence the already-extracted,
    provenance-aware EmailBrief/reconstruction facts are genuinely being
    used at runtime, not just wired but unused. Best-effort — never
    raises."""
    try:
        _session_stats['attachment_grounded_responses'] += 1
    except Exception:  # noqa: BLE001
        logger.info('emailbuilder.local_ai_diagnostics.record_attachment_grounded_response_failed')


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


def record_document_summary_tool_call(document_summary):
    """D4-E3I §3/§14 — called at the GET_DOCUMENT_SUMMARY tool-call site
    with whatever execute_tool_call() was actually given (possibly None,
    when the frontend never supplied one this turn). Only counts a REAL,
    grounded use — an empty/None summary means the model asked but there
    was nothing real to ground on, which is not the signal this counter
    is for — an email with zero modules is still a real, grounded answer,
    so presence of the dict is what's checked, never truthiness of its
    (possibly legitimately empty) module_types list. Best-effort — never
    raises."""
    try:
        if not isinstance(document_summary, dict) or 'module_types' not in document_summary:
            return
        _session_stats['document_summary_tool_calls'] += 1
    except Exception:  # noqa: BLE001
        logger.info('emailbuilder.local_ai_diagnostics.record_document_summary_tool_call_failed')


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
        # D4-E3H §20 — exposes the SAME internal total_latency_ms
        # already tracked (average_latency_ms above already divides by
        # total_calls) — never a second, parallel latency-tracking
        # mechanism, just the raw sum surfaced directly.
        'llm_total_latency_ms': round(_session_stats['total_latency_ms'], 1) if _session_stats['total_latency_ms'] else None,
        'knowledge_grounded_responses': _session_stats['knowledge_grounded_responses'],
        'document_summary_tool_calls': _session_stats['document_summary_tool_calls'],
        'recent_knowledge_rule_ids': list(_recent_knowledge_rule_ids),
        'cross_module_plans': _session_stats['cross_module_plans'],
        'deterministic_cross_module_plans': _session_stats['deterministic_cross_module_plans'],
        'llm_assisted_cross_module_plans': _session_stats['llm_assisted_cross_module_plans'],
        'plan_operations_generated': _session_stats['plan_operations_generated'],
        'plan_operations_rejected': _session_stats['plan_operations_rejected'],
        'module_exclusions_enforced': _session_stats['module_exclusions_enforced'],
        'unresolved_target_references': _session_stats['unresolved_target_references'],
        'user_requested_unsupported_operations': _session_stats['user_requested_unsupported_operations'],
        'scope_creep_operations_stripped': _session_stats['scope_creep_operations_stripped'],
        'conversation_turns': _session_stats['conversation_turns'],
        'repair_attempts': _session_stats['repair_attempts'],
        'repair_successes': _session_stats['repair_successes'],
        'clarifications': _session_stats['clarifications'],
        'contextual_reference_resolutions': _session_stats['contextual_reference_resolutions'],
        'attachment_grounded_responses': _session_stats['attachment_grounded_responses'],
    }


def reset_session_stats_for_tests():
    """Test-only escape hatch — mirrors module_capabilities.py's own
    reset_cache_for_tests() convention. Never called from application
    code."""
    for key in _session_stats:
        _session_stats[key] = 0 if isinstance(_session_stats[key], int) else 0.0
    _recent_knowledge_rule_ids.clear()
