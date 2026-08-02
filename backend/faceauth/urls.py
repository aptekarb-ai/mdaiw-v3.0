from django.urls import path

from . import views

urlpatterns = [
    path('readiness/', views.readiness_view, name='face-readiness'),
    path('challenge/', views.challenge_view, name='face-challenge'),
    path('enrollment-proof/', views.enrollment_proof_view, name='face-enrollment-proof'),
    path('enroll/', views.enroll_view, name='face-enroll'),
    path('verify/', views.verify_view, name='face-verify'),
    path('status/', views.status_view, name='face-status'),
    path('enrollment/', views.enrollment_view, name='face-enrollment-delete'),
    path('enrollment/resume/', views.enrollment_resume_view, name='face-enrollment-resume'),
]
