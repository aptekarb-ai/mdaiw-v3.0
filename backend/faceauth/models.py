from django.conf import settings
from django.db import models
from django.utils import timezone


class FaceCredential(models.Model):
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='face_credential',
    )
    encrypted_embedding = models.TextField()
    embedding_version = models.PositiveSmallIntegerField(default=1)
    model_name = models.CharField(max_length=100)
    detector_backend = models.CharField(max_length=100)
    distance_metric = models.CharField(max_length=50)
    enrollment_frame_count = models.PositiveSmallIntegerField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    last_verified_at = models.DateTimeField(null=True, blank=True)
    revoked_at = models.DateTimeField(null=True, blank=True)
    is_active = models.BooleanField(default=True)

    def __str__(self):
        return f'FaceCredential(user={self.user_id}, active={self.is_active})'


class FaceChallengePurpose(models.TextChoices):
    ENROLL = 'ENROLL', 'Enroll'
    LOGIN = 'LOGIN', 'Login'


class FaceChallenge(models.Model):
    token_hash = models.CharField(max_length=64, unique=True)
    purpose = models.CharField(max_length=16, choices=FaceChallengePurpose.choices)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='face_challenges',
    )
    challenge_actions = models.JSONField()
    expires_at = models.DateTimeField()
    used_at = models.DateTimeField(null=True, blank=True)
    failed_attempts = models.PositiveSmallIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    def is_expired(self):
        return timezone.now() >= self.expires_at

    def is_used(self):
        return self.used_at is not None

    def __str__(self):
        return f'FaceChallenge({self.purpose}, used={self.is_used()})'


class FaceLoginAttempt(models.Model):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='face_login_attempts',
    )
    username_hash = models.CharField(max_length=64)
    success = models.BooleanField()
    reason_code = models.CharField(max_length=64)
    distance = models.FloatField(null=True, blank=True)
    threshold = models.FloatField(null=True, blank=True)
    ip_hash = models.CharField(max_length=64, blank=True, default='')
    user_agent_hash = models.CharField(max_length=64, blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [
            models.Index(fields=['username_hash', 'created_at']),
        ]

    def __str__(self):
        return f'FaceLoginAttempt(success={self.success}, reason={self.reason_code})'
