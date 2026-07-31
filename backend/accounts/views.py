import json

from django.contrib.auth import authenticate, get_user_model, login, logout
from django.db import IntegrityError, transaction
from django.http import JsonResponse
from django.middleware.csrf import get_token
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.http import require_GET, require_POST

from employees.models import EmployeeProfile

from .registration import validate_registration

User = get_user_model()


def _serialize_user(user):
    return {
        'id': user.id,
        'username': user.username,
        'email': user.email,
        'first_name': user.first_name,
        'last_name': user.last_name,
    }


@require_GET
@ensure_csrf_cookie
def csrf_view(request):
    get_token(request)
    return JsonResponse({'success': True, 'message': 'CSRF cookie set.'})


@require_POST
def login_view(request):
    try:
        payload = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        payload = {}

    username = (payload.get('username') or '').strip()
    password = payload.get('password') or ''

    if not username:
        return JsonResponse(
            {
                'success': False,
                'code': 'USERNAME_REQUIRED',
                'message': 'Username is required.',
            },
            status=400,
        )
    if not password:
        return JsonResponse(
            {
                'success': False,
                'code': 'PASSWORD_REQUIRED',
                'message': 'Password is required.',
            },
            status=400,
        )

    # authenticate() returns None for unknown username, wrong password, or an
    # inactive account, so all three collapse into one generic response below
    # and never reveal which case occurred.
    user = authenticate(request, username=username, password=password)

    if user is None:
        return JsonResponse(
            {
                'success': False,
                'code': 'INVALID_CREDENTIALS',
                'message': 'Invalid username or password.',
            },
            status=401,
        )

    login(request, user)

    return JsonResponse(
        {
            'success': True,
            'message': 'Signed in successfully.',
            'user': _serialize_user(user),
        }
    )


@require_POST
def register_view(request):
    errors, cleaned = validate_registration(request.POST, request.FILES)

    if errors:
        return JsonResponse(
            {
                'success': False,
                'code': 'VALIDATION_ERROR',
                'message': 'Please correct the highlighted fields.',
                'errors': errors,
            },
            status=400,
        )

    photo_storage_field = None
    photo_storage_name = None
    try:
        with transaction.atomic():
            user = User.objects.create_user(
                username=cleaned.username,
                email=cleaned.work_email,
                password=cleaned.password,
                first_name=cleaned.first_name,
                last_name=cleaned.last_name,
                is_active=False,
            )
            profile = EmployeeProfile(
                user=user,
                employee_id=cleaned.employee_id,
                designation=cleaned.designation,
                department=cleaned.department,
                location=cleaned.location,
                manager_name=cleaned.manager_name,
                date_of_joining=cleaned.date_of_joining,
                phone=cleaned.phone,
                date_of_birth=cleaned.date_of_birth,
            )
            if cleaned.profile_photo is not None:
                profile.profile_photo = cleaned.profile_photo
            profile.save()
            if profile.profile_photo:
                photo_storage_field = profile.profile_photo.field
                photo_storage_name = profile.profile_photo.name
    except IntegrityError:
        if photo_storage_name and photo_storage_field:
            photo_storage_field.storage.delete(photo_storage_name)
        return JsonResponse(
            {
                'success': False,
                'code': 'VALIDATION_ERROR',
                'message': 'Please correct the highlighted fields.',
                'errors': {'employee_id': ['This Employee ID is already registered.']},
            },
            status=400,
        )

    return JsonResponse(
        {
            'success': True,
            'message': 'Registration details saved. Complete Face Enrollment to activate your account.',
            'registration': {
                'user_id': user.id,
                'username': user.username,
                'employee_id': profile.employee_id,
                'work_email': user.email,
                'registration_status': profile.registration_status,
                'face_enrollment_required': True,
            },
        },
        status=201,
    )


@require_GET
def me_view(request):
    if request.user.is_authenticated:
        return JsonResponse({'authenticated': True, 'user': _serialize_user(request.user)})
    return JsonResponse({'authenticated': False, 'user': None})


@require_POST
def logout_view(request):
    logout(request)
    return JsonResponse({'success': True, 'message': 'Signed out successfully.'})
