"""Face Recognition service layer.

Isolates every DeepFace/TensorFlow call behind small, mockable functions so
automated tests never need to run real model inference (see
`faceauth/tests.py`, which patches `_extract_faces` and `_represent`).
Nothing here trusts client input: every frame is re-validated regardless of
what the frontend already checked.

Timing note: DeepFace caches every model it builds (detector, recognition,
anti-spoofing) in a process-wide singleton dict (see
`deepface.modules.modeling.build_model`) — a model is only ever loaded once
per process, not once per frame or once per request. The slow "stuck"
experience reported against the registration wizard's Face Enrollment step is
cold-start model loading (TensorFlow import + first-time weight load), which
is unavoidable on the *first* inference in a process but is a one-time cost —
see `warm_up_models()` below and `faceauth/management/commands/
warm_up_face_models.py` for how to pay that cost outside the request path.
"""

import io
import logging
import threading
import time
from contextlib import contextmanager

import numpy as np
from django.conf import settings
from PIL import Image, UnidentifiedImageError

from . import encryption
from .anti_spoof import get_anti_spoof_provider
from .engines import get_engine

logger = logging.getLogger('faceauth.service')

# Process-wide readiness tracking for the three models the biometric pipeline
# depends on. Separate from DeepFace's own internal model cache (see the
# module docstring) — this tracks whether *this process* has confirmed each
# model loads, so a request can fail fast with MODEL_UNAVAILABLE instead of
# either hanging on a slow cold load inside its own timeout budget or racing
# a background warm-up thread. Written only from warm_up_models(); read
# freely (a stale "not ready" read just means one extra fast-fail response,
# never an incorrect "ready").
_readiness_lock = threading.Lock()
_readiness = {'detector': False, 'recognition': False, 'anti_spoofing': False}
# Safe error metadata only (exception *class name*, e.g. "ModuleNotFoundError")
# — never the full exception message, which could theoretically mention a
# local file path. Exposed only in aggregate via get_readiness_status();
# never returned verbatim to a client.
_model_errors = {'detector': None, 'recognition': None, 'anti_spoofing': None}
_warm_up_started = False

# Cosine distance below this fraction of the pre-tuned threshold, relative to
# the *other* frames in the same set, is treated as "same person" for
# cross-frame consistency. We reuse DeepFace's own pre-tuned verification
# threshold rather than inventing a new number (see `_verification_threshold`).

# Cheap, CPU-only, pre-DeepFace quality gate (section D/E of the processing-
# timeout fix) — rejects an obviously unusable frame (too dark, too bright,
# no edge detail at all) before it ever reaches the detector/anti-
# spoofing/embedding models, so a garbage frame never pays for a real
# inference pass. Deliberately conservative: this only catches frames a
# real capture would never legitimately produce, not a stylistic quality
# bar — the real accuracy gate is still detection + anti-spoofing +
# cross-frame identity consistency below, unchanged.
MIN_BRIGHTNESS = 25.0
MAX_BRIGHTNESS = 235.0
MIN_SHARPNESS = 15.0

# Reject a detected face that is too small or too far from center *before*
# spending an embedding-model call on it — reuses the facial_area DeepFace's
# own detector already returned, no extra inference.
MIN_FACE_AREA_RATIO = 0.04
MAX_FACE_CENTER_OFFSET_RATIO = 0.30

# See enroll(): only the highest-quality N of the
# submitted, already-validated frames are spent on the (comparatively
# expensive) embedding model — every submitted frame still independently
# passes detection + anti-spoofing + quality + position validation
# regardless. Configurable because this is a deliberate, documented
# security/performance tradeoff (see docs/module-1/IMPLEMENTATION_STATUS.md)
# an operator may want to revisit, not a hard-coded magic number.


class FaceServiceError(Exception):
    def __init__(self, code, message=None):
        self.code = code
        super().__init__(message or code)


