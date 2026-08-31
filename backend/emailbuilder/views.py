from django.conf import settings
from django.core.cache import cache
from django.db import IntegrityError, transaction
from rest_framework import mixins, status, viewsets
from rest_framework.exceptions import ValidationError
from rest_framework.filters import SearchFilter
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .ai_command import (
    ActionType, CommandResult, get_default_email_command_provider, requires_confirmation,
    requires_strong_confirmation, resolve_asset_references, validate_action,
)
from . import learning
from .models import EmailAsset, EmailDocument, SavedEmailModule
from .serializers import (
    EmailAICommandRequestSerializer, EmailAssetSerializer, EmailDocumentSerializer, LearningSignalRequestSerializer,
    SavedEmailModuleSerializer,
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
            # Used only by the optional AI provider's own separate
            # throttle (ai_command_openai.py) — never logged or returned.
            '_rate_limit_identifier': str(request.user.pk),
        }

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
