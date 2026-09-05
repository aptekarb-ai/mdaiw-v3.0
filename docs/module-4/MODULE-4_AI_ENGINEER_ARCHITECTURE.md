# Module-4 — AI Engineer Architecture (Final, Phase-1)

This is the authoritative description of how a user message becomes (or
doesn't become) a document mutation. It reflects the actual code at commit
`97ddb9a`, not the original design prompts alone.

## Pipeline

```
user message (typed or voice-transcribed)
  │
  ▼
1. Local-only pre-checks (frontend, zero network)
   - undo-family phrase?              → matchUndoIntent (document history undo)
   - a proposal is already pending?   → confirm / reject / narrow / combined-
                                          transition / correction / continuation
                                          classification (see "Active task" below)
   - a document-level intent (diagnose/explain/repair)? → answered locally
   - a reconstruction-repair intent (import flow)?       → answered locally
   - a construction/"build me an email" intent?          → routed to the
                                                             construction planner
  │  (none of the above matched — ordinary command path)
  ▼
2. Deterministic intent/reference resolution (frontend, zero network)
   - referring expression? ("this button", "the second CTA", "the last CTA",
     "the other one", "it") → referenceResolver.ts, now multilingual for
     first/second/third/last (EN/HI-Devanagari/Hinglish/ES/DE)
   - module-level exclusion? ("except the footer CTA") → resolveExclusions
   - copy-source request? ("same padding as the previous section") →
     resolveCopySourceRequest
   - cross-module compound request (2+ distinct real targets)? →
     resolveMultipleReferences
   - genuinely ambiguous at any of these steps → answered with a clarifying
     question, LOCALLY, zero backend call
  │
  ▼
3. Request sent to backend: POST /api/v1/email-builder/ai-command/
   carrying: message, selected_module, resolved_targets, excluded_targets,
   copy_source, bounded conversation_history, document_summary (types only)
  │
  ▼
4. Backend deterministic action planning (ai_command.py)
   - CanonicalIntentEmailCommandProvider: non-English canonical-intent
     shortcuts (color/spacing/alignment) execute directly
   - RuleBasedEmailCommandProvider: the main deterministic extractor —
     single-target UPDATE_MODULE_PROPS/BATCH_UPDATE, or
     build_deterministic_multi_module_plan for 2+ resolved_targets
     (including within-message "do the same" propagation via
     _SAME_TRIGGER_RE, and cross-turn "do the same" via the propagated_patch
     wire field)
   - preservation clauses (_NEGATIVE_CONSTRAINT_RE) and exclusions strip
     concepts/targets from the candidate patch BEFORE it is ever built
  │  (deterministic extraction produced nothing usable)
  ▼
5. Local LLM residual reasoning (ai_command_local.py) — ONLY if step 4
   produced no match. An OpenAI-compatible client pointed at a self-hosted
   endpoint via base_url. Never falls through to the real OpenAI API when
   local is selected but unreachable (dedicated, tested guarantee).
  │
  ▼
6. Capability validation (module_capabilities.py)
   Every field in the candidate patch must exist in that module type's real,
   generated capability manifest. Unsupported fields are dropped, never
   silently reinterpreted as a different supported field.
  │
  ▼
7. Scope gate (apply_scope_gate / _scope_gate_patch)
   Only concepts the user's own message (or the resolved compound segment)
   actually named survive — an unrequested field the model "helpfully"
   added is stripped.
  │
  ▼
8. Semantic consistency gate
   Catches a proposal that doesn't logically match what was asked.
  │
  ▼
9. validate_action() — final structural/type validation of the action shape
  │
  ▼
10. Proposal returned to the frontend (never applied yet)
    Natural-language reply + a structured action + requires_(strong_)confirmation
  │
  ▼
11. Frontend renders the proposal card; establishes/updates the
    ActiveEditTaskContext from whatever real target(s)/field(s) the action
    actually named
  │
  ▼
12. Apply / Cancel / Undo (see below) — the ONLY point at which the
    document is ever actually mutated
```

## Active task / conversational-continuity handling

`activeEditTask.ts` holds the smallest bounded structure needed for a short
sequence of turns about ONE task:

```ts
{ targetIds, moduleType, resolvedFields, preservationPhrase, exclusionPhrase,
  excludedTargetIds, turnsSinceEstablished }
```

- **Not** general conversation memory. Never stores raw chat history.
- Established/updated only when a real proposal is created; cleared on
  Apply, Cancel, a real Undo, a classified `new_task` turn, or staleness.
- `classifyTurnRelation()` fails closed: anything not matching a narrow,
  closed continuation vocabulary is `new_task`, and a `new_task` never
  inherits prior targets, exclusions, or preservation.
- Preservation/exclusion continuity works by **text re-injection**: the
  establishing turn's own clause (canonicalized to English via
  `extractPreservationPhrase` so it works regardless of source language) is
  re-appended to a continuation turn's outgoing text, letting the *existing*
  backend preservation parser and the *existing* frontend exclusion resolver
  re-derive the same constraint fresh — never a second, duplicated parser.
