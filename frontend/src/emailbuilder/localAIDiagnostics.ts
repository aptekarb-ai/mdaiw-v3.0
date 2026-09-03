// D4-E0 item 14 — TypeScript mirror of backend
// local_ai_diagnostics.py::get_local_ai_diagnostics()'s shape, as
// returned by GET /api/v1/email-builder/local-ai-diagnostics/. Backend-
// authoritative: no logic here, only the response's shape. Never
// includes a secret value (the backend itself never returns one).

export type LocalAICapabilityFlag = boolean | 'unknown';

export interface LocalAICapabilities {
  natural_language: LocalAICapabilityFlag;
  multilingual: LocalAICapabilityFlag;
  coding: LocalAICapabilityFlag;
  tool_calling: LocalAICapabilityFlag;
  structured_output: LocalAICapabilityFlag;
  vision: LocalAICapabilityFlag;
  context_window: number | null;
}

// D4-E1 item 11 — in-process, session-scoped call statistics (reset on
// process restart; "current test session," not a persisted metric).
export interface LocalAISessionStats {
  total_calls: number;
  average_latency_ms: number | null;
  structured_action_attempts: number;
  structured_action_successes: number;
  structured_action_success_rate: number | null;
  validator_repair_corrections: number;
  scope_gate_corrections: number;
  deterministic_fallback_count: number;
  // D4-E2 item 10 — how many turns the deterministic router answered
  // without ever calling the optional LLM tier, vs how many genuinely
  // needed it (DeterministicFirstEmailCommandProvider).
  llm_calls_avoided_by_deterministic: number;
  llm_calls_required: number;
  // D4-E2 item 5 — residual LLM-proposed field values overridden by
  // apply_semantic_consistency_gate().
  semantic_gate_corrections: number;
}

export interface LocalAIDiagnostics {
  configured: boolean;
  reachable: boolean;
  runtime: string | null;
  model: string | null;
  configured_model_available: boolean | null;
  available_models: string[];
  api_key_configured: boolean;
  capabilities: LocalAICapabilities | null;
  error: string | null;
  deterministic_fallback_ready: boolean;
  session_stats: LocalAISessionStats;
}

export interface RequestLocalAIDiagnosticsResponse {
  success: boolean;
  diagnostics: LocalAIDiagnostics;
}
