"""Selects the configured FaceRecognitionEngine. Each engine is a process-
wide singleton (constructed once, reused across requests) so its own
internal model-warm-up state persists correctly."""

import threading

_lock = threading.Lock()
_instances = {}


def _build(engine_name):
    if engine_name == 'opencv_sface':
        from .opencv_sface import OpenCVSFaceEngine

        return OpenCVSFaceEngine()
    if engine_name == 'deepface':
        from .deepface_engine import DeepFaceEngine

        return DeepFaceEngine()
    raise ValueError(f'Unknown FACE_RECOGNITION_ENGINE: {engine_name!r}')


def get_engine(engine_name=None):
    """Returns the singleton instance for `engine_name` (defaults to
    `settings.FACE_RECOGNITION_ENGINE`). Multiple engines can coexist in
    the same process — e.g. `opencv_sface` for new enrollments and
    `deepface` for verifying pre-existing credentials — each with its own
    independent warm-up/readiness state."""
    if engine_name is None:
        from django.conf import settings

        engine_name = settings.FACE_RECOGNITION_ENGINE

    with _lock:
        if engine_name not in _instances:
            _instances[engine_name] = _build(engine_name)
        return _instances[engine_name]
