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
    'yukti',
    'landingpages',
    'emailbuilder',
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
    'EXCEPTION_HANDLER': 'mdaiw.exceptions.mdaiw_exception_handler',
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

# Which FaceRecognitionEngine new enrollments use — 'opencv_sface' (YuNet
# detection + SFace embeddings/matching) or 'deepface' (the pre-existing
# RetinaFace/Facenet512 pipeline above, kept for rollback and for verifying
# credentials created before this setting existed). See
# faceauth/engines/registry.py. Existing FaceCredential rows always verify
# through the engine recorded on them (FaceCredential.engine_name),
# regardless of this setting — see faceauth/service.py's engine-aware
# verify() path.
FACE_RECOGNITION_ENGINE = os.environ.get('FACE_RECOGNITION_ENGINE', 'opencv_sface')

# Passive anti-spoofing is independent of which FaceRecognitionEngine is
# selected (YuNet+SFace has no anti-spoofing of its own) — see
# faceauth/anti_spoof/registry.py. 'silent_face' wraps the project's
# existing Fasnet-based passive anti-spoofing model.
FACE_ANTI_SPOOF_PROVIDER = os.environ.get('FACE_ANTI_SPOOF_PROVIDER', 'silent_face')

# Official OpenCV Zoo cosine-similarity threshold documented in the SFace
# model's own reference demo (models/face_recognition_sface/sface.py,
# `_threshold_cosine = 0.363`) — used as the initial value here, not
# invented. Must be recalibrated against this project's own real-environment
# enrollment/verification data before production use (different cameras,
# lighting, and population than OpenCV's own evaluation set can shift the
# operating point) — see docs/module-1/IMPLEMENTATION_STATUS.md.
FACE_SFACE_COSINE_THRESHOLD = float(os.environ.get('FACE_SFACE_COSINE_THRESHOLD', '0.363'))
# YuNet's own confidence score (0-1) for a detection to be trusted at all.
# 0.6 is YuNet's own documented/demo default confidence threshold.
FACE_MIN_DETECTION_CONFIDENCE = float(os.environ.get('FACE_MIN_DETECTION_CONFIDENCE', '0.6'))
# Minimum face bounding-box width/height, in pixels, at the ~640x480 capture
# resolution this project requests (see frontend/src/hooks/useCamera.ts) —
# rejects a face too small to embed reliably before spending a model call on it.
FACE_MIN_FACE_SIZE_PIXELS = int(os.environ.get('FACE_MIN_FACE_SIZE_PIXELS', '60'))

# Local, git-ignored OpenCV model files — see
# faceauth/management/commands/download_face_models.py. Never downloaded
# during an active enrollment request; must exist before the engine can warm.
FACE_OPENCV_MODEL_DIR = BASE_DIR / '.face-models' / 'opencv'
FACE_OPENCV_MODEL_DIR.mkdir(parents=True, exist_ok=True)
FACE_YUNET_MODEL_PATH = FACE_OPENCV_MODEL_DIR / 'yunet.onnx'
FACE_SFACE_MODEL_PATH = FACE_OPENCV_MODEL_DIR / 'sface.onnx'
FACE_MAX_FAILED_ATTEMPTS = int(os.environ.get('FACE_MAX_FAILED_ATTEMPTS', '5'))
FACE_FAILURE_WINDOW_MINUTES = int(os.environ.get('FACE_FAILURE_WINDOW_MINUTES', '15'))
FACE_LOCK_MINUTES = int(os.environ.get('FACE_LOCK_MINUTES', '30'))
FACE_CHALLENGE_TTL_SECONDS = int(os.environ.get('FACE_CHALLENGE_TTL_SECONDS', '120'))
FACE_ENROLLMENT_TOKEN_TTL_SECONDS = int(os.environ.get('FACE_ENROLLMENT_TOKEN_TTL_SECONDS', '900'))
FACE_MAX_FRAMES = int(os.environ.get('FACE_MAX_FRAMES', '4'))
# Of the frames a request submits (all independently detection/anti-spoof/
# quality/position validated), only this many highest-quality ones are
# actually spent on the embedding model — see
# faceauth/service.py::process_enrollment_frames. Never allowed below 2:
# cross-frame identity consistency needs at least two embeddings.
FACE_EMBEDDING_FRAME_COUNT = int(os.environ.get('FACE_EMBEDDING_FRAME_COUNT', '2'))
FACE_FRAME_MAX_BYTES = int(os.environ.get('FACE_FRAME_MAX_BYTES', str(2 * 1024 * 1024)))
FACE_ENROLLMENT_RESUME_MAX_ATTEMPTS = int(os.environ.get('FACE_ENROLLMENT_RESUME_MAX_ATTEMPTS', '5'))
FACE_ENROLLMENT_RESUME_WINDOW_MINUTES = int(os.environ.get('FACE_ENROLLMENT_RESUME_WINDOW_MINUTES', '15'))

