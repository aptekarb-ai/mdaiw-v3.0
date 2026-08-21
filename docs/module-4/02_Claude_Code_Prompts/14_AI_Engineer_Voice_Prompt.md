# Claude Code Prompt — 14. AI Engineer Voice

## Reference
- UI: `C:\Projects\MDAIW\docs\module-4\01_UI_UX_Designs\14_AI_Engineer_Voice.png`
- Design system: `C:\Projects\MDAIW\docs\module-4\01_UI_UX_Designs\DESIGN_SYSTEM.md`
- Master rules: `C:\Projects\MDAIW\docs\module-4\02_Claude_Code_Prompts\00_Master_Module4_Prompt.md`

## Goal
Natural-language and voice AI engineer for generation, changes, optimization and guided fixes.

## Implement these operations
1. Push-to-talk / voice input
2. Natural multilingual commands
3. Context-aware selected-module actions
4. Confirm ambiguous intent
5. Generate email/modules
6. Edit global styles
7. Responsive changes
8. Explain proposed changes
9. Apply/revert
10. Maintain AI action history
11. Secure server-side OpenAI integration

## UX requirements
- Match Module-1/Module-3 branding and application shell.
- Use the PNG as layout/interaction reference, not as a bitmap in the product.
- Responsive at common laptop/desktop widths; critical controls remain usable at narrower sizes.
- Include loading, empty, disabled, success and error states where relevant.
- Keyboard/focus/accessibility behavior must be deliberate.
- Use existing shared components/tokens before adding new ones.

## Architecture requirements
- Create typed data models and action/event contracts for this feature.
- Keep platform-specific logic behind capability/adapter interfaces.
- Do not hard-code vendor rules in generic UI components.
- Persist state through the existing project persistence layer or a feature repository abstraction if not yet available.
- Add tests for core operations and edge cases.

## Acceptance criteria
Users can speak naturally; ambiguous commands are clarified; accepted actions are structured, logged and reversible.

## Claude Code execution order
1. Inspect relevant existing files and describe the smallest change set.
2. Implement types/state first.
3. Implement UI and interactions.
4. Wire persistence/integration.
5. Add tests.
6. Run lint/typecheck/tests.
7. Report changed files, commands run, test result and remaining TODOs.

Do not make unrelated refactors.
