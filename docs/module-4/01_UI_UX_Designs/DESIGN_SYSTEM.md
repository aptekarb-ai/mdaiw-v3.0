# Module-4 — AI Email Builder Design System

## Brand direction
Use the same MDAIW/DAIW visual language as Module-1 and Module-3. Before coding, inspect those modules and reuse their existing tokens, typography, spacing, navigation, cards, shadows, icon library, and button variants. Do **not** create a competing design system.

### Reference palette used by these wireframes
- Primary purple: `#6C5CE7`
- Secondary blue: `#008894` / adapt to existing project secondary token
- Accent blue: `#3B82F6`
- Dark/navy: `#0E172A`
- Surface: `#FFFFFF`
- App background: `#F8FAFC`
- Text: `#1E293B`
- Muted text: `#64748B`
- Border: `#E2E8F0`
- Success: `#22C55E`
- Warning: `#F59E0B`
- Error: `#EF4444`

> Replace these fallback values with actual tokens found in Module-1/Module-3.

## UX principles
1. Compatibility first: the visual builder must generate table-first email markup.
2. Progressive disclosure: basic controls first; advanced/platform controls appear only when needed.
3. Context preservation: moving between Visual, Code, Responsive, Preview and AI must not lose edits or selection.
4. Fast authoring: click-to-add and drag/drop must both work.
5. Platform neutrality by default: Generic mode first, adapters layered on top.
6. Accessibility: WCAG-oriented application UI and email-content checks.
7. Responsive by design: desktop/mobile controls and predictable stacking order.
8. Safe automation: AI proposes or applies reversible changes with version history.

## Main workspace anatomy
- Top toolbar: file/email context, environment, width, undo/redo, preview, validate, save.
- Left panel: modules/categories/search/saved modules.
- Center: email canvas with selected-module affordances.
- Right panel: Content / Style / Responsive / Advanced properties.
- Bottom/context toolbar: device switch, zoom, code, AI engineer.

## Email markup rules reflected in UI
- Prefer `table`, `tbody`, `tr`, `td`.
- Avoid structural `div` usage in Generic mode.
- Allow platform-specific exceptions only through adapter rules.
- Inline critical styles; keep safe media queries for responsive behavior.
- Treat Outlook Classic/New Outlook compatibility as a first-class validation target.
