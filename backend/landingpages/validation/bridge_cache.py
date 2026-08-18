"""Low-Latency AI Engineer Performance Optimization sprint, spec section
9/12 — source-fingerprint result caching for the expensive subprocess-
backed validator/compiler engines (node_bridge.py, java_bridge.py).

Every wrapped function is pure with respect to its OWN arguments (same
input -> same output, no side effects other than the subprocess call
itself — verified by reading each one; none reads `project`, a
timestamp, or anything else request-specific that would make caching
unsound) — but each resolves its OWN executable via a `LP_*_EXECUTABLE`
setting (see `_resolve_node_executable`/`_resolve_java_executable`),
which is genuinely external, environment-level configuration. A test
overriding that setting to simulate "engine unavailable" (see
test_css_validation.py's `test_css_engine_unavailable_...`) is exactly
the case a cache keyed on function args ALONE would get wrong — an
earlier, real success for the identical CSS would incorrectly "come
back" as a cache hit even though this specific request's engine is
unavailable. `_settings_fingerprint()` below folds every such
environment-identity setting into the cache key so a genuine
configuration change (a test override, or a real engine upgrade in a
redeployed environment) always misses rather than serving a stale
result — a small, deliberate over-invalidation (ANY of these settings
changing invalidates the WHOLE cache, not just the affected engine) in
exchange for correctness. This is exactly the same "cache the pure
computation" pattern
Ai Engineer analysis already uses (see ai_engineer/__init__.py's
`_cached_language_result`) — this module gives the same treatment to the
underlying validator/compiler calls, so it also benefits every caller of
those adapters, not only the AI Engineer path.

Deliberately caches the SUBPROCESS CALL LAYER, not the adapter layer
above it (css_conformance.py, js_conformance.py, css_scss_sass.py, ...) —
those adapters still run their own (cheap, pure-Python) result-shaping
logic every time, so their own instance-attribute side channels (e.g.
ScssSassAdapter.compiled_css) are always freshly populated whether the
underlying compile call was a cache hit or not. This keeps the cache
entirely internal to node_bridge.py/java_bridge.py — no call site
anywhere else needs to change.

Never caches a failure — only a function that actually RETURNED (never
raised) is memoized; a NodeBridgeError/JavaBridgeError always propagates
live, so a transient engine outage is never "stuck" as a cached failure,
and a genuinely bad input is always freshly reported.
"""

from __future__ import annotations

import copy
import functools
import hashlib
import json
import logging

from django.conf import settings
from django.core.cache import cache

from .. import perf_metrics

logger = logging.getLogger('landingpages.validation.bridge_cache')

_CACHE_KEY_PREFIX = 'landingpages:validator-bridge-cache'

# Every setting that changes whether/how one of the wrapped calls can
# succeed — the executable identity (a test override or a real engine
# swap) plus every per-engine version-relevant knob. Timeouts/output caps
# are deliberately EXCLUDED — they bound HOW the call behaves under
# failure, not WHAT a successful result would be, so including them would
# only cause needless cache misses.
_ENVIRONMENT_SETTING_NAMES = ('LP_NODE_EXECUTABLE', 'LP_JAVA_EXECUTABLE')


def _settings_fingerprint() -> str:
    values = {name: getattr(settings, name, None) for name in _ENVIRONMENT_SETTING_NAMES}
    return json.dumps(values, sort_keys=True, separators=(',', ':'))


def _cache_key(name: str, args: tuple, kwargs: dict) -> str:
    # sort_keys + a stable separator makes the key deterministic
    # regardless of kwarg insertion order; default=str is a defensive
    # fallback only (every real caller passes JSON-safe args — see each
    # wrapped function's own docstring) so an unexpected argument type
    # degrades to "always a cache miss for that shape" rather than a
    # hard error.
    payload = json.dumps(
        {'args': args, 'kwargs': kwargs, 'env': _settings_fingerprint()},
        sort_keys=True, default=str, separators=(',', ':'),
    )
    digest = hashlib.sha256(payload.encode('utf-8')).hexdigest()
    return f'{_CACHE_KEY_PREFIX}:{name}:{digest}'


def cached_bridge_call(*, metric_prefix: str = 'validator'):
    """`metric_prefix` selects which perf_metrics counter pair
    (`{prefix}_cache_hits` / `{prefix}_cache_misses`) this function's
    calls get attributed to — 'validator' for validation-only engines,
    'compile' for the SCSS/Sass/LESS compilers (spec section 12's own
    named counters)."""
    call_metric = 'compiler_calls' if metric_prefix == 'compile' else 'validator_calls'

    def decorator(fn):
        @functools.wraps(fn)
        def wrapper(*args, **kwargs):
            perf_metrics.record(call_metric)
            if not settings.LP_VALIDATOR_CACHE_ENABLED:
                return fn(*args, **kwargs)
            key = _cache_key(fn.__name__, args, kwargs)
            cached = cache.get(key)
            if cached is not None:
                perf_metrics.record(f'{metric_prefix}_cache_hits')
                logger.debug('landingpages.validation.bridge_cache.hit engine=%s', fn.__name__)
                return copy.deepcopy(cached)
            perf_metrics.record(f'{metric_prefix}_cache_misses')
            result = fn(*args, **kwargs)
            cache.set(key, result, timeout=settings.LP_VALIDATOR_CACHE_TTL_SECONDS)
            return result
        return wrapper
    return decorator
