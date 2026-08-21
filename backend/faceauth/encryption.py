import json

from cryptography.fernet import Fernet, InvalidToken, MultiFernet
from django.conf import settings

EMBEDDING_SERIALIZATION_VERSION = 1


class EncryptionKeyMissing(Exception):
    """Raised when no FACE_EMBEDDING_ENCRYPTION_KEYS are configured."""


class EmbeddingDecryptionFailed(Exception):
    """Raised when a stored credential cannot be decrypted with any known key."""


def _multi_fernet():
    keys = settings.FACE_EMBEDDING_ENCRYPTION_KEYS
    if not keys:
        raise EncryptionKeyMissing('FACE_EMBEDDING_ENCRYPTION_KEYS is not configured.')
    return MultiFernet([Fernet(key.encode()) for key in keys])


def encrypt_embedding(vector, model_name, distance_metric, detector_backend):
    """Serialize an embedding vector as JSON (never pickle) and encrypt it.

    Raises EncryptionKeyMissing if no key is configured — callers must treat
    that as a hard failure of the enrollment/verification operation, never a
    silent fallback to storing the embedding unencrypted.
    """
    payload = {
        'version': EMBEDDING_SERIALIZATION_VERSION,
        'model_name': model_name,
        'distance_metric': distance_metric,
        'detector_backend': detector_backend,
        'vector': [float(value) for value in vector],
    }
    serialized = json.dumps(payload).encode('utf-8')
    return _multi_fernet().encrypt(serialized).decode('utf-8')


def decrypt_embedding(encrypted_value):
    """Decrypt and deserialize a stored embedding.

    Raises EncryptionKeyMissing when no key is configured, or
    EmbeddingDecryptionFailed when the value cannot be decrypted or parsed
    with any currently configured key (corrupt data, rotated-away key, or
    tampering) — both are safe-failure conditions the caller must treat as a
    Face Recognition service error, never crash the request.
    """
    try:
        decrypted = _multi_fernet().decrypt(encrypted_value.encode('utf-8'))
    except InvalidToken as exc:
        raise EmbeddingDecryptionFailed('Stored credential could not be decrypted.') from exc

    try:
        payload = json.loads(decrypted.decode('utf-8'))
    except (ValueError, UnicodeDecodeError) as exc:
        raise EmbeddingDecryptionFailed('Stored credential payload is malformed.') from exc

    return payload
