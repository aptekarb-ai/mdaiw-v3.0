from django.conf import settings
from django.core.cache import cache
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError, transaction
from django.shortcuts import get_object_or_404
from rest_framework import mixins, status, viewsets
from rest_framework.exceptions import ValidationError
from rest_framework.filters import SearchFilter
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .ai_command import (
    ActionType, CommandResult, compute_copy_source_result, get_default_email_command_provider, requires_confirmation,
    requires_strong_confirmation, resolve_asset_references, validate_action,
)
from . import learning
from .attachment_extraction import run_extraction
from .attachment_validation import RejectedAttachmentType, classify_and_validate_upload
from .construction_planner import build_construction_plan, summarize_plan
from .email_brief import build_email_brief
from .local_ai_diagnostics import get_local_ai_diagnostics
from .models import EmailAsset, EmailAttachment, EmailDocument, SavedEmailModule
from .serializers import (
    EmailAICommandRequestSerializer, EmailAssetSerializer, EmailAttachmentSerializer, EmailBriefRequestSerializer,
    EmailDocumentSerializer, LearningSignalRequestSerializer, SavedEmailModuleSerializer,
)


DUPLICATE_NAME_ERROR = 'An email with this name already exists. Choose a different name.'


def save_with_unique_name_guard(serializer, **extra):
    """EmailDocumentSerializer.validate_name already rejects the common
    case pre-save; this is the final backstop for the race two concurrent
    requests can create (both pass validation, then both try to INSERT/
    UPDATE the same (user, name_normalized) pair) — the DB's
    UniqueConstraint (models.py) is what actually decides that race, and
    this turns the resulting IntegrityError into the same clean
    field-level 400 instead of an unhandled 500. The nested atomic() block
    means the failed statement only rolls back to this savepoint, not the
    whole request, so this stays safe to call under ATOMIC_REQUESTS too."""
    try:
        with transaction.atomic():
            serializer.save(**extra)
    except IntegrityError as exc:
        if 'name_normalized' in str(exc):
            raise ValidationError({'name': [DUPLICATE_NAME_ERROR]})
        raise


