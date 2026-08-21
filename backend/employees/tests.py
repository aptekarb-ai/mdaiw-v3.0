from datetime import date

from django.contrib.auth import get_user_model
from django.test import TestCase

from .models import EmployeeProfile, RegistrationStatus

User = get_user_model()


class EmployeeProfileModelTests(TestCase):
    def test_create_employee_profile(self):
        user = User.objects.create_user(
            username='john.smith',
            email='john.smith@example.com',
            password='StrongPass123',
            first_name='John',
            last_name='Smith',
            is_active=False,
        )
        profile = EmployeeProfile.objects.create(
            user=user,
            employee_id='MDAIW-001',
            designation='Software Engineer',
            department='Engineering',
            location='India',
            manager_name='Priya Rao',
            date_of_joining=date(2026, 1, 5),
            phone='+91 9876543210',
            date_of_birth=date(1990, 6, 15),
        )
        self.assertEqual(profile.registration_status, RegistrationStatus.PENDING_FACE_ENROLLMENT)
        self.assertIn('MDAIW-001', str(profile))
        self.assertFalse(profile.profile_photo)

    def test_employee_id_must_be_unique(self):
        user1 = User.objects.create_user(username='a.one', email='a.one@example.com', password='StrongPass123')
        user2 = User.objects.create_user(username='b.two', email='b.two@example.com', password='StrongPass123')
        EmployeeProfile.objects.create(
            user=user1,
            employee_id='MDAIW-100',
            designation='Engineer',
            department='Engineering',
            location='India',
            manager_name='Manager One',
            date_of_joining=date(2026, 1, 1),
            phone='+919876543210',
            date_of_birth=date(1990, 1, 1),
        )
        with self.assertRaises(Exception):
            EmployeeProfile.objects.create(
                user=user2,
                employee_id='MDAIW-100',
                designation='Engineer',
                department='Engineering',
                location='India',
                manager_name='Manager Two',
                date_of_joining=date(2026, 1, 1),
                phone='+919876543211',
                date_of_birth=date(1990, 1, 1),
            )
