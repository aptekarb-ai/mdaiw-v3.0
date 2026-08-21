"""Wraps the pre-existing DeepFace/RetinaFace/Facenet512 pipeline behind
the FaceRecognitionEngine interface. Kept for rollback, for verifying
credentials created before the OpenCV engine existed, and for compatibility
testing — see faceauth/service.py's engine-aware verify() path and section
I of the engine-migration fix. Delegates to the already-existing,
already-tested module-level functions in faceauth/service.py rather than
reimplementing them, so this wrapper introduces no behavioral change to
the DeepFace path itself.
"""

from django.conf import settings

from .base import AlignedFace, DetectedFace, FaceEngineReadiness, FaceMatchResult, FaceModelMetadata, FaceRecognitionEngine


class DeepFaceEngine(FaceRecognitionEngine):
    name = 'deepface'
    # detect_single_face() below already runs DeepFace's fused
    # detection+anti-spoofing call (anti_spoofing=True) — never run the
    # separate AntiSpoofingProvider on top of that; see the base class
    # docstring for why.
    includes_anti_spoofing = True

    def warm_up(self) -> None:
        # Blocking, matching OpenCVSFaceEngine.warm_up()'s contract — see
        # start_background_warm_up() below for the non-blocking variant the
        # readiness endpoint uses.
        from .. import service

        service.warm_up_models()

    def start_background_warm_up(self) -> None:
        from .. import service

        service.start_background_warm_up()

    def readiness(self) -> FaceEngineReadiness:
        from .. import service

        return FaceEngineReadiness(status=service.get_readiness_status(), engine=self.name)

    def detect_single_face(self, image) -> DetectedFace:
        from .. import service

        face = service._detect_and_validate_single_face(image, settings.FACE_DETECTOR_BACKEND)  # noqa: SLF001
        area = face.get('facial_area') or {}
        return DetectedFace(
            x=int(area.get('x', 0)),
            y=int(area.get('y', 0)),
            width=int(area.get('w', 0)),
            height=int(area.get('h', 0)),
            confidence=float(face.get('confidence') or 0.0),
            raw=face,
        )

    def align_face(self, image, detected_face: DetectedFace) -> AlignedFace:
        # DeepFace's extract_faces(align=True) already aligns during
        # detection — the crop it returned is reused directly, no separate
        # alignment call (this is the existing detector_backend='skip'
        # reuse from the earlier processing-timeout fix).
        return AlignedFace(image=detected_face.raw['face'])

    def create_embedding(self, aligned_face: AlignedFace) -> list:
        from .. import service

        face = {'face': aligned_face.image}
        vector = service._embed_validated_face(face, settings.FACE_MODEL_NAME)  # noqa: SLF001
        return vector.tolist()

    def compare_embeddings(self, first, second) -> FaceMatchResult:
        from .. import service

        threshold = service._verification_threshold(settings.FACE_MODEL_NAME, settings.FACE_DISTANCE_METRIC)  # noqa: SLF001
        distance = service._cosine_distance(first, second)  # noqa: SLF001
        return FaceMatchResult(
            verified=distance <= threshold, score=distance, threshold=threshold, metric=settings.FACE_DISTANCE_METRIC
        )

    def model_metadata(self) -> FaceModelMetadata:
        return FaceModelMetadata(
            engine_name=self.name,
            model_name=settings.FACE_MODEL_NAME,
            model_version='',
            detector_name=settings.FACE_DETECTOR_BACKEND,
            distance_metric=settings.FACE_DISTANCE_METRIC,
            threshold_version='',
        )
