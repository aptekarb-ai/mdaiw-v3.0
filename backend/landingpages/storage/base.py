"""Storage provider abstraction for landing-page project files.

Mirrors faceauth/engines/base.py's provider-interface pattern: callers only
ever depend on this ABC, never on a concrete provider — swapping the local
filesystem for S3/Azure Blob/MinIO/GCS later means adding one new subclass
and a registry entry (see registry.py), not touching any caller.
"""

import re
from abc import ABC, abstractmethod

# Every path segment must be one of these — no dots, no slashes, no null
# bytes, nothing that could ever be interpreted as a path-traversal token.
# Generated identifiers (integer PKs, uuid4 hex strings, a small fixed set
# of file-type names) all satisfy this trivially; anything else is rejected
# outright rather than "sanitized", since silently rewriting an attacker's
# input is itself a common source of traversal bugs.
_SAFE_SEGMENT_PATTERN = re.compile(r'^[A-Za-z0-9_-]+$')


class UnsafeStoragePathError(Exception):
    """Raised when a storage path segment is not safe to use — never
    caught and "handled" silently anywhere; every caller must fail the
    request rather than attempt to recover a path that failed this check."""


def build_path(*segments: str) -> str:
    """Join path segments into a single storage-relative path, after
    validating every segment individually. This is the one and only way
    a storage-relative path should ever be constructed in this app — no
    caller should use os.path.join / f-strings / string concatenation to
    build a path that reaches a StorageProvider method.

    Deliberately allow-list based (segments must be alphanumeric plus
    '-'/'_') rather than deny-list based (rejecting only known-bad tokens
    like '..') — an allow-list cannot be bypassed by an encoding or
    normalization trick a deny-list didn't anticipate.
    """
    if not segments:
        raise UnsafeStoragePathError('At least one path segment is required.')
    for segment in segments:
        if not segment or not _SAFE_SEGMENT_PATTERN.match(segment):
            raise UnsafeStoragePathError(f'Unsafe storage path segment: {segment!r}')
    return '/'.join(segments)


class StorageProvider(ABC):
    """Provider-independent interface for landing-page file storage.
    Every method takes/returns a storage-relative path already produced by
    build_path() — a provider implementation must never accept an
    arbitrary caller-supplied path string without re-validating it itself
    (see LocalStorageProvider for the extra containment check applied on
    top of build_path's allow-list)."""

    @abstractmethod
    def save(self, relative_path: str, content: bytes) -> str:
        """Persist `content` at `relative_path`. Returns the stored path
        (providers may version or rename; callers must use the returned
        value, not assume it equals the input)."""

    @abstractmethod
    def read(self, relative_path: str) -> bytes:
        """Return the raw bytes stored at `relative_path`. Raises
        FileNotFoundError if it does not exist."""

    @abstractmethod
    def delete(self, relative_path: str) -> None:
        """Delete the file at `relative_path`. Must not raise if the file
        is already absent — deletion is idempotent."""

    @abstractmethod
    def exists(self, relative_path: str) -> bool:
        """Return whether a file exists at `relative_path`."""
