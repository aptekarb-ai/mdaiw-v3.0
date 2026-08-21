# Module-4 — AI Email Builder Implementation Plan

Target documentation path: `C:\Projects\MDAIW\docs\module-4`

## Objective
Build one generic, table-first visual email builder that can optionally enable platform-specific capabilities for Salesforce Marketing Cloud, Marketo, HubSpot and Pardot/Account Engagement without fragmenting the product into separate builders.

## Recommended delivery order
### Phase 1 — Core builder
1. Dashboard
2. Create New Email
3. Main Workspace
4. Module Library
5. Layout Builder
6. Module Editor
7. Responsive Editor

### Phase 2 — Assets and professional editing
8. Asset Manager
9. Code Editor

### Phase 3 — Platform, preview and QA
10. Platform / Environment
11. Preview Studio
12. Validation Center

### Phase 4 — Output and AI
13. Export / Deploy
14. AI Engineer — natural voice and conversational control

## Core technical principle
The UI edits a structured **Email Document Model**. A renderer converts that model into compatible email HTML. Platform adapters decorate/transform only when required. Preview and validation consume the rendered result. AI edits the structured model through controlled actions rather than directly rewriting the entire HTML by default.

## Definition of done
- Visual authoring is stable.
- Table-first output passes deterministic checks.
- Responsive/mobile order is predictable.
- Generic email can be exported without a platform dependency.
- Platform adapters are capability-driven.
- Code mode preserves developer changes.
- Preview and validation are integrated.
- AI actions are contextual, reversible, secure and auditable.