# Throttling for the final atomic registration submission (account + employee
# + Face Enrollment together) and for issuing the anonymous, pre-account
# ENROLL challenge used by the inline registration-wizard Face Enrollment step.
REGISTRATION_MAX_ATTEMPTS = int(os.environ.get('REGISTRATION_MAX_ATTEMPTS', '10'))
REGISTRATION_WINDOW_MINUTES = int(os.environ.get('REGISTRATION_WINDOW_MINUTES', '60'))
FACE_ENROLLMENT_CHALLENGE_MAX_ATTEMPTS = int(os.environ.get('FACE_ENROLLMENT_CHALLENGE_MAX_ATTEMPTS', '10'))
FACE_ENROLLMENT_CHALLENGE_WINDOW_MINUTES = int(os.environ.get('FACE_ENROLLMENT_CHALLENGE_WINDOW_MINUTES', '15'))

# The registration wizard's Step 3 validates captured frames immediately
# (faceauth/views.py::enrollment_proof_view) and gets back a single-use proof
# referencing the already-encrypted embedding. Its TTL must comfortably cover
# Step 4 review time, unlike the short-lived capture challenge above.
FACE_ENROLLMENT_PROOF_TTL_SECONDS = int(os.environ.get('FACE_ENROLLMENT_PROOF_TTL_SECONDS', '900'))
FACE_ENROLLMENT_PROOF_MAX_ATTEMPTS = int(os.environ.get('FACE_ENROLLMENT_PROOF_MAX_ATTEMPTS', '10'))
FACE_ENROLLMENT_PROOF_WINDOW_MINUTES = int(os.environ.get('FACE_ENROLLMENT_PROOF_WINDOW_MINUTES', '15'))

# Hard budget for the synchronous biometric-processing call inside
# enrollment_proof_view, once models are confirmed loaded (see
# faceauth/apps.py::FaceauthConfig.ready() and service.is_ready() — a
# request never even attempts processing while models are still warming;
# it fails fast with MODEL_UNAVAILABLE instead). 120s comfortably covers
# real per-frame CPU inference for a handful of frames with headroom; the
# frontend's own request timeout (see frontend/.env.example's
# VITE_FACE_PROCESSING_TIMEOUT_MS) must always be set higher than this,
# with a safety margin, so this backend timeout — with its specific,
# distinguishable error code — is what normally fires, not a generic
# client-side abort.
FACE_PROCESSING_TIMEOUT_SECONDS = int(os.environ.get('FACE_PROCESSING_TIMEOUT_SECONDS', '120'))

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

# Module-4 Feature 08 (Asset Manager). Kept at the same ceiling as
# PROFILE_PHOTO_MAX_BYTES deliberately — DATA_UPLOAD_MAX_MEMORY_SIZE below
# is sized for Module-1's face-frame uploads (~9MB), so any asset limit
# must stay comfortably under that shared Django-wide ceiling rather than
# raising it.
EMAIL_ASSET_MAX_BYTES = 5 * 1024 * 1024
EMAIL_ASSET_ALLOWED_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

# Module-4 Feature 14 V4 / D4-B (Email AI Engineer attachment ingestion).
# Kept comfortably under DATA_UPLOAD_MAX_MEMORY_SIZE below (~9 MB) per the
# D4-A audit finding that any new upload limit must stay under that
# shared Django-wide ceiling rather than raising it. Larger than
# EMAIL_ASSET_MAX_BYTES since a legitimate PDF/DOCX/XLSX document is
# often bigger than a marketing image, but still bounded well short of
# the ceiling.
EMAIL_ATTACHMENT_MAX_BYTES = 8 * 1024 * 1024

# Module-4 Feature 14 V4 / D4-C (EmailBrief construction). Own throttle,
# independent of EMAILBUILDER_AI_COMMAND_REQUEST_MAX — a brief request
# re-reads and re-extracts every referenced attachment (PDF/DOCX/XLSX
# parsing), a heavier per-request cost than a plain AI command, so it
# gets its own, tighter budget rather than sharing the ai-command one.
EMAILBUILDER_BRIEF_REQUEST_MAX = int(os.environ.get('EMAILBUILDER_BRIEF_REQUEST_MAX', '15'))
EMAILBUILDER_BRIEF_REQUEST_WINDOW_SECONDS = int(os.environ.get('EMAILBUILDER_BRIEF_REQUEST_WINDOW_SECONDS', '60'))

# Module-4 Feature 14 V4 / D4-D (builder-aware construction planner). Own
# throttle, separate from the brief endpoint's — a construction-plan
# request does everything the brief endpoint does (re-extract every
# referenced attachment) PLUS the matching/plan-assembly pass, so it gets
# the tightest budget of the three AI-adjacent endpoints.
EMAILBUILDER_CONSTRUCTION_PLAN_REQUEST_MAX = int(os.environ.get('EMAILBUILDER_CONSTRUCTION_PLAN_REQUEST_MAX', '10'))
EMAILBUILDER_CONSTRUCTION_PLAN_REQUEST_WINDOW_SECONDS = int(
    os.environ.get('EMAILBUILDER_CONSTRUCTION_PLAN_REQUEST_WINDOW_SECONDS', '60'),
)

