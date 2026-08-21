# 07 — Preview & Validation

## Preview
Build provider-neutral preview contracts. Start with internal desktop/mobile/dark-mode preview. Add external inbox-render testing through an adapter when credentials/API access are available.

Suggested interface: `submitRender`, `getRenderStatus`, `listClientRenders`, `getRenderImage`.

## Validation
Deterministic checks first:
- invalid/nested table structure
- missing closing tags
- unsafe CSS
- image dimensions/alt text
- placeholder/broken URLs
- width overflow
- mobile stacking
- accessibility
- dark mode risks
- platform syntax
- Outlook-specific patterns

AI fixes should consume structured issues and propose minimal diffs.
