"""Passive anti-spoofing is deliberately decoupled from face recognition
(section H of the engine-migration fix) — the OpenCV YuNet+SFace engine
has no anti-spoofing of its own (YuNet only detects, SFace only
recognizes), so this runs as an independent step regardless of which
FaceRecognitionEngine is selected. Selected via
`settings.FACE_ANTI_SPOOF_PROVIDER`; see `registry.py`.
"""

from dataclasses import dataclass


@dataclass
class AntiSpoofResult:
    """Internal, structured result — never returned to the client as-is.
    `confidence` is never exposed publicly; only `is_live`/the mapped safe
    error code ever reach a response body."""

    is_live: bool
    confidence: float
    provider: str
    reason_code: str  # SPOOF_DETECTED | LIVENESS_FAILED | '' (empty when is_live)


@dataclass
class AntiSpoofProviderReadiness:
    status: str  # NOT_INITIALIZED | LOADING | READY | UNAVAILABLE
    provider: str


class AntiSpoofingProvider:
    name: str = ''

    def warm_up(self) -> None:
        raise NotImplementedError

    def start_background_warm_up(self) -> None:
        raise NotImplementedError

    def readiness(self) -> AntiSpoofProviderReadiness:
        raise NotImplementedError

    def validate(self, image, detected_face) -> AntiSpoofResult:
        """`detected_face` is a `faceauth.engines.base.DetectedFace`.
        Must raise `faceauth.service.FaceServiceError` with one of
        ANTI_SPOOF_MODEL_UNAVAILABLE / ANTI_SPOOF_PROCESSING_FAILED for a
        genuine provider/service failure — never silently reinterpret an
        infrastructure error as SPOOF_DETECTED (see the module docstring
        in silent_face.py for why this distinction matters)."""
        raise NotImplementedError
