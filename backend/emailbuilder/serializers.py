from rest_framework import serializers

from .edm import EdmValidationError, validate_edm
from .models import MAX_EMAIL_WIDTH, MIN_EMAIL_WIDTH, EmailDocument


class EmailDocumentSerializer(serializers.ModelSerializer):
    """`user` is never a writable field here — the view always sets it
    from `request.user` (see views.py::EmailDocumentViewSet.perform_create),
    never from client input, so a draft can never be created for a
    different owner than the authenticated caller.

    `content` (the Email Document Model) is optional on create — Feature
    02's setup wizard never sends it, and the model default supplies an
    empty document — but validated the same way on both create and the
    builder's PATCH updates via edm.validate_edm()."""

    class Meta:
        model = EmailDocument
        fields = [
            'id', 'name', 'platform', 'width', 'start_type', 'status', 'content',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'status', 'created_at', 'updated_at']
        extra_kwargs = {'content': {'required': False}}

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

    def validate_content(self, value):
        try:
            return validate_edm(value)
        except EdmValidationError as error:
            raise serializers.ValidationError(str(error)) from error