# Module-4 Feature 14 (Email AI Engineer). 3-way provider selection via
# EMAILBUILDER_AI_COMMAND_PROVIDER: 'openai' (the SAME OPENAI_API_KEY
# value Yukti/LP AI Review already use — one secret, not a new one),
# 'local' (EMAILBUILDER_LOCAL_AI_BASE_URL below — any OpenAI-compatible
# server), or anything else/unset — deterministic only. See
# emailbuilder/ai_command.py::get_default_email_command_provider(). The
# deterministic router (emailbuilder/ai_command.py::
# RuleBasedEmailCommandProvider) is always fully functional regardless of
# provider selection — same "AI is optional, deterministic is the
# baseline" posture as YUKTI_AI_PROVIDER above. No API key or local
# server is ever required for normal operation.
EMAILBUILDER_AI_COMMAND_PROVIDER = os.environ.get('EMAILBUILDER_AI_COMMAND_PROVIDER', '')
EMAILBUILDER_AI_COMMAND_MODEL = os.environ.get('EMAILBUILDER_AI_COMMAND_MODEL', 'gpt-4o-mini')
EMAILBUILDER_AI_COMMAND_TIMEOUT_SECONDS = float(os.environ.get('EMAILBUILDER_AI_COMMAND_TIMEOUT_SECONDS', '15'))
EMAILBUILDER_AI_COMMAND_MAX_OUTPUT_TOKENS = int(os.environ.get('EMAILBUILDER_AI_COMMAND_MAX_OUTPUT_TOKENS', '500'))
# Separate, tighter throttle for the paid provider call itself — a traffic
# spike degrades to the free deterministic router rather than the API
# bill (same reasoning as YUKTI_AI_MAX_REQUESTS_PER_WINDOW).
EMAILBUILDER_AI_COMMAND_MAX_REQUESTS_PER_WINDOW = int(
    os.environ.get('EMAILBUILDER_AI_COMMAND_MAX_REQUESTS_PER_WINDOW', '20'),
)
EMAILBUILDER_AI_COMMAND_WINDOW_SECONDS = int(os.environ.get('EMAILBUILDER_AI_COMMAND_WINDOW_SECONDS', '60'))
# General per-user throttle on the whole /ai-command/ endpoint, independent
# of which provider answers (mirrors YUKTI_INTENT_MAX_REQUESTS below).
EMAILBUILDER_AI_COMMAND_REQUEST_MAX = int(os.environ.get('EMAILBUILDER_AI_COMMAND_REQUEST_MAX', '30'))
EMAILBUILDER_AI_COMMAND_REQUEST_WINDOW_SECONDS = int(
    os.environ.get('EMAILBUILDER_AI_COMMAND_REQUEST_WINDOW_SECONDS', '60'),
)

# Feature 14 V2 Phase A — optional local/self-hosted provider
# (EMAILBUILDER_AI_COMMAND_PROVIDER='local'). Any OpenAI-compatible HTTP
# endpoint works (Ollama, llama.cpp's llama-server, LM Studio, etc.) — see
# emailbuilder/ai_command_local.py. Both unset (the default) means the
# local provider is never constructed and the deterministic router alone
# answers every request — no local server is required for normal
# operation. EMAILBUILDER_LOCAL_AI_API_KEY is almost never needed (most
# local servers ignore it) but is provided for the rare server that
# checks for a bearer token.
EMAILBUILDER_LOCAL_AI_BASE_URL = os.environ.get('EMAILBUILDER_LOCAL_AI_BASE_URL', '')
EMAILBUILDER_LOCAL_AI_MODEL = os.environ.get('EMAILBUILDER_LOCAL_AI_MODEL', '')
EMAILBUILDER_LOCAL_AI_API_KEY = os.environ.get('EMAILBUILDER_LOCAL_AI_API_KEY', '')
# R4-B2 — informational only, never read for control flow: which local
# runtime family the operator has pointed EMAILBUILDER_LOCAL_AI_BASE_URL
# at ('ollama' | 'llamacpp' | 'compatible-local-server' | ''), surfaced
# only in admin/settings diagnostics (see §24 of the R4-B2 spec — never
# shown in the normal AI Engineer conversation UI). The wire protocol is
# identical OpenAI-compatible JSON regardless of this value, so nothing
# in ai_command_local.py branches on it.
EMAILBUILDER_LOCAL_AI_RUNTIME = os.environ.get('EMAILBUILDER_LOCAL_AI_RUNTIME', '')
# R4-B2 — a local model's own context window is frequently much smaller
# than a hosted model's (many popular local 7B-13B models ship with
# 4k-8k token windows) — this caps the TOTAL serialized size (system
# prompt + knowledge snippets + conversation history + context JSON) the
# local provider will ever send, trimming the OLDEST conversation turns
# first (see ai_command_local.py::_apply_context_limit) rather than
# failing the request outright. Character-based, not token-based — a
# simple, dependency-free, conservative proxy (roughly 3-4 chars/token
# for English) that never requires a tokenizer library for a local
# runtime whose exact tokenizer this app cannot know in advance.
EMAILBUILDER_LOCAL_AI_CONTEXT_LIMIT_CHARS = int(os.environ.get('EMAILBUILDER_LOCAL_AI_CONTEXT_LIMIT_CHARS', '6000'))

