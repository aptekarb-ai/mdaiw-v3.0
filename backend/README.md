# MDAIW Backend

Django 6.0.7 + Django REST Framework backend for Module-1 of the MarketOne
Digital AI Workspace. Session-based authentication (no JWT), SQLite for local
development, PostgreSQL prepared but inactive.

## Apps

- `accounts` — Django `User` account creation, registration orchestration,
  username/email/password validation, login/session/logout endpoints.
- `employees` — `EmployeeProfile` model, employee-related fields, profile-photo
  metadata, future employee-management functionality.
- `faceauth` — Face Recognition and Face Enrollment: `FaceCredential`,
  `FaceChallenge`, `FaceLoginAttempt` models; `service.py` (DeepFace pipeline,
  every call isolated behind mockable wrappers); `encryption.py` (Fernet
  embedding encryption with key rotation); `tokens.py` (enrollment
  authorization tokens); `lockout.py`; `throttling.py`.

## Setup (Windows 10 PowerShell)

```powershell
cd backend
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe manage.py migrate
.\.venv\Scripts\python.exe manage.py createsuperuser
.\.venv\Scripts\python.exe manage.py runserver
```

## Warming the Face Recognition model (optional)

DeepFace downloads model weights to `backend/.face-models/` (git-ignored) on
first real use. To pre-download rather than let the first real enrollment
attempt pay this cost:

```powershell
.\.venv\Scripts\python.exe -c "from deepface import DeepFace; import numpy as np; DeepFace.extract_faces(img_path=np.zeros((100,100,3), dtype='uint8'), detector_backend='retinaface', enforce_detection=False)"
```

