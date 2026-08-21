"""Line/column <-> character-offset conversion shared by every patch
generator in catalogue.py. Never re-implemented per rule — the same
approach validation/ampscript/__init__.py already uses internally."""

import bisect


def line_starts(text: str) -> list[int]:
    starts = [0]
    for index, char in enumerate(text):
        if char == '\n':
            starts.append(index + 1)
    return starts


def line_col_to_offset(line: int, column: int | None, starts: list[int]) -> int:
    line = max(1, min(line, len(starts)))
    return starts[line - 1] + max(0, (column or 1) - 1)


def offset_to_line_col(offset: int, starts: list[int]) -> tuple[int, int]:
    index = max(0, bisect.bisect_right(starts, offset) - 1)
    return index + 1, offset - starts[index] + 1
