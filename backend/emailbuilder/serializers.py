from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers

from .ai_command import MAX_MESSAGE_LENGTH
from . import learning
from . import module_capabilities
from .custom_css_security import validate_custom_css_security
from .edm import UNSAFE_URL_PREFIXES, EdmValidationError, validate_edm, validate_module_instance
from .models import (
    MAX_EMAIL_WIDTH, MIN_EMAIL_WIDTH, EmailAsset, EmailAssetSourceType, EmailAttachment, EmailDocument,
    RepairSignalOutcome, RepairSignalSource, SavedEmailModule,
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
            # Module-4 E4 — document-level default for settings.outlookVml.
            'outlook_vml_enabled',
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


class EmailAttachmentSerializer(serializers.ModelSerializer):
    """D4-B — metadata-only read shape for list/retrieve/create, and the
    exact shape a remounted AI Engineer panel restores a chip from.
    Never exposes `file` (no server filesystem path/storage key ever
    reaches the client — see models.EmailAttachment's docstring), never
    exposes `document` (the caller already knows which document it asked
    for via `?document=`; the id itself is not attachment metadata a
    chip needs), and never carries extracted facts (not persisted; those
    are returned once, inline, in the create view's own response — see
    views.EmailAttachmentViewSet)."""

    class Meta:
        model = EmailAttachment
        fields = [
            'id', 'original_filename', 'detected_type', 'content_type', 'size',
            'status', 'error_message', 'extraction_meta', 'warnings', 'created_at',
        ]
        read_only_fields = fields


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


class SelectedColumnContextSerializer(serializers.Serializer):
    """Module-4 E9 — informational only (see ai_command_openai.py's
    _build_safe_context docstring): describes which column is selected,
    never its content, and does not yet drive a real column-scoped edit
    action."""

    layout_module_type = serializers.ChoiceField(choices=list(module_capabilities.get_all_module_types()))
    column_index = serializers.IntegerField(min_value=0, max_value=63)


class ValidationIssueContextSerializer(serializers.Serializer):
    """Module-4 E9 — a small, WHITELISTED subset of ValidationIssue's own
    already-public fields (see frontend/src/emailbuilder/emailValidation.ts)
    — never the full ValidationReport, never a safeFix patch (that stays
    entirely client-side/deterministic, never sent to a model)."""

    id = serializers.CharField(max_length=200, trim_whitespace=True, allow_blank=False)
    title = serializers.CharField(max_length=200, trim_whitespace=True, allow_blank=False)
    detail = serializers.CharField(max_length=1000, trim_whitespace=True, allow_blank=False)
    severity = serializers.ChoiceField(choices=['error', 'warning'])
    category = serializers.CharField(max_length=40, trim_whitespace=True, allow_blank=False)


class ConversationTurnSerializer(serializers.Serializer):
    """Module-4 E10 — one bounded prior turn of THIS SAME document's AI
    Engineer conversation. `content` is capped independently of, and more
    generously than, MAX_MESSAGE_LENGTH (a stored assistant reply can be
    longer than one user instruction) but still bounded — never arbitrary
    length."""

    role = serializers.ChoiceField(choices=['user', 'assistant'])
    content = serializers.CharField(max_length=1000, trim_whitespace=True, allow_blank=False)


# Module-4 E10 — defense in depth: the frontend already caps the history
# it sends (aiConversationStorage.ts's boundedHistoryForRequest), but the
# server never trusts a client-side cap alone.
MAX_CONVERSATION_HISTORY_TURNS = 8

# R4-A (Import HTML AI Reconstruction) — the SAME "server never trusts a
# client-side cap alone" posture as MAX_CONVERSATION_HISTORY_TURNS above,
# applied to importReconstructionContext.ts's own caps (MAX_REGIONS_SENT/
# MAX_SAMPLE_FINDINGS_PER_CATEGORY). Kept in sync manually — both sides
# are small, stable, documented constants, not runtime-shared config.
MAX_IMPORT_REGIONS = 20
MAX_IMPORT_SAMPLE_FINDINGS_PER_CATEGORY = 3
MAX_IMPORT_FIDELITY_CATEGORIES = 8

IMPORT_FIDELITY_CATEGORY_IDS = ['structure', 'content', 'typography', 'spacing', 'images', 'links', 'responsive', 'outlook']
IMPORT_FIDELITY_STATUSES = ['preserved', 'normalized', 'approximated', 'removed', 'unsupported']
IMPORT_FINDING_CATEGORIES = ['normalized', 'unsupported', 'security', 'unresolved-resource', 'structural-conversion', 'outlook-regeneration']
# frontend/src/emailbuilder/htmlImportAnalysis.ts's DetectedRegionRole —
# kept in sync manually, same posture as the fidelity constants above.
IMPORT_REGION_ROLES = [
    'preheader', 'header', 'hero', 'heading', 'paragraph', 'cta', 'image', 'columns', 'divider', 'footer', 'unknown',
]


class ImportFindingSummarySerializer(serializers.Serializer):
    """R4-A — a condensed ImportFinding (see importFindings.ts): category/
    source/location/reason only, never `outcome`/`recommendation` (kept
    off the wire to hold the per-finding payload down; the reason alone
    is enough for the AI to explain a difference)."""

    category = serializers.ChoiceField(choices=IMPORT_FINDING_CATEGORIES)
    source = serializers.CharField(max_length=200, trim_whitespace=True, allow_blank=False)
    location = serializers.CharField(max_length=100, trim_whitespace=True, allow_blank=False)
    reason = serializers.CharField(max_length=500, trim_whitespace=True, allow_blank=False)


class ImportFidelityCategorySummarySerializer(serializers.Serializer):
    """R4-A — one FidelityCategoryResult (htmlImportFidelity.ts), condensed:
    `findings` itself is never sent, only a bounded `sample_findings` plus
    the total `finding_count` — the model can reason about "this category
    has more issues than shown" without receiving an unbounded list."""

    id = serializers.ChoiceField(choices=IMPORT_FIDELITY_CATEGORY_IDS)
    status = serializers.ChoiceField(choices=IMPORT_FIDELITY_STATUSES)
    summary = serializers.CharField(max_length=300, trim_whitespace=True, allow_blank=False)
    finding_count = serializers.IntegerField(min_value=0)
    sample_findings = ImportFindingSummarySerializer(many=True, required=False, default=list, max_length=MAX_IMPORT_SAMPLE_FINDINGS_PER_CATEGORY)


class ImportRegionSummarySerializer(serializers.Serializer):
    """R4-A — one condensed DetectedRegion (htmlImportAnalysis.ts).
    `content_preview` is a short excerpt, never the full source text of
    every region in the document — see
    importReconstructionContext.ts's CONTENT_PREVIEW_MAX_CHARS."""

    role = serializers.ChoiceField(choices=IMPORT_REGION_ROLES)
    confidence = serializers.FloatField(min_value=0, max_value=1)
    source_position = serializers.CharField(max_length=100, trim_whitespace=True, allow_blank=False)
    content_preview = serializers.CharField(max_length=200, required=False, allow_null=True, default=None)
    column_ratio = serializers.ListField(child=serializers.FloatField(), required=False, allow_null=True, default=None, max_length=8)
    has_image = serializers.BooleanField(default=False)
    has_links = serializers.BooleanField(default=False)
    background_color = serializers.CharField(max_length=20, required=False, allow_null=True, default=None)
    align = serializers.CharField(max_length=10, required=False, allow_null=True, default=None)


class ImportReconstructionContextSerializer(serializers.Serializer):
    """R4-A (Import HTML AI Reconstruction) — the bounded reconstruction
    context an "Review reconstruction with AI Engineer" conversation
    attaches (see importReconstructionContext.ts's
    buildImportReconstructionContext, the ONE place on the frontend that
    builds this shape from R1's DetectedStructure + R2's FidelityReport).
    Never the raw imported HTML — every field here is either a small
    scalar or a capped list of already-condensed summaries. Malformed/
    over-cap input is rejected by this serializer the same way every
    other AICommandRequest field already is (DRF's own field-level
    errors -> 400), never silently truncated by view code."""

    document_width = serializers.IntegerField(min_value=1)
    module_count = serializers.IntegerField(min_value=0)
    region_count = serializers.IntegerField(min_value=0)
    regions = ImportRegionSummarySerializer(many=True, required=False, default=list, max_length=MAX_IMPORT_REGIONS)
    fidelity_categories = ImportFidelityCategorySummarySerializer(many=True, required=False, default=list, max_length=MAX_IMPORT_FIDELITY_CATEGORIES)
    has_mso_conditional_content = serializers.BooleanField(default=False)


class CopySourceContextSerializer(serializers.Serializer):
    """R4-B4 Closure §B/§C — a property value ALREADY READ client-side
    (referenceResolver.ts's resolveCopySourceRequest) from a resolved
    source module/column, for a "same padding/background/ratio as the
    previous section/column N" request. Never used to look anything up
    server-side — `value`'s shape depends on `property` (padding -> a
    4-key numeric dict, backgroundColor -> a string, columnRatio -> a
    list of numbers), and is validated per-property in
    ai_command.compute_copy_source_result, which never trusts this shape
    alone (that function's own patch/validate_action() calls are the
    real gate, exactly like every other canonical-intent action)."""

    property = serializers.ChoiceField(choices=['padding', 'backgroundColor', 'align', 'columnRatio'])
    value = serializers.JSONField()
    source_label = serializers.CharField(max_length=200, trim_whitespace=True, allow_blank=False)


class EmailAICommandRequestSerializer(serializers.Serializer):
    message = serializers.CharField(max_length=MAX_MESSAGE_LENGTH, trim_whitespace=True, allow_blank=False)
    selected_module = SelectedModuleContextSerializer(required=False, allow_null=True, default=None)
    platform = serializers.CharField(required=False, allow_null=True, default=None, max_length=20)
    width = serializers.IntegerField(required=False, allow_null=True, default=None)
    # Module-4 E9 — additive, optional context. A request that omits these
    # (every pre-E9 client) behaves exactly as before.
    editor_mode = serializers.ChoiceField(
        choices=['visual', 'code', 'preview', 'validate', 'ai'], required=False, allow_null=True, default=None,
    )
    selected_column = SelectedColumnContextSerializer(required=False, allow_null=True, default=None)
    selected_validation_issue = ValidationIssueContextSerializer(required=False, allow_null=True, default=None)
    # Module-4 E10 — bounded prior turns. max_length on the list is the
    # server-side cap that never trusts the client's own cap alone.
    conversation_history = ConversationTurnSerializer(
        many=True, required=False, default=list, max_length=MAX_CONVERSATION_HISTORY_TURNS,
    )
    # R4-A — additive, optional; present only for an Import Review
    # reconstruction-review conversation. A request that omits this
    # (every pre-R4 client) behaves exactly as before.
    import_reconstruction = ImportReconstructionContextSerializer(required=False, allow_null=True, default=None)
    # R4-B4 Closure §B/§C — additive, optional; present only when the
    # frontend's reference resolver has already resolved a "same X as
    # the previous section/column N" request and read the value. A
    # request that omits this (every pre-closure-pass client) behaves
    # exactly as before.
    copy_source = CopySourceContextSerializer(required=False, allow_null=True, default=None)


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
