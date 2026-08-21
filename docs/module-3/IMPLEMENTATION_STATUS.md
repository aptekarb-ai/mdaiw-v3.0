# MDAIW Module-3 Implementation Status

## 1. Project name
MarketOne Digital AI Workspace (MDAIW)

## 2. Module name
Module-3 — LP Validator & AI Fixer (Priority 1)

## 3. Current date
2026-08-05

## 4. Current Git branch
feature/module-1

## 5. Scope covered by this checkpoint
Sprints completed, in order:

- **Sprint A** — diagnosed and fixed the live "Validation could not be completed" failure. Root cause: migration `landingpages.0003_validationreport_validation_scope` was never applied to the dev database (unrelated duplicate `runserver` processes were a red herring, cleaned up regardless). No code changes; environment fix only.
- **Sprint B** — completed scope-specific validation behaviour: exact per-scope disabled-Validate/empty-state copy matching the backend serializer's own messages, confirming HTML/CSS/Complete-LP scope isolation end-to-end via live HTTP verification.
- **Sprint CSS-A** — inline `style="..."` attribute validation and internal `<style>` block validation, both mapped back to their real HTML line/column (`language: 'css'`, `file: 'html'`). Found and fixed two real bugs during implementation: (1) batching a document's embedded-CSS units into one PostCSS parse meant one broken unit silently discarded every other unit's findings — fixed with a parse-failure fallback to per-unit isolation; (2) the API's `language` field had been aliased straight to the `file` column since Sprint 1C, so the whole file≠language design silently collapsed at the serializer layer — fixed by adding a real, independently-stored `language` column with a backfill migration.
- **Sprint CSS structural/semantic rewrite** — PostCSS's parser is not error-recovering: one hard syntax error (missing colon, unclosed brace) aborted the whole document and collapsed everything to one generic message. Added `css-tree@3.2.1` (pinned) as an independent, recovering structural+semantic layer (parse-error recovery + a standards-derived property/value grammar lexer, not a hand-maintained property list), plus a hand-written lexical brace/string/comment balance checker. The pre-existing PostCSS/Stylelint/custom-checks pipeline is functionally unchanged — it just no longer masks the other phases on a hard failure. Found and fixed a real false positive during verification: `var(...)` references were being value-matched against their containing property's grammar, which is not statically valid in general (e.g. `padding-inline: var(--space)` was wrongly flagged) — fixed by skipping value-matching whenever a declaration's value contains `var(`.

Explicitly not started: Sprint CSS-B (stylesheet-source aggregation, external `<link>` classification), Sprint CSS-C/D (SCSS/Sass/LESS compilation), Sprint CSS-E (frontend source-type selector), JavaScript/TypeScript validation engines, Fix These Errors, Ask AI to Review and Fix, Preview, Save, Copy, Download, Manual LP Builder, AI LP Generator.

## 6. Architecture summary

### Backend (`backend/landingpages/`)
- Django app with DRF: `LandingPageProject`, `LandingPageVersion`, `ValidationReport`, `ValidationIssue` models.
- `POST /api/v1/lp/validate/` — the only validation endpoint. Accepts `html`/`css`/`js`/`ts`/`validation_scope`/`profile`/`project`. Returns a `ValidationReport` with nested `issues`.
- `validation/engine.py` — orchestrator. Dispatches adapters by scope (`complete`/`html`/`css`/`javascript`/`typescript`), isolates each adapter's failures (`EngineStatus` per engine), deduplicates by fingerprint (now including `source_context` and `file` so embedded-CSS findings can never collapse with unrelated standalone-CSS findings that coincidentally share a line/column).
- HTML adapters (`_HTML_ADAPTERS`): `HtmlConformanceAdapter` (html5lib), `HtmlStructureAdapter`, `HtmlAccessibilityStaticAdapter`, `HtmlSeoAdapter`, `HtmlResponsiveAdapter`, `HtmlInlineStyleAdapter`, `HtmlStyleBlockAdapter` (the last two are Sprint CSS-A).
- CSS adapter (`_CSS_ADAPTERS`): `CssConformanceAdapter`, backed by a controlled Node subprocess (`validation/node_bridge.py` → `validators_node/validate_css.mjs`) — never `shell=True`, fixed script path, explicit minimal environment, real OS-enforced timeout, output-size cap.
- `validators_node/validate_css.mjs` — three independent phases per validation call: (1) lexical brace/string/comment balance check, (2) `css-tree` recovering structural parse + standards-derived semantic lexer, (3) PostCSS + Stylelint + 13 project-owned custom AST checks. A hard failure in phase 3 never removes phases 1–2's findings, and vice versa.
- `validation/schema.py::ValidationIssueData` — unified issue shape. `language` (what it is) and `file`/`editor_target` (which editor tab to open) are now independently trackable — previously conflated.
- JavaScript/TypeScript adapters (`_JAVASCRIPT_ADAPTERS`/`_TYPESCRIPT_ADAPTERS`) are empty tuples — no engine exists yet; the scope is honestly reported as unavailable, never silently substituted with HTML validation.

