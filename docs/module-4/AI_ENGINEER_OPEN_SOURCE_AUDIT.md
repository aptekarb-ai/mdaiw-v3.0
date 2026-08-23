# Email AI Engineer — Open-Source Ecosystem Audit

**Module:** Module-4 (AI Email Builder) — Feature 14 V2 ("Email AI Engineer")
**Purpose:** Determine what, if anything, from the open-source email-engineering and local/self-hosted-AI ecosystem should be adopted, adapted, used as structured reference data, used only as architectural inspiration, or rejected, before Phase B (Email Knowledge + Validation) begins.
**Status:** Research complete. No code copied, no dependency added yet. This document is the basis for Phase B's knowledge-rule authoring and Phase F's local-provider integration.

---

## Executive summary

| # | Project | License | Recommendation |
|---|---|---|---|
| 1 | Can I Email | MIT | **ADAPT** — primary seed data source for the knowledge engine |
| 2 | email-bugs (hteumeuleu) | unconfirmed | **REFERENCE** only |
| 3 | "Emailens" | — | not a real project — **N/A** |
| 4 | Cerberus | MIT | **REFERENCE** (layout patterns) |
| 5 | MJML | MIT | **REFERENCE** — primary architectural blueprint for VML/ghost-table generation; **not** adopted as a dependency |
| 6 | Maizzle | MIT | **REFERENCE** only |
| 7 | React Email | MIT | **REJECT** as dependency (wrong rendering paradigm for us) |
| 8 | Maily (arikchakma/maily.to) | MIT | **REFERENCE** (editor UX ideas only) |
| 9 | GrapesJS preset-newsletter | BSD-3-Clause | **REJECT** (we have our own builder; plugin is stale) |
| 10 | Juice | MIT | **REJECT** (wrong runtime — Node, we're Python) |
| 11 | Premailer (Python) | BSD-3-Clause | **CONDITIONAL/DEFER** — right language/license, revisit only if CSS-inlining becomes a real need |
| 12 | Ollama | MIT | **ADOPT** as an integration *target* (not embedded) |
| 13 | llama.cpp | MIT | **ADOPT** as an integration *target* (not embedded) |
| 14 | LM Studio | proprietary | out of audit scope (not OSS); still usable as a target endpoint via our generic OpenAI-compatible client |
| 15 | Haystack | Apache-2.0 | **REJECT** as dependency (heavy `transformers`/`sentence-transformers`); reference only |
| 16 | LlamaIndex | MIT | **REJECT** as dependency (same heavy-RAG-stack profile); reference only |
| 17 | Mem0 | Apache-2.0 | **REJECT** as dependency (telemetry-by-default, heavy transitive deps); **REFERENCE** concepts only — validates our own three-tier memory design |
| 18 | LangGraph | MIT | **REFERENCE** only (our pipeline is linear, not graph-shaped, today) |
| 19 | Classic/New Outlook compat DB | — | nothing credible found — **N/A**, rely on #1 |
| 20 | VML utility library | — | nothing credible/licensed found — **N/A**, rely on #5 as reference |
| 21 | email-comb | MIT | **REFERENCE** (narrow dead-CSS tool, not core) |
| 22 | Email-specific WCAG ruleset | none / W3C license | **REJECT** the unlicensed repo; **REFERENCE** W3C WCAG success-criteria text directly |
| 23 | Email engineering agent skills | MIT (both found) | **ADAPT** `skill-email-html-mjml` as seed checklist content; **REFERENCE** `resend-skills` (different knowledge dimension — deliverability, not rendering) |

**Net effect on Phase B**: one adaptation source for compatibility data (Can I Email), one reference blueprint for VML/ghost-table generation logic (MJML), one adaptation source for an initial rule checklist (the MJML-flavored Claude Skill), zero new runtime/ML dependencies. Local-provider integration (Phase F) targets Ollama/llama.cpp/LM-Studio-class servers via the existing OpenAI-compatible HTTP contract with zero new Python dependencies (the `openai` SDK we already depend on supports arbitrary `base_url`).

---

## 1. Can I Email

- **Repo**: github.com/hteumeuleu/caniemail · **License**: MIT · **Status**: active (936 stars, 1,511+ commits), maintained by Rémi Parmentier
- **What it is**: the data behind caniemail.com — a Jekyll site whose per-feature CSS/HTML support matrix lives as structured YAML under `_features/`, covering per-client support rows including Outlook (Windows/Word engine) as a distinct row from Outlook.com/modern web Outlook.
- **Capability useful to us**: the single most valuable structured compatibility dataset available anywhere in this audit — exactly the shape of fact ("does client X support CSS property Y") our `KnowledgeRule.detection`/`affectedClients` fields need.
- **Dependency vs data vs architecture**: **data** — we would parse/transform selected YAML entries into our own `KnowledgeRule` records, not import the Jekyll site or any code.
- **Security implications**: none (static data, transformed at authoring time, never executed).
- **Bundle/runtime implications**: negligible — we cherry-pick and re-encode a bounded subset relevant to our 8(+) validation categories, not the whole dataset.
- **Commercial-use implications**: MIT permits commercial use, modification, and redistribution; requires retaining the copyright/license notice for the portions adapted.
- **Recommendation**: **ADAPT**. This becomes Phase B's primary seed source. Attribution notice required (see Legal Notes below).

## 2. email-bugs (hteumeuleu)

- **Repo**: github.com/hteumeuleu/email-bugs · **License**: **no LICENSE file found in this specific repo** (the author uses MIT on sibling projects, but that doesn't extend here without confirmation) · **Status**: active-ish (574 stars, 112 GitHub Issues)
- **What it is**: a curated list of email-client rendering bugs, each documented as a prose GitHub Issue thread — not structured/machine-ingestible data.
- **Capability useful to us**: valuable for a human (me, when authoring Phase B rules) to read and understand real documented bugs; not programmatically consumable.
- **Dependency vs data vs architecture**: reference reading material only.
- **Security/bundle implications**: none — nothing is imported.
- **Commercial-use implications**: license unconfirmed — do not copy substantial text verbatim into our repo; may cite the issue URL as an evidence/reference link in our own independently-written rule.
- **Recommendation**: **REFERENCE** only.

## 3. "Emailens"

No real, maintained open-source project by this name was found. **N/A** — nothing to adopt, adapt, or reject.

## 4. Cerberus (TedGoas)

- **Repo**: github.com/TedGoas/Cerberus (also mirrored at emailmonday/Cerberus) · **License**: MIT · **Status**: long-standing, still referenced/active in the community
- **What it is**: three canonical responsive-email template patterns (fluid, responsive, hybrid).
- **Capability useful to us**: informs our own hybrid/fluid-layout and ghost-table generation approach; a well-known, battle-tested reference shape.
- **Dependency vs data vs architecture**: architecture reference only — we generate markup through our own module registry/renderer, not by vendoring these templates.
- **Recommendation**: **REFERENCE**.

## 5. MJML

- **Repo**: github.com/mjmlio/mjml · **License**: MIT · **Status**: active, Mailjet-backed
- **What it is**: a markup-language-to-HTML email compiler. Its compiler emits fluid `width="100%"` tables for modern clients plus **fixed-width ghost tables wrapped in MSO conditional comments** (`<!--[if mso]>...<![endif]-->`) for Outlook, and compiles buttons to **VML** (also MSO-conditional-wrapped) so Outlook 2007–365 renders real rounded, clickable buttons instead of a plain link.
- **Capability useful to us**: this is the **primary architectural blueprint** for exactly the VML/ghost-table generation gap identified in the Gap Analysis (our renderer today emits zero VML). Its compiler's *approach* — not its code — is what our deterministic VML/ghost-table builder functions (Phase C, §6 of the approved plan) should follow.
- **Dependency vs data vs architecture**: **architecture reference**, explicitly **not adopted as a runtime dependency**. MJML compiles *its own* markup language to HTML; adopting it would mean running two parallel rendering pipelines (MJML's and our module-registry renderer's) for no benefit, since we already own the module data model MJML doesn't know about. Because MJML is MIT-licensed, short, isolated markup patterns (e.g. the exact shape of a VML button snippet) may be **adapted with attribution** if directly useful during Phase C authoring — but this is pattern-level inspiration, not a code dependency.
- **Security/bundle implications**: none if not adopted as a dependency (which we're not doing).
- **Recommendation**: **REFERENCE** (primary blueprint), with narrow attributed **ADAPT** of specific markup patterns permitted during Phase C at the point of use.

## 6. Maizzle

- **Repo**: github.com/maizzle/framework, maizzle.com · **License**: MIT · **Status**: active (Stack Overflow's own email system, `TedGoas/stacks-maizzle`, is built on it)
- **What it is**: a Tailwind-CSS-based email build framework.
- **Capability useful to us**: general "how to structure an email build pipeline" ideas; the Tailwind-CSS paradigm doesn't match our architecture (we don't use Tailwind, we have a props/registry-driven renderer).
- **Recommendation**: **REFERENCE** only.

## 7. React Email

- **Repo**: github.com/resend/react-email · **License**: MIT · **Status**: very active (~17k stars, v5.0 shipped Nov 2025, Resend-backed)
- **What it is**: React-component-to-email-HTML compiler.
- **Capability useful to us**: irrelevant as a dependency — we don't render through a React-to-email compiler; our EDM/registry renderer is the equivalent system and stays authoritative.
- **Recommendation**: **REJECT** as dependency. Component-API ergonomics could be a distant reference for DX, not worth calling out further.

## 8. Maily (arikchakma/maily.to)

- **Repo**: github.com/arikchakma/maily.to · **License**: MIT · **Status**: active (~3,900 stars, commits within weeks) — disambiguated from an unrelated email-*client* app of the same name (`Enough-Software/maily`), which was not investigated further as it's irrelevant.
- **What it is**: an open, component-based email editor.
- **Capability useful to us**: UX ideas for our own visual module-editing panel; not a rendering/compatibility resource.
- **Recommendation**: **REFERENCE** only.

## 9. GrapesJS preset-newsletter

- **Repo**: github.com/GrapesJS/preset-newsletter · **License**: BSD-3-Clause · **Status**: low direct activity (latest npm release ~3 years old; some 2025 issue activity); core GrapesJS itself is active.
- **Capability useful to us**: none directly — we already have our own visual builder (Features 01–13), and this plugin is stale.
- **Recommendation**: **REJECT**.

## 10. Juice

- **Repo**: github.com/Automattic/juice · **License**: MIT (confirmed via LICENSE.md) · **Status**: maintained
- **What it is**: a Node.js CSS inliner.
- **Capability useful to us**: potentially relevant if we ever need a CSS-inlining pass (e.g. for platform export or dark-mode transforms) — but it's Node.js, and our backend is Python/Django. Integrating it would require a Node subprocess or microservice, a real architectural cost for a capability we don't currently need (our renderer already emits inline styles directly at module-render time, not via a separate stylesheet+inlining pass).
- **Recommendation**: **REJECT** as a direct dependency (wrong runtime for our backend). Algorithm ideas remain referenceable if we ever build our own inliner.

## 11. Premailer (Python)

- **PyPI**: `premailer` (peterbe/premailer) · **License**: BSD-3-Clause · **Status**: ~1k stars, but **no PyPI release in the past 12 months** — works, but not freshly maintained.
- **Capability useful to us**: the correct-language, correct-license option if CSS inlining becomes a genuine need later (unlike Juice, this runs natively in our Django backend).
- **Recommendation**: **CONDITIONAL / DEFER**. Not added in Phase A–C since none of the approved phases currently require a CSS-inlining pass. If a real need emerges (e.g. a future dark-mode or platform-export transform that requires it), re-evaluate then, and budget for the possibility of needing to patch/fork given its low recent-maintenance signal.

## 12. Ollama

- **Repo**: github.com/ollama/ollama · **License**: MIT · **Status**: extremely active (179k stars, commits within days)
- **Confirmed**: exposes an OpenAI-compatible `/v1/chat/completions` endpoint at `localhost:11434/v1/` by default.
- **Capability useful to us**: a ready, well-known local-inference target for our optional local provider (Phase F). We do not embed or redistribute Ollama — it's software the *user* installs and runs themselves; our code only speaks HTTP to it.
- **Caveat**: an HN discussion surfaced historical licensing/attribution friction between Ollama and llama.cpp (which Ollama's engine derives from). This doesn't affect us since we neither embed nor redistribute either project — noted for completeness only.
- **Recommendation**: **ADOPT** as a supported/tested integration target (zero embedding, zero new dependency — our existing `openai` Python SDK dependency already supports arbitrary `base_url`).

## 13. llama.cpp

- **Repo**: github.com/ggml-org/llama.cpp · **License**: MIT · **Status**: very active (~118k stars)
- **Confirmed**: `llama-server` ships a built-in OpenAI-compatible server (`/v1/completions`, `/v1/chat/completions`, `/v1/embedding`).
- **Recommendation**: **ADOPT** as an integration target, identically to Ollama — from our side, both are indistinguishable generic OpenAI-compatible HTTP endpoints, so supporting one means supporting both (and LM Studio, and any other compatible server) with zero extra code.

## 14. LM Studio

- **Status**: **proprietary** — the desktop app and its `llmster` daemon are closed-source (the underlying inference engines it wraps, llama.cpp and MLX, are open source, but LM Studio itself is not).
- **Recommendation**: out of scope for an *open-source* adoption decision — not rejected as unusable, just not an OSS artifact to evaluate here. It remains a fully valid target endpoint for our generic OpenAI-compatible local-provider client, exactly like Ollama/llama.cpp, since our integration makes no assumption about what's on the other end of the HTTP call.

## 15. Haystack

- **Repo**: github.com/deepset-ai/haystack · **License**: Apache-2.0 · **Status**: active (~24k stars)
- **Confirmed**: core dependencies pull in `transformers>=4.57` and `sentence-transformers>=5.0.0` — heavy, GPU-class ML-runtime dependencies.
- **Recommendation**: **REJECT** as a direct dependency — directly contradicts the "no heavy ML runtime bundled into the web application" requirement. Its RAG-pipeline *design ideas* remain referenceable if a future version genuinely needs free-text retrieval beyond our bounded structured rule set (not currently planned — our knowledge engine is structured records, not embeddings-based retrieval).

## 16. LlamaIndex

- **Repo**: github.com/run-llama/llama_index · **License**: MIT · **Status**: active, large multi-package ecosystem (300+ integration packages)
- **Recommendation**: **REJECT** as a direct dependency — same heavy-RAG-stack profile as Haystack. Reference only, same rationale.

## 17. Mem0

- **Repo**: github.com/mem0ai/mem0 · **License**: Apache-2.0 · **Status**: very active (~60k+ stars)
- **Confirmed**: `pip install mem0ai` pulls in `qdrant-client` + `grpcio` (~40MB) + `posthog` (telemetry) as **default hard dependencies**, even when unused — confirmed via an open GitHub issue (#4209) requesting these be made optional. Modular extras exist (`mem0ai[pgvector]` etc.) but the base install still isn't lightweight, and **telemetry-by-default** is a real concern given this project handles a user's actual email content and design preferences.
- **Capability useful to us**: the *concept* — user/session/agent-scoped memory tiers — closely validates the three-tier design (global-verified / project / learned-user-pattern) already approved for our own memory model.
- **Recommendation**: **REJECT** as a direct dependency (telemetry + heavy transitive deps). **REFERENCE** the concepts only — we build our own lightweight Django-model-backed memory store (Phase E), which is already architecturally aligned with what Mem0 is *trying* to do, without its dependency/privacy cost.

## 18. LangGraph

- **Repo**: github.com/langchain-ai/langgraph · **License**: MIT (confirmed via LICENSE file), standalone core library with no required LangChain dependency
- **Caveat found**: a blog post titled "LangGraph is MIT-Licensed, but Your Production Deployment Might Not Be" refers to LangChain Inc.'s separate *commercial* LangGraph Platform hosting product — irrelevant to us since we'd only ever reference the state-machine *pattern*, never adopt the hosted product or even the library itself.
- **Recommendation**: **REFERENCE** only. Our repair pipeline (ANALYZE→DIAGNOSE→PROPOSE→DIFF→APPLY→REVALIDATE, approved in the Gap Analysis) is a linear sequence, not a branching multi-agent graph — a graph-orchestration library would be premature complexity for what is currently plain typed Python control flow. Revisit only if the repair engine grows genuinely branchy.

## 19. Classic vs New Outlook compatibility database

No dedicated, maintained, structured open-source project was found. Scattered blog posts exist (vendor content, dev.to articles) but none are licensed structured data suitable for adaptation. **N/A** — Phase B relies on Can I Email (#1) as the best available structured source, supplemented by developer-authored, individually-verified rules (consistent with Module-3's existing verified-knowledge pattern, referenced architecturally in the Gap Analysis).

## 20. VML utility library

No maintained, clearly-licensed, general-purpose VML email utility library was found. Scattered single-purpose tools exist (e.g. small personal repos, unlicensed web-published techniques from Campaign Monitor/Litmus community pages) — none suitable for adoption or confident adaptation. **N/A** — MJML (#5) remains the best available reference for VML/ghost-table generation *logic*.

## 21. email-comb

- **Repo**: github.com/codsen/codsen (package `packages/email-comb`) · **License**: MIT · **Status**: active
- **What it is**: a narrow dead/unused-CSS-removal tool for HTML email, not a compatibility validator.
- **Recommendation**: **REFERENCE** only — not core to Phase B's compatibility-validation scope. Could be a small future utility if we ever want to slim exported HTML, out of scope now.

## 22. Email-specific WCAG ruleset

- `matthieuSolente/wcag-for-email` — an interactive checklist page, explicitly described by its author as a replica of France's RGAA criteria (WCAG-aligned, not identical). **No license specified**, 0 stars, 1 watcher. **REJECT** — no license means we cannot legally reuse its content, and its adoption signal is negligible.
- W3C's own `wcag`/`wcag-act-rules-cg` repositories are authoritative but generic-web (not email-specific), under the W3C Document License rather than a typical OSS license.
- **Recommendation**: **REFERENCE** the WCAG success-criteria text/numbering directly (e.g. citing WCAG 1.1.1, 1.4.3, 2.4.4 in our own rule records) as the accessibility authority — this is standard practice for citing a public specification, not a license violation — rather than vendoring any specific third-party repo.

## 23. Email engineering "agent skill" packages

- **`framix-team/skill-email-html-mjml`** — a Claude Code skill (64 stars, 9 commits), **MIT-licensed**, containing SKILL.md + reference markdown + example templates covering Outlook-safe/VML/ghost-table generation, WCAG 2.1 AA, and Gmail clip-threshold guidance via an MJML-flavored workflow. Small but genuinely structured and on-target for our exact domain.
- **`resend/resend-skills`** — official Resend repo, **MIT-licensed** (confirmed via LICENSE fetch), containing an `email-best-practices` subskill focused on **deliverability/compliance** (SPF/DKIM/DMARC, CAN-SPAM/GDPR/CASL, spam/bounce handling) — a genuinely different knowledge dimension (sending/compliance, not rendering/compatibility).
- **Recommendation**: **ADAPT** `skill-email-html-mjml`'s structured checklists as seed content when authoring Phase B's initial `KnowledgeRule` set (attribution retained, MIT permits this). **REFERENCE** `resend-skills`' deliverability material as a flagged *future* knowledge category (out of scope for V2 — Feature 14 V2 is about rendering/compatibility/repair, not sending infrastructure).

---

## Legal / attribution notes

- **Can I Email (MIT)** and **skill-email-html-mjml (MIT)** are the two sources where we adapt actual content (not just read for understanding). MIT requires retaining the original copyright notice and license text for the portions adapted. Action for Phase B: include a `docs/module-4/THIRD_PARTY_NOTICES.md` (or a section in the knowledge-rule source files themselves) crediting both projects by name, URL, and license, alongside the specific rules derived from each.
- **MJML (MIT)** patterns may be adapted narrowly with attribution at the point of use in Phase C, per the same MIT terms — not a blanket "we copied MJML," a specific note on any function whose markup shape was directly informed by MJML's compiler output.
- **email-bugs**, **wcag-for-email**: license unconfirmed/absent — do not copy content; URL-cite only as evidence in our own independently-authored rules.
- No project in this audit is copyleft (GPL/AGPL) in a way that would affect our ability to keep MDAIW proprietary/closed — every ADOPT/ADAPT candidate is MIT or BSD-3-Clause.

---

## Net decision feeding into Phase B/F

- **Zero new runtime dependencies** from this audit. No vector DB, no ML runtime, no Node-based tooling added to the Python backend.
- **Phase B** (Email Knowledge + Validation) seeds its initial `KnowledgeRule` set from Can I Email data + the MJML-flavored agent skill's checklists, both adapted with attribution, both MIT.
- **Phase C** (Repair Engine / VML) uses MJML's compiler behavior as its architectural blueprint for ghost-table/VML/MSO-conditional generation, implemented as our own parameterized builder functions — not a vendored dependency.
- **Phase F** (Local + OpenAI) supports Ollama, llama.cpp, and LM-Studio-class servers identically via one generic OpenAI-compatible HTTP client, zero new dependency (the `openai` SDK we already ship supports arbitrary `base_url`).
