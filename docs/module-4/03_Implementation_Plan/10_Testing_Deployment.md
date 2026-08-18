# 10 — Testing & Deployment

## Test levels
- Unit tests: document commands, renderer, adapters, validators.
- Component tests: module library, editor controls, drag/drop, responsive overrides.
- Integration tests: create → build → validate → preview → export.
- Golden HTML snapshots for representative modules and environments.
- Visual regression tests for application UI.
- Email-client render regression via external provider when available.

## Deployment gates
Typecheck, lint, tests, production build, migration checks, feature flags, security scan, smoke test.

Ship Module-4 behind a feature flag until core document/rendering compatibility is stable.
