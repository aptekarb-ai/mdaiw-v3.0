from datetime import timedelta

from django.conf import settings
from django.utils import timezone

from .models import FaceLoginAttempt


def is_locked_out(username_hash):
    """Whether Face Recognition login is currently locked for this username.

    Only counts failures since the most recent success, so a successful
    verification resets the counter. Password login is never affected by
    this — callers must only consult this for the face-verify endpoint.
    """
    now = timezone.now()
    last_success = (
        FaceLoginAttempt.objects.filter(username_hash=username_hash, success=True)
        .order_by('-created_at')
        .first()
    )

    failures = FaceLoginAttempt.objects.filter(username_hash=username_hash, success=False)
    if last_success:
        failures = failures.filter(created_at__gt=last_success.created_at)

    window_start = now - timedelta(minutes=settings.FACE_FAILURE_WINDOW_MINUTES)
    recent_failures = failures.filter(created_at__gte=window_start)

    if recent_failures.count() < settings.FACE_MAX_FAILED_ATTEMPTS:
        return False

    last_failure = recent_failures.order_by('-created_at').first()
    lock_until = last_failure.created_at + timedelta(minutes=settings.FACE_LOCK_MINUTES)
    return now < lock_until
