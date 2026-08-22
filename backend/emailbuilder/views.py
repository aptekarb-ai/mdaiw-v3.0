from rest_framework import mixins, viewsets
from rest_framework.filters import SearchFilter
from rest_framework.permissions import IsAuthenticated

from .models import EmailAsset, EmailDocument, SavedEmailModule
from .serializers import EmailAssetSerializer, EmailDocumentSerializer, SavedEmailModuleSerializer


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
        serializer.save(user=self.request.user)


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
