import threading

_lock = threading.Lock()
_instances = {}


def _build(provider_name):
    if provider_name == 'silent_face':
        from .silent_face import SilentFaceAntiSpoofProvider

        return SilentFaceAntiSpoofProvider()
    raise ValueError(f'Unknown FACE_ANTI_SPOOF_PROVIDER: {provider_name!r}')


def get_anti_spoof_provider(provider_name=None):
    if provider_name is None:
        from django.conf import settings

        provider_name = settings.FACE_ANTI_SPOOF_PROVIDER

    with _lock:
        if provider_name not in _instances:
            _instances[provider_name] = _build(provider_name)
        return _instances[provider_name]
