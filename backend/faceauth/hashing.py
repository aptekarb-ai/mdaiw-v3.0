import hashlib
import hmac
import secrets

from django.conf import settings


def generate_token():
    """Cryptographically secure opaque token for challenges."""
    return secrets.token_urlsafe(32)


def hash_token(token):
    """SHA-256 of an opaque token — only the hash is ever stored."""
    return hashlib.sha256(token.encode('utf-8')).hexdigest()


def keyed_hash(value):
    """HMAC-SHA256 pepper using the Django secret key.

    Used only for pseudonymizing audit-log fields (username, IP, user-agent)
    so they can be correlated without storing the raw value. This is
    unrelated to and never used for biometric embedding encryption.
    """
    return hmac.new(settings.SECRET_KEY.encode('utf-8'), value.encode('utf-8'), hashlib.sha256).hexdigest()
