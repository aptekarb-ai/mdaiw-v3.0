"""Shared excerpt-windowing logic — used by __init__.py (building the
bounded context sent to the provider) AND validation.py (translating the
AI's excerpt-relative offsets back to real source offsets). Kept in its
own module, not owned by either caller, specifically so the two stay
using the IDENTICAL window math — a live-verification run caught the bug
that motivated splitting this out: the provider was told offsets were
excerpt-relative but validation checked them as full-source-relative,
so every real proposal failed its own expected_text check. See
../fixes/offsets.py for the underlying line/offset primitives.
"""

from ..fixes.offsets import line_starts

# Lines of surrounding context included on each side of an issue's own
# line — enough for the model to understand the defect without receiving
# the whole document.
EXCERPT_CONTEXT_LINES = 6
MAX_EXCERPT_CHARS = 1500


def excerpt_window(source: str, line: int) -> tuple[str, int]:
    """Returns (excerpt_text, excerpt_start_offset) — `excerpt_start_offset`
    is the excerpt's own position within `source`, so an offset the AI
    reports as relative to the excerpt it was shown can be translated back
    with `excerpt_start_offset + ai_offset`."""
    lines = source.split('\n')
    starts = line_starts(source)
    line_index = max(0, (line or 1) - 1)
    start_line_index = max(0, line_index - EXCERPT_CONTEXT_LINES)
    end_line_index = min(len(lines), line_index + EXCERPT_CONTEXT_LINES + 1)
    excerpt = '\n'.join(lines[start_line_index:end_line_index])[:MAX_EXCERPT_CHARS]
    excerpt_start_offset = starts[start_line_index] if start_line_index < len(starts) else len(source)
    return excerpt, excerpt_start_offset