### Frontend (`frontend/src/landingpages/`, `frontend/src/pages/LandingPageValidatorPage.tsx`)
- Monaco Editor (self-hosted, no CDN) via `@monaco-editor/react` — `CodeEditor` abstraction, `CodeEditorTabs` (scope-gated tab visibility — a single-language scope shows only that tab; hidden tabs' source is preserved, never deleted).
- `ValidationScopeControl` — Complete LP/HTML/CSS/JavaScript/TypeScript radio group; JS/TS disabled with an explanatory `title` until their engines exist.
- `ValidationIssuesPanel`/`ValidationIssueCard` — severity + language filters, language-and-severity combined primary label (`HTML Error`, `Inline CSS Error`, `Internal CSS Error`, `CSS Error`, never a bare `Error`).
- Sidebar: "Landing Pages Builder" is a disclosure group (chevron, `aria-expanded`, keyboard-operable) with three children — LP Validator & AI Fixer (live), LP Builder and AI LP Generator (`Coming Soon` placeholders, explicitly stating their priority).

## 7. Database / migrations
`landingpages` migrations `0001`–`0006`, all applied:
- `0001_initial`, `0002_validationissue_code_excerpt_and_more` — Sprint 1A/1C.
- `0003_validationreport_validation_scope` — Sprint 1D-era; the migration Sprint A found unapplied in the dev DB.
- `0004_validationissue_source_block_index_and_more` — Sprint CSS-A: `source_context`, `source_block_index`.
- `0005_validationissue_language` — Sprint CSS-A: a real, independently-stored `language` column (with a data migration backfilling `language = file` for every pre-existing row, since the two only diverge starting with the embedded-CSS adapters).
- `0006_alter_validationissue_category` — CSS structural rewrite: widened `Category` choices with `structure`/`property`/`value`/`compatibility`.

`python manage.py makemigrations --check --dry-run` reports no changes detected.

## 8. Test evidence (as of this checkpoint)
- Focused CSS tests (`test_css_structural_validation.py` + `test_css_validation.py`): **75/75**.
- Full `landingpages` app suite: **200/200**.
- Complete backend suite (all apps): **468/468**.
- Frontend suite: **319/319** (29 files), `oxlint` clean, `tsc -b` clean, `npm run build` succeeds.
- Manual live-browser verification confirmed by the user: unclosed-block/missing-colon detection, multiple independent errors reported together, invalid colors/units/properties/values identified, valid custom properties and `var()` accepted, correct original-source line/column mapping, "Go to Line" navigates correctly.

## 9. Known limitations (honestly documented, not silently worked around)
- JavaScript and TypeScript validation engines do not exist yet — their scope options stay disabled in the UI.
- `<style type="text/scss">`/`type="text/less">` blocks are reported as a single "not browser-runnable" notice; not compiled (Sprint CSS-C/D).
- External `<link rel="stylesheet">` references are not yet classified or validated (Sprint CSS-B).
- A genuinely unparseable single declaration (e.g. `color red` — missing colon merges into the next token stream) can still produce one merged/awkward finding rather than two clean ones — inherent to how a single declaration's grammar match works; the *document-level* recovery (every other declaration/block still gets analyzed independently) is what this checkpoint's fix actually guarantees.
- `css-tree`'s lexer initialization adds roughly 700ms–1s per Node subprocess spawn; the full backend suite runtime grew from ~365s to ~380s as a result.

## 10. Next step
Sprint CSS-B (stylesheet-source aggregation for Complete LP scope, local external project asset validation, external `<link>` reference classification) — plan to be presented for approval before implementation begins.
