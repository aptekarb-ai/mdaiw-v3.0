# Module-4 — AI Email Builder — Phase-1 Completion Report

**Status: Phase-1 COMPLETE.** Browser-accepted, regression-tested, pushed to
`feature/module-4-nav-completion` at commit `97ddb9a`.

This document is the authoritative, self-contained record of what Module-4
Phase-1 actually is, as verified against the running codebase — not against
the original design prompts alone. A future engineer or AI agent should be
able to pick up Module-4 work from this document plus the codebase, without
needing the chat history that produced it.

---

## 1. Executive summary

Module-4 is a generic, table-first, email-safe visual email builder with an
integrated conversational "AI Engineer" that edits the email through a
structured document model rather than free-form HTML rewriting. It ships as
one React/TypeScript SPA (shared with Module-1) talking to a Django REST
backend.

Phase-1 covers the full authoring pipeline — Dashboard → Visual Builder →
Code View → Preview → Validation → Export — plus a mature, safety-gated,
deterministic-first AI Engineer layer built up across checkpoints D4-E0
through D4-E3L and hardened once more by the Dev-Port Hardening commit.

Phase-1 is **feature-complete and browser-accepted**. Remaining gaps are
either genuinely out-of-scope advanced features (real test-send infra,
platform-specific scripting) or narrow, disclosed conversational edge cases —
see `MODULE-4_KNOWN_LIMITATIONS_AND_PHASE2.md`.

## 2. Phase-1 status

| Dimension | Status |
|---|---|
| Core visual builder (Dashboard → Create → Builder → Preview → Validate → Export) | ✅ Complete |
| AI Engineer conversational layer | ✅ Complete |
| Automated regression (frontend + backend) | ✅ Green at HEAD |
| Real browser acceptance | ✅ Passed (see §14) |
| Dev-port architecture (5174 frontend / 8001 backend, isolated from Module-1/5173) | ✅ Complete, hardened |
| Documentation | This pass (D4-E3M) |

## 3. Architecture overview

```
frontend/src/emailbuilder/        — all Module-4 UI: builder canvas, module
                                     library, property editors, Code/Preview/
                                     Validate panels, AI Engineer chat panel
frontend/src/pages/
  EmailBuilderWorkspacePage.tsx    — the workspace shell: owns document state
                                     (useEmailBuilderState), wires the AI
                                     Engineer's proposed actions to real
                                     mutators, owns Undo
backend/emailbuilder/              — Django app: EmailDocument model, REST
                                     endpoints, the deterministic + local-LLM
                                     AI command providers, validation engine,
                                     capability manifest, diagnostics
```

The UI edits a structured **Email Document Model** (EDM) — modules with
typed `props`/`settings`. A renderer (`htmlRenderer.ts`) converts that model
to email-safe, table-based, Outlook-safe HTML. The AI Engineer never
generates raw HTML directly for an edit; it proposes a bounded patch to the
EDM, which then flows through the *same* renderer as any manual edit.

## 4. Frontend / backend boundary

- **Frontend owns**: the document model, canvas rendering, module registry,
  Undo/Redo history, the conversational UI, and *all* local-only
  deterministic resolution that never needs the server (referring-expression
  resolution, module-type-aware target/exclusion resolution, proposal
  confirm/reject/narrow classification, active-task bookkeeping).
- **Backend owns**: authentication/session, document persistence, the AI
  command endpoint (`POST /api/v1/email-builder/ai-command/`), validation
  rule evaluation, capability manifest (which fields are editable per module
  type), and — only when the frontend cannot resolve a request locally — the
  deterministic-then-local-LLM command pipeline.
- Every mutation the AI Engineer ever proposes is re-validated **server-side**
  against the real capability manifest before it is returned to the client;
  the client never trusts its own guess about what a module supports.

## 5. Deterministic-first AI architecture

The command pipeline (`backend/emailbuilder/ai_command.py` and friends) tries,
in order:
1. **Deterministic rule-based extraction** — regex/pattern-based intent,
   target, ordinal, exclusion, preservation, and compound-request parsing.
   This resolves the overwhelming majority of real requests with zero model
   calls (color/spacing/alignment changes, single- and multi-target edits,
   confirmations/rejections, undo, most CTA/copy requests).