@contextmanager
def _timed_stage(timings, key):
    """Accumulate elapsed milliseconds for `key` into `timings` (a plain
    dict passed in by the caller). Never logs or stores frame/embedding
    data — only stage names and durations."""
    start = time.perf_counter()
    try:
        yield
    finally:
        elapsed_ms = (time.perf_counter() - start) * 1000
        timings[key] = timings.get(key, 0.0) + elapsed_ms


def log_timings(request_id, stage, timings, total_ms):
    """Log per-stage timing for one Face Enrollment/verification request.
    Never logs frames, embeddings, passwords, tokens, or encryption keys —
    only a request_id and millisecond durations per named stage."""
    breakdown = ', '.join(f'{key}={value:.1f}ms' for key, value in timings.items())
    logger.info('face.%s request_id=%s total=%.1fms %s', stage, request_id, total_ms, breakdown)


def warm_up_models():
    """Force-load the configured detector, recognition, and anti-spoofing
    models into DeepFace's process-wide model cache. Idempotent — safe to
    call more than once; DeepFace's own singleton cache makes any call after
    the first a cheap no-op. Touches no biometric data (no image is
    processed, nothing is written to the database).

    Each of the three models is loaded independently so that one missing
    optional dependency (e.g. the anti-spoofing model requires `torch`,
    separate from the TensorFlow stack the detector/recognition models use)
    does not prevent the other two from warming up. Returns a dict of
    {model_key: (True, elapsed_seconds) | (False, error_message)} so the
    caller (the `warm_up_face_models` management command) can report exactly
    which models loaded and how long each took.
    """
    from deepface import DeepFace

    targets = [
        ('detector', settings.FACE_DETECTOR_BACKEND, 'face_detector'),
        ('recognition', settings.FACE_MODEL_NAME, 'facial_recognition'),
        ('anti_spoofing', 'Fasnet', 'spoofing'),
    ]
    results = {}
    for key, model_name, task in targets:
        start = time.perf_counter()
        try:
            DeepFace.build_model(model_name, task=task)
        except Exception as exc:  # noqa: BLE001 - reported to the caller, not swallowed silently
            results[key] = (False, str(exc))
            with _readiness_lock:
                _readiness[key] = False
                _model_errors[key] = type(exc).__name__
        else:
            results[key] = (True, time.perf_counter() - start)
            with _readiness_lock:
                _readiness[key] = True
                _model_errors[key] = None
    return results


def get_model_readiness():
    """Safe, cheap snapshot of which models this process has confirmed
    loaded. Never triggers loading itself — see start_background_warm_up()."""
    with _readiness_lock:
        return dict(_readiness)


def is_ready():
    """True only when detector, recognition, and anti-spoofing have all
    loaded in this process. Anti-spoofing is required, not optional — the
    pipeline never skips liveness, so a missing anti-spoofing model (e.g.
    torch not installed) must fail the readiness check rather than silently
    allow requests that would fail deep inside the pipeline anyway, after
    already spending most of the request's timeout budget."""
    readiness = get_model_readiness()
    return all(readiness.values())


def get_readiness_status():
    """The only readiness vocabulary ever exposed to a client (see
    faceauth/views.py::readiness_view) — one of 'READY', 'LOADING',
    'UNAVAILABLE'. Never returns model names, exception details, or
    filesystem paths; those stay internal to _model_errors/warm_up_models's
    return value (read only by the trusted, local warm_up_face_models /
    run_face_server management commands)."""
    with _readiness_lock:
        readiness_snapshot = dict(_readiness)
        errors_snapshot = dict(_model_errors)
    if any(errors_snapshot.values()):
        return 'UNAVAILABLE'
    if all(readiness_snapshot.values()):
        return 'READY'
    return 'LOADING'


def start_background_warm_up():
    """Fire-and-forget model loading on a daemon thread, safe to call any
    number of times from any number of threads/processes-within-the-same-
    process — only the first call actually starts a thread. Intended to be
    triggered once when the Django server process starts (see
    faceauth/apps.py::FaceauthConfig.ready()) so the *first real request*
    to a freshly started `runserver` process does not pay the full cold
    model-load cost inside its own request timeout. Idempotent and
    non-blocking: callers never wait on this."""
    global _warm_up_started
    with _readiness_lock:
        if _warm_up_started:
            return
        _warm_up_started = True
    thread = threading.Thread(target=warm_up_models, name='face-model-warmup', daemon=True)
    thread.start()


