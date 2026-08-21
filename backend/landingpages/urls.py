from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register('projects', views.LandingPageProjectViewSet, basename='landingpage-project')
router.register('reports', views.ValidationReportViewSet, basename='landingpage-report')

urlpatterns = [
    path('validate/', views.ValidateView.as_view(), name='landingpage-validate'),
    path('projects/save/', views.SaveLandingPageVersionView.as_view(), name='landingpage-save-version'),
    path('projects/<int:pk>/latest-version/', views.LoadLandingPageVersionView.as_view(), name='landingpage-load-version'),
    path('validate/start/', views.AIValidateStartView.as_view(), name='landingpage-validate-start'),
    path('validate/status/<str:operation_id>/', views.AIValidateStatusView.as_view(), name='landingpage-validate-status'),
    path('fixes/preview/', views.FixPreviewView.as_view(), name='landingpage-fix-preview'),
    path('fixes/apply/', views.FixApplyView.as_view(), name='landingpage-fix-apply'),
    path('ai-review/request/', views.AIReviewRequestView.as_view(), name='landingpage-ai-review-request'),
    path('ai-review/apply/', views.AIReviewApplyView.as_view(), name='landingpage-ai-review-apply'),
    path('ai-fix/run/', views.AIFixIssuesRunView.as_view(), name='landingpage-ai-fix-run'),
    path('ai-fix/start/', views.AIFixIssuesStartView.as_view(), name='landingpage-ai-fix-start'),
    path('ai-fix/status/<str:operation_id>/', views.AIFixIssuesStatusView.as_view(), name='landingpage-ai-fix-status'),
    path('yukti/explain/', views.YuktiExplainView.as_view(), name='landingpage-yukti-explain'),
    path('preview/', views.PreviewCreateView.as_view(), name='landingpage-preview-create'),
    path('preview/<uuid:token>/', views.PreviewServeView.as_view(), name='landingpage-preview-serve'),
    path(
        'preview/<uuid:token>/cross-browser/', views.CrossBrowserCheckView.as_view(),
        name='landingpage-preview-cross-browser',
    ),
    path('', include(router.urls)),
]
