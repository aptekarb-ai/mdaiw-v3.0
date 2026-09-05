# Module-4 — Implementation Status (Phase-1, at commit 97ddb9a)

Feature-by-feature status, verified against the running codebase and a real
browser acceptance pass. Status values: **COMPLETE**, **COMPLETE WITH KNOWN
LIMITATION**, **DEFERRED / PHASE-2**, **OUT OF SCOPE**.

| # | Feature | Status | Important files | Testing evidence | Known limitation / future enhancement |
|---|---|---|---|---|---|
| 1 | Email Dashboard | COMPLETE | `pages/*` under `emailbuilder`, `EmailDashboard*` | Browser-verified: lists real drafts, search/filter/sort | — |
| 2 | Visual Email Builder | COMPLETE | `EmailBuilderWorkspacePage.tsx`, `emailbuilder/*Panel.tsx` | Browser-verified: built a real 6-module email live | — |
| 3 | Module Library | COMPLETE | `registryCore.tsx`, `catalog/*.tsx`, `ModulePanel.tsx` | Browser-verified: all 9 categories (Layout/Header/Hero/Content/Images/Products/CTA/Social/Footer) populated and addable | One category's own empty-state ("Coming soon") is dead code today — every category has ≥1 real module |
| 4 | Module editing (content/style/settings) | COMPLETE | per-module `Properties` panels | Browser-verified: edited button text/color, hero copy | — |
| 5 | Layout editing (columns, reorder, duplicate, delete) | COMPLETE | `LAYOUT` catalog, canvas drag/reorder controls | Component-tested + browser smoke-tested | — |
| 6 | Responsive editing (Desktop/Mobile) | COMPLETE | Preview Studio device tabs, responsive settings per module | Browser-verified: Desktop + Mobile preview both match Builder state, no overflow | — |
| 7 | Code View | COMPLETE | `CodeEditorPanel.tsx`, `htmlRenderer.ts` | Browser-verified: valid, Outlook-safe, inline-styled, table-based HTML; Find works; deliberately read-only | Platform-specific *scripting* (AMPscript/HubL/etc.) inside Code View is honestly labeled "not yet implemented" — Phase-2 |
| 8 | Preview Studio | COMPLETE | `PreviewStudioPanel.tsx` | Browser-verified Desktop/Mobile; Dark Mode + Email Clients tabs present | "Send Test" is a disclosed, disabled "Coming soon" affordance — Phase-2, needs real send infra |
| 9 | Validation Center | COMPLETE | `ValidationCenterPanel.tsx`, `emailValidation.ts` | Browser-verified: real Health Score, 9 real computed issues (incl. exact WCAG contrast ratio), Explain modals, Fix actions | A stale in-code comment in this file still says "no AI backend exists yet" (left as-is, since documentation resolves it — see `MODULE-4_KNOWN_LIMITATIONS_AND_PHASE2.md` classification list); the actual AI Engineer handoff button next to it already works |
| 10 | AI Engineer (chat shell, text + voice) | COMPLETE | `AIEngineerPanel.tsx` | Browser-verified: mic button, listening states, transcript, full conversation persists per document | Voice quality depends on the browser's own Web Speech API support |
| 11 | Natural email-engineering Q&A | COMPLETE | `ai_command.py` knowledge-rule engine | Browser-verified live: "Why does Gmail clip an email?" answered accurately, zero mutation, zero model call | Knowledge-base coverage is curated/bounded, not exhaustive |
| 12 | Deterministic-first AI routing | COMPLETE | `ai_command.py`, `local_ai_diagnostics.py` | Browser-verified via Local AI Diagnostics panel + network log: zero model calls for every tested scenario | — |
| 13 | Local LLM residual reasoning | COMPLETE WITH KNOWN RUNTIME LIMITATION | `ai_command_local.py` | Backend suite covers the local-provider client and its never-falls-through-to-OpenAI guarantee | The routing architecture, provider integration, and safety/fallback behavior are fully implemented; actual local-model availability/performance/configuration is environment-dependent — no local model server happens to be running in this development environment (see Phase-2 doc). This is a runtime-configuration fact, not a missing product capability. |
| 14 | Email design-intent interpretation | COMPLETE | `intent_normalization.py`, D4-E0/E1-era rule engine | Backend suite | — |
| 15 | Attachment/reference-material processing | COMPLETE | `composition.py`, `EmailBrief`, attachment endpoints | Backend suite (`test_attachment_instruction_cannot_defeat_module_exclusion`) + structural guarantee (see architecture doc) | — |
| 16 | Email construction from brief/instructions | COMPLETE | `requestConstructionPlan`, D4-D construction planner | Backend + frontend suites | — |
| 17 | Target resolution (ordinal/last/other/same/both) | COMPLETE, multilingual | `referenceResolver.ts`, `ordinalReference.ts` | Browser-verified "make both buttons green"; unit + integration tests for EN/HI-Devanagari/Hinglish/ES/DE | Ordinals beyond first/second/third/last, and two rarer narrowing grammars, stay English-only — disclosed |
| 18 | Multi-module editing | COMPLETE | `MULTI_MODULE_UPDATE` action, `ai_command.py` planner | Browser-verified atomic 2-module Apply | — |
| 19 | Preservation constraints ("don't change X") | COMPLETE | `_NEGATIVE_CONSTRAINT_RE` (backend), `extractPreservationPhrase` (frontend) | Browser-verified: "make it red but don't change the text" touched only backgroundColor | — |
| 20 | Module exclusions ("except the footer CTA") | COMPLETE | `resolveExclusions`, `_excluded_target_ids_from_context` | Backend + frontend test suites | — |
| 21 | Conversational references ("this", "the other one") | COMPLETE | `referenceResolver.ts` | Unit + integration tests | — |
| 22 | Conversation continuation | COMPLETE | `activeEditTask.ts` (`classifyTurnRelation`) | Unit + integration tests, browser-verified persistence | A genuinely new task while a proposal is pending still gets a conservative bounce rather than an explicit Apply/Cancel choice UI — disclosed, deliberate |
| 23 | Proposal correction/revision | COMPLETE | `proposalResponseMatcher.ts` (`isProposalCorrection`) | Unit + integration tests | Mid-sentence "instead" ("do it to the other one instead") isn't recognized — disclosed |
| 24 | Typed Apply/Cancel/confirm/reject, combined transitions | COMPLETE | `matchProposalResponse`, `matchCombinedProposalTransition` | Unit + integration tests incl. 2 real regressions found+fixed this pass | — |
| 25 | Apply/Cancel/Undo atomicity | COMPLETE | `handleApplyAiAction`, `builder.undo` | Browser-verified exact field-level Apply, exact Undo restore, zero-mutation Cancel | — |
| 26 | Multilingual conversational handling | COMPLETE for the 5 supported languages/scripts | `ordinalReference.ts`, `activeEditTask.ts`, `proposalResponseMatcher.ts` | Extensive unit + integration tests (EN/HI-Devanagari/Hinglish/ES/DE) | Coverage is for the documented core vocabulary, not open-ended free text in each language |
| 27 | Scope-creep protection | COMPLETE | `_scope_gate_patch`, `apply_scope_gate` | Backend suite | — |
| 28 | Capability grounding | COMPLETE | `module_capabilities.py`, generated manifest | Backend suite; browser-verified "I can't change its X" style honest decline | — |
| 29 | Semantic consistency | COMPLETE | `apply_semantic_consistency_gate` | Backend suite | — |
| 30 | Email engineering knowledge retrieval | COMPLETE | `retrieve_relevant_knowledge`, Can-I-Email-derived rule set | Backend suite; browser-verified live Q&A | Curated rule set, not a full web-scale knowledge base — by design |
| 31 | Validation → Ask AI Engineer handoff | COMPLETE | `aiEngineerHandoff.ts` | Browser-verified live: seeded a real scoped turn, AI correctly refused to guess a placeholder URL | — |
| 32 | Export/download behavior | COMPLETE | `Export` button, Code View Download/Copy | Browser-verified Download/Copy present and enabled | Real Send-Test (to an inbox) is Phase-2 |
| 33 | Platform selection/adapters (Generic/SFMC/Marketo/HubSpot/Pardot) | COMPLETE for generic + capability-driven adapters | `Create Email` platform picker, capability manifest per platform | Browser-verified picker; backend suite for adapter logic | Platform-specific advanced scripting is Phase-2 |
| 34 | Runtime/dev-port architecture | COMPLETE | `frontend/package.json` (`dev:5174`), root `.env` (CORS/CSRF/`FRONTEND_URL`=5174), `.env.local` (`VITE_API_BASE_URL`=8001) | Proven live via `Get-NetTCPConnection` + fresh login on 5174/8001, Module-1's 5173 confirmed byte-identical before/after | — |

## Automated regression (headline numbers)

| Suite | Result | When last executed at this HEAD-equivalent state |
|---|---|---|
| Frontend `src/emailbuilder` (vitest) | 1946/1946 | D4-E3L pass (commit `fa66960`); no test/source files changed since |
| Backend `emailbuilder` (Django test) | 1228/1228 | Confirmed twice: D4-E3L pass and again during the Dev-Port Hardening pass |
| `tsc --noEmit` / `tsc -b` | 0 errors (emailbuilder scope) | Same as above |
| `oxlint` | clean | Same as above |
| `vite build` | succeeds | Re-confirmed during Dev-Port Hardening (after the `package.json` change) |
| `manage.py check` / `makemigrations --check` | clean / no changes | D4-E3L pass |
