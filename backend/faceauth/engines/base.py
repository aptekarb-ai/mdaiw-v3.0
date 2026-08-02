"""Provider interface for the biometric face-recognition engine.

Two implementations exist: `OpenCVSFaceEngine` (YuNet detection + SFace
embeddings/matching) and `DeepFaceEngine` (wraps the pre-existing
DeepFace/RetinaFace/Facenet512 pipeline, kept for rollback and for
verifying credentials created before this engine was introduced — see
`faceauth/service.py`'s engine-aware verify() path). Selected via
`settings.FACE_RECOGNITION_ENGINE`; see `registry.py::get_engine`.

Every method here must raise `faceauth.service.FaceServiceError` (never a
raw library exception) on any rejection, exactly like the rest of the
Face Recognition service layer — callers already know how to map that to a
safe client response.
"""

from dataclasses import dataclass, field
from typing import Any


@dataclass
class DetectedFace:
    """One validated, single detected face. `raw` carries whatever the
    concrete engine needs to pass into its own align/embed steps (e.g. the
    OpenCV engine's raw 15-value detection row, or the DeepFace engine's
    face dict) — never inspected outside that same engine."""

    x: int
    y: int
    width: int
    height: int
    confidence: float
    raw: Any = field(repr=False)


@dataclass
class AlignedFace:
    """An aligned, cropped face image ready for embedding. `image` is a
    numpy array in whatever format the engine's own embed step expects —
    never assumed compatible across engines."""

    image: Any = field(repr=False)


@dataclass
class FaceMatchResult:
    verified: bool
    score: float
    threshold: float
    metric: str


@dataclass
class FaceModelMetadata:
    """Recorded on FaceCredential/FaceEnrollmentProof at creation time so a
    later verification always knows which engine/model/threshold produced
    a given stored embedding — see faceauth/models.py and section I of the
    engine-migration fix. Never mixed across engines."""

    engine_name: str
    model_name: str
    model_version: str
    detector_name: str
    distance_metric: str
    threshold_version: str


@dataclass
class FaceEngineReadiness:
    status: str  # NOT_INITIALIZED | LOADING | READY | UNAVAILABLE
    engine: str


class FaceRecognitionEngine:
    """Abstract provider interface. Every concrete engine must implement
    all six methods below with these exact semantics."""

    #: Value stored in FaceCredential.engine_name / matched against
    #: settings.FACE_RECOGNITION_ENGINE.
    name: str = ''

    #: True when detect_single_face() already performs its own passive
    #: anti-spoofing check internally (the legacy DeepFace engine fuses
    #: detection + anti-spoofing into one call — see DeepFaceEngine).
    #: When True, the separate AntiSpoofingProvider step in
    #: faceauth/service.py::_process_frames_with_engine is skipped for
    #: this engine, so anti-spoofing never runs twice on the same frame.
    #: OpenCVSFaceEngine (YuNet has no anti-spoofing of its own) leaves
    #: this False, so the separate provider always runs for it.
    includes_anti_spoofing: bool = False

    def warm_up(self) -> None:
        """Load all models this engine needs into memory. Idempotent —
        safe to call more than once. Must never process real biometric
        data; only loads model weights. Blocking — see
        start_background_warm_up() for a non-blocking variant."""
        raise NotImplementedError

    def start_background_warm_up(self) -> None:
        """Non-blocking: spawns a background thread running warm_up().
        Safe to call repeatedly — only the first call actually starts a
        thread. Used by the readiness endpoint, which must never block a
        GET on model loading."""
        raise NotImplementedError

    def readiness(self) -> FaceEngineReadiness:
        """Cheap, non-blocking snapshot of whether warm_up() has completed
        successfully. Never triggers loading itself."""
        raise NotImplementedError

    def detect_single_face(self, image) -> DetectedFace:
        """Validate exactly one face is present and return it. Raises
        FaceServiceError (NO_FACE_DETECTED / MULTIPLE_FACES_DETECTED /
        FACE_TOO_SMALL / FACE_NOT_CENTERED / FACE_DETECTION_FAILED) on any
        rejection."""
        raise NotImplementedError

    def align_face(self, image, detected_face: DetectedFace) -> AlignedFace:
        """Align and crop the detected face for embedding."""
        raise NotImplementedError

    def create_embedding(self, aligned_face: AlignedFace) -> list:
        """Generate one feature vector from an aligned face."""
        raise NotImplementedError

    def compare_embeddings(self, first, second) -> FaceMatchResult:
        """Compare two embeddings produced by *this* engine. Never called
        with an embedding from a different engine — see
        faceauth/service.py's engine-aware verify() path, which selects
        the engine from the stored credential's engine_name before this is
        ever reached."""
        raise NotImplementedError

    def model_metadata(self) -> FaceModelMetadata:
        """Static metadata describing this engine's configured models —
        recorded on every credential/proof this engine creates."""
        raise NotImplementedError
