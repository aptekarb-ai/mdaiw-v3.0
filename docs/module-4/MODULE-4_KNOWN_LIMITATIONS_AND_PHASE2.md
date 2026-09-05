# Module-4 — Known Limitations & Phase-2 Backlog

This document separates **A) real Phase-1 limitations** (things that exist
today and are disclosed, bounded, non-blocking) from **B) optional Phase-2
enhancements** (things deliberately out of Phase-1 scope). Nothing in either
list is a Phase-1 blocker — see `MODULE-4_PHASE-1_COMPLETION.md` for the
Definition-of-Done result.

---

## A. Real Phase-1 limitations (disclosed, bounded, non-blocking)

1. **No local LLM server is configured in this dev environment.**
   `Local AI: Not configured` in the Local AI Diagnostics panel. The
   deterministic-first architecture means this doesn't block real usage —
   every scenario exercised during acceptance testing was answered correctly
   with zero model calls — but genuinely open-ended requests that need real
   LLM judgement will get a safe deterministic decline/clarification instead
   of a smart answer until a local model endpoint is actually running.

2. **Open-ended LLM judgement quality is inherently untested here**, for the
   same reason — there is no live local model to judge. The architecture
   (capability/scope/semantic-consistency gates applied identically to LLM
   and deterministic output) is verified; the *quality* of a real local
   model's output is a separate, hardware-and-model-dependent concern for
   whoever deploys one.

3. **Multilingual conversational coverage is bounded, not open-ended.**
   English/Hindi(Devanagari)/Hinglish/Spanish/German are supported for the
   documented core vocabulary (colors/spacing, confirm/reject,
   exclusion/preservation, ordinal/target handling including "last").
   Specifically still English-only:
   - Ordinal target words beyond first/second/third/last (fourth–sixth).
   - Two rarer English-grammar-specific narrowing phrasings
     (`NOT_FIRST_THEN_RE`, `LEAVE_OUT_RE` — e.g. "not the first one, the
     second").
   - Mid-sentence "instead" as a correction marker ("do it to the other one
     instead") is not recognized as a correction trigger.

4. **A genuinely new, unrelated task typed while a proposal is still
   pending gets the existing conservative "there is a proposal waiting"
   bounce**, rather than an explicit "Apply current / Cancel and continue"
   choice UI. This was a deliberate decision during D4-E3L: building that
   choice UI would be new UI surface, not a bounded conversational-logic
   fix, and the existing bounce is safe (it never silently discards or
   applies anything).

5. **Advanced platform-specific scripting** (e.g. Salesforce AMPscript,
   HubSpot HubL) inside Code View is honestly labeled "not yet implemented"
   in the UI itself. Generic, capability-driven platform *adapters* (which
   fields/behaviors are available per platform) are complete; executable
   platform scripting is not.

6. **"Send Test" (send a live test email to a real inbox) is a disclosed,
   disabled "Coming soon" affordance** in Preview Studio. It requires real
   SMTP/rendering-service infrastructure outside this module's own scope.

7. **Browser acceptance testing covered one browser/session, one
   representative email, and the core conversational flows** — not an
   exhaustive real-device/real-email-client matrix (that's what Preview
   Studio's own Email Clients tab and eventual real Litmus/Email-on-Acid
   style integration would be for).

8. **The active-task representation (`ActiveEditTaskContext`) is
   intentionally the smallest bounded structure that supports the required
   continuation/correction/narrowing scenarios** — it is not a general,
   persistent, multi-turn task-planning system. Chaining a third "do the
   same" off an already-multi-target "do the same" result is out of its
   disclosed scope (see the D4-E3K completion report).

## B. Optional Phase-2 enhancements

- Stand up and load-test a real local LLM endpoint (Ollama/llama.cpp-class)
  for genuinely open-ended email-engineering reasoning beyond the
  deterministic rule set's coverage.
- Extend the multilingual ordinal vocabulary to fourth–sixth and to the two
  remaining English-only narrowing grammars.
- Recognize mid-sentence "instead" as a correction trigger.
- Design and build an explicit "Apply current / Cancel and continue" choice
  UI for the new-task-while-pending case, if user research shows the
  current bounce is friction rather than safety.
- Real platform-specific scripting support (AMPscript/HubL/etc.) inside
  Code View.
- Real Send-Test infrastructure (SMTP or a rendering-service integration).
- A wider, automated real-device/real-client visual regression matrix for
  Preview Studio.
- A more expressive multi-turn task representation, if a real workflow is
  found that needs to chain more than two related edits across turns.

## C. Stale in-code statements found (documented here, code untouched)

Swept `frontend/src/emailbuilder/` for `TODO`/`FIXME`/`Coming soon`/`not yet
implemented` at commit `97ddb9a`. Classification per D4-E3M's own scheme:

| Location | Statement | Classification | Disposition |
|---|---|---|---|
| `CodeEditorPanel.tsx` | "platform-specific scripting not yet implemented" | **A — still accurate** | Retained; matches Phase-2 item above |
| `ModulePanel.tsx` | empty-category "Coming soon" | **C — dead documentation** | The code path is unreachable (all 9 module categories are populated today); harmless, left as defensive fallback markup, not worth a code change for a Phase-1 documentation pass |
| `PreviewStudioPanel.tsx` | "Send Test" — "Coming soon" | **A — still accurate** | Retained; matches Phase-2 item above |
| `ValidationCenterPanel.tsx` | comment: "no AI backend exists yet in Module-4" | **B — feature now exists, comment is stale** | The comment predates Feature 14 (the AI Engineer); the real "Ask AI Engineer" handoff button beside it is complete and browser-verified working. Documented here rather than edited in code, per this pass's own rule (no code change unless documentation cannot resolve the discrepancy — it does) |
