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
}

export interface RequestLocalAIDiagnosticsResponse {
  success: boolean;
  diagnostics: LocalAIDiagnostics;
}
