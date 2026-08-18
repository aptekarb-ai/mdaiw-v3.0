# 06 — Module Library Strategy

## Goal
Support 1,000–2,000+ reusable email modules without shipping 2,000 hand-written React components.

## Approach
- Define module schemas/templates and render them through shared primitives.
- Store searchable metadata: category, tags, column count, image position, supported environments, responsive behavior, version.
- Use lazy loading/virtualized grids.
- Add favorites, recent and organization-specific saved modules.
- Keep module HTML generated from structured definitions.

## Initial module families
Headers, navigation, heroes, 1–6 column layouts, image/text alternation, product cards, content cards, event blocks, statistics, testimonials, CTA strips, banners, social, legal and footers.
