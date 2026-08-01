"""Face Recognition service layer.

Isolates every DeepFace/TensorFlow call behind small, mockable functions so
automated tests never need to run real model inference (see
`faceauth/tests.py`, which patches `_extract_faces` and `_represent`).
Nothing here trusts client input: every frame is re-validated regardless of
what the frontend already checked.
"""

import io

import numpy as np
from django.conf import settings
from PIL import Image, UnidentifiedImageError

from . import encryption

# Cosine distance below this fraction of the pre-tuned threshold, relative to
# the *other* frames in the same set, is treated as "same person" for
# cross-frame consistency. We reuse DeepFace's own pre-tuned verification
# threshold rather than inventing a new number (see `_verification_threshold`).


class FaceServiceError(Exception):
    def __init__(self, code, message=None):
        self.code = code
        super().__init__(message or code)


def _verification_threshold(model_name, distance_metric):
    from deepface.modules import verification as deepface_verification

    return deepface_verification.find_threshold(model_name, distance_metric)


def _extract_faces(image_array, detector_backend, anti_spoofing):
    """Thin wrapper around DeepFace.extract_faces — patched in tests."""
    from deepface import DeepFace

    return DeepFace.extract_faces(
        img_path=image_array,
        detector_backend=detector_backend,
        enforce_detection=True,
        align=True,
        anti_spoofing=anti_spoofing,
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
    """Decode + verify an uploaded frame is a real image, return an RGB array."""
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


def analyze_single_face(image_array, detector_backend, require_liveness):
    """Validate exactly one real (non-spoofed) face is present.

    Returns the DeepFace face-detection dict for the single detected face.
    """
    try:
        faces = _extract_faces(image_array, detector_backend, anti_spoofing=require_liveness)
    except ValueError as exc:
        message = str(exc).lower()
        if 'face could not be detected' in message or 'no face' in message:
            raise FaceServiceError('NO_FACE', 'No face was detected in the frame.') from exc
        raise FaceServiceError('SERVICE_ERROR', 'Face detection failed.') from exc
    except Exception as exc:  # noqa: BLE001 - never leak raw library exceptions
        raise FaceServiceError('SERVICE_ERROR', 'Face detection failed.') from exc

    if len(faces) == 0:
        raise FaceServiceError('NO_FACE', 'No face was detected in the frame.')
    if len(faces) > 1:
        raise FaceServiceError('MULTIPLE_FACES', 'Multiple faces were detected in the frame.')

    face = faces[0]
    if require_liveness and face.get('is_real') is False:
        raise FaceServiceError('LIVENESS_FAILED', 'Liveness check failed for this frame.')

    return face


def extract_embedding(image_array, model_name, detector_backend):
    try:
        results = _represent(image_array, model_name, detector_backend)
    except Exception as exc:  # noqa: BLE001
        raise FaceServiceError('SERVICE_ERROR', 'Embedding extraction failed.') from exc

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


def process_enrollment_frames(uploaded_files, model_name, detector_backend, distance_metric):
    """Validate and combine enrollment frames into a single embedding.

    Returns {"embedding": np.ndarray, "frame_count": int}. Raises
    FaceServiceError on any rejection — caller must not persist anything.
    """
    threshold = _verification_threshold(model_name, distance_metric)
    embeddings = []

    for uploaded_file in uploaded_files:
        image_array = decode_frame(uploaded_file)
        analyze_single_face(image_array, detector_backend, require_liveness=True)
        embeddings.append(extract_embedding(image_array, model_name, detector_backend))

    for i in range(1, len(embeddings)):
        distance = _cosine_distance(embeddings[0], embeddings[i])
        if distance > threshold:
            raise FaceServiceError(
                'INCONSISTENT_FRAMES', 'Frames did not consistently show the same person.'
            )

    averaged = np.mean(np.stack(embeddings), axis=0)
    return {'embedding': averaged, 'frame_count': len(embeddings)}


def process_verification_frames(uploaded_files, model_name, detector_backend, distance_metric):
    """Validate submitted login frames and return a single averaged embedding."""
    embeddings = []
    for uploaded_file in uploaded_files:
        image_array = decode_frame(uploaded_file)
        analyze_single_face(image_array, detector_backend, require_liveness=True)
        embeddings.append(extract_embedding(image_array, model_name, detector_backend))

    threshold = _verification_threshold(model_name, distance_metric)
    for i in range(1, len(embeddings)):
        if _cosine_distance(embeddings[0], embeddings[i]) > threshold:
            raise FaceServiceError(
                'INCONSISTENT_FRAMES', 'Frames did not consistently show the same person.'
            )

    return np.mean(np.stack(embeddings), axis=0)


def enroll(user, uploaded_files):
    """Full enrollment pipeline: validate frames, encrypt, return credential kwargs.

    Does not touch the database — the caller wraps this in transaction.atomic()
    alongside User activation, per the atomicity requirement.
    """
    model_name = settings.FACE_MODEL_NAME
    detector_backend = settings.FACE_DETECTOR_BACKEND
    distance_metric = settings.FACE_DISTANCE_METRIC

    result = process_enrollment_frames(uploaded_files, model_name, detector_backend, distance_metric)

    encrypted = encryption.encrypt_embedding(
        result['embedding'], model_name, distance_metric, detector_backend
    )

    return {
        'encrypted_embedding': encrypted,
        'model_name': model_name,
        'detector_backend': detector_backend,
        'distance_metric': distance_metric,
        'enrollment_frame_count': result['frame_count'],
    }


def verify(credential, uploaded_files):
    """Full verification pipeline against a stored FaceCredential.

    Returns {"verified": bool, "distance": float, "threshold": float}.
    Raises FaceServiceError for any input-validation failure (caller maps
    every raised code to the same generic public response).
    """
    payload = encryption.decrypt_embedding(credential.encrypted_embedding)

    stored_model = payload['model_name']
    stored_metric = payload['distance_metric']
    stored_detector = payload['detector_backend']

    if stored_model != settings.FACE_MODEL_NAME or stored_metric != settings.FACE_DISTANCE_METRIC:
        raise FaceServiceError('MODEL_MISMATCH', 'Stored credential uses an incompatible model configuration.')

    submitted_embedding = process_verification_frames(
        uploaded_files, stored_model, stored_detector, stored_metric
    )

    threshold = _verification_threshold(stored_model, stored_metric)
    distance = _cosine_distance(submitted_embedding, payload['vector'])

    return {'verified': distance <= threshold, 'distance': distance, 'threshold': threshold}