# Django upload-size ceiling — comfortably covers FACE_MAX_FRAMES frames at
# FACE_FRAME_MAX_BYTES each, so an oversized multipart request is rejected by
# Django itself before any per-file validation or model inference runs.
DATA_UPLOAD_MAX_MEMORY_SIZE = FACE_MAX_FRAMES * FACE_FRAME_MAX_BYTES + (1 * 1024 * 1024)
FILE_UPLOAD_MAX_MEMORY_SIZE = FACE_FRAME_MAX_BYTES + (512 * 1024)

YUKTI_INTENT_MAX_REQUESTS = int(os.environ.get('YUKTI_INTENT_MAX_REQUESTS', '30'))
YUKTI_INTENT_WINDOW_SECONDS = int(os.environ.get('YUKTI_INTENT_WINDOW_SECONDS', '60'))

# Optional AI-backed Yukti provider. Empty/unset YUKTI_AI_PROVIDER (the
# default) or a missing OPENAI_API_KEY means Yukti runs the deterministic
# rule-based router only — see yukti/providers.py::get_default_provider().
YUKTI_AI_PROVIDER = os.environ.get('YUKTI_AI_PROVIDER', '')
YUKTI_AI_MODEL = os.environ.get('YUKTI_AI_MODEL', 'gpt-4o-mini')
YUKTI_AI_TIMEOUT_SECONDS = float(os.environ.get('YUKTI_AI_TIMEOUT_SECONDS', '8'))
YUKTI_AI_MAX_OUTPUT_TOKENS = int(os.environ.get('YUKTI_AI_MAX_OUTPUT_TOKENS', '400'))
# Separate, tighter throttle for the paid provider call itself — a traffic
# spike degrades to the free deterministic router rather than the API bill.
YUKTI_AI_MAX_REQUESTS_PER_WINDOW = int(os.environ.get('YUKTI_AI_MAX_REQUESTS_PER_WINDOW', '20'))
YUKTI_AI_WINDOW_SECONDS = int(os.environ.get('YUKTI_AI_WINDOW_SECONDS', '60'))
# Server-only. Never exposed to Vite/frontend JavaScript, never returned in
# any API response, never committed with a real value (see .env.example).
OPENAI_API_KEY = os.environ.get('OPENAI_API_KEY', '')

# Module 3 — LP Validator & Fixer (Sprint 1A foundation). 'local' is the
# only implemented provider; see landingpages/storage/registry.py for how
# a future S3/Azure Blob/MinIO/GCS provider would be added without any
# caller-visible change.
LP_STORAGE_PROVIDER = os.environ.get('LP_STORAGE_PROVIDER', 'local')
# Kept inside the repo's already-gitignored media/ directory (see
# backend/.gitignore's "backend/media/" rule) rather than a new top-level
# path, so no .gitignore change was needed for this sprint.
LP_STORAGE_ROOT = BASE_DIR / 'media' / 'landing_pages'

# CSS validation (Sprint 1D) — controlled Node subprocess bridge, see
# backend/landingpages/validation/node_bridge.py. LP_NODE_EXECUTABLE is
# resolved via shutil.which() at call time, never accepted from a request.
LP_NODE_EXECUTABLE = os.environ.get('LP_NODE_EXECUTABLE', 'node')
LP_CSS_VALIDATION_TIMEOUT_SECONDS = float(os.environ.get('LP_CSS_VALIDATION_TIMEOUT_SECONDS', '5'))
LP_CSS_VALIDATION_MAX_OUTPUT_BYTES = int(os.environ.get('LP_CSS_VALIDATION_MAX_OUTPUT_BYTES', str(2_000_000)))
LP_CSS_VALIDATION_MAX_ISSUES = int(os.environ.get('LP_CSS_VALIDATION_MAX_ISSUES', '500'))

# SCSS/Sass compilation (Sprint CSS-C) — same controlled Node subprocess
# bridge, separate timeout since Dart Sass compilation is slower than
# plain CSS parsing. LP_CSS_VALIDATION_MAX_OUTPUT_BYTES/MAX_ISSUES above
# are shared with this path.
LP_SCSS_COMPILATION_TIMEOUT_SECONDS = float(os.environ.get('LP_SCSS_COMPILATION_TIMEOUT_SECONDS', '8'))

