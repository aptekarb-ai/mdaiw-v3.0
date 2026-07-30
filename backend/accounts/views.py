import json

from django.contrib.auth import authenticate, login, logout
from django.http import JsonResponse
from django.middleware.csrf import get_token
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.http import require_GET, require_POST


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


@require_GET
def me_view(request):
    if request.user.is_authenticated:
        return JsonResponse({'authenticated': True, 'user': _serialize_user(request.user)})
    return JsonResponse({'authenticated': False, 'user': None})


@require_POST
def logout_view(request):
    logout(request)
    return JsonResponse({'success': True, 'message': 'Signed out successfully.'})
