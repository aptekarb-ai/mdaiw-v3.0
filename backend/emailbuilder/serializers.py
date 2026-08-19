from rest_framework import serializers

from .models import MAX_EMAIL_WIDTH, MIN_EMAIL_WIDTH, EmailDocument


class EmailDocumentSerializer(serializers.ModelSerializer):
    """`user` is never a writable field here — the view always sets it
    from `request.user` (see views.py::EmailDocumentViewSet.perform_create),
    never from client input, so a draft can never be created for a
    different owner than the authenticated caller."""

    class Meta:
        model = EmailDocument
        fields = ['id', 'name', 'platform', 'width', 'start_type', 'status', 'created_at', 'updated_at']
        read_only_fields = ['id', 'status', 'created_at', 'updated_at']

    def validate_name(self, value):
        trimmed = value.strip()
        if not trimmed:
            raise serializers.ValidationError('Email name is required.')
        return trimmed

    def validate_width(self, value):
        if value < MIN_EMAIL_WIDTH or value > MAX_EMAIL_WIDTH:
            raise serializers.ValidationError(
                f'Width must be between {MIN_EMAIL_WIDTH} and {MAX_EMAIL_WIDTH} pixels.',
            )
        return value