- Cross-turn "do the same" reuses the backend's own existing
  `_SAME_TRIGGER_RE`/`previous_resolved` propagation machinery, seeded via a
  new, minimal, capability-validated wire field (`propagated_patch`) rather
  than a new mutation pathway.

## Selected-target handling

The live canvas selection always wins when present. When nothing is
selected, an unambiguous referring expression resolved in step 2 fills in;
a genuinely ambiguous one is asked about instead of guessed. This precedence
is enforced in exactly one place (`AIEngineerPanel.tsx`'s target-context
construction) — never duplicated.

## Cross-module targeting

A single message naming 2+ distinct real targets ("make the hero heading
smaller and the CTA green", "make both buttons green") resolves to a
`resolved_targets` list and a `MULTI_MODULE_UPDATE` action — applied through
the exact same batch-commit primitive `BATCH_UPDATE` already uses, so it is
still exactly one history/Undo entry.

## Proposal corrections and narrowing

- **Correction** ("actually make it blue"): an explicit marker discards the
  pending proposal and re-runs the *same* resolution pipeline on the new
  text — never a second mutation-extraction engine.
- **Additive continuation** ("increase the padding too"): the old pending
  proposal's own original command text is prepended to the new turn's text,
  and the combined text is handed to the same pipeline — the backend's own
  compound-sentence extractor produces the merged result.
- **Narrowing** ("actually only change the first one", "leave the footer
  one out"): purely subtractive, local, zero backend call — filters the
  pending `MULTI_MODULE_UPDATE`'s own already-validated operations by
  ordinal/label match. Never invents or re-derives a value.
- **Combined transitions** ("cancel that and make the footer black", "apply
  that, then change the second CTA to red"): resolves the current proposal
  through the *existing* Apply/Cancel handlers, then lets the remainder fall
  through the same ordinary pipeline — never a new auto-apply/auto-cancel
  path of its own.

## Attachment trust boundary

Attachment content reaches the model only as clearly-labeled untrusted
reference text via the construction/brief-understanding path. It cannot
reach the confirm/reject/target/active-task matchers at all — those take
only the user's own typed `message: string`, a structural (type-level)
guarantee, not just a runtime one. A dedicated backend test proves that even
if a model were to obey injected instruction text inside attachment content,
`_strip_excluded_operations` removes the resulting operation unconditionally.

## Knowledge retrieval

`retrieve_relevant_knowledge` answers real email-engineering questions from a
curated, bounded rule set (seeded from Can-I-Email-derived compatibility
data plus hand-authored rules) — deterministic, zero model calls, verified
live ("Why does Gmail clip an email?").

## Diagnostics

`local_ai_diagnostics.py` exposes ~20 dedicated counters (call latency/
success/timeout/failure, fallback usage, scope-creep stripped, module
exclusion enforced, clarifications, contextual reference resolutions,
attachment-grounded responses, knowledge rules used, cross-module plans,
unresolved target references, semantic-gate corrections, repair
attempts/successes, conversation turns, document-summary tool calls). No new
counters were added for the conversational-continuity work in D4-E3K/L —
every event that reaches the backend already had an equivalent; purely
local frontend state transitions (confirm/reject/narrow/continuation) have
nothing to instrument server-side by design (they never call the backend).

## Zero-OpenAI expectation for the current deployment

This dev environment has no `OPENAI_API_KEY` configured and no local LLM
endpoint running. Verified end-to-end via a real browser session: every
tested scenario (Q&A, single/multi-target edits, corrections, undo,
preservation, exclusion) was served with **zero external model requests** —
confirmed via the browser's own network log and the Local AI Diagnostics
panel (`Local AI: Not configured`, `Deterministic fallback: Ready`). The
OpenAI provider code path (`ai_command_openai.py`) exists for structural
parity but is not the active provider and was not exercised.
