from rest_framework import mixins, viewsets
from rest_framework.permissions import IsAuthenticated

from .models import EmailDocument, SavedEmailModule
from .serializers import EmailDocumentSerializer, SavedEmailModuleSerializer


class EmailDocumentViewSet(
    mixins.ListModelMixin,
    mixins.CreateModelMixin,
    mixins.RetrieveModelMixin,
    mixins.UpdateModelMixin,
    viewsets.GenericViewSet,
):
    """List/create/retrieve/update a user's own email drafts. Same
    ownership boundary as landingpages.LandingPageProjectViewSet: another
    user's document id is filtered out before lookup, so it 404s rather
    than 403s. Update (PATCH) exists for Feature 03's builder to persist
    `content` — delete still isn't exposed; that belongs to the later "My
    Emails" feature, not the builder."""

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
