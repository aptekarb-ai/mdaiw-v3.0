"""Local-filesystem StorageProvider — the only provider implemented in
this sprint. Every other provider (S3, Azure Blob, MinIO, GCS) implements
the same StorageProvider interface and is selected via registry.py; no
caller-visible change is required to add one later."""

from pathlib import Path

from django.conf import settings

from .base import StorageProvider, UnsafeStoragePathError


class LocalStorageProvider(StorageProvider):
    """Stores files under settings.LP_STORAGE_ROOT. `relative_path` is
    expected to already be the output of storage.base.build_path() — this
    class re-validates containment anyway (belt-and-suspenders) rather
    than trusting that every caller used build_path correctly."""

    def __init__(self, root: Path | None = None):
        self._root = Path(root or settings.LP_STORAGE_ROOT).resolve()
        self._root.mkdir(parents=True, exist_ok=True)

    def _resolve(self, relative_path: str) -> Path:
        if not relative_path or relative_path.startswith('/') or '..' in relative_path.split('/'):
            raise UnsafeStoragePathError(f'Unsafe storage path: {relative_path!r}')
        candidate = (self._root / relative_path).resolve()
        # The definitive containment check: no matter what build_path or a
        # caller did upstream, the fully resolved absolute path must still
        # live inside the storage root. Path.is_relative_to (3.9+) is exact
        # and does not have the "/foobar" vs "/foo" prefix-string bug a
        # naive str.startswith(root) check would have.
        if not candidate.is_relative_to(self._root):
            raise UnsafeStoragePathError(f'Storage path escapes root: {relative_path!r}')
        return candidate

    def save(self, relative_path: str, content: bytes) -> str:
        target = self._resolve(relative_path)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
        return relative_path

    def read(self, relative_path: str) -> bytes:
        target = self._resolve(relative_path)
        return target.read_bytes()

    def delete(self, relative_path: str) -> None:
        target = self._resolve(relative_path)
        target.unlink(missing_ok=True)

    def exists(self, relative_path: str) -> bool:
        target = self._resolve(relative_path)
        return target.is_file()
