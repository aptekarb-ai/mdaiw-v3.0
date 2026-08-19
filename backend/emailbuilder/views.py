from rest_framework import mixins, viewsets
from rest_framework.permissions import IsAuthenticated

from .models import EmailDocument
from .serializers import EmailDocumentSerializer


class EmailDocumentViewSet(
    mixins.ListModelMixin,
    mixins.CreateModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    """List/create/retrieve a user's own email drafts. Same ownership
    boundary as landingpages.LandingPageProjectViewSet: another user's
    document id is filtered out before lookup, so it 404s rather than
    403s. Update and delete aren't exposed yet — rename/duplicate/delete
    belong to the later "My Emails" feature, not this setup wizard."""

    serializer_class = EmailDocumentSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return EmailDocument.objects.filter(user=self.request.user)

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)
