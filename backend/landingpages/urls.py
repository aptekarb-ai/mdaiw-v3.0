from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register('projects', views.LandingPageProjectViewSet, basename='landingpage-project')
router.register('reports', views.ValidationReportViewSet, basename='landingpage-report')

urlpatterns = [
    path('validate/', views.ValidateView.as_view(), name='landingpage-validate'),
    path('', include(router.urls)),
]