Observed during this checkpoint (script-level, no camera — see root
`README.md`'s manual verification section): first real detection call ~45s
(RetinaFace weights, ~119 MB, downloaded fresh), ~31s on a second fresh
process with weights already cached (dominated by the TensorFlow/DeepFace
Python import chain, not the network). This cost is paid once per server
process — the module stays imported and cached for the life of that process,
not per-request.

## Validation commands

```powershell
.\.venv\Scripts\python.exe manage.py check
.\.venv\Scripts\python.exe manage.py makemigrations --check --dry-run
.\.venv\Scripts\python.exe manage.py migrate
.\.venv\Scripts\python.exe manage.py test
```

## Authentication endpoints

```http
GET  /api/v1/auth/csrf/
POST /api/v1/auth/login/
POST /api/v1/auth/logout/
GET  /api/v1/auth/me/
POST /api/v1/auth/register/
```

## Face Recognition endpoints (Checkpoint 5)

```http
POST   /api/v1/auth/face/challenge/
POST   /api/v1/auth/face/enroll/
POST   /api/v1/auth/face/verify/
GET    /api/v1/auth/face/status/
DELETE /api/v1/auth/face/enrollment/
POST   /api/v1/auth/face/enrollment/resume/
```

All are plain Django views (same CSRF rationale as the auth endpoints above).
`face/status/` and `face/enrollment/` (`DELETE`) require an authenticated
session; the rest are reachable by pending/anonymous users by design (that's
the whole point of enrollment and face login).

### Enrollment flow

1. Registration (`accounts/views.py::register_view`) issues a short-lived,
   signed **enrollment authorization token** (`faceauth/tokens.py`,
   `django.core.signing`, `FACE_ENROLLMENT_TOKEN_TTL_SECONDS` default 900s) in
   the registration success response. This is not a Django session — the
   frontend holds it only in React memory (router state), never Local/Session
   Storage. Its cryptographic validity window is independent of, and
   additionally gated by, the account's `registration_status`: once
   enrollment succeeds and the account becomes `ACTIVE`, the same token is
   rejected even if its signature/expiry would otherwise still pass, because
   `verify_enrollment_token` re-checks `is_active`/`registration_status`
   every time.
2. `POST /face/challenge/` with `{"purpose": "ENROLL", "enrollment_token": "..."}`
   returns an opaque one-time token (only its SHA-256 hash is stored,
   `faceauth/hashing.py`) plus a **randomized** 3-action subset of
   `LOOK_CENTER` / `TURN_LEFT` / `TURN_RIGHT` / `BLINK`, expiring in
   `FACE_CHALLENGE_TTL_SECONDS` (default 120s).
3. `POST /face/enroll/` (multipart: `enrollment_token`, `challenge_token`,
   `consent`, 2–4 `frames`) re-validates everything server-side regardless of
   what the browser already checked: token validity, challenge validity/
   single-use/expiry, consent, frame count, then runs the full
   `faceauth/service.py` pipeline (decode → single-face → anti-spoofing →
   embedding → cross-frame consistency → encrypt). `FaceCredential` creation,
   `User.is_active = True`, and `EmployeeProfile.registration_status = ACTIVE`
   all happen inside one `transaction.atomic()` block — any failure anywhere
   rolls back the whole thing, so there is never a `FaceCredential` without an
   active user or vice versa. On success, a Django session is created
   immediately (the user just completed a real biometric ceremony).

### Verification (login) flow

`POST /face/challenge/` with `{"purpose": "LOGIN", "username": "..."}` issues
a challenge **whether or not the username resolves to a real, enrolled,
active account** — this is what prevents username enumeration through this
endpoint. `POST /face/verify/` (multipart: `username`, `challenge_token`,
2–4 `frames`) always returns the identical generic
`{"success": false, "code": "FACE_AUTHENTICATION_FAILED", "message": "Face sign-in could not be completed. Use your password or try again."}`
for every failure cause (unknown user, inactive account, no credential,
revoked credential, spoofed frame, non-matching face, expired/invalid
challenge, lockout) — the *true* cause is recorded internally on
`FaceLoginAttempt.reason_code` for audit purposes only, never in the response.
Distance/threshold values are stored on that row for internal debugging but
never returned to the client. Lockout: 5 failures within 15 minutes (both
configurable) locks Face Recognition login for 30 minutes
(`faceauth/lockout.py`) — password login is completely unaffected, and a
successful verification resets the counter (only failures *after* the most
recent success count toward the threshold).

### Enrollment resume

If a pending user loses their in-memory enrollment token (e.g. closed the
tab), `POST /face/enrollment/resume/` with `{"username", "password"}"`
verifies the password directly (`user.check_password()` — **not**
`authenticate()`, since `authenticate()` refuses inactive users outright) and
issues a fresh enrollment token, without creating a session. Throttled
(5 attempts / 15 minutes per IP+username) and always returns the same
generic `ENROLLMENT_RESUME_FAILED` failure regardless of whether the username
exists, the account is already active, or the password was wrong.

## EmployeeProfile model (Checkpoint 4)

One-to-one with Django `User`. Fields: `employee_id` (unique, letters/numbers/
hyphens), `designation`, `department`, `location`, `manager_name`,
`date_of_joining`, `phone`, `date_of_birth`, `profile_photo` (optional),
`registration_status` (`PENDING_FACE_ENROLLMENT` / `ACTIVE` / `REJECTED` /
`SUSPENDED`), `created_at`, `updated_at`. Work email, first name, last name,
and username live on the Django `User` record, not on `EmployeeProfile`.

## Registration endpoint

`POST /api/v1/auth/register/`, `multipart/form-data`. Required fields:
`username`, `password`, `confirm_password`, `work_email`, `employee_id`,
`first_name`, `last_name`, `designation`, `department`, `location`,
`manager_name`, `date_of_joining`, `phone`, `date_of_birth`. Optional:
`profile_photo`.

`User` and `EmployeeProfile` are created together inside
`transaction.atomic()` — if either fails, neither record persists. The new
`User` is created with `is_active=False` and the profile's
`registration_status` defaults to `PENDING_FACE_ENROLLMENT`. **No session is
created and the user is not logged in.** This is intentional: Face Enrollment
(Checkpoint 5) is a mandatory part of activating an account, and Checkpoint 4
only saves the registration data — it does not (and must not) fake or skip
that step. An inactive account attempting password login receives the same
generic `Invalid username or password.` response as any other failed login,
so the login endpoint never reveals that an account exists but is pending.

Validation failures return `400` with a `VALIDATION_ERROR` body shaped as
`{"success": false, "code": "VALIDATION_ERROR", "message": "...", "errors": {"field": ["message"]}}`.
Passwords are never included in any registration response.

## Profile photo rules

- Accepted formats: JPEG, PNG, WebP — detected from the decoded image data via
  Pillow (`employees/validators.py`), not from the filename extension or the
  client-supplied `Content-Type` header.
- Maximum size: 5 MB (`settings.PROFILE_PHOTO_MAX_BYTES`).
- Stored under `media/profile_photos/<uuid>.<ext>` — the original filename is
  discarded so it can never collide or leak information.
- API responses never include a filesystem path, only the fields listed in
  the registration success example above.
- If `EmployeeProfile` creation fails after a photo was already written to
  storage (e.g. a database integrity error), the orphaned file is deleted.

## Biometric encryption

`faceauth/encryption.py` uses `cryptography.fernet.MultiFernet` over
`FACE_EMBEDDING_ENCRYPTION_KEYS` (comma-separated). The first key encrypts new
embeddings; every listed key may decrypt existing ones, which is what enables
rotation: prepend a new key, keep old ones until every credential has been
re-enrolled, then drop them. The embedding vector is serialized as **JSON**
(never pickle) with model/metric/detector metadata before encryption. If no
key is configured, every enroll/verify attempt fails safely with a generic
error — there is no silent fallback to storing plaintext. Generate a key with:

```powershell
backend\.venv\Scripts\python.exe -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

`FaceCredential.encrypted_embedding` is excluded from Django Admin's
`list_display`, `readonly_fields`, and explicitly from the form (`exclude`)
so it can never render anywhere in Admin. It is never included in any API
response, and the raw floating-point vector never touches the database in
unencrypted form.

## Dependency versions (Checkpoint 5 additions)

Resolved and pinned in `requirements.txt` (Python 3.12.2):

```text
deepface==0.0.100
retina-face==0.0.18
tensorflow==2.21.0
tf-keras==2.21.0
cryptography==50.0.0
numpy==2.5.1
opencv-python==5.0.0.93
```

`deepface==0.0.100` hard-depends on `opencv-python` (the GUI build) directly
in its own metadata — there is no way to substitute
`opencv-python-headless` without patching deepface's package metadata, so
`opencv-python` is the real, unavoidable resolution here despite the
preference for headless.

## Known issue and fix: retina-face vs. Keras 3

**Discovered during this checkpoint's real (non-mocked) verification, not
theoretical:** `retina-face==0.0.18`'s model-construction code
(`retinaface_model.py`) calls raw `tf.shape()` on a `KerasTensor` while
building the detector. TensorFlow 2.21's default backend is Keras 3, which
rejects this with `ValueError: A KerasTensor cannot be used as input to a
TensorFlow function.` — a hard crash during the very first real face-detection
call, not something `enforce_detection` or any of our own code controls.

**Fix:** `backend/mdaiw/settings.py` sets
`os.environ.setdefault('TF_USE_LEGACY_KERAS', '1')` at settings-load time
(before TensorFlow can be imported by anything else in the process). This
routes `tf.keras` through the installed `tf-keras` package (a Keras-2-API
compatible implementation) instead of Keras 3, which resolves the
incompatibility. Verified: the identical face-detection call that crashed
without this flag correctly returns a clean `NO_FACE` result with it set —
reproduced twice, with and without the fix, on the same input.

This is an upstream `retina-face`/TensorFlow compatibility gap, not a defect
in this project's code — our own service layer already never lets a raw
TensorFlow/DeepFace exception reach an API response either way (everything
funnels through `FaceServiceError` with a stable, safe internal code); this
fix is about making detection *work*, not just fail safely.

## Checkpoint status

- Checkpoint 0–4: Complete (see `docs/module-1/IMPLEMENTATION_STATUS.md`).
- Checkpoint 5 (Face Recognition enrollment and login): Complete.
- Checkpoint 6 (Yukti text and voice assistant): Not started.