2. **Local LLM residual reasoning** (Ollama/llama.cpp-class, OpenAI-compatible
   HTTP contract) — used *only* when deterministic extraction cannot resolve
   the request at all. Every action the LLM proposes is still forced through
   the same capability/scope/semantic-consistency gates as a deterministic
   one; the LLM never gets unmediated write access to the document.
3. **Honest fallback** — if local AI is unavailable/unconfigured, the system
   answers via deterministic knowledge rules or a safe clarification; it
   never silently escalates to a paid API.

Verified live: with no local LLM configured in this dev environment, real
knowledge questions ("Why does Gmail clip an email?") and all edit requests
tested were answered correctly with **zero external model calls** — see the
Local AI Diagnostics panel (`Local AI: Not configured` / `Deterministic
fallback: Ready`).

## 6. Local-AI architecture

`ai_command_local.py` implements the local-provider client: an
OpenAI-compatible HTTP client pointed at a self-hosted endpoint via
`base_url`, using the SAME `openai` Python SDK the (unused-by-default)
OpenAI provider uses — no new dependency for local-model support. It never
falls through to the real OpenAI API when local is selected but unreachable
(a dedicated, tested guarantee — see `NeverFallsThroughToOpenAITests`).

## 7. Safety architecture

- **Capability validation**: every proposed field is checked against the
  module's real, generated capability manifest before it can be applied.
- **Scope gate**: only concepts the user actually asked about are allowed
  into a patch — unrequested fields are stripped even if the model proposed
  them.
- **Semantic consistency gate**: catches proposals that don't logically match
  the request.
- **Module exclusion / field preservation**: "except the footer CTA" and
  "don't change the copy" are enforced as first-class, testable constraints,
  distinct from each other, and never leak into an unrelated later task.
- **Attachment trust boundary**: attachment content reaches the model only as
  clearly-labeled untrusted reference text; it structurally cannot confirm,
  cancel, or redirect a proposal, change exclusions, or override the user's
  own instruction — proven both by a dedicated backend test
  (`test_attachment_instruction_cannot_defeat_module_exclusion`) and by the
  frontend's own type signatures (the confirm/reject/target/active-task
  matchers take only the user's typed `message`, with no code path from
  attachment content into them at all).
- **Never**: passwords/secrets are irrelevant here (Module-4 has none), no
  destructive action applies without an explicit Apply, Cancel always
  produces zero mutation, Undo always uses the *existing* document-history
  primitive (never a parallel undo system).

## 8. Conversation architecture

See `MODULE-4_AI_ENGINEER_ARCHITECTURE.md` for the full pipeline. In brief:
a single-slot pending-proposal model (`PendingProposal`) plus a small,
bounded `ActiveEditTaskContext` (targets, resolved fields, preservation/
exclusion phrases, staleness counter) together support continuation,
correction, narrowing, cross-turn "do the same," and combined
confirm/cancel-then-new-task commands — all deterministic, all fail-closed
on ambiguity, all expiring on Apply/Cancel/Undo/new-task/staleness.

## 9. Attachment architecture

Attachments are uploaded via a dedicated, document-scoped endpoint and only
ever consumed by the construction-planner / brief-understanding path
(`composition.py`, `EmailBrief`) as reference material — never as a channel
for conversational control. See §7 for the trust-boundary guarantee.

## 10. Target-resolution architecture

`referenceResolver.ts` (frontend) resolves "this button", "the second CTA",
"the last CTA", "both buttons", "the other one", column/section references,
and module-exclusion phrases — entirely client-side, entirely deterministic,
now multilingual (English/Hindi-Devanagari/Hinglish/Spanish/German) for
first/second/third/last via the shared `ordinalReference.ts` table. A
genuinely ambiguous reference is answered with a clarifying question
locally; the backend is never asked to guess.

## 11. Apply / Cancel / Undo architecture