# LESS compilation (Sprint CSS-D) — same controlled Node subprocess bridge.
LP_LESS_COMPILATION_TIMEOUT_SECONDS = float(os.environ.get('LP_LESS_COMPILATION_TIMEOUT_SECONDS', '8'))

# JavaScript validation (Module 3 — LP Validator, JS engine sprint) — same
# controlled Node subprocess bridge, see
# backend/landingpages/validation/node_bridge.py::run_js_validation.
# 8s (not 5s), same reasoning as SCSS/LESS above: ESLint's own cold-start
# (loading the Linter class, @eslint/js, and this project's custom rule
# modules) measured 4.4-4.5s on a cold Node process vs ~0.4s once the
# OS/AV file cache is warm — directly measured as the cause of an
# intermittent full-suite-only failure in
# test_javascript_validation.AcceptanceCaseTests.test_case_a_javascript_only
# (passed standalone every time; the flake only appeared once across
# many full-suite runs, right when a cold-start coincided with
# contention from the hundreds of other Node subprocesses the full suite
# spawns). 5s left under 15% margin above the measured worst case —
# not enough headroom under load. 8s matches the already-proven-safe
# SCSS/LESS value for the same class of cold-start cost.
LP_JS_VALIDATION_TIMEOUT_SECONDS = float(os.environ.get('LP_JS_VALIDATION_TIMEOUT_SECONDS', '8'))

# Nu Html Checker (Hybrid Validator + AI Engineer architecture sprint) —
# controlled Java subprocess bridge, see
# backend/landingpages/validation/java_bridge.py. LP_JAVA_EXECUTABLE is
# resolved via shutil.which() at call time, never accepted from a request.
# vnu.jar requires a Java 11+ runtime; override this only if the `java`
# resolved via PATH is older (this adapter reports itself cleanly
# unavailable rather than crashing when no suitable Java is found).
LP_JAVA_EXECUTABLE = os.environ.get('LP_JAVA_EXECUTABLE', 'java')
LP_NU_HTML_TIMEOUT_SECONDS = float(os.environ.get('LP_NU_HTML_TIMEOUT_SECONDS', '10'))
LP_NU_HTML_MAX_OUTPUT_BYTES = int(os.environ.get('LP_NU_HTML_MAX_OUTPUT_BYTES', str(2_000_000)))
LP_JS_VALIDATION_MAX_OUTPUT_BYTES = int(os.environ.get('LP_JS_VALIDATION_MAX_OUTPUT_BYTES', str(2_000_000)))
LP_JS_VALIDATION_MAX_ISSUES = int(os.environ.get('LP_JS_VALIDATION_MAX_ISSUES', '500'))

# AI Review & Fix (Module 3 — LP Validator, AI Review sprint) — same
# provider-availability pattern as YUKTI_AI_PROVIDER above (see
# yukti/providers.py::get_default_provider): empty/unset
# LP_AI_REVIEW_PROVIDER (the default) or a missing OPENAI_API_KEY means
# "Review & Fix with AI" reports AI_REVIEW_UNAVAILABLE — never a crash,
# never a silently-broken feature. Reuses the same OPENAI_API_KEY value
# as Yukti (one key, two independent optional features) rather than
# introducing a second secret to manage. Independent rate limit/timeout/
# token settings from Yukti's own, since a code-review call is a larger,
# slower, more expensive request than a chat turn.
LP_AI_REVIEW_PROVIDER = os.environ.get('LP_AI_REVIEW_PROVIDER', '')
LP_AI_REVIEW_MODEL = os.environ.get('LP_AI_REVIEW_MODEL', 'gpt-4o-mini')
LP_AI_REVIEW_TIMEOUT_SECONDS = float(os.environ.get('LP_AI_REVIEW_TIMEOUT_SECONDS', '30'))
LP_AI_REVIEW_MAX_OUTPUT_TOKENS = int(os.environ.get('LP_AI_REVIEW_MAX_OUTPUT_TOKENS', '4000'))
LP_AI_REVIEW_MAX_REQUESTS_PER_WINDOW = int(os.environ.get('LP_AI_REVIEW_MAX_REQUESTS_PER_WINDOW', '10'))
LP_AI_REVIEW_WINDOW_SECONDS = int(os.environ.get('LP_AI_REVIEW_WINDOW_SECONDS', '300'))

# AI Engineer Autonomous Repair sprint — the detect-fix-revalidate loop
# (fixes/iterative.py::run_autonomous_repair) repeats up to this many full
# validate+repair rounds in ONE "AI Fix Issues" click, so a root defect
# that was hiding secondary ones (a malformed <html>/<head>, a JS syntax
# error blocking ESLint, ...) gets a real chance to expose and fix them
# too, with no manual re-click and no per-issue approval step. Each round
# is a full deterministic-engines-plus-AI-Engineer revalidation plus (when
# issues remain that only an AI-assisted fix can address) an AI Review
# call, so this is a real cost/latency multiplier, not a free knob.
# Consistent Validation Counts sprint, section 9 — raised from 5: the loop
# ALREADY stops as soon as genuinely no more progress is possible
# (stopped_reason 'no_actionable'/'no_progress'/'all_resolved' — see
# below), so a higher ceiling costs nothing extra for an ordinary fixture
# that finishes early; it only matters for a deeply-layered malformed
# document where each round exposes one more real layer and 5 rounds cut
# the loop off mid-progress. Still configurable via the environment.
LP_AI_FIX_MAX_ITERATIONS = int(os.environ.get('LP_AI_FIX_MAX_ITERATIONS', '8'))

