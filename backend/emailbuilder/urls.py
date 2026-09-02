from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register('emails', views.EmailDocumentViewSet, basename='email-document')
router.register('saved-modules', views.SavedEmailModuleViewSet, basename='saved-email-module')
router.register('assets', views.EmailAssetViewSet, basename='email-asset')
router.register('attachments', views.EmailAttachmentViewSet, basename='email-attachment')

urlpatterns = [
    path('ai-command/', views.EmailAICommandView.as_view(), name='email-ai-command'),
    # D4-C — read-only EmailBrief construction, deliberately its own
    # endpoint rather than a branch on ai-command/: different request
    # shape (document + attachment_ids, no selected-module/editor
    # context), different cost profile (re-extracts every referenced
    # attachment), different throttle (EMAILBUILDER_BRIEF_REQUEST_MAX).
    path('brief/', views.EmailBriefView.as_view(), name='email-brief'),
    # D4-D — takes the same request shape as brief/ one step further:
    # builds the EmailBrief AND the builder-aware construction plan in
    # one call, returning a ready-to-Apply, already-validated
    # COMPOSE_EMAIL action alongside the plan's explanation.
    path('construction-plan/', views.ConstructionPlanView.as_view(), name='email-construction-plan'),
    # Feature 14 V3 Sub-phase 8 — ranking must be its own GET path (not a
    # method branch on the signals collection) so it's cacheable/
    # bookmarkable independently and never collides with a future
    # GET-list-of-signals endpoint this feature deliberately does not add.
    path('learning/signals/ranking/', views.LearningRankingView.as_view(), name='email-learning-ranking'),
    path('learning/signals/', views.LearningSignalView.as_view(), name='email-learning-signals'),
    # D4-E0 item 14 — read-only local AI runtime/model diagnostics; never
    # gates anything else, the deterministic AI Engineer works with this
    # endpoint absent entirely.
    path('local-ai-diagnostics/', views.LocalAIDiagnosticsView.as_view(), name='email-local-ai-diagnostics'),
    path('', include(router.urls)),
]
