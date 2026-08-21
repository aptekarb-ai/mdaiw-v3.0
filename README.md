# MarketOne Digital AI Workspace (MDAIW)

Module-1: Application Landing Page, Employee Registration, Password Login,
Face Recognition Login, Dashboard Shell, Yukti Text and Voice Assistant.

Full functional and architecture specification:
[`MDAIW_Module_1_Claude_Codex_Master_Prompt.md`](MDAIW_Module_1_Claude_Codex_Master_Prompt.md).

Live implementation status and decision log:
[`docs/module-1/IMPLEMENTATION_STATUS.md`](docs/module-1/IMPLEMENTATION_STATUS.md).

## Structure

- `frontend/` — React 19 + TypeScript + Vite SPA. See `frontend/README.md`.
- `backend/` — Django 6 + DRF API. See `backend/README.md`.

## Quick start (Windows 10 PowerShell)

```powershell
# Backend — note: this installs the full DeepFace/TensorFlow stack
# (Checkpoint 5), roughly 1-1.5 GB of packages; the first install takes
# several minutes depending on connection speed.
cd backend
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe manage.py migrate
.\.venv\Scripts\python.exe manage.py runserver

# Frontend (separate terminal)
cd frontend
npm install
.\scripts\setup-face-landmarker.ps1   # one-time: MediaPipe model + WASM runtime
npm run dev
```

Copy `.env.example` to `.env` at the repository root (and
`frontend/.env.example` to `frontend/.env`) before running either side; never
commit a real `.env` file. For Face Recognition, generate and set
`FACE_EMBEDDING_ENCRYPTION_KEYS` in the root `.env` — see `backend/README.md`.

## Manual Face Recognition verification (Checkpoint 5)

Automated tests mock DeepFace entirely (see `backend/README.md` and
`frontend/README.md` for why). A full end-to-end pass with a **real webcam
and a real face** was not performed by the assistant in this session — that
environment has no camera or browser to exercise. What follows are the exact
steps to do it yourself; each is what the automated flow does, just with a
real camera behind it.

1. Generate an encryption key and put it in the root `.env`:
   ```powershell
   backend\.venv\Scripts\python.exe -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
   ```
   Set `FACE_EMBEDDING_ENCRYPTION_KEYS=<the key>` in `.env`.
2. `.env` is already configured for SQLite; no PostgreSQL setup is needed.
3. Warm the DeepFace model (optional — it downloads automatically on first
   real use otherwise): see `backend/README.md` for a one-line shell warm-up
   command. Expect the RetinaFace detector weights (~119 MB) to download on
   first use.
4. Run `.\frontend\scripts\setup-face-landmarker.ps1` if not already done.
5. Start Django: `backend\.venv\Scripts\python.exe manage.py runserver`.
6. Start Vite: `cd frontend; npm run dev`.
7. Register a new employee at `/register` through to the success screen.
8. Click "Continue to Face Enrollment", grant the consent checkbox, click
   "Open Camera", grant the browser's camera permission, and follow the
   on-screen liveness prompts (look center / turn left / turn right) with a
   real face in frame.
9. Confirm: the new `User.is_active` becomes `True`, the `EmployeeProfile`'s
   `registration_status` becomes `ACTIVE`, a `FaceCredential` row exists for
   that user (check via `manage.py shell` or Django Admin — the embedding
   itself will not be visible either way), and no raw frame file exists
   anywhere on disk (nothing is ever written to `media/` for face frames).
10. Log out.
11. Go to `/login`, click "Sign in with Face Recognition", enter the same
    username, and verify with the same face.
12. Refresh the page and confirm the Django session persists
    (`/api/v1/auth/me/` still reports authenticated).
13. Try again with a different person's face (or someone else in the room) —
    expect the generic "Face sign-in could not be completed" message, never a
    specific reason.
14. Where practical, try holding up a photo or a phone/laptop screen showing
    a face instead of a live person, to exercise the anti-spoofing path.
15. Trigger the failure limit: attempt verification unsuccessfully 5 times
    within 15 minutes and confirm the 6th attempt is rejected the same
    generic way (internally logged as locked; never disclosed).
16. Confirm password login still works for that same account throughout,
    including during the lockout window from step 15.
17. Confirm the browser's camera indicator turns off after every one of the
    above flows (success, failure, cancel, and simply navigating away).

Report model download time and first-inference time honestly when you run
this — see `backend/README.md`'s "Known issue and fix" section for the
timings observed during this checkpoint's own real (script-level, no camera)
verification, and the one real upstream bug found and fixed along the way.
