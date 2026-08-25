"""Canonical EmailDocument name normalization — the single source of truth
for "do these two names collide for the same user" across every write path
(Create Email, Rename, Create-from-Template, and future Import HTML / AI
Generate Email document creation), the `name_normalized` DB column, and the
serializer-level pre-check. Never trust a normalized value from client
input — it is always derived server-side from `name`.

`casefold()` rather than `lower()` is deliberate: it is Python's full
Unicode case-insensitive comparison primitive (handles cases `lower()`
misses, e.g. German sharp s), and — unlike a database-level `LOWER()` SQL
function — behaves identically regardless of which database backend is
running (SQLite's native LOWER() is ASCII-only in this Django version;
Postgres's is locale-dependent), which is exactly why normalization happens
in Python and is persisted, rather than computed by a SQL expression."""


def normalize_email_name(name: str) -> str:
    return name.strip().casefold()