# Deep Validation + Autonomous Repair sprint, Checkpoint 6 — Whole-Source
# AI Repair mode (fixes/iterative.py::_attempt_whole_source_repair). Only
# ever attempted by "AI Fix Issues" (never "AI Fix This Issue" — spec
# section 12), and only as a fallback when regional patching has already
# failed to make progress on a structurally malformed file. A whole-file
# rewrite needs to both receive and RETURN the complete source, so it
# needs its own, larger output budget than a bounded per-issue patch list
# — and its own input-size ceiling, since a very large file makes a
# single-shot full rewrite both expensive and harder to safely diff.
LP_AI_REPAIR_WHOLE_SOURCE_MAX_INPUT_LENGTH = int(
    os.environ.get('LP_AI_REPAIR_WHOLE_SOURCE_MAX_INPUT_LENGTH', '12000'),
)
LP_AI_REPAIR_WHOLE_SOURCE_MAX_OUTPUT_TOKENS = int(
    os.environ.get('LP_AI_REPAIR_WHOLE_SOURCE_MAX_OUTPUT_TOKENS', '8000'),
)

# Yukti explains validation issues (Module 3 — LP Validator, Master AI
# Yukti sprint). Gated by the SAME LP_AI_REVIEW_PROVIDER/OPENAI_API_KEY
# switch as AI Review & Fix (see yukti_explain/provider.py) — one
# AI-availability toggle for the whole LP Validator. Independent rate
# limit/timeout/token settings, since an explanation call is smaller and
# faster than a fix-generation call.
LP_YUKTI_EXPLAIN_MODEL = os.environ.get('LP_YUKTI_EXPLAIN_MODEL', 'gpt-4o-mini')
LP_YUKTI_EXPLAIN_TIMEOUT_SECONDS = float(os.environ.get('LP_YUKTI_EXPLAIN_TIMEOUT_SECONDS', '20'))
LP_YUKTI_EXPLAIN_MAX_OUTPUT_TOKENS = int(os.environ.get('LP_YUKTI_EXPLAIN_MAX_OUTPUT_TOKENS', '1200'))
LP_YUKTI_EXPLAIN_MAX_REQUESTS_PER_WINDOW = int(os.environ.get('LP_YUKTI_EXPLAIN_MAX_REQUESTS_PER_WINDOW', '20'))
LP_YUKTI_EXPLAIN_WINDOW_SECONDS = int(os.environ.get('LP_YUKTI_EXPLAIN_WINDOW_SECONDS', '300'))

# AI Engineer full-source analysis (Module 3 — LP Validator, AI Engineer
# sprint). Deliberately its OWN provider toggle — NOT a reuse of
# LP_AI_REVIEW_PROVIDER like AI Review & Fix/Yukti explain share — because,
# unlike those two (separate, opt-in endpoints), this runs AUTOMATICALLY
# inside ValidateView on every AI Validate Code call, the single hottest
# endpoint in the whole app. Sharing the toggle would mean any test (or
# environment) that enables AI Review & Fix for its own purposes also
# silently makes every /validate/ call attempt a real, slow AI Engineer
# network round-trip — exactly what a live-verification run of this sprint
# caught. Uses the same OPENAI_API_KEY value as the other two features.
LP_AI_ENGINEER_PROVIDER = os.environ.get('LP_AI_ENGINEER_PROVIDER', '')
LP_AI_ENGINEER_MODEL = os.environ.get('LP_AI_ENGINEER_MODEL', 'gpt-4o-mini')
LP_AI_ENGINEER_TIMEOUT_SECONDS = float(os.environ.get('LP_AI_ENGINEER_TIMEOUT_SECONDS', '25'))
LP_AI_ENGINEER_MAX_OUTPUT_TOKENS = int(os.environ.get('LP_AI_ENGINEER_MAX_OUTPUT_TOKENS', '2000'))
LP_AI_ENGINEER_MAX_REQUESTS_PER_WINDOW = int(os.environ.get('LP_AI_ENGINEER_MAX_REQUESTS_PER_WINDOW', '10'))
LP_AI_ENGINEER_WINDOW_SECONDS = int(os.environ.get('LP_AI_ENGINEER_WINDOW_SECONDS', '300'))
# Per-language source cap — a source longer than this is not sent to the AI
# Engineer at all for that language (coverage reports 'skipped-too-large');
# deterministic engines still run and still cover it fully.
LP_AI_ENGINEER_MAX_SOURCE_CHARS = int(os.environ.get('LP_AI_ENGINEER_MAX_SOURCE_CHARS', '60000'))
# Structural-chunk target size and the hard per-language chunk cap — a
# language needing more chunks than this has its remainder marked
# 'partial' in analysis_coverage rather than silently scanning only the
# first N chunks and calling it complete.
LP_AI_ENGINEER_MAX_CHUNK_CHARS = int(os.environ.get('LP_AI_ENGINEER_MAX_CHUNK_CHARS', '6000'))
LP_AI_ENGINEER_MAX_CHUNKS_PER_LANGUAGE = int(os.environ.get('LP_AI_ENGINEER_MAX_CHUNKS_PER_LANGUAGE', '4'))
# Hard ceiling on total OpenAI calls for ONE validate request (every
# language's chunks plus the optional Complete-LP cross-language pass) —
# the real backstop against a pathological multi-language, multi-chunk
# request generating an unbounded number of provider calls.
LP_AI_ENGINEER_MAX_REQUESTS_PER_VALIDATION = int(os.environ.get('LP_AI_ENGINEER_MAX_REQUESTS_PER_VALIDATION', '8'))
# Cached per (language, source hash, validation_scope, css_source_type,
# profile, model) — see ai_engineer/__init__.py::_cached_language_result.
# Reused whenever the same source is re-validated unchanged, so clicking
# "AI Validate Code" again after only editing one tab never re-calls the
# provider for the other, unchanged tabs.
LP_AI_ENGINEER_CACHE_TTL_SECONDS = int(os.environ.get('LP_AI_ENGINEER_CACHE_TTL_SECONDS', '3600'))

