"""Passive anti-spoofing provider wrapping DeepFace's existing Fasnet
anti-spoofing model, called directly (independent of DeepFace's own face
detection) so it works regardless of which FaceRecognitionEngine detected
the face — including the OpenCV YuNet+SFace engine, which has no
anti-spoofing of its own. Reuses the already-detected bounding box (from
whichever engine ran detection) rather than re-detecting.

Named `silent_face` per the configured provider identifier
(`FACE_ANTI_SPOOF_PROVIDER=silent_face`) — this wraps the project's
existing, already-integrated Fasnet-based passive anti-spoofing model
(the same one used by the DeepFace engine's fused detect+anti-spoof call),
not a different third-party anti-spoofing library. Swapping in a genuinely
different passive-anti-spoofing implementation later only requires a new
class behind this same `AntiSpoofingProvider` interface — see
`faceauth/anti_spoof/base.py`.
"""

import logging
import threading
import time

from .base import AntiSpoofingProvider, AntiSpoofProviderReadiness, AntiSpoofResult

logger = logging.getLogger('faceauth.anti_spoof.silent_face')


class SilentFaceAntiSpoofProvider(AntiSpoofingProvider):
    name = 'silent_face'

    def __init__(self):
        self._lock = threading.Lock()
        self._model = None
        self._state = 'NOT_INITIALIZED'
        self._background_warm_up_started = False

    def readiness(self) -> AntiSpoofProviderReadiness:
        return AntiSpoofProviderReadiness(status=self._state, provider=self.name)

    def start_background_warm_up(self) -> None:
        """Non-blocking — see OpenCVSFaceEngine.start_background_warm_up()
        for why this exists separately from warm_up()."""
        with self._lock:
            if self._background_warm_up_started:
                return
            self._background_warm_up_started = True
        thread = threading.Thread(target=self.warm_up, name='silent-face-antispoof-warmup', daemon=True)
        thread.start()

    def warm_up(self) -> None:
        with self._lock:
            if self._state == 'READY':
                return
            self._state = 'LOADING'
        try:
            from deepface.modules import modeling

            start = time.perf_counter()
            model = modeling.build_model(task='spoofing', model_name='Fasnet')
            logger.info('face.anti_spoof.silent_face.warm_up duration=%.2fs', time.perf_counter() - start)
        except Exception:  # noqa: BLE001 - reported via readiness(), never raised to a request
            logger.exception('face.anti_spoof.silent_face.warm_up_failed')
            with self._lock:
                self._state = 'UNAVAILABLE'
            return

        with self._lock:
            self._model = model
            self._state = 'READY'

    def validate(self, image, detected_face) -> AntiSpoofResult:
        from ..service import FaceServiceError

        if self._state != 'READY' or self._model is None:
            raise FaceServiceError('ANTI_SPOOF_MODEL_UNAVAILABLE', 'Secure Face Enrollment is temporarily unavailable.')

        bgr = image[:, :, ::-1]
        facial_area = (detected_face.x, detected_face.y, detected_face.width, detected_face.height)
        with self._lock:
            try:
                is_real, score = self._model.analyze(img=bgr, facial_area=facial_area)
            except Exception as exc:  # noqa: BLE001 - a service/inference error, never mistaken for a real spoof verdict
                logger.warning('face.anti_spoof.silent_face.processing_failed error=%s', type(exc).__name__)
                raise FaceServiceError(
                    'ANTI_SPOOF_PROCESSING_FAILED', 'We could not verify liveness for this frame. Try again.'
                ) from exc

        reason_code = '' if is_real else 'SPOOF_DETECTED'
        return AntiSpoofResult(is_live=bool(is_real), confidence=float(score), provider=self.name, reason_code=reason_code)
