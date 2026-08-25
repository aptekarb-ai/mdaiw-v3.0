from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers

from .ai_command import MAX_MESSAGE_LENGTH
from . import learning
from . import module_capabilities
from .custom_css_security import validate_custom_css_security
from .edm import UNSAFE_URL_PREFIXES, EdmValidationError, validate_edm, validate_module_instance
from .models import (
    MAX_EMAIL_WIDTH, MIN_EMAIL_WIDTH, EmailAsset, EmailAssetSourceType, EmailDocument, RepairSignalOutcome,
    RepairSignalSource, SavedEmailModule,
)
from .name_normalization import normalize_email_name
from .validators import validate_asset_image


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
            # Email Document Standards Sub-phase 1 — deliberately distinct
            # from `name` (see models.py's EmailDocument docstring).
            'email_title', 'email_subject', 'favicon_url',
            # Sub-phase 2 — reset_css_enabled/custom_css_enabled/custom_css.
            # custom_css passes through validate_custom_css_security() as
            # the final persistence-layer security gate (the frontend also
            # validates before Save/before an AI proposal is shown, but
            # this is authoritative).
            'reset_css_enabled', 'custom_css_enabled', 'custom_css',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'status', 'created_at', 'updated_at']
        extra_kwargs = {'content': {'required': False}}

    def validate_name(self, value):
        trimmed = value.strip()
        if not trimmed:
            raise serializers.ValidationError('Email name is required.')
        # Early UX only — the DB's (user, name_normalized) constraint
        # (models.py) is authoritative and is what actually protects
        # against a concurrent/racing request choosing the same name; see
        # EmailDocumentViewSet's IntegrityError handling in views.py for
        # that final backstop.
        request = self.context.get('request')
        user = getattr(request, 'user', None)
        if user is not None:
            existing = EmailDocument.objects.filter(user=user, name_normalized=normalize_email_name(trimmed))
            if self.instance is not None:
                existing = existing.exclude(pk=self.instance.pk)
            if existing.exists():
                raise serializers.ValidationError('An email with this name already exists. Choose a different name.')
        return trimmed

    def validate_width(self, value):
        if value < MIN_EMAIL_WIDTH or value > MAX_EMAIL_WIDTH:
            raise serializers.ValidationError(
                f'Width must be between {MIN_EMAIL_WIDTH} and {MAX_EMAIL_WIDTH} pixels.',
            )
        return value

    def validate_email_title(self, value):
        # Optional — blank is valid (renders as an empty <title>, same as
        # today's always-empty baseline). Only trims; escaping for HTML
        # output is the renderer's job (htmlRenderer.ts), not storage.
        return value.strip()

    def validate_email_subject(self, value):
        # Never rendered as markup — pure document/send metadata, so no
        # HTML-safety concern here, just trimming.
        return value.strip()

    def validate_favicon_url(self, value):
        if not value:
            return value
        trimmed = value.strip()
        lowered = trimmed.lower()
        for scheme in UNSAFE_URL_PREFIXES:
            if lowered.startswith(scheme):
                raise serializers.ValidationError(f'Favicon URL must not use an unsafe scheme ("{scheme}").')
        if not (lowered.startswith('http://') or lowered.startswith('https://')):
            raise serializers.ValidationError('Favicon URL must start with http:// or https://.')
        return trimmed

    def validate_custom_css(self, value):
        if not value:
            return value
        violations = validate_custom_css_security(value)
        if violations:
            raise serializers.ValidationError(violations[0])
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
        fields = ['id', 'name', 'module_type', 'props', 'settings', 'columns', 'created_at', 'updated_at']
        read_only_fields = ['id', 'created_at', 'updated_at']
        extra_kwargs = {'columns': {'required': False}}

    def validate_name(self, value):
        trimmed = value.strip()
        if not trimmed:
            raise serializers.ValidationError('Module name is required.')
        return trimmed

    def validate(self, attrs):
        module_type = attrs.get('module_type', getattr(self.instance, 'module_type', None))
        props = attrs.get('props', getattr(self.instance, 'props', None))
        module_settings = attrs.get('settings', getattr(self.instance, 'settings', None))
        # A saved module's columns default to [] (the model field default)
        # rather than None — validate_module_instance treats an empty list
        # the same as "no columns" for a non-layout module_type, and as
        # "not yet backfilled" for a layout type (still valid; the
        # frontend backfills empty columns on load, same as a full EDM).
        columns = attrs.get('columns', getattr(self.instance, 'columns', None)) or None
        try:
            validate_module_instance(module_type, props, module_settings, columns=columns, prefix='module')
        except EdmValidationError as error:
            raise serializers.ValidationError({'module_type': [str(error)]}) from error
        return attrs