class EmailDocumentViewSet(
    mixins.ListModelMixin,
    mixins.CreateModelMixin,
    mixins.RetrieveModelMixin,
    mixins.UpdateModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    """List/create/retrieve/update/delete a user's own email drafts. Same
    ownership boundary as landingpages.LandingPageProjectViewSet: another
    user's document id is filtered out before lookup, so it 404s rather
    than 403s. Update (PATCH) exists for Feature 03's builder to persist
    `content`; rename reuses the same PATCH (`name` is a writable
    serializer field). Delete backs the dashboard's row action — no
    dashboard-only model, this is the same EmailDocument the builder
    reads/writes. Duplicate has no dedicated endpoint: the frontend
    composes it from create + update (fresh row, then the cloned/
    fresh-ID content), so the API surface stays exactly these five verbs."""

    serializer_class = EmailDocumentSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return EmailDocument.objects.filter(user=self.request.user)

    def perform_create(self, serializer):
        save_with_unique_name_guard(serializer, user=self.request.user)

    def perform_update(self, serializer):
        save_with_unique_name_guard(serializer)


class SavedEmailModuleViewSet(
    mixins.ListModelMixin,
    mixins.CreateModelMixin,
    mixins.RetrieveModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    """Feature 04 — a user's personal reusable module library. Same
    ownership boundary as EmailDocumentViewSet: another user's saved
    module id is filtered out before lookup (404, not 403). No update
    endpoint — rename/re-save is out of scope for Feature 04; delete and
    re-save covers it."""

    serializer_class = SavedEmailModuleSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return SavedEmailModule.objects.filter(user=self.request.user)

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)


_SAFE_FALLBACK_REPLY = (
    "I'm not sure how to do that yet. I can add a text/image/button/divider/spacer, "
    "change the selected module's color/text/size/alignment, delete or duplicate the "
    "selected module, or apply a style change to every module of one type."
)


def _rate_limited(user_id):
    key = f'emailbuilder-ai-command-request:{user_id}'
    try:
        count = cache.incr(key)
    except ValueError:
        cache.set(key, 1, timeout=settings.EMAILBUILDER_AI_COMMAND_REQUEST_WINDOW_SECONDS)
        count = 1
    return count > settings.EMAILBUILDER_AI_COMMAND_REQUEST_MAX


class EmailAICommandView(APIView):
    """Feature 14 — POST /api/v1/email-builder/ai-command/. Stateless: the
    server's only job is turning one NL instruction into a single
    ALREADY-VALIDATED structured action; APPLYING it happens entirely on
    the frontend through the existing builder mutation functions (no
    parallel mutation system, no EDM write here) — same division of
    responsibility as every other Module-4 feature (the server never
    touches `content` outside the normal EmailDocument PATCH).

    `validate_action()` re-checks the result regardless of which provider
    (deterministic or AI) answered — see ai_command.py's module docstring;
    a misbehaving/compromised AI response can never produce anything the
    trusted deterministic router wouldn't also be allowed to produce."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        if _rate_limited(request.user.pk):
            return Response(
                {'success': False, 'code': 'RATE_LIMITED', 'message': 'Too many requests. Please wait a moment and try again.'},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )

        serializer = EmailAICommandRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        safe_context = {
            'selected_module': data.get('selected_module'),
            'platform': data.get('platform'),
            'width': data.get('width'),
            # Module-4 E9 — additive, optional editor context (see
            # ai_command_openai.py's _build_safe_context for how the
            # optional AI provider actually uses these).
            'editor_mode': data.get('editor_mode'),
            'selected_column': data.get('selected_column'),
            'selected_validation_issue': data.get('selected_validation_issue'),
            # Module-4 E10 — bounded prior turns of THIS SAME document's
            # conversation only (never persisted server-side — see
            # aiConversationStorage.ts's own docstring for the client-side
            # persistence decision).
            'conversation_history': data.get('conversation_history') or [],
            # R4-A (Import HTML AI Reconstruction) — additive, optional;
            # present only for an Import Review reconstruction-review
            # conversation. See ai_command_openai.py's _build_safe_context
            # for how the optional AI provider actually uses this.
            'import_reconstruction': data.get('import_reconstruction'),
            # R4-B4 Closure §B/§C — see the dedicated branch below; kept
            # in safe_context (rather than read straight off `data`) for
            # the same reason every other field here is: one single
            # whitelist the view trusts, matching every other context key.
            'copy_source': data.get('copy_source'),
            # Used only by the optional AI provider's own separate
            # throttle (ai_command_openai.py) — never logged or returned.
            '_rate_limit_identifier': str(request.user.pk),
        }

        copy_source = safe_context.get('copy_source')
        if isinstance(copy_source, dict):
            # R4-B4 Closure §B/§C — deterministic path ALWAYS wins for a
            # copy-source request, regardless of EMAILBUILDER_AI_COMMAND_
            # PROVIDER selection. The value has already been read from a
            # resolved source module/column client-side (see
            # referenceResolver.ts) — there is nothing left for an LLM
            # tier to interpret, and routing it through one anyway would
            # risk a hallucinated action for a request that must never
            # guess. The SAME validate_action() gate every other path
            # here uses still applies unconditionally below.
            from .intent_normalization import detect_language

            selected = safe_context.get('selected_module')
            selected_type = selected.get('type') if isinstance(selected, dict) else None
            result = compute_copy_source_result(selected_type, copy_source)
            language = detect_language(data['message'])
            if language != 'en':
                from .ai_command_local import localize_reply

                translated = localize_reply(result.reply, language)
                if translated is not None:
                    result = CommandResult(reply=translated, action=result.action, confidence=result.confidence, provider=result.provider)
        else:
            provider = get_default_email_command_provider()
            try:
                result = provider.resolve(data['message'], safe_context)
            except Exception:  # noqa: BLE001 - never leak provider internals to the client
                result = CommandResult(reply=_SAFE_FALLBACK_REPLY, action={'type': ActionType.NONE}, confidence=0.0)

        validated_action = validate_action(result.action)
        if validated_action is None:
            validated_action = {'type': ActionType.NONE}
        # Feature 14 V2 — second-pass, per-request resolution of any
        # `image_asset` field left as an unresolved {assetId}/{url}
        # marker by validate_action() (a pure, user-agnostic function).
        # Ownership is checked here, where request.user is available —
        # never inside validate_action() itself. See ai_command.py's
        # resolve_asset_references() docstring.
        validated_action = resolve_asset_references(validated_action, request)

        return Response({
            'success': True,
            'reply': result.reply,
            'action': validated_action,
            'requires_confirmation': requires_confirmation(validated_action),
            # Sub-phase 2, item F — a substantial Custom CSS replacement
            # needs stronger confirmation UI than a trivial property
            # change; every other action type is always False here.
            'requires_strong_confirmation': requires_strong_confirmation(validated_action),
            'confidence': result.confidence,
            'provider': result.provider,
        }, status=status.HTTP_200_OK)


def _learning_rate_limited(user_id):
    # Abuse protection ONLY — never the deduplication/correctness
    # mechanism (that's the (user, event_id) DB uniqueness constraint;
    # see learning.record_signal's own docstring). A legitimate burst of
    # a few dozen signals (e.g. a large Fix-All batch) must never be
    # blocked, so this window is generous compared to the AI-command
    # endpoint's own throttle.
    key = f'emailbuilder-learning-signal:{user_id}'
    try:
        count = cache.incr(key)
    except ValueError:
        cache.set(key, 1, timeout=60)
        count = 1
    return count > 120


class LearningSignalView(APIView):
    """Feature 14 V3 Sub-phase 8 — POST /api/v1/email-builder/learning/signals/
    records one explicit Accept/Reject decision (idempotent per
    (user, event_id) — see learning.record_signal); DELETE clears every
    signal this user has ever recorded ("Clear learned preferences").
    Both are the ONLY ways this table is ever written or emptied — no
    other endpoint touches LearnedRepairSignal."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        if _learning_rate_limited(request.user.pk):
            return Response(
                {'success': False, 'code': 'RATE_LIMITED', 'message': 'Too many requests. Please wait a moment and try again.'},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )

        serializer = LearningSignalRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        _signal, created = learning.record_signal(
            user=request.user,
            event_id=data['event_id'],
            signature=data['signature'],
            outcome=data['outcome'],
            source=data['source'],
        )
        return Response({'success': True, 'created': created}, status=status.HTTP_200_OK)

    def delete(self, request):
        deleted_count = learning.clear_signals_for_user(request.user)
        return Response({'success': True, 'deleted': deleted_count}, status=status.HTTP_200_OK)


class LearningRankingView(APIView):
    """GET /api/v1/email-builder/learning/signals/ranking/ — the current
    user's own {signature: {score, evidenceCount, accepted, rejected}}
    map, or an empty map on any internal failure (invariant 4 in
    learning.py: a ranking failure must never surface as an error the
    frontend has to handle specially — it just gets no ranking, i.e. the
    exact pre-Sub-phase-8 order)."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        try:
            ranking = learning.compute_ranking(request.user)
        except Exception:  # noqa: BLE001 - ranking must never fail the request; fall back to unranked
            ranking = {}
        return Response({'success': True, 'signatures': ranking}, status=status.HTTP_200_OK)


class LocalAIDiagnosticsView(APIView):
    """D4-E0 item 14 — GET /api/v1/email-builder/local-ai-diagnostics/.

    Read-only, no document/ownership scope (this is global deployment
    configuration, not per-user data) — any authenticated user may check
    whether the optional local AI provider is reachable. Never exposes
    the configured API key's value (get_local_ai_diagnostics() itself
    never includes it, only whether one is set). A local runtime being
    down never turns into a 5xx here — the diagnostics payload itself
    reports 'reachable': False, same "never fail the request" posture as
    LearningRankingView above."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        try:
            diagnostics = get_local_ai_diagnostics()
        except Exception:  # noqa: BLE001 - diagnostics must never fail the request
            diagnostics = {
                'configured': False, 'reachable': False, 'runtime': None, 'model': None,
                'configured_model_available': None, 'available_models': [], 'api_key_configured': False,
                'capabilities': None, 'error': 'diagnostics_failed', 'deterministic_fallback_ready': True,
            }
        return Response({'success': True, 'diagnostics': diagnostics}, status=status.HTTP_200_OK)


