# Third-Party Notices

This file lists third-party, open-source projects whose **content** (not code) was
reviewed and, in places, adapted into MDAIW's own structured data — specifically the
Email AI Engineer's knowledge base (`backend/emailbuilder/knowledge/rules.py`).

No third-party **source code** from any project listed below is vendored, copied, or
executed by MDAIW. Where a project is listed as an integration *target* (Ollama,
llama.cpp), MDAIW only ever speaks HTTP to a server the operator installs and runs
themselves — nothing from those projects is bundled into this application.

The full research and licensing rationale behind these decisions lives in
[`docs/module-4/AI_ENGINEER_OPEN_SOURCE_AUDIT.md`](docs/module-4/AI_ENGINEER_OPEN_SOURCE_AUDIT.md).
This file is the attribution record MIT requires for the entries marked **ADAPT** there.

---

## Can I Email

- **Source:** https://github.com/hteumeuleu/caniemail
- **License:** MIT
- **Copyright:** Rémi Parmentier and contributors
- **What was adapted:** General, publicly-documented email-client CSS/HTML compatibility
  facts (which client supports which feature) were cross-referenced by a developer
  (Claude Code acting as the developer) when authoring `KnowledgeRule` records in
  `backend/emailbuilder/knowledge/rules.py`. No automated parse of Can I Email's YAML
  dataset exists — see each rule's `source.transformation` field for the exact,
  honestly-disclosed provenance of that specific fact.
- **License text:** https://github.com/hteumeuleu/caniemail/blob/main/LICENSE

## framix-team/skill-email-html-mjml

- **Source:** https://github.com/framix-team/skill-email-html-mjml
- **License:** MIT
- **What was adapted:** Checklist facts (Outlook-safe HTML/VML/ghost-table construction,
  WCAG 2.1 AA guidance for email, Gmail clip-threshold awareness) were rewritten, in
  this codebase's own words, as independent `KnowledgeRule` records — see the rules
  whose `source.name` is `framix-team/skill-email-html-mjml (MIT)` for the specific
  facts adapted (e.g. `email-role-presentation-tables`, `email-alt-text-mandatory`,
  `email-xhtml-doctype-recommended`, `email-mobile-minimum-tap-target`,
  `outlook-vml-roundrect-arcsize`). No markdown text was copied verbatim.

## resend/resend-skills (email-best-practices subskill)

- **Source:** https://github.com/resend/resend-skills
- **License:** MIT
- **What was adapted:** Deliverability/compliance concepts from the
  `email-best-practices` subskill (authentication standards, legal unsubscribe/sender-
  identification requirements, list-hygiene practices) were rewritten as independent,
  general-knowledge `KnowledgeRule` records — see rules whose `source.name` is
  `resend/resend-skills — email-best-practices (MIT)` (e.g.
  `email-authentication-spf-dkim-dmarc`, `email-unsubscribe-legal-requirement`,
  `email-list-hygiene-sender-reputation`, `email-preheader-length-best-practice`,
  `email-consistent-sender-identity`).
- **What was explicitly NOT adopted:** Resend's API, SDK, or hosted sending service.
  MDAIW does not integrate with Resend in any form — only the referenced subskill's
  *written guidance* was reviewed.

## MJML

- **Source:** https://github.com/mjmlio/mjml
- **License:** MIT
- **Copyright:** Mailjet
- **What was used:** Architectural reference only — MJML's compiler *approach* to
  generating VML/MSO-conditional ghost tables informed how MDAIW's own renderer
  (`frontend/src/emailbuilder/htmlRenderer.ts`) approaches the same problem. MJML is
  **not** a runtime dependency of MDAIW; no MJML code is imported or executed.

## Can I Email, framix-team/skill-email-html-mjml — MIT license text

Both projects above marked MIT include the standard MIT License. A representative
copy of the license text (identical in substance for every MIT-licensed project
listed here) follows:

```
MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files, to deal in the
software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the software, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
```

---

## Local AI runtime integration targets (not embedded, not redistributed)

MDAIW's optional local AI provider (`backend/emailbuilder/ai_command_local.py`) speaks
the OpenAI-compatible `/v1/chat/completions` HTTP protocol to a server the operator
installs and runs themselves. The following are the researched, supported targets;
none of their code is bundled into MDAIW.

- **Ollama** — https://github.com/ollama/ollama — MIT License
- **llama.cpp** (`llama-server`) — https://github.com/ggml-org/llama.cpp — MIT License
- **LM Studio** — proprietary desktop application (its underlying inference engines,
  llama.cpp and MLX, are open source); usable as a target endpoint via the same
  generic OpenAI-compatible client, out of scope for open-source attribution here.

---

## Reference-only sources (no content adapted, cited for completeness)

The following were reviewed during the same open-source audit and used only as
architectural or conceptual reference — no data or text from them appears in
MDAIW's own rules. See `docs/module-4/AI_ENGINEER_OPEN_SOURCE_AUDIT.md` for the full
per-project rationale: Cerberus (TedGoas, MIT), Maizzle (MIT), React Email (MIT),
Maily (arikchakma/maily.to, MIT), GrapesJS preset-newsletter (BSD-3-Clause), Juice
(MIT), Premailer (BSD-3-Clause), Haystack (Apache-2.0), LlamaIndex (MIT), Mem0
(Apache-2.0), LangGraph (MIT), email-comb (MIT), W3C WCAG success-criteria text
(cited by number, e.g. WCAG 1.4.3, per standard public-specification citation
practice).
