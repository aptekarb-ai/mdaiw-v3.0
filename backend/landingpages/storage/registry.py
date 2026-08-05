"""Selects the configured StorageProvider — mirrors
faceauth/engines/registry.py's settings-driven pattern, so this app's
storage backend can be swapped (local -> S3/Azure/MinIO/GCS) by adding one
provider class and one registry entry, with zero changes to any calling
code.

Deliberately stateless — no module-level cache. Unlike the face-recognition
engines (which load a real model into memory), constructing a
LocalStorageProvider is just a Path.resolve() + mkdir(), so caching it buys
nothing and only risks tests silently reusing a provider pointed at a stale
settings.LP_STORAGE_ROOT after an override_settings block exits.
"""

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured

from .base import StorageProvider
from .local import LocalStorageProvider


def get_storage_provider() -> StorageProvider:
    name = getattr(settings, 'LP_STORAGE_PROVIDER', 'local')
    if name == 'local':
        return LocalStorageProvider()
    # Future providers (e.g. 's3', 'azure_blob', 'minio', 'gcs') register
    # here as they are implemented — never silently fall back to local.
    raise ImproperlyConfigured(f'Unknown LP_STORAGE_PROVIDER: {name!r}')