class EmailAssetViewSet(
    mixins.ListModelMixin,
    mixins.CreateModelMixin,
    mixins.RetrieveModelMixin,
    mixins.UpdateModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    """Feature 08 — a user's personal reusable image library for the email
    builder. Same ownership boundary as the other two viewsets in this
    module. `?search=` (name, case-insensitive) and `?category=` (exact:
    image/logo/icon/other) both compose with the base queryset — the
    frontend's My Assets tab combines them the same way the dashboard's
    Recent Emails search/filter toolbar already does for EmailDocument."""

    serializer_class = EmailAssetSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [SearchFilter]
    search_fields = ['name']

    def get_queryset(self):
        queryset = EmailAsset.objects.filter(user=self.request.user)
        category = self.request.query_params.get('category')
        if category:
            queryset = queryset.filter(category=category)
        return queryset

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)


class EmailAttachmentViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    """D4-B (Feature 14 V4) — POST /api/v1/email-builder/attachments/
    validates + extracts one uploaded file inline (synchronous — no
    Celery/background worker; see attachment_extraction.py's module
    docstring) and returns the extracted facts directly in the create
    response. Same manual ownership boundary as every other viewset in
    this module: another user's attachment id is filtered out before
    lookup (404, not 403) — see get_queryset.

    D4-B hardening — every attachment belongs to exactly one EmailDocument
    (`document`, required). create() resolves and OWNERSHIP-CHECKS the
    referenced document before any file validation/extraction runs, so an
    attempt to attach to a document the caller doesn't own 404s before a
    single byte is read. list() is document-scoped: without `?document=
    <id>` it returns nothing at all (see get_queryset) — this is the
    mechanism that keeps Document A's attachments from ever appearing
    while browsing Document B. retrieve()/destroy() stay id+owner scoped
    like every other viewset here (a single attachment's id already
    identifies exactly one document; no extra document filter is needed
    for those two to stay correct).

    list()/retrieve() return metadata only (EmailAttachmentSerializer)
    since extracted facts are never persisted (see models.EmailAttachment's
    docstring); create() is the only response that ever carries facts —
    the same serializer shape list()/retrieve() use is exactly what a
    remounted AI Engineer panel restores its chips from.

    No `update()` — reprocessing an attachment is out of scope for D4-B;
    remove and re-upload covers it, same pattern as SavedEmailModuleViewSet."""

    serializer_class = EmailAttachmentSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        queryset = EmailAttachment.objects.filter(user=self.request.user)
        if self.action == 'list':
            # Safe-by-default: with no explicit `?document=`, list()
            # returns nothing rather than every attachment across every
            # document this user owns — the panel always passes its
            # current documentId, so this only ever matters for a caller
            # that (accidentally or otherwise) omits it.
            document_id = self.request.query_params.get('document')
            if not document_id:
                return queryset.none()
            return queryset.filter(document_id=document_id)
        return queryset

    def create(self, request, *args, **kwargs):
        document_id = request.data.get('document')
        if not document_id:
            return Response(
                {'success': False, 'code': 'MISSING_DOCUMENT', 'message': 'A document is required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        document = get_object_or_404(EmailDocument.objects.filter(user=request.user), pk=document_id)

        uploaded_file = request.FILES.get('file')
        if uploaded_file is None:
            return Response(
                {'success': False, 'code': 'MISSING_FILE', 'message': 'No file was submitted.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        original_filename = uploaded_file.name or 'upload'

        try:
            classification = classify_and_validate_upload(uploaded_file, original_filename)
        except RejectedAttachmentType as exc:
            return Response(
                {'success': False, 'code': 'UNSUPPORTED_FILE_TYPE', 'message': exc.messages[0]},
                status=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            )
        except DjangoValidationError as exc:
            return Response(
                {'success': False, 'code': 'INVALID_ATTACHMENT', 'message': exc.messages[0]},
                status=status.HTTP_400_BAD_REQUEST,
            )

        extraction = run_extraction(
            classification.detected_type, uploaded_file,
            probe_meta=classification.probe_meta, content_type=classification.content_type,
        )

        instance = EmailAttachment.objects.create(
            user=request.user,
            document=document,
            original_filename=original_filename[:255],
            file=uploaded_file,
            detected_type=classification.detected_type,
            content_type=classification.content_type,
            size=uploaded_file.size,
            status=extraction.status,
            error_message=extraction.error_message,
            extraction_meta=extraction.meta,
            warnings=extraction.warnings,
        )

        return Response({
            'success': extraction.status == 'ready',
            'attachment': EmailAttachmentSerializer(instance).data,
            'facts': [fact.to_dict() for fact in extraction.facts],
            'warnings': extraction.warnings,
        }, status=status.HTTP_201_CREATED)


def _brief_rate_limited(user_id):
    key = f'emailbuilder-brief-request:{user_id}'
    try:
        count = cache.incr(key)
    except ValueError:
        cache.set(key, 1, timeout=settings.EMAILBUILDER_BRIEF_REQUEST_WINDOW_SECONDS)
        count = 1
    return count > settings.EMAILBUILDER_BRIEF_REQUEST_MAX


class EmailBriefView(APIView):
    """D4-C (Feature 14 V4) — POST /api/v1/email-builder/brief/. Builds
    and returns one EmailBrief (see email_brief.py) from the caller's
    instruction text plus zero or more of the caller's OWN, already-
    uploaded attachments for the given document. Stateless and read-only
    in exactly the same sense EmailAICommandView is: this view never
    touches an EmailDocument's `content`, never calls validate_action(),
    and never produces an ActionType — it returns a structured
    understanding of what the user wants, for a LATER checkpoint to turn
    into a construction plan. The brief itself is never persisted (see
    email_brief.py's module docstring).

    Ownership is checked twice, matching the EmailAttachmentViewSet
    convention: the referenced `document` must belong to the caller
    (404 otherwise, before anything else runs), and `attachment_ids` are
    resolved through a queryset already filtered to
    (user=request.user, document=document) — an id belonging to another
    user or another document simply does not resolve; it is silently
    excluded and counted in a single generic warning, never distinguished
    from "does not exist" (same 404-not-403 non-revealing posture as the
    rest of this app)."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        if _brief_rate_limited(request.user.pk):
            return Response(
                {'success': False, 'code': 'RATE_LIMITED', 'message': 'Too many requests. Please wait a moment and try again.'},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )

        serializer = EmailBriefRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        document = get_object_or_404(EmailDocument.objects.filter(user=request.user), pk=data['document'])

        requested_ids = data['attachment_ids']
        attachments = list(EmailAttachment.objects.filter(
            user=request.user, document=document, id__in=requested_ids,
        )) if requested_ids else []
        missing_count = len(set(requested_ids)) - len(attachments)

        message = data['message'].strip()
        # Checked against what the caller ASKED for, not what actually
        # resolved — a request naming an attachment id that turns out to
        # belong to someone else/another document is a real request that
        # produced a warning, never "you asked for nothing."
        if not message and not requested_ids:
            return Response(
                {'success': False, 'code': 'EMPTY_REQUEST', 'message': 'Provide an instruction, an attachment, or both.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        brief = build_email_brief(message, attachments, document.platform)
        if missing_count:
            brief.warnings.append(
                f'{missing_count} attachment(s) could not be found for this document and were skipped.',
            )

        return Response({'success': True, 'brief': brief.to_dict()}, status=status.HTTP_200_OK)


def _construction_plan_rate_limited(user_id):
    key = f'emailbuilder-construction-plan-request:{user_id}'
    try:
        count = cache.incr(key)
    except ValueError:
        cache.set(key, 1, timeout=settings.EMAILBUILDER_CONSTRUCTION_PLAN_REQUEST_WINDOW_SECONDS)
        count = 1
    return count > settings.EMAILBUILDER_CONSTRUCTION_PLAN_REQUEST_MAX


class ConstructionPlanView(APIView):
    """D4-D (Feature 14 V4) — POST /api/v1/email-builder/construction-plan/.
    Builds a D4-C EmailBrief (same inputs/ownership rules as
    EmailBriefView — reuses the exact same request serializer) and then a
    D4-D ConstructionPlan from it, section by section
    (construction_planner.build_construction_plan). The resulting
    COMPOSE_EMAIL action is passed through the SAME validate_action() gate
    every other action type uses before it is ever returned to the client
    — this view never trusts its own planner's output unchecked. Like
    EmailBriefView and EmailAICommandView, this is entirely read-only:
    nothing here touches an EmailDocument's `content`. Applying the
    returned `action` happens client-side through the EXISTING
    addComposedModules path (see AIEngineerPanel.tsx / moduleFactory.ts),
    unchanged by this checkpoint — one Apply, one history entry, one Undo.

    Zero OpenAI/LLM dependency: build_email_brief() and
    build_construction_plan() are both fully deterministic (see their own
    module docstrings) — this endpoint works identically whether or not
    any AI provider is configured.

    Learning boundary (D4-D hardening item 3): every `plan.sections[*].match`
    carries a stable, learning.py-valid `signature` — this view exposes
    learning-READY construction decisions only; it never calls
    learning.record_signal() itself, and this endpoint performs no
    database writes. A later checkpoint records a genuine signal (Build /
    Cancel / choose-an-alternative) once that real user decision exists,
    using RepairSignalSource.AI_ENGINEER_CONSTRUCTION and one of these
    signatures."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        if _construction_plan_rate_limited(request.user.pk):
            return Response(
                {'success': False, 'code': 'RATE_LIMITED', 'message': 'Too many requests. Please wait a moment and try again.'},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )

        serializer = EmailBriefRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        document = get_object_or_404(EmailDocument.objects.filter(user=request.user), pk=data['document'])

        requested_ids = data['attachment_ids']
        attachments = list(EmailAttachment.objects.filter(
            user=request.user, document=document, id__in=requested_ids,
        )) if requested_ids else []
        missing_count = len(set(requested_ids)) - len(attachments)

        message = data['message'].strip()
        if not message and not requested_ids:
            return Response(
                {'success': False, 'code': 'EMPTY_REQUEST', 'message': 'Provide an instruction, an attachment, or both.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        brief = build_email_brief(message, attachments, document.platform)
        if missing_count:
            brief.warnings.append(
                f'{missing_count} attachment(s) could not be found for this document and were skipped.',
            )

        plan = build_construction_plan(brief, message)

        action = {'type': ActionType.COMPOSE_EMAIL, 'items': plan.compose_email_items}
        validated_action = validate_action(action)
        if validated_action is None:
            validated_action = {'type': ActionType.NONE}
            plan.warnings.append('The generated plan could not be validated and was discarded — nothing will be applied.')
        # Same second-pass, per-request asset-reference resolution every
        # other action type gets — a construction plan never gets a
        # looser resolution path than a hand-typed action would.
        validated_action = resolve_asset_references(validated_action, request)

        return Response({
            'success': True,
            'reply': summarize_plan(plan),
            'brief': brief.to_dict(),
            'plan': plan.to_dict(),
            'action': validated_action,
            'requires_confirmation': requires_confirmation(validated_action),
            'requires_strong_confirmation': requires_strong_confirmation(validated_action),
            'provider': 'deterministic',
        }, status=status.HTTP_200_OK)
