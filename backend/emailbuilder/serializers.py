from rest_framework import serializers

from .edm import EdmValidationError, validate_edm, validate_module_instance
from .models import MAX_EMAIL_WIDTH, MIN_EMAIL_WIDTH, EmailDocument, SavedEmailModule


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


class SavedEmailModuleSerializer(serializers.ModelSerializer):
    """`user` is never writable here — the view sets it from
    `request.user` (see views.py::SavedEmailModuleViewSet.perform_create),
    same convention as EmailDocumentSerializer. `module_type`/`props`/
    `settings` are validated with the exact same rules as one EDM module
    instance (edm.validate_module_instance) — a saved module is just that
    triple, captured outside of any document."""

    class Meta:
        model = SavedEmailModule
        fields = ['id', 'name', 'module_type', 'props', 'settings', 'created_at', 'updated_at']
        read_only_fields = ['id', 'created_at', 'updated_at']

    def validate_name(self, value):
        trimmed = value.strip()
        if not trimmed:
            raise serializers.ValidationError('Module name is required.')
        return trimmed

    def validate(self, attrs):
        module_type = attrs.get('module_type', getattr(self.instance, 'module_type', None))
        props = attrs.get('props', getattr(self.instance, 'props', None))
        module_settings = attrs.get('settings', getattr(self.instance, 'settings', None))
        try:
            validate_module_instance(module_type, props, module_settings, prefix='module')
        except EdmValidationError as error:
            raise serializers.ValidationError({'module_type': [str(error)]}) from error
        return attrs
