# MDAIW Project Instructions

Before inspecting, planning, modifying, or generating code, read these files completely:

@MDAIW_Module_1_Claude_Codex_Master_Prompt.md
@MDAIW_Module1_HTML_Assets/CLAUDE_CODEX_ASSET_INTEGRATION.md
@MDAIW_Module1_HTML_Assets/README.md

## Authority order

1. `MDAIW_Module_1_Claude_Codex_Master_Prompt.md` is the main functional,
   architecture, security, UI/UX, testing, validation, and acceptance specification.
2. `MDAIW_Module1_HTML_Assets/CLAUDE_CODEX_ASSET_INTEGRATION.md` defines how
   generated icons and illustrations must be integrated.
3. `MDAIW_Module1_HTML_Assets/README.md` defines asset paths and usage examples.
4. Existing working project conventions should be preserved when they do not
   conflict with the documents above.

## Mandatory functionality

- Responsive public landing page
- Username and password login
- Django session authentication
- Four-step employee registration
- Profile-photo upload
- Working Face Recognition enrollment
- Working Face Recognition login
- Anti-spoofing and liveness validation
- Encrypted biometric embedding storage
- Password fallback
- Yukti text assistance
- Yukti push-to-talk voice communication
- Voice-guided password login
- Voice-guided Face Recognition login
- Voice-assisted registration field completion
- Dashboard shell
- Profile and settings
- Secure logout

## Security boundaries

- Never collect a password through speech recognition.
- Never speak, log, or store a plain-text password.
- Never log biometric embeddings or live camera frames.
- Never store raw audio.
- Never allow Yukti to authenticate users directly.
- Never bypass anti-spoofing.
- Never hard-code secrets.
- Never commit `.env`.
- Password login must remain available.
- Face Recognition must not be replaced by a placeholder.

## UI implementation rules

- Use the supplied SVG icons and illustrations.
- Do not use design screenshots as page backgrounds.
- Build real React and TypeScript components.
- Use approved colours:
  - `#002D38`
  - `#0082AD`
  - `#76C043`
  - `#F4F6F8`
  - `#FFFFFF`
  - `#333333`
- Use semantic HTML and accessible form controls.
- Preserve visible keyboard focus.
- Provide loading, success, validation, empty, and error states.
- Internal navigation must not cause a full-page refresh.

## Required engineering workflow

1. Inspect before editing.
2. Report the current architecture and missing requirements.
3. Work one checkpoint at a time.
4. Do not stop after providing a plan once implementation is authorized.
5. Do not modify unrelated modules.
6. Run relevant tests after every checkpoint.
7. Run linting and type checks.
8. Run the frontend production build.
9. Run Django system checks and migrations.
10. Update `docs/module-1/IMPLEMENTATION_STATUS.md` after every checkpoint.
11. Stop after each major checkpoint for user review.
12. Report failures honestly.

## Git safety

- Inspect `git status` before editing.
- Never force-push.
- Never delete user files without explicit approval.
- Do not commit secrets.
- Make small, phase-based commits only after validation.
