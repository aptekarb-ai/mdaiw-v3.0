// D4-D — local, zero-network gate deciding whether a chat message is a
// "build/compose a whole email" request that should route to the new
// construction-plan endpoint (requestConstructionPlan) rather than the
// ordinary ai-command endpoint. Deliberately mirrors backend
// composition.py's own compose-verb + "email" gate (interpret_brief's
// `_COMPOSE_VERB_PATTERN`/`_EMAIL_WORD_PATTERN`) — independently
// implemented client-side (no cross-language import is possible), kept
// intentionally as small and boring as the backend's own gate so the two
// never drift into meaningfully different behavior. This is a single
// boolean check, not a second matching engine — the real, deterministic
// section-by-section matching happens entirely server-side in
// construction_planner.py.
const COMPOSE_VERB_PATTERN = /\b(create|build|generate|make|compose|draft)\b/i;
const EMAIL_WORD_PATTERN = /\bemail\b/i;

export function matchConstructionIntent(message: string): boolean {
  if (!message.trim()) return false;
  return COMPOSE_VERB_PATTERN.test(message) && EMAIL_WORD_PATTERN.test(message);
}