def _verification_threshold(model_name, distance_metric):
    from deepface.modules import verification as deepface_verification

    return deepface_verification.find_threshold(model_name, distance_metric)


def _extract_faces(image_array, detector_backend, anti_spoofing):
    """Thin wrapper around DeepFace.extract_faces — patched in tests.

    `normalize_face=False, color_face='bgr'` are deliberate: they make the
    returned face crop (`result[i]['face']`) safe to feed straight into
    `_represent(..., detector_backend='skip')` without re-detecting — see
    `_embed_validated_face`. Verified against the installed
    deepface==0.0.100 source: with the defaults (normalize_face=True,
    color_face='rgb'), the crop is divided by 255 and channel-flipped to
    RGB; DeepFace.represent's own `detector_backend='skip'` code path
    expects raw, unnormalized BGR input (it does its own `img[:, :, ::-1]`
    BGR→RGB flip and its own normalization). Reusing the default-normalized
    crop there would silently double-process the pixels and corrupt the
    embedding — this is why the two calls must agree on this exact
    pixel-format contract, not just skip re-detection blindly.
    """
    from deepface import DeepFace

    return DeepFace.extract_faces(
        img_path=image_array,
        detector_backend=detector_backend,
        enforce_detection=True,
        align=True,
        anti_spoofing=anti_spoofing,
        normalize_face=False,
        color_face='bgr',
    )


def _represent(image_array, model_name, detector_backend):
    """Thin wrapper around DeepFace.represent — patched in tests."""
    from deepface import DeepFace

    return DeepFace.represent(
        img_path=image_array,
        model_name=model_name,
        detector_backend=detector_backend,
        enforce_detection=True,
        align=True,
    )


def validate_frame_size(uploaded_file):
    if uploaded_file.size > settings.FACE_FRAME_MAX_BYTES:
        raise FaceServiceError('FRAME_TOO_LARGE', 'Frame exceeds the maximum allowed size.')


def decode_frame(uploaded_file):
    """Decode + verify an uploaded frame is a real image, return an RGB array.

    Closes the uploaded file handle itself (success or failure) rather than
    leaving that to the caller — an `InMemoryUploadedFile`/
    `TemporaryUploadedFile` left open until Django's own request-teardown
    GC holds a backing buffer or temp file open longer than necessary,
    which matters here since a request may hold up to FACE_MAX_FRAMES of
    them concurrently.
    """
    try:
        validate_frame_size(uploaded_file)
        uploaded_file.seek(0)
        raw = uploaded_file.read()
        try:
            pil_image = Image.open(io.BytesIO(raw))
            pil_image.verify()
            pil_image = Image.open(io.BytesIO(raw))
            pil_image = pil_image.convert('RGB')
        except (UnidentifiedImageError, OSError, ValueError) as exc:
            raise FaceServiceError('CAMERA_FRAME_INVALID', 'Frame is not a valid image.') from exc

        return np.array(pil_image)
    finally:
        uploaded_file.close()


def _reraise_model_or_processing_error(exc, fallback_message):
    """Map an unexpected exception from a DeepFace call to the most specific
    safe code available: a missing/broken install (ImportError) is a
    different operational problem than a corrupt/unreachable weight file
    (OSError), which is different again from an unclassified failure during
    otherwise-normal processing."""
    if isinstance(exc, (ImportError, ModuleNotFoundError)):
        raise FaceServiceError('MODEL_UNAVAILABLE', 'Face Recognition model is unavailable.') from exc
    if isinstance(exc, OSError):
        raise FaceServiceError('MODEL_INITIALIZATION_FAILED', 'Face Recognition model failed to load.') from exc
    raise FaceServiceError('FACE_PROCESSING_FAILED', fallback_message) from exc


