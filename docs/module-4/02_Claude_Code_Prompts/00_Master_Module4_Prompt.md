# Claude Code Master Prompt — Module-4 AI Email Builder

You are implementing **Module-4: AI Email Builder** inside the existing MDAIW V3.1 repository.

## First actions — mandatory
1. Inspect `C:\Projects\MDAIW\docs\module-1` and `C:\Projects\MDAIW\docs\module-3`.
2. Inspect the existing application source code and identify the current frontend stack, routing, state management, component library, icon library, API conventions, linting, tests and design tokens.
3. Reuse existing architecture and branding. Do not introduce a second UI framework unless absolutely necessary.
4. Read all files under `C:\Projects\MDAIW\docs\module-4`.
5. Implement incrementally, feature-by-feature. Do not rewrite unrelated Module-1 or Module-3 code.

## Non-negotiable email engineering rules
- Generated email markup is **table-first**: `table > tbody > tr > td`.
- Generic mode should avoid `div` as a structural layout primitive.
- Allow `div` only when a selected platform requires it and the adapter explicitly permits it.
- Target Outlook Classic, New Outlook, Gmail, Apple Mail, iOS Mail, Android mail clients and common webmail clients.
- Prefer inline email-safe CSS plus supported responsive media queries.
- Do not allow visual-editor round trips to destroy or rewrite valid custom code unnecessarily.
- Add deterministic validation before any AI-based auto-fix.

## Engineering behavior
- Keep code modular, typed, testable and production-oriented.
- Build reusable primitives instead of one-off feature components.
- Preserve user work with autosave/draft state and explicit version checkpoints.
- Every mutating AI action must be reversible.
- Add empty/loading/error states to every async screen.
- Respect keyboard navigation and accessible labels.

## Deliverables per feature
- UI implementation matching the corresponding PNG reference.
- State model and types.
- Feature operations/actions.
- Validation rules.
- Unit/component tests.
- Integration wiring.
- Short implementation note documenting files changed and known limitations.
