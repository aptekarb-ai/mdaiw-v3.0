# 03 — Architecture

## Suggested layers
1. **App shell / routing** — reuse existing MDAIW shell.
2. **Email Document Model (EDM)** — typed JSON representation of email metadata, modules, content, style and responsive overrides.
3. **Command layer** — add/update/move/duplicate/delete modules; apply style; set mobile order; switch environment; undo/redo.
4. **Renderer** — deterministic EDM → table-first email HTML.
5. **Platform adapters** — Generic, SFMC, Marketo, HubSpot, Pardot.
6. **Validation engine** — static rules + platform/client checks.
7. **Preview adapters** — local responsive preview + optional external rendering provider.
8. **AI action planner** — natural-language intent → validated structured commands → preview/confirm/apply.
9. **Persistence** — draft/version/template/asset repositories.

## Important separation
AI should not be the source of truth for email structure. The Email Document Model is the source of truth; AI proposes controlled mutations.
