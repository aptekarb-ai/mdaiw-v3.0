from django.contrib import admin

from .models import FaceChallenge, FaceCredential, FaceLoginAttempt


@admin.register(FaceCredential)
class FaceCredentialAdmin(admin.ModelAdmin):
    # encrypted_embedding is intentionally excluded from list_display,
    # readonly_fields, and every other surface — it must never render
    # anywhere in Admin, even in an expanded detail view.
    list_display = (
        'user',
        'model_name',
        'detector_backend',
        'is_active',
        'enrollment_frame_count',
        'last_verified_at',
        'created_at',
    )
    list_filter = ('is_active', 'model_name', 'detector_backend')
    search_fields = ('user__username', 'user__email')
    readonly_fields = (
        'model_name',
        'detector_backend',
        'distance_metric',
        'embedding_version',
        'enrollment_frame_count',
        'created_at',
        'updated_at',
        'last_verified_at',
    )
    exclude = ('encrypted_embedding',)


@admin.register(FaceChallenge)
class FaceChallengeAdmin(admin.ModelAdmin):
    list_display = ('purpose', 'user', 'expires_at', 'used_at', 'failed_attempts', 'created_at')
    list_filter = ('purpose',)
    readonly_fields = ('token_hash', 'created_at')
    exclude = ()


@admin.register(FaceLoginAttempt)
class FaceLoginAttemptAdmin(admin.ModelAdmin):
    list_display = ('username_hash', 'success', 'reason_code', 'user', 'created_at')
    list_filter = ('success', 'reason_code')
    readonly_fields = (
        'user',
        'username_hash',
        'success',
        'reason_code',
        'distance',
        'threshold',
        'ip_hash',
        'user_agent_hash',
        'created_at',
    )