# Controlled Self-Learning AI Engineer sprint (Module 3) — landingpages/
# knowledge/. Defaults OFF: online research is a genuine outbound network
# call to a third-party domain, and this project's default posture (like
# every other AI feature here) is "no network call unless explicitly
# configured." The Rule Knowledge Registry (validation/rules/) already
# covers the common case with zero network dependency; this only ever
# supplements it for a rule the registry has nothing for.
LP_KNOWLEDGE_ONLINE_RESEARCH_ENABLED = os.environ.get('LP_KNOWLEDGE_ONLINE_RESEARCH_ENABLED', '') == 'true'
LP_KNOWLEDGE_FETCH_TIMEOUT_SECONDS = float(os.environ.get('LP_KNOWLEDGE_FETCH_TIMEOUT_SECONDS', '5'))
LP_KNOWLEDGE_MAX_RESPONSE_BYTES = int(os.environ.get('LP_KNOWLEDGE_MAX_RESPONSE_BYTES', str(2 * 1024 * 1024)))
LP_KNOWLEDGE_MAX_EXCERPT_CHARS = int(os.environ.get('LP_KNOWLEDGE_MAX_EXCERPT_CHARS', '2000'))
# A cached/verified record older than this is treated as stale — a fresh
# research attempt is allowed again rather than trusting a possibly
# outdated excerpt indefinitely (spec section 10 — "version-aware/
# freshness-aware knowledge").
LP_KNOWLEDGE_FRESHNESS_DAYS = int(os.environ.get('LP_KNOWLEDGE_FRESHNESS_DAYS', '30'))
# Per (language, rule_id) research-attempt rate limit window — prevents a
# run with many distinct uncatalogued rule_ids from firing a burst of
# outbound requests at the same source in a short span.
LP_KNOWLEDGE_RATE_LIMIT_WINDOW_SECONDS = int(os.environ.get('LP_KNOWLEDGE_RATE_LIMIT_WINDOW_SECONDS', '600'))

# Low-Latency AI Engineer Performance Optimization sprint — caches every
# validator/compiler subprocess call's result by a hash of its own
# arguments (see validation/bridge_cache.py). Each of those functions is
# a pure function of its arguments (verified per-function — none reads
# `project`/a timestamp/anything else that would make caching unsound),
# so this is safe to enable by default, unlike the online-knowledge
# fetch (a real network call, defaults OFF). TTL is short — long enough
# to cover "the same source re-validated unchanged within one repair
# operation" and "an identical repeated fixture shortly after," short
# enough that a validator/compiler upgrade in a redeployed environment
# is never stuck serving a stale cached result for long.
LP_VALIDATOR_CACHE_ENABLED = os.environ.get('LP_VALIDATOR_CACHE_ENABLED', 'true') == 'true'
LP_VALIDATOR_CACHE_TTL_SECONDS = int(os.environ.get('LP_VALIDATOR_CACHE_TTL_SECONDS', '900'))
# spec section 36/37 — "AI Fix Issues" clicked twice in a row against
# UNCHANGED source returns the first click's result immediately, no new
# AI request/rate-limit slot spent. Short on purpose: this only ever
# protects against an accidental double-click/immediate re-check, never
# a deliberate later retry (see fixes/iterative.py::run_autonomous_repair).
LP_AI_FIX_NOOP_CACHE_TTL_SECONDS = int(os.environ.get('LP_AI_FIX_NOOP_CACHE_TTL_SECONDS', '120'))

