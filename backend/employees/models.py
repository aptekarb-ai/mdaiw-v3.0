import uuid

from django.conf import settings
from django.core.validators import RegexValidator
from django.db import models
from django.utils import timezone


def profile_photo_upload_path(instance, filename):
    extension = filename.rsplit('.', 1)[-1].lower() if '.' in filename else 'jpg'
    return f'profile_photos/{uuid.uuid4().hex}.{extension}'


employee_id_validator = RegexValidator(
    regex=r'^[A-Za-z0-9-]{1,50}$',
    message='Employee ID may only contain letters, numbers, and hyphens.',
)

phone_validator = RegexValidator(
    regex=r'^\+?[0-9\s()-]{7,20}$',
    message='Enter a valid phone number.',
)


class RegistrationStatus(models.TextChoices):
    PENDING_FACE_ENROLLMENT = 'PENDING_FACE_ENROLLMENT', 'Pending Face Enrollment'
    ACTIVE = 'ACTIVE', 'Active'
    REJECTED = 'REJECTED', 'Rejected'
    SUSPENDED = 'SUSPENDED', 'Suspended'


class EmployeeProfile(models.Model):
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='employee_profile',
    )
    employee_id = models.CharField(
        max_length=50,
        unique=True,
        validators=[employee_id_validator],
    )
    designation = models.CharField(max_length=150)
    department = models.CharField(max_length=150)
    location = models.CharField(max_length=150)
    manager_name = models.CharField(max_length=150)
    date_of_joining = models.DateField()
    phone = models.CharField(max_length=20, validators=[phone_validator])
    date_of_birth = models.DateField()
    profile_photo = models.ImageField(
        upload_to=profile_photo_upload_path,
        blank=True,
        null=True,
    )
    registration_status = models.CharField(
        max_length=32,
        choices=RegistrationStatus.choices,
        default=RegistrationStatus.PENDING_FACE_ENROLLMENT,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f'{self.employee_id} — {self.user.get_full_name() or self.user.username}'

    def clean(self):
        from django.core.exceptions import ValidationError

        if self.date_of_birth and self.date_of_birth >= timezone.localdate():
            raise ValidationError({'date_of_birth': 'Date of birth cannot be today or in the future.'})