def assess_image_quality(image_array):
    """Cheap, CPU-only brightness/sharpness pre-check — runs before any
    DeepFace call so an unusable frame (too dark, too bright, no edge
    detail at all — e.g. a covered lens or a blank wall) never pays for a
    real detector/anti-spoofing/embedding pass. Raises FaceServiceError on
    rejection; returns None on success. Lazily imports cv2, matching this
    module's existing convention of never importing heavy vision libraries
    at module load time (see the DeepFace imports elsewhere in this file)."""
    import cv2

    gray = cv2.cvtColor(image_array, cv2.COLOR_RGB2GRAY)
    brightness = float(gray.mean())
    if brightness < MIN_BRIGHTNESS or brightness > MAX_BRIGHTNESS:
        raise FaceServiceError('POOR_LIGHTING', 'Lighting is too dark or too bright. Try a well-lit area.')

    sharpness = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    if sharpness < MIN_SHARPNESS:
        raise FaceServiceError('BLURRY_FRAME', 'The frame was too blurry. Hold still and try again.')


def _validate_face_position(face, image_shape):
    """Reject a detected face that is too small or too far off-center,
    reusing the facial_area DeepFace's own detector already computed — no
    extra inference call needed."""
    area = face.get('facial_area') or {}
    frame_h, frame_w = image_shape[0], image_shape[1]
    face_w, face_h = area.get('w', 0), area.get('h', 0)

    if frame_w <= 0 or frame_h <= 0 or face_w <= 0 or face_h <= 0:
        raise FaceServiceError('FACE_TOO_SMALL', 'Face is too small in the frame. Move closer to the camera.')

    if (face_w * face_h) / (frame_w * frame_h) < MIN_FACE_AREA_RATIO:
        raise FaceServiceError('FACE_TOO_SMALL', 'Face is too small in the frame. Move closer to the camera.')

    center_x = area.get('x', 0) + face_w / 2
    center_y = area.get('y', 0) + face_h / 2
    offset_x = abs(center_x - frame_w / 2) / frame_w
    offset_y = abs(center_y - frame_h / 2) / frame_h
    if offset_x > MAX_FACE_CENTER_OFFSET_RATIO or offset_y > MAX_FACE_CENTER_OFFSET_RATIO:
        raise FaceServiceError(
            'FACE_NOT_CENTERED', 'Face is not centered in the frame. Position your face inside the guide.'
        )


def _detect_and_validate_single_face(image_array, detector_backend):
    """One DeepFace call does detection *and* anti-spoofing together
    (`anti_spoofing=True`) — this is the single most expensive step in the
    pipeline, and there is exactly one such call per frame, never more.
    Returns the validated face dict (including its reusable crop — see
    `_extract_faces`'s docstring) for the caller to pass to
    `_embed_validated_face` if this frame is selected for embedding.
    """
    try:
        faces = _extract_faces(image_array, detector_backend, anti_spoofing=True)
    except ValueError as exc:
        message = str(exc).lower()
        if 'face could not be detected' in message or 'no face' in message:
            raise FaceServiceError('NO_FACE', 'No face was detected. Position your face in the frame.') from exc
        _reraise_model_or_processing_error(exc, 'Face detection failed.')
    except Exception as exc:  # noqa: BLE001 - never leak raw library exceptions
        _reraise_model_or_processing_error(exc, 'Face detection failed.')

    if len(faces) == 0:
        raise FaceServiceError('NO_FACE', 'No face was detected. Position your face in the frame.')
    if len(faces) > 1:
        raise FaceServiceError('MULTIPLE_FACES', 'Multiple faces were detected. Only one person should be visible.')

    face = faces[0]
    if 'is_real' not in face:
        raise FaceServiceError('LIVENESS_FAILED', 'We could not verify liveness for this frame. Try again.')
    if face['is_real'] is False:
        raise FaceServiceError(
            'SPOOF_DETECTED', 'This does not appear to be a live person in front of a real camera.'
        )

    return face