# Validator Worker + Subprocess Latency sprint — a small pool of
# long-lived Node worker processes that keep ESLint/Stylelint/PostCSS/
# Dart-Sass/Less loaded in memory across requests (profiled at ~85-95%
# of total wall-clock being module-load, not actual validation work —
# see validators_node/worker_server.mjs's docstring and this sprint's
# final report). Always falls back safely to the existing one-shot
# subprocess path (node_bridge.py) on any worker failure, so disabling
# this can never make validation itself unavailable — only slower.
LP_VALIDATOR_WORKER_ENABLED = os.environ.get('LP_VALIDATOR_WORKER_ENABLED', 'true') == 'true'
# Small on purpose (spec section 6) — each worker handles ONE request at
# a time, strictly sequentially; concurrency comes from having a FEW
# such processes, not from letting requests race inside one. 2 covers
# Complete LP's common case (CSS and JS validating at once, on separate
# Python threads since the prior Low-Latency sprint) without the memory
# cost of a large pool sitting mostly idle.
LP_VALIDATOR_WORKER_POOL_SIZE = int(os.environ.get('LP_VALIDATOR_WORKER_POOL_SIZE', '2'))
LP_VALIDATOR_WORKER_STARTUP_TIMEOUT_SECONDS = float(os.environ.get('LP_VALIDATOR_WORKER_STARTUP_TIMEOUT_SECONDS', '15'))
LP_VALIDATOR_WORKER_REQUEST_TIMEOUT_SECONDS = float(os.environ.get('LP_VALIDATOR_WORKER_REQUEST_TIMEOUT_SECONDS', '10'))

# Secure Preview (Module 3 — LP Validator). A snapshot is a full assembled
# HTML document stored directly in the database (models.
# LandingPagePreviewSnapshot) — small, ephemeral, TTL-bound, never a
# durable project asset. Size limits bound the assembled document itself
# (after HTML+CSS+JS are combined), independent of any per-field limit the
# validator already enforces on the editor tabs individually.
LP_PREVIEW_TTL_SECONDS = int(os.environ.get('LP_PREVIEW_TTL_SECONDS', str(30 * 60)))
LP_PREVIEW_MAX_HTML_BYTES = int(os.environ.get('LP_PREVIEW_MAX_HTML_BYTES', str(500_000)))
LP_PREVIEW_MAX_CSS_BYTES = int(os.environ.get('LP_PREVIEW_MAX_CSS_BYTES', str(500_000)))
LP_PREVIEW_MAX_JS_BYTES = int(os.environ.get('LP_PREVIEW_MAX_JS_BYTES', str(500_000)))
LP_PREVIEW_MAX_DOCUMENT_BYTES = int(os.environ.get('LP_PREVIEW_MAX_DOCUMENT_BYTES', str(2_000_000)))
LP_PREVIEW_MAX_REQUESTS_PER_WINDOW = int(os.environ.get('LP_PREVIEW_MAX_REQUESTS_PER_WINDOW', '20'))
LP_PREVIEW_WINDOW_SECONDS = int(os.environ.get('LP_PREVIEW_WINDOW_SECONDS', '300'))

# Cross-browser Check (Module 3 — Secure Preview). Renders the current
# preview snapshot through a REAL Chromium/Firefox/WebKit engine, in an
# isolated subprocess (see landingpages/cross_browser/runner.py) — never
# inside this Django worker, never with application cookies/auth state.
# The outer subprocess.run() timeout (LP_CROSS_BROWSER_TIMEOUT_SECONDS) is
# the hard wall-clock cap; LP_CROSS_BROWSER_NAV_TIMEOUT_SECONDS is the
# inner Playwright per-navigation timeout, always kept below it.
LP_CROSS_BROWSER_TIMEOUT_SECONDS = float(os.environ.get('LP_CROSS_BROWSER_TIMEOUT_SECONDS', '30'))
LP_CROSS_BROWSER_NAV_TIMEOUT_SECONDS = float(os.environ.get('LP_CROSS_BROWSER_NAV_TIMEOUT_SECONDS', '15'))
LP_CROSS_BROWSER_MAX_OUTPUT_BYTES = int(os.environ.get('LP_CROSS_BROWSER_MAX_OUTPUT_BYTES', str(8_000_000)))
LP_CROSS_BROWSER_MAX_REQUESTS_PER_WINDOW = int(os.environ.get('LP_CROSS_BROWSER_MAX_REQUESTS_PER_WINDOW', '10'))
LP_CROSS_BROWSER_WINDOW_SECONDS = int(os.environ.get('LP_CROSS_BROWSER_WINDOW_SECONDS', '300'))
