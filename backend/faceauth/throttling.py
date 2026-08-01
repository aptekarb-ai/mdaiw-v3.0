from django.core.cache import cache

from .hashing import keyed_hash


def _bucket_key(prefix, identifier):
    return f'{prefix}:{keyed_hash(identifier)}'


def is_throttled(prefix, identifier, max_attempts, window_seconds):
    return cache.get(_bucket_key(prefix, identifier), 0) >= max_attempts


def record_attempt(prefix, identifier, window_seconds):
    key = _bucket_key(prefix, identifier)
    try:
        cache.incr(key)
    except ValueError:
        cache.set(key, 1, timeout=window_seconds)


def reset(prefix, identifier):
    cache.delete(_bucket_key(prefix, identifier))
