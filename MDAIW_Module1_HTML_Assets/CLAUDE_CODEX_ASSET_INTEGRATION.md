# Claude / Codex Asset Integration Instruction

Use the assets in this folder instead of drawing decorative icons with text,
emoji, or screenshots.

1. Copy this folder to `frontend/public/assets/mdaiw/`.
2. Load `css/mdaiw-icons.css` once in the application.
3. Use CSS mask icon classes for navigation and buttons.
4. Use the SVG illustrations in `images/` for hero, Yukti, profile placeholder,
   Face Recognition overlay, success, and voice states.
5. Use the official MarketOne logo supplied separately; do not treat the
   MDAIW placeholder wordmark as the official company logo.
6. Keep icons accessible with visible labels or `aria-label`.
7. Do not use the full-page design PNGs as interface backgrounds.
8. Maintain the approved branding colours:
   `#002D38`, `#0082AD`, `#76C043`, `#F4F6F8`, `#FFFFFF`, `#333333`.
9. Verify all asset paths in the production Vite build.
10. Add a small visual regression or component test confirming that key icons
    and images load successfully.
