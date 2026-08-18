# 04 — Email HTML Rules

## Generic mode
- Use presentation tables for layout.
- Prefer `table`, `tbody`, `tr`, `td`, `img`, `a`, headings/text tags only where client-safe.
- Avoid structural `div` by default.
- Use explicit widths, max-width strategy and safe fallbacks.
- Inline critical CSS.
- Preserve media queries required for responsive stacking when client support allows.
- Add `role="presentation"` to layout tables where appropriate.
- Use defensive image attributes and alt text.
- Provide Outlook-friendly line-height, spacing and button strategies.
- Avoid unsupported CSS unless validation explicitly allows it.

## Outlook strategy
Build a dedicated validator/rule set for Outlook Classic and a separate rule set for modern web-renderer clients. Do not assume code that looks correct in one Outlook generation will be correct in another.

## Code mode
Track developer-authored protected/custom regions. Visual edits should touch only the mapped module/region whenever possible.
