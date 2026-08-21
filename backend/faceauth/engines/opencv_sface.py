"""OpenCV YuNet (detection) + SFace (alignment/embedding/matching) engine.

Model files are never bundled in the repository — see
`faceauth/management/commands/download_face_models.py`. Both `cv2.dnn`
network objects are expensive to construct (ONNX graph load) and are
built at most once per process via a thread-safe lazy singleton, matching
the existing model-warm-up pattern in `faceauth/service.py`.
"""

import logging
import threading
import time

import numpy as np
from django.conf import settings

from .base import (
    AlignedFace,
    DetectedFace,
    FaceEngineReadiness,
    FaceMatchResult,
    FaceModelMetadata,
    FaceRecognitionEngine,
)

logger = logging.getLogger('faceauth.engines.opencv_sface')

MODEL_NAME = 'SFace'
MODEL_VERSION = '2021dec'
DETECTOR_NAME = 'YuNet'
DETECTOR_VERSION = '2026may'
DISTANCE_METRIC = 'cosine'

# cv2.FaceRecognizerSF's match() disType: 0 = cosine similarity, 1 = norm-L2.
_DIST_TYPE_COSINE = 0


class OpenCVSFaceEngine(FaceRecognitionEngine):
    name = 'opencv_sface'

    def __init__(self):
        self._lock = threading.Lock()
        self._detector = None
        self._recognizer = None
        self._state = 'NOT_INITIALIZED'
        self._last_input_size = None
        self._background_warm_up_started = False

    # ---- readiness ----

    def readiness(self) -> FaceEngineReadiness:
        return FaceEngineReadiness(status=self._state, engine=self.name)

    def start_background_warm_up(self) -> None:
        """Non-blocking — spawns a daemon thread running warm_up(). Safe to
        call repeatedly (e.g. once per readiness poll); only the first call
        actually starts a thread. Used by the readiness endpoint, which
        must never block a GET on model loading — see
        faceauth/views.py::readiness_view. `run_face_server` calls
        warm_up() directly instead, deliberately blocking, since that
        command's whole point is to guarantee readiness before serving."""
        with self._lock:
            if self._background_warm_up_started:
                return
            self._background_warm_up_started = True
        thread = threading.Thread(target=self.warm_up, name='opencv-sface-warmup', daemon=True)
        thread.start()

    def warm_up(self) -> None:
        with self._lock:
            if self._state == 'READY':
                return
            self._state = 'LOADING'
        try:
            import cv2

            start = time.perf_counter()
            detector = cv2.FaceDetectorYN.create(
                str(settings.FACE_YUNET_MODEL_PATH),
                '',
                (320, 320),
                settings.FACE_MIN_DETECTION_CONFIDENCE,
                0.3,
                5000,
            )
            recognizer = cv2.FaceRecognizerSF.create(
                str(settings.FACE_SFACE_MODEL_PATH), '', backend_id=0, target_id=0
            )
            # Safe dummy warm-up inference — a blank frame, never real
            # biometric data — forces the ONNX graph to actually build/
            # optimize now rather than on the first real request.
            dummy = np.zeros((320, 320, 3), dtype=np.uint8)
            detector.setInputSize((320, 320))
            detector.detect(dummy)
            elapsed = time.perf_counter() - start
            logger.info('face.engine.opencv_sface.warm_up duration=%.2fs', elapsed)
        except Exception:  # noqa: BLE001 - reported via readiness(), never raised to a request
            logger.exception('face.engine.opencv_sface.warm_up_failed')
            with self._lock:
                self._state = 'UNAVAILABLE'
            return

        with self._lock:
            self._detector = detector
            self._recognizer = recognizer
            self._state = 'READY'

    def _require_ready(self):
        if self._state != 'READY' or self._detector is None or self._recognizer is None:
            from ..service import FaceServiceError

            raise FaceServiceError('MODEL_UNAVAILABLE', 'Face Recognition is temporarily unavailable.')

    # ---- detection ----

    def detect_single_face(self, image) -> DetectedFace:
        from ..service import FaceServiceError

        self._require_ready()
        height, width = image.shape[0], image.shape[1]
        if width <= 0 or height <= 0:
            raise FaceServiceError('FACE_DETECTION_FAILED', 'Frame had invalid dimensions.')

        bgr = image[:, :, ::-1]  # decode_frame() returns RGB; YuNet expects BGR.
        with self._lock:
            try:
                self._detector.setInputSize((width, height))
                _retval, faces = self._detector.detect(bgr)
            except Exception as exc:  # noqa: BLE001 - never leak a raw OpenCV/dnn exception
                logger.warning('face.engine.opencv_sface.detect_failed error=%s', type(exc).__name__)
                raise FaceServiceError('FACE_DETECTION_FAILED', 'Face detection failed.') from exc

        if faces is None or len(faces) == 0:
            raise FaceServiceError('NO_FACE_DETECTED', 'No face was detected. Position your face in the frame.')
        if len(faces) > 1:
            raise FaceServiceError(
                'MULTIPLE_FACES_DETECTED', 'Multiple faces were detected. Only one person should be visible.'
            )

        row = faces[0]
        x, y, w, h, confidence = float(row[0]), float(row[1]), float(row[2]), float(row[3]), float(row[14])

        if confidence < settings.FACE_MIN_DETECTION_CONFIDENCE:
            raise FaceServiceError('NO_FACE_DETECTED', 'No face was detected. Position your face in the frame.')
        if x < 0 or y < 0 or x + w > width or y + h > height:
            raise FaceServiceError('FACE_DETECTION_FAILED', 'Detected face was not fully inside the frame.')
        if min(w, h) < settings.FACE_MIN_FACE_SIZE_PIXELS:
            raise FaceServiceError('FACE_TOO_SMALL', 'Face is too small in the frame. Move closer to the camera.')

        face_center_x, face_center_y = x + w / 2, y + h / 2
        offset_x = abs(face_center_x - width / 2) / width
        offset_y = abs(face_center_y - height / 2) / height
        if offset_x > 0.3 or offset_y > 0.3:
            raise FaceServiceError(
                'FACE_NOT_CENTERED', 'Face is not centered in the frame. Position your face inside the guide.'
            )

        return DetectedFace(x=int(x), y=int(y), width=int(w), height=int(h), confidence=confidence, raw=row)

    # ---- alignment / embedding / matching ----

    def align_face(self, image, detected_face: DetectedFace) -> AlignedFace:
        from ..service import FaceServiceError

        self._require_ready()
        bgr = image[:, :, ::-1]
        with self._lock:
            try:
                aligned = self._recognizer.alignCrop(bgr, detected_face.raw)
            except Exception as exc:  # noqa: BLE001
                raise FaceServiceError('INVALID_FACE_CROP', 'Could not process the detected face.') from exc
        return AlignedFace(image=aligned)

    def create_embedding(self, aligned_face: AlignedFace) -> list:
        from ..service import FaceServiceError

        self._require_ready()
        with self._lock:
            try:
                feature = self._recognizer.feature(aligned_face.image)
            except Exception as exc:  # noqa: BLE001
                raise FaceServiceError('FACE_PROCESSING_FAILED', 'Embedding extraction failed.') from exc
        return np.asarray(feature).flatten().astype(np.float64).tolist()

    def compare_embeddings(self, first, second) -> FaceMatchResult:
        self._require_ready()
        first_arr = np.asarray(first, dtype=np.float32).reshape(1, -1)
        second_arr = np.asarray(second, dtype=np.float32).reshape(1, -1)
        with self._lock:
            score = float(self._recognizer.match(first_arr, second_arr, _DIST_TYPE_COSINE))
        threshold = settings.FACE_SFACE_COSINE_THRESHOLD
        return FaceMatchResult(verified=score >= threshold, score=score, threshold=threshold, metric=DISTANCE_METRIC)

    def model_metadata(self) -> FaceModelMetadata:
        return FaceModelMetadata(
            engine_name=self.name,
            model_name=MODEL_NAME,
            model_version=MODEL_VERSION,
            detector_name=f'{DETECTOR_NAME}-{DETECTOR_VERSION}',
            distance_metric=DISTANCE_METRIC,
            threshold_version=str(settings.FACE_SFACE_COSINE_THRESHOLD),
        )