- **Apply**: exactly one call into `handleApplyAiAction` (or the
  document-setting equivalent), producing exactly one history entry.
- **Cancel**: zero calls into any mutator, zero history entry.
- **Undo**: routed through the *same* `builder.undo()` the manual
  Ctrl+Z / History-tab Undo control already uses — there is no
  AI-Engineer-specific undo stack.
- Verified live in-browser this session: Apply → visible field-exact
  mutation; Undo → exact prior-state restore; Cancel → zero mutation,
  confirmed both via the chat transcript and by re-inspecting the canvas.

## 12. Validation architecture

`ValidationCenterPanel` computes a real, multi-category Health Score
(Email Settings, HTML, Outlook Compatibility, Responsive, Accessibility,
Links, Images, Dark Mode, Platform Compatibility) from the live document —
every issue traces to a real, reproducible check (e.g. an exact computed
WCAG contrast ratio), never fabricated advice. Each issue has an "Explain"
modal (why it matters / where / affected clients / can it auto-fix) and,
where applicable, a "Fix" action or a "Review N more with AI Engineer"
handoff that seeds a real, scoped conversation turn.

## 13. Runtime / dev-port architecture

| Service | Port | Notes |
|---|---|---|
| Module-1 frontend | 5173 | unaffected by any Module-4 change |
| Module-4 frontend | 5174 | `npm run dev:5174` (added in commit `97ddb9a`); `--strictPort` so a port conflict fails loudly instead of silently drifting to 5175/5176 |
| Module-4 backend | 8001 | isolated from Module-3's own default of 8000 |

See `MODULE-4_RUNTIME_GUIDE.md` for full startup instructions and the
incident history that motivated `--strictPort`.

## 14. Browser acceptance result

A full, real (non-mocked) browser acceptance pass was executed against
frontend 5174 / backend 8001 with an authenticated session. Result:
**PASSED, zero P0/P1 defects.** Covered: login, Email Dashboard, Visual
Builder (multi-module authoring), Code View (valid/Outlook-safe/inline
HTML, Find, read-only-by-design), Preview Studio (desktop + mobile),
Validation Center (real issues, Explain, AI-Engineer handoff, and a live
demonstration of the "never guess a placeholder URL" safety rule), AI
Engineer Q&A, single-module edit + Apply + Undo + Cancel, field
preservation, multi-target compound edits, atomic Apply. Console/network
were clean; zero OpenAI requests were observed. Full narrative in the prior
session's Module-4 Final Real-Browser Acceptance Report and the subsequent
Dev-Port retest.

## 15. Automated-test evidence

At the code HEAD this document describes (functionally unchanged since
commit `fa66960`; `97ddb9a` only added a dev npm script):
- Frontend `src/emailbuilder` suite: **1946/1946 passed**.
- Backend `emailbuilder` suite: **1228/1228 passed**.
- `tsc --noEmit`, `tsc -b`: zero errors in any emailbuilder file.
- `oxlint`: clean.
- `vite build`: succeeds.
- `manage.py check`: clean. `makemigrations --check --dry-run`: no changes.

See `MODULE-4_IMPLEMENTATION_STATUS.md` §"Automated regression" for the
per-checkpoint breakdown, and Phase 6 of the D4-E3M closure report for the
"previously verified" vs. "re-run this pass" distinction.

## 16. Final checkpoint chain

```
D4-E0 … D4-E3F → D4-E3G → D4-E3H → D4-E3I → D4-E3J → D4-E3K → D4-E3L
  → Module-4 Dev-Port Hardening (97ddb9a)
```

## 17. Production/readiness assessment

Module-4 Phase-1 is **production-usable for its stated scope**: a generic
email builder with a safe, deterministic-first, capability-gated
conversational assistant. Before a real production deployment, separately
consider: enabling and load-testing an actual local LLM endpoint (none is
configured in this dev environment), real Send-Test infrastructure, and a
wider real-device/real-client browser matrix — none of which are Phase-1
blockers (see `MODULE-4_KNOWN_LIMITATIONS_AND_PHASE2.md`).
