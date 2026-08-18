# Claude Code Prompt — 03. Email Builder Main Workspace

## Reference
- UI: `C:\Projects\MDAIW\docs\module-4\01_UI_UX_Designs\03_Email_Builder_Main_Workspace.png`
- Design system: `C:\Projects\MDAIW\docs\module-4\01_UI_UX_Designs\DESIGN_SYSTEM.md`
- Master rules: `C:\Projects\MDAIW\docs\module-4\02_Claude_Code_Prompts\00_Master_Module4_Prompt.md`

## Goal
Core drag-and-drop builder with modules, canvas, properties, toolbar and live state.

## Implement these operations
1. Drag module
2. Click module to insert
3. Select/reorder/duplicate/delete module
4. Undo/redo
5. Save/autosave
6. Change email width/environment
7. Zoom/device switch
8. Open preview/validation/code/AI

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
Core builder can create, edit, reorder and persist modules with undo/redo and responsive canvas behavior.

## Claude Code execution order
1. Inspect relevant existing files and describe the smallest change set.
2. Implement types/state first.
3. Implement UI and interactions.
4. Wire persistence/integration.
5. Add tests.
6. Run lint/typecheck/tests.
7. Report changed files, commands run, test result and remaining TODOs.

Do not make unrelated refactors.
