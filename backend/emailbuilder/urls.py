from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register('emails', views.EmailDocumentViewSet, basename='email-document')
router.register('saved-modules', views.SavedEmailModuleViewSet, basename='saved-email-module')

urlpatterns = [
    path('', include(router.urls)),
]