def _embed_validated_face(face, model_name):
    """Generates an embedding by reusing the crop DeepFace's own detector
    already produced and validated in `_detect_and_validate_single_face` —
    `detector_backend='skip'` tells DeepFace.represent to skip re-detecting
    the face entirely and go straight to the embedding model, avoiding a
    second, redundant full detector pass over the identical frame. Only
    ever called with a crop that has already passed detection,
    anti-spoofing, quality, and position validation — never on raw,
    unvalidated client input (see `_extract_faces`'s docstring for the
    exact pixel-format contract this depends on)."""
    crop = face['face']
    try:
        results = _represent(crop, model_name, 'skip')
    except Exception as exc:  # noqa: BLE001
        _reraise_model_or_processing_error(exc, 'Embedding extraction failed.')

    if not results:
        raise FaceServiceError('NO_FACE', 'No face was detected in the frame.')

    return np.array(results[0]['embedding'], dtype=np.float64)


def _cosine_distance(vector_a, vector_b):
    a = np.asarray(vector_a, dtype=np.float64)
    b = np.asarray(vector_b, dtype=np.float64)
    denom = np.linalg.norm(a) * np.linalg.norm(b)
    if denom == 0:
        return 1.0
    return float(1 - np.dot(a, b) / denom)


_SPOOF_ERROR_MESSAGES = {
    'SPOOF_DETECTED': 'This does not appear to be a live person in front of a real camera.',
    'LIVENESS_FAILED': 'We could not verify liveness for this frame. Try again.',
}


def _process_frames_with_engine(uploaded_files, engine, anti_spoof_provider, timings):
    """Decode + quality-check + detect + passive-anti-spoof + align every
    submitted frame exactly once each, using whichever FaceRecognitionEngine
    and AntiSpoofingProvider the caller selected. Returns a list of
    {'aligned': AlignedFace, 'quality_score': float} for every frame that
    passed — the caller decides how many to spend an embedding call on
    (enroll()) or embeds all of them (verify()). Every submitted frame is
    fully validated here regardless of that later choice.

    `quality_score` is the anti-spoofing confidence (or, for an engine that
    already fuses anti-spoofing into detection, the detection confidence)
    — reused to rank frames for enrollment's frame-selection tradeoff.

    If `engine.includes_anti_spoofing` is True (the legacy DeepFace engine,
    which already runs anti-spoofing as part of `detect_single_face()`),
    the separate `anti_spoof_provider` is never invoked for that frame —
    running two independent anti-spoofing passes over the same frame would
    be genuinely redundant inference, not defense in depth, since both
    would be answering the exact same question from the exact same frame.
    """
    validated = []
    for uploaded_file in uploaded_files:
        with _timed_stage(timings, 'decode'):
            image_array = decode_frame(uploaded_file)

        with _timed_stage(timings, 'quality'):
            assess_image_quality(image_array)

        detect_start = time.perf_counter()
        detected = engine.detect_single_face(image_array)
        timings['detection'] = timings.get('detection', 0.0) + (time.perf_counter() - detect_start) * 1000

        if engine.includes_anti_spoofing:
            quality_score = detected.confidence
        else:
            anti_spoof_start = time.perf_counter()
            spoof_result = anti_spoof_provider.validate(image_array, detected)
            timings['anti_spoof'] = timings.get('anti_spoof', 0.0) + (time.perf_counter() - anti_spoof_start) * 1000
            if not spoof_result.is_live:
                code = spoof_result.reason_code or 'SPOOF_DETECTED'
                raise FaceServiceError(
                    code, _SPOOF_ERROR_MESSAGES.get(code, _SPOOF_ERROR_MESSAGES['LIVENESS_FAILED'])
                )
            quality_score = spoof_result.confidence

        with _timed_stage(timings, 'alignment'):
            aligned = engine.align_face(image_array, detected)

        validated.append({'aligned': aligned, 'quality_score': quality_score})

    return validated


