# MDAIW Backend

Django 6.0.7 + Django REST Framework backend for Module-1 of the MarketOne
Digital AI Workspace. Session-based authentication (no JWT), SQLite for local
development, PostgreSQL prepared but inactive.

## Apps

- `accounts` — Django `User` account creation, registration orchestration,
  username/email/password validation, login/session/logout endpoints.
- `employees` — `EmployeeProfile` model, employee-related fields, profile-photo
  metadata, future employee-management functionality.
- `faceauth` — Face Recognition and Face Enrollment (Checkpoint 5; empty in
  Checkpoint 4).

## Setup (Windows 10 PowerShell)

```powershell
cd backend
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe manage.py migrate
.\.venv\Scripts\python.exe manage.py createsuperuser
.\.venv\Scripts\python.exe manage.py runserver
```

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

## Checkpoint status

- Checkpoint 0–3: Complete (see `docs/module-1/IMPLEMENTATION_STATUS.md`).
- Checkpoint 4 (Employee Registration Wizard and `EmployeeProfile`): Complete.
- Checkpoint 5 (Face Recognition enrollment and login): Not started.