class EmailAssetSerializer(serializers.ModelSerializer):
    """`user` is never writable — set from `request.user` in the view,
    same convention as EmailDocumentSerializer/SavedEmailModuleSerializer.

    `file` is write-only (accepted on create for `source_type=upload`);
    `url` is the one read field callers actually need — an absolute URL
    for uploads, `external_url` verbatim for external assets — so the
    frontend never has to know which storage a given asset uses."""

    url = serializers.SerializerMethodField()

    class Meta:
        model = EmailAsset
        fields = [
            'id', 'name', 'category', 'source_type', 'file', 'external_url', 'url',
            'alt_text', 'content_type', 'file_size', 'width', 'height',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'content_type', 'file_size', 'width', 'height', 'created_at', 'updated_at']
        extra_kwargs = {
            'file': {'write_only': True, 'required': False},
            'external_url': {'required': False},
        }

    def get_url(self, instance):
        if instance.source_type == EmailAssetSourceType.EXTERNAL:
            return instance.external_url
        if not instance.file:
            return ''
        request = self.context.get('request')
        return request.build_absolute_uri(instance.file.url) if request else instance.file.url

    def validate_name(self, value):
        trimmed = value.strip()
        if not trimmed:
            raise serializers.ValidationError('Asset name is required.')
        return trimmed

    def validate_external_url(self, value):
        lowered = value.strip().lower()
        for scheme in UNSAFE_URL_PREFIXES:
            if lowered.startswith(scheme):
                raise serializers.ValidationError(f'External URL must not use an unsafe scheme ("{scheme}").')
        return value.strip()

    def validate(self, attrs):
        source_type = attrs.get('source_type', getattr(self.instance, 'source_type', None))
        file_value = attrs.get('file', serializers.empty)
        external_url = attrs.get('external_url', getattr(self.instance, 'external_url', ''))

        if source_type == EmailAssetSourceType.UPLOAD:
            uploaded = file_value if file_value is not serializers.empty else getattr(self.instance, 'file', None)
            if not uploaded:
                raise serializers.ValidationError({'file': ['An uploaded file is required for this asset type.']})
            if file_value is not serializers.empty and file_value:
                try:
                    content_type, width, height = validate_asset_image(file_value)
                except DjangoValidationError as error:
                    raise serializers.ValidationError({'file': error.messages}) from error
                attrs['content_type'] = content_type
                attrs['width'] = width
                attrs['height'] = height
                attrs['file_size'] = file_value.size
            attrs['external_url'] = ''
        elif source_type == EmailAssetSourceType.EXTERNAL:
            if not external_url:
                raise serializers.ValidationError({'external_url': ['An external URL is required for this asset type.']})
            attrs['file'] = None
            attrs['content_type'] = ''
            attrs['width'] = None
            attrs['height'] = None
            attrs['file_size'] = None
        return attrs


class SelectedModuleContextSerializer(serializers.Serializer):
    """Feature 14 V2 — the currently-selected canvas module, sent as
    context for a natural-language command. `type` is restricted to every
    module type the generated capability manifest knows about (Phase A:
    all 53 registered types, not the V1 5-type subset) — see
    module_capabilities.py. A type the manifest doesn't recognize is
    rejected here at the request-validation boundary, the same posture
    V1 had for its narrower list."""

    type = serializers.ChoiceField(choices=list(module_capabilities.get_all_module_types()))
    props = serializers.DictField(required=False, default=dict)


class EmailAICommandRequestSerializer(serializers.Serializer):
    message = serializers.CharField(max_length=MAX_MESSAGE_LENGTH, trim_whitespace=True, allow_blank=False)
    selected_module = SelectedModuleContextSerializer(required=False, allow_null=True, default=None)
    platform = serializers.CharField(required=False, allow_null=True, default=None, max_length=20)
    width = serializers.IntegerField(required=False, allow_null=True, default=None)


class LearningSignalRequestSerializer(serializers.Serializer):
    """Feature 14 V3 Sub-phase 8 — the durable-idempotency POST contract.
    `event_id` is opaque (any non-empty string up to
    learning.MAX_EVENT_ID_LENGTH) — its UNIQUENESS per user, not its
    format, is what the view's get_or_create() relies on.
    `signature`'s format is bounded (learning.is_valid_signature) but
    deliberately not checked against a second hand-maintained manifest of
    every real frontend issue signature — see learning.py's own
    docstring on why that's proportionate for a per-user, display-order-
    only feature."""

    event_id = serializers.CharField(max_length=learning.MAX_EVENT_ID_LENGTH, trim_whitespace=True, allow_blank=False)
    signature = serializers.CharField(max_length=learning.MAX_SIGNATURE_LENGTH, trim_whitespace=True, allow_blank=False)
    outcome = serializers.ChoiceField(choices=RepairSignalOutcome.choices)
    source = serializers.ChoiceField(choices=RepairSignalSource.choices)

    def validate_event_id(self, value):
        if not learning.is_valid_event_id(value):
            raise serializers.ValidationError('Invalid event id.')
        return value

    def validate_signature(self, value):
        if not learning.is_valid_signature(value):
            raise serializers.ValidationError('Invalid signature format.')
        return value