def enroll(user, uploaded_files, request_id=None):
    """Full enrollment pipeline: validate frames, encrypt, return credential
    kwargs. New enrollments always use the currently configured engine
    (`settings.FACE_RECOGNITION_ENGINE`) — never a caller-chosen one, so a
    credential's engine_name always genuinely reflects what created it.

    Does not touch the database — the caller wraps this in transaction.atomic()
    alongside User activation, per the atomicity requirement.

    Logs a per-stage timing breakdown under `request_id` regardless of
    success or failure (never logs frame or embedding data — see
    `log_timings`).
    """
    engine = get_engine()
    anti_spoof_provider = get_anti_spoof_provider()

    timings = {}
    overall_start = time.perf_counter()
    try:
        validated = _process_frames_with_engine(uploaded_files, engine, anti_spoof_provider, timings)

        # Only the highest-quality FACE_EMBEDDING_FRAME_COUNT of the
        # already-validated frames are spent on the (comparatively
        # expensive) embedding model — see docs/module-1/
        # IMPLEMENTATION_STATUS.md for the documented tradeoff. Never below
        # 2: cross-frame identity consistency needs at least two embeddings.
        embedding_frame_count = max(2, settings.FACE_EMBEDDING_FRAME_COUNT)
        ranked = sorted(validated, key=lambda item: item['quality_score'], reverse=True)
        selected = ranked[:embedding_frame_count] if len(ranked) > embedding_frame_count else ranked

        embeddings = []
        for item in selected:
            with _timed_stage(timings, 'embedding'):
                embeddings.append(engine.create_embedding(item['aligned']))

        with _timed_stage(timings, 'consistency'):
            for i in range(1, len(embeddings)):
                match = engine.compare_embeddings(embeddings[0], embeddings[i])
                if not match.verified:
                    raise FaceServiceError(
                        'IDENTITY_INCONSISTENT', 'Frames did not consistently show the same person.'
                    )

        averaged = np.mean(np.asarray(embeddings, dtype=np.float64), axis=0).tolist()

        metadata = engine.model_metadata()
        with _timed_stage(timings, 'proof'):
            encrypted = encryption.encrypt_embedding(
                averaged, metadata.model_name, metadata.distance_metric, metadata.detector_name
            )

        return {
            'encrypted_embedding': encrypted,
            'model_name': metadata.model_name,
            'detector_backend': metadata.detector_name,
            'distance_metric': metadata.distance_metric,
            'engine_name': metadata.engine_name,
            'model_version': metadata.model_version,
            'threshold_version': metadata.threshold_version,
            'enrollment_frame_count': len(embeddings),
        }
    finally:
        log_timings(request_id, 'enroll', timings, (time.perf_counter() - overall_start) * 1000)


def verify(credential, uploaded_files):
    """Full verification pipeline against a stored FaceCredential.

    Selects the FaceRecognitionEngine from `credential.engine_name` — never
    from live settings — so a credential always verifies against the exact
    engine that created it, regardless of what FACE_RECOGNITION_ENGINE is
    currently configured to. Fails safely (MODEL_UNAVAILABLE) if that
    engine cannot be warmed, rather than silently falling back to a
    different engine or interpreting the embedding as something it is not.

    Returns {"verified": bool, "distance": float, "threshold": float} —
    "distance" is whatever score the credential's own engine produces
    (cosine distance for the legacy DeepFace engine, cosine similarity for
    OpenCV SFace); never compared across engines.
    """
    engine_name = getattr(credential, 'engine_name', None) or 'deepface'
    engine = get_engine(engine_name)
    anti_spoof_provider = get_anti_spoof_provider()

    payload = encryption.decrypt_embedding(credential.encrypted_embedding)

    timings = {}
    validated = _process_frames_with_engine(uploaded_files, engine, anti_spoof_provider, timings)
    embeddings = [engine.create_embedding(item['aligned']) for item in validated]

    for i in range(1, len(embeddings)):
        match = engine.compare_embeddings(embeddings[0], embeddings[i])
        if not match.verified:
            raise FaceServiceError('IDENTITY_INCONSISTENT', 'Frames did not consistently show the same person.')

    submitted_embedding = np.mean(np.asarray(embeddings, dtype=np.float64), axis=0).tolist()
    match = engine.compare_embeddings(submitted_embedding, payload['vector'])

    return {'verified': match.verified, 'distance': match.score, 'threshold': match.threshold}
