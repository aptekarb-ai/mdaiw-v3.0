from rest_framework import mixins, viewsets
from rest_framework.permissions import IsAuthenticated

from .models import EmailDocument
from .serializers import EmailDocumentSerializer


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
