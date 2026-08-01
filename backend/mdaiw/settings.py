"""
Django settings for the MDAIW backend.
"""

import os
from pathlib import Path

import dj_database_url
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR.parent / '.env')

SECRET_KEY = os.environ.get('DJANGO_SECRET_KEY', 'django-insecure-dev-only-change-me')

DEBUG = os.environ.get('DJANGO_DEBUG', 'true').lower() == 'true'

ALLOWED_HOSTS = [
    host.strip()
    for host in os.environ.get('DJANGO_ALLOWED_HOSTS', 'localhost,127.0.0.1').split(',')
    if host.strip()
]

INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'rest_framework',
    'corsheaders',
    'accounts',
    'employees',
    'faceauth',
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'corsheaders.middleware.CorsMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'mdaiw.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'mdaiw.wsgi.application'

DATABASES = {
    'default': dj_database_url.parse(
        os.environ.get('DATABASE_URL', f"sqlite:///{BASE_DIR / 'db.sqlite3'}")
    )
}

AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator'},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]

LANGUAGE_CODE = 'en-us'
TIME_ZONE = 'UTC'
USE_I18N = True
USE_TZ = True

STATIC_URL = 'static/'
MEDIA_URL = 'media/'
MEDIA_ROOT = BASE_DIR / 'media'

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': [
        'rest_framework.authentication.SessionAuthentication',
    ],
    'DEFAULT_PERMISSION_CLASSES': [
        'rest_framework.permissions.IsAuthenticated',
    ],
}

CORS_ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.environ.get('CORS_ALLOWED_ORIGINS', 'http://localhost:5173').split(',')
    if origin.strip()
]
CORS_ALLOW_CREDENTIALS = True

CSRF_TRUSTED_ORIGINS = [
    origin.strip()
    for origin in os.environ.get('CSRF_TRUSTED_ORIGINS', 'http://localhost:5173').split(',')
    if origin.strip()
]

SESSION_COOKIE_HTTPONLY = True
CSRF_COOKIE_HTTPONLY = False
SESSION_COOKIE_SAMESITE = 'Lax'
CSRF_COOKIE_SAMESITE = 'Lax'
SESSION_COOKIE_SECURE = not DEBUG
CSRF_COOKIE_SECURE = not DEBUG

FACE_EMBEDDING_ENCRYPTION_KEYS = [
    key.strip()
    for key in os.environ.get('FACE_EMBEDDING_ENCRYPTION_KEYS', '').split(',')
    if key.strip()
]
FACE_MODEL_NAME = os.environ.get('FACE_MODEL_NAME', 'Facenet512')
FACE_DETECTOR_BACKEND = os.environ.get('FACE_DETECTOR_BACKEND', 'retinaface')
FACE_DISTANCE_METRIC = os.environ.get('FACE_DISTANCE_METRIC', 'cosine')
FACE_MAX_FAILED_ATTEMPTS = int(os.environ.get('FACE_MAX_FAILED_ATTEMPTS', '5'))
FACE_FAILURE_WINDOW_MINUTES = int(os.environ.get('FACE_FAILURE_WINDOW_MINUTES', '15'))
FACE_LOCK_MINUTES = int(os.environ.get('FACE_LOCK_MINUTES', '30'))
FACE_CHALLENGE_TTL_SECONDS = int(os.environ.get('FACE_CHALLENGE_TTL_SECONDS', '120'))
FACE_ENROLLMENT_TOKEN_TTL_SECONDS = int(os.environ.get('FACE_ENROLLMENT_TOKEN_TTL_SECONDS', '900'))
FACE_MAX_FRAMES = int(os.environ.get('FACE_MAX_FRAMES', '4'))
FACE_FRAME_MAX_BYTES = int(os.environ.get('FACE_FRAME_MAX_BYTES', str(2 * 1024 * 1024)))
FACE_ENROLLMENT_RESUME_MAX_ATTEMPTS = int(os.environ.get('FACE_ENROLLMENT_RESUME_MAX_ATTEMPTS', '5'))
FACE_ENROLLMENT_RESUME_WINDOW_MINUTES = int(os.environ.get('FACE_ENROLLMENT_RESUME_WINDOW_MINUTES', '15'))

# DeepFace downloads model weights to this directory on first use instead of
# the default ~/.deepface — kept inside the repo but git-ignored so it never
# gets committed.
FACE_MODEL_CACHE_DIR = BASE_DIR / '.face-models'
FACE_MODEL_CACHE_DIR.mkdir(parents=True, exist_ok=True)
os.environ.setdefault('DEEPFACE_HOME', str(FACE_MODEL_CACHE_DIR))

# retina-face==0.0.18's model-construction code (retinaface_model.py) calls
# raw tf.shape() on a KerasTensor, which TensorFlow 2.21's default Keras 3
# backend rejects with "A KerasTensor cannot be used as input to a
# TensorFlow function." tf-keras (installed alongside tensorflow) provides a
# Keras-2-compatible implementation; this flag routes tf.keras through it,
# which resolves the incompatibility. Must be set before TensorFlow is first
# imported anywhere in the process, so it belongs here, at settings load
# time — not inside faceauth/service.py, which may be imported after some
# other codepath has already triggered a TensorFlow import.
os.environ.setdefault('TF_USE_LEGACY_KERAS', '1')

PROFILE_PHOTO_MAX_BYTES = 5 * 1024 * 1024
PROFILE_PHOTO_ALLOWED_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp']

# Django upload-size ceiling — comfortably covers FACE_MAX_FRAMES frames at
# FACE_FRAME_MAX_BYTES each, so an oversized multipart request is rejected by
# Django itself before any per-file validation or model inference runs.
DATA_UPLOAD_MAX_MEMORY_SIZE = FACE_MAX_FRAMES * FACE_FRAME_MAX_BYTES + (1 * 1024 * 1024)
FILE_UPLOAD_MAX_MEMORY_SIZE = FACE_FRAME_MAX_BYTES + (512 * 1024)
