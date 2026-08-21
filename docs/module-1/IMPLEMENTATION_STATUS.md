# MDAIW Module-1 Implementation Status

## 1. Project name
MarketOne Digital AI Workspace (MDAIW)

## 2. Module name
Module-1 — Application Landing Page, Employee Registration, Password Login, Face Recognition Login, Dashboard Shell, Yukti Text and Voice Assistant

## 3. Current date
2026-08-01 (last updated after Checkpoint 5 real webcam verification)

## 4. Current Git branch
feature/module-1

## 5. Specification files confirmed as read
- `CLAUDE.md`
- `MDAIW_Module_1_Claude_Codex_Master_Prompt.md` (full, all 44 sections)
- `MDAIW_Module1_HTML_Assets/CLAUDE_CODEX_ASSET_INTEGRATION.md`
- `MDAIW_Module1_HTML_Assets/README.md`

## 6. Repository audit summary
Repo contains specification documents and design-asset pack only. One commit (`fe0ce87 chore: add Module-1 specifications and frontend assets`). Working tree clean at time of audit. No application code, no scaffolding, no dependencies installed.

## 7. Current frontend status
Foundation complete. Vite + React 19 + TypeScript scaffold at `frontend/`, with `react-router-dom` wired. Design tokens (`src/styles/tokens.css`) implement the approved palette and extended tokens from spec section 5A.3. Layout shells (`PublicLayout`, `AppLayout`) and navigation components (`PublicSidebar`, `AppSidebar`, `AppHeader`, `Footer`) match the documented frame measurements, with responsive rules below 1024px. MDAIW asset pack copied to `frontend/public/assets/mdaiw/` and wired (favicon, icon CSS, wordmark, illustrations). All required routes from spec section 8 are stubbed with placeholder pages (real functionality lands in Checkpoints 3–7). A dev-only `/dev/assets` route (`AssetPreviewPage`) renders all 60 icons and 8 illustrations to visually confirm every asset path resolves, per the asset-integration doc's item 10. Vitest + React Testing Library configured; 3 tests passing. Lint (`oxlint`), type-check (`tsc -b`), tests (`vitest run`), and production build all pass clean.

## 8. Current backend status
Foundation complete. Django 6.0.7 + Django REST Framework project at `backend/`, running under a dedicated Python 3.12.2 virtual environment (`backend/.venv`) chosen over the machine's default Python 3.14.6 for Face Recognition library compatibility. Project package `mdaiw` plus two apps scaffolded: `accounts` (auth/employee concerns) and `faceauth` (Face Recognition concerns) — no models yet, that is Checkpoint 3+. `django-cors-headers` configured for the Vite dev origin. A minimal `GET /api/v1/health/` endpoint exists for smoke testing — verified live via `manage.py runserver` and `curl` (200, `{"status": "ok"}`). `requirements.txt` frozen. No real `.env` file is present; settings load from `.env.example`-documented defaults only (SQLite fallback baked into `settings.py`).

## 9. Current database status
SQLite is the active local development database per approved Checkpoint 2 scope, configured via `DATABASE_URL=sqlite:///db.sqlite3` (parsed with `dj-database-url` in `backend/mdaiw/settings.py`). PostgreSQL support is prepared but not activated: `psycopg[binary]` is installed and `.env.example` documents a commented-out future value (`DATABASE_URL=postgresql://mdaiw_user:change_me@localhost:5432/mdaiw`). No Docker database is used. Note: this machine also has a separate, unrelated native PostgreSQL 18 Windows service already running on port 5432 (`postgresql-x64-18`) — it was not modified, configured, or used, and must not be assumed available for this project without explicit confirmation.

## 10. Current authentication status
Checkpoint 3 complete. Username/password login with Django server-side sessions is fully implemented. Backend: `GET /api/v1/auth/csrf/`, `POST /api/v1/auth/login/`, `GET /api/v1/auth/me/`, `POST /api/v1/auth/logout/` implemented as plain Django views (not DRF `APIView`s — see decision log) using `authenticate()`/`login()`/`logout()`, enforcing real Django CSRF middleware on both POST endpoints, returning a single generic `INVALID_CREDENTIALS` message for unknown username, wrong password, and inactive accounts alike. Frontend: typed API client (`src/api/client.ts`), `AuthContext`/`AuthProvider`/`useAuth`, `ProtectedRoute`/`PublicOnlyRoute` guarding all authenticated routes and redirecting authenticated users away from `/login`/`/register`, a fully built `LoginPage` (validation, show/hide password, remember-username, loading/error states), a working logout flow (confirmation modal in `AppSidebar` → `POST /logout/` → redirect to `/login`), and a `DashboardPage` showing the real signed-in user. Registration submission, `EmployeeProfile`, Face Recognition, Yukti, SSO/OTP/MFA, and JWT were explicitly out of scope and not touched.

## 11. Current testing status
Backend: 16 tests passing in `backend/accounts/tests.py` (1 health-check + 15 auth: CSRF cookie, successful login, unknown username, invalid password, missing username, missing password, inactive user, session-created-after-login, authenticated/unauthenticated `/me/`, logout success, session invalidated after logout, logout-safe-without-session, CSRF enforced on login, CSRF enforced on logout). Frontend: Vitest + React Testing Library, 28 tests across 8 files passing — API client (5), AuthContext (4: loading/authenticated/error/logout), ProtectedRoute (3), PublicOnlyRoute (2), LoginPage (10: rendering, both required-field validations, show/hide-password value preservation, remembered-username prefill/removal, success navigation, server-error display, duplicate-submission prevention, password-never-in-localStorage), AppSidebar logout flow (1), plus the 3 pre-existing App/AssetPreview tests. Full spec-section-40 suites (registration, Face Recognition, Yukti, accessibility/security sweep) remain scheduled for later checkpoints/Checkpoint 8.

## 12. Available design assets
`MDAIW_Module1_HTML_Assets/`:
- 60 SVG interface icons (`icons/svg/`) + PNG exports at 16/20/24/32/48/64px + sprite sheet
- 7 SVG illustrations (`images/`) + PNG equivalents (hero, Yukti, profile placeholder, face-scan frame, success, voice-wave, wordmark, favicon)
- `css/mdaiw-icons.css` mask-icon helper classes
- `demo/index.html` preview page
- `manifest.json` feature-to-asset mapping
- Official MarketOne logo NOT included — placeholder wordmark only, per README note
- Copied into `frontend/public/assets/mdaiw/` and verified via the dev-only `/dev/assets` preview route plus 1 automated test asserting all 60 icons and 8 illustrations render

## 13. Requirements already satisfied
- Design tokens, colour palette, typography implemented as CSS custom properties and wired into the frontend
- Icon/illustration asset pack copied into `frontend/public/assets/mdaiw/` and referenced by layout/nav components
- Vite + React + TypeScript foundation scaffolded, building and linting clean
- Django + DRF foundation scaffolded, passing system checks, migrating clean on SQLite
- All client-side routes from spec section 8 exist with no full-page refresh between them
- `.env.example` (root + frontend) created; no real `.env` committed anywhere
- `docs/module-1/IMPLEMENTATION_STATUS.md` tracking established
- Username/password login with Django session authentication, CSRF-protected, session-persisted-on-refresh, generic invalid-credentials messaging, protected/public-only route guarding, remember-my-username (username only), working logout with confirmation modal — all verified by automated tests and live manual verification (Checkpoint 3)

## 14. Missing requirements
Remaining functional requirements in Master Prompt sections 2–43: Yukti text/voice assistant (Checkpoint 6), dashboard/profile/settings real functionality beyond the Checkpoint 3 identity summary and Face status/removal wiring (Checkpoint 7), full test suites, accessibility and security verification (Checkpoint 8). Face Recognition enrollment/login and anti-spoofing (Checkpoint 5) are now complete, including user-performed real webcam verification — see the Checkpoint 5 section below.

## 15. Security boundaries
Carried forward from `CLAUDE.md`, in force for all future checkpoints:
- Never collect a password through speech recognition.
- Never speak, log, or store a plain-text password.
- Never log biometric embeddings or live camera frames.
- Never store raw audio.
- Never allow Yukti to authenticate users directly.
- Never bypass anti-spoofing.
- Never hard-code secrets.
- Never commit `.env`.
- Password login must remain available.
- Face Recognition must not be replaced by a placeholder.

Checkpoint 3 additions verified in code and tests:
- No JWT; Django server-side sessions only, `SessionAuthentication`-compatible cookies (`HttpOnly` session cookie, readable-but-scoped `csrftoken` cookie).
- CSRF enforced by real Django `CsrfViewMiddleware` on `/login/` and `/logout/` (confirmed both by automated tests with `enforce_csrf_checks=True` and by live `curl` calls returning 403 without a token).
- Login/`/me/` responses never include `password` (asserted in tests via `assertNotIn('password', ...)` on the full serialized JSON).
- Username existence is never revealed — unknown username, wrong password, and inactive account all return the same `INVALID_CREDENTIALS` / "Invalid username or password." pair.
- `localStorage` holds only the remembered username under `mdaiw.rememberedUsername`; grep-confirmed no other `localStorage` call exists anywhere in `frontend/src`, so a password can never reach browser storage.

## 16. Known risks and blockers
- Default `python` resolves to 3.14.6 on this machine; DeepFace/TensorFlow compatibility with 3.14 is uncertain. Backend venv is pinned to Python 3.12.2 (`backend/.venv`, created via `py -3.12`).
- This machine has a separate, pre-existing native PostgreSQL 18 Windows service running on port 5432 (`postgresql-x64-18`), discovered while testing DB connectivity during this checkpoint. It is unrelated to this project, was not modified, and must not be assumed available without explicit user confirmation — Module-1 does not depend on it while SQLite is active.
- HTTPS/camera/microphone permission behavior must be verified once real Face Recognition/Yukti UI exists (localhost is permitted for `getUserMedia`, non-localhost deployment requires HTTPS).
- A stray global FastAPI install exists under the Python 3.12 site-packages (unrelated to this repository); not a project dependency.
- The Chrome browser extension was not connected during Checkpoint 3, so interactive browser-based manual verification (actual clicking through the running app) could not be performed. Manual verification was instead done by running the real `manage.py runserver` and driving the exact HTTP flow the frontend uses via `curl` (CSRF cookie, invalid login, valid login, session persistence, CSRF-enforced logout, session invalidation) plus the full automated frontend test suite for UI-only behavior (route redirects, remember-username, password-never-in-localStorage). This should be redone with an actual browser click-through once the extension is available, per CLAUDE.md's UI-testing requirement.
- ~~`react-router`/`react-router-dom` cannot currently reach zero `npm audit --omit=dev` findings...~~ **Corrected and resolved** — see "React Router v8 migration" below. A prior pass in this session checked the npm registry and found the highest published version to be `7.18.2`, with no `8.x` line yet; `react-router@8.3.0` is confirmed published now. Migrating to it and dropping `react-router-dom` entirely clears every finding — `npm audit --omit=dev` reports **0 vulnerabilities**.

### Checkpoint 3 cleanup (post-review)

Two issues were found in Checkpoint 3 review and fixed:

1. **`oxlint` `react-refresh/only-export-components` warning** on the combined `context/AuthContext.tsx` (it exported both the `AuthProvider` component and the `useAuth` hook). Fixed by splitting into three single-purpose files instead of disabling the rule:
   - `frontend/src/context/AuthContext.ts` — exports only the raw `AuthContext` object (`createContext(...)`), no JSX.
   - `frontend/src/context/AuthProvider.tsx` — exports only the `AuthProvider` component.
   - `frontend/src/hooks/useAuth.ts` — exports only the `useAuth` hook.
   - `AuthStatus` and `AuthContextValue` moved into `frontend/src/types/auth.ts` alongside the other auth types (a types-only file has no Fast Refresh concern). Every consumer (`App.tsx`, `ProtectedRoute.tsx`, `PublicOnlyRoute.tsx`, `DashboardPage.tsx`, `LoginPage.tsx`, `AppSidebar.tsx`) and every test that mocked the old module (`ProtectedRoute.test.tsx`, `PublicOnlyRoute.test.tsx`, `LoginPage.test.tsx`, `AppSidebar.test.tsx`) were updated to import from the new locations. No `eslint-disable` comments were added.
2. **React `act(...)` warning** in `LoginPage.test.tsx`'s "prevents duplicate submission" test: it resolved a deferred login promise at the very end of the test without awaiting the resulting state flush, so `LoginPage`'s and `MemoryRouter`'s post-resolution state updates landed outside any `act()`/`waitFor()` boundary. Fixed by rewriting all interactions in the file to `@testing-library/user-event` (`userEvent.setup()`, `await user.click/type(...)`, which auto-wrap in `act`) and, in that specific test, replacing the bare `resolveLogin()` with a `resolveLogin()` followed by `expect(await screen.findByText('Dashboard content')).toBeInTheDocument()` so the promise's continuation (successful navigation) is awaited and flushed before the test ends. `@testing-library/user-event` was added as a new dev dependency. All 10 `LoginPage` test cases still cover the same behavior as before (rendering, both required-field validations, show/hide-password value preservation, remembered-username prefill/removal, success navigation, server-error display, duplicate-submission prevention, password-never-in-localStorage). `console.error` was not mocked or suppressed anywhere.

## 17. Validation commands

```powershell
# Frontend
cd frontend
npm run lint
npm run type-check
npm run test
npm run build

# Backend
cd backend
.\.venv\Scripts\python.exe manage.py check
.\.venv\Scripts\python.exe manage.py makemigrations --check --dry-run
.\.venv\Scripts\python.exe manage.py migrate
.\.venv\Scripts\python.exe manage.py test
```

All four frontend commands and all four backend commands were run and passed at the end of Checkpoint 2, again at the end of Checkpoint 3 (28 frontend tests, 16 backend tests), and once more after the post-review cleanup below — with the additional result that `npm run lint` now reports **zero warnings and zero errors** (previously 1 warning) and `npx vitest run --reporter=verbose` shows **no `act(...)` warnings in stderr** for any test (previously 2 lines of warning output from one test). `GET /api/v1/health/` and the full auth flow (`/csrf/`, `/login/`, `/me/`, `/logout/`) were additionally verified against a live `manage.py runserver` instance with `curl` — see the decision log and section 10 for the exact sequence.

### Creating a development user

Superuser (interactive prompts for username/email/password — nothing echoed to shell history):

```powershell
backend\.venv\Scripts\python.exe manage.py createsuperuser
```

Normal (non-staff) development user, via the Django shell — replace the placeholder before running, and never commit a real value:

```powershell
backend\.venv\Scripts\python.exe manage.py shell
```
```python
from django.contrib.auth import get_user_model
User = get_user_model()
User.objects.create_user(
    username="your.username",
    email="your.username@example.com",
    password="choose-your-own-password",
    first_name="Your",
    last_name="Name",
)
```

No demo credentials are committed anywhere in this repository; `.env.example` and this document intentionally contain no real password.

## 18. Decision log
- Face Recognition service architecture: Option B (Django service layer) selected as the simplest fit per Master Prompt section 3. `faceauth` app scaffolded for this purpose.
- Backend Python interpreter: 3.12.2 confirmed and used for `backend/.venv`, over the machine-default 3.14.6, for Face Recognition library compatibility.
- Database for Checkpoint 2: SQLite only, per explicit user correction. A Docker Postgres container was briefly started, found to conflict with a pre-existing native Postgres 18 service on port 5432, and was removed (container, network, and volume) rather than resolved by picking a side — user directed SQLite-only scope for this checkpoint. PostgreSQL remains prepared-but-inactive via `DATABASE_URL`.
- Icon/illustration assets copied (not symlinked) into `frontend/public/assets/mdaiw/` so the Vite build is self-contained; the original `MDAIW_Module1_HTML_Assets/` source tree is left untouched.
- No real `.env` file is kept in the working tree during Checkpoint 2, per explicit user direction. `backend/mdaiw/settings.py` reads `DATABASE_URL`/`DJANGO_SECRET_KEY`/etc. via `os.environ.get(..., default)`, so Django, migrations, and tests all run correctly from the built-in SQLite/dev-key defaults with no `.env` present; `.env.example` remains the only committed template.
- Health endpoint moved to `GET /api/v1/health/` (trailing slash added) to match Django URL convention and the exact path requested for manual verification.
- Auth endpoints (`csrf`, `login`, `logout`, `me`) implemented as plain Django views, not DRF `APIView`/`@api_view`. Reason: DRF's `APIView.as_view()` always wraps views with `csrf_exempt`, delegating CSRF enforcement to `SessionAuthentication.enforce_csrf`, which only fires once a session-authenticated user is already resolved — meaning an anonymous `POST /login/` would silently skip CSRF enforcement under a stock DRF setup. Plain Django views run under the project's real `CsrfViewMiddleware`, so CSRF is enforced unconditionally on both `/login/` and `/logout/`, matching the requirement and confirmed by tests and live `curl` (403 without a token).
- Route-guard design: `ProtectedRoute`/`PublicOnlyRoute` render `null` while `AuthContext.status === 'loading'` rather than a spinner, so protected content is never briefly shown before the session check resolves; both redirect via `<Navigate replace>` so the guard itself never adds a back-button history entry.
- `AuthContext` models three states (`loading` / `authenticated` / `unauthenticated`) rather than a fifth explicit "expired" state — an expired/invalidated session is treated identically to `unauthenticated` (same redirect, same UI), since the spec does not require different messaging for that case in Checkpoint 3.
- Manual verification substitution: the Chrome extension was not connected this session (see risks). The full backend session lifecycle was verified live via `curl` against a running `manage.py runserver`; frontend-only behaviors (redirects, remember-username, localStorage safety) were verified via the automated RTL suite exercising the real components rather than a real browser click-through.

### Security dependency review: `react-router` / `react-router-dom` (post-review)

**Trigger:** independent validation ran `npm audit --omit=dev` and reported `GHSA-qwww-vcr4-c8h2` ("React Router: RSC Mode CSRF Bypass Allows Action Execution Before 400 Response"), stated affected range `>=7.12.0 and <8.3.0`, via `react-router-dom`.

**Inspection performed:**
1. `frontend/package.json` declared `"react-router-dom": "^7.11.0"` at the start of this pass (already tightened once from the Checkpoint-3-era `^7.18.1` before this task began). `react-router` was never a direct dependency — only transitive, via `react-router-dom`.
2. `frontend/package-lock.json` resolved both `react-router-dom` and `react-router` to the same version in lockstep (`react-router-dom`'s own `package.json` declares an exact, non-range `"react-router": "<same-version>"`), confirmed for both `7.11.0` and later `7.18.2`.
3. Import audit: `grep -rl "from 'react-router-dom'" src` found 14 files; `grep -rn "from 'react-router'"` (bare package) found zero. The app imports only from `react-router-dom`.
4. RSC/unstable-API audit: `grep -rn "unstable_RSC|createStaticRouter|ServerRouter|renderToPipeableStream|react-server|\.server\.|entry\.server|ssr" src vite.config.ts` — zero matches. `App.tsx` uses plain client-side `BrowserRouter`. This is a Vite SPA with no SSR/RSC configuration anywhere.

**Attempted Option A (pin below 7.12.0, e.g. `7.11.0`):** pinned exactly, clean-reinstalled (`node_modules` + `package-lock.json` removed, `npm install`), confirmed resolution via `npm ls`. Result: `npm audit --omit=dev` reported **2 high-severity findings**, not zero — a 14-advisory cluster covering the range `6.0.0 - 7.17.0` (open redirects, XSS, a turbo-stream deserialization RCE, DoS, CSRF, and more), which fully includes `7.11.0`. Option A does not achieve the required result; abandoned.

**Attempted Option B (controlled upgrade):** the instruction named `8.3.0` as the target, but `npm view react-router-dom versions` / `dist-tags` shows the registry's highest published version overall is `7.18.2` (`latest` tag) — **`react-router-dom@8.3.0` does not exist**. Pinned to `7.18.2` instead (highest available, still v7, no major bump, no import changes needed) and clean-reinstalled again.

**Result of `7.18.2`:** `npm audit --omit=dev` now reports exactly **one** finding: `GHSA-qwww-vcr4-c8h2` (range `7.12.0 - 8.2.0`), the same advisory the task started from. This is a structural gap in the current upstream release train, not a version we failed to find: the cluster fixed by `>=7.18.0` and the RSC advisory fixed by `>=8.3.0` do not overlap in any published version. **Zero `npm audit --omit=dev` findings is not currently achievable** for this dependency.

**Why `7.18.2` is still the correct choice despite the one remaining finding:** `GHSA-qwww-vcr4-c8h2`'s exploit path is a CSRF bypass specific to React Router's RSC (React Server Components) mode / server actions. Per the RSC/unstable-API audit above, this codebase has zero RSC or server-action usage of any kind — it is a client-only SPA rendered via `BrowserRouter`. The advisory's precondition is absent from this codebase, while the 14-advisory cluster fixed by upgrading past `7.11.0` includes issues in client-facing surfaces this app does use directly (`<Link>`, `useNavigate`). Net risk is lower on `7.18.2` than on `7.11.0`.

**Versions:** `react-router-dom` `^7.11.0` (session start) → `7.11.0` exact (attempted, rejected) → `7.18.2` exact (final). `react-router` transitive throughout, always resolving to the identical version as `react-router-dom`.

**Validation after `7.18.2`:** `npm ls react-router react-router-dom` → both `7.18.2`; `npm run lint` → 0 warnings/0 errors; `npm run type-check` → passed; `npx vitest run --reporter=verbose` → 28/28 passed, no React warnings in stderr; `npm run build` → passed. As a side effect of the clean reinstall, the previously-noted 2 high-severity npm-audit findings in Vite/esbuild dev tooling are gone (dev deps refreshed to current compatible versions) — that old risk-log line has been removed as resolved.

### React Router v8 migration (final resolution)

**Correction to the above:** `react-router@8.3.0` is published — the fix for `GHSA-qwww-vcr4-c8h2` (range `>=7.12.0 and <8.3.0`). React Router v8 removes the separate `react-router-dom` package entirely; all client APIs (`BrowserRouter`, `Routes`, `Route`, `Navigate`, `NavLink`, `Link`, `useNavigate`, `useLocation`, `Outlet`, `MemoryRouter`, etc.) now live on `react-router` itself. `RouterProvider`/`HydratedRouter`, when used, move to `react-router/dom` — not applicable here (grep-confirmed zero usage of either in this codebase).

**Pre-migration inspection:**
1. Installed versions: `react@19.2.8`, `react-dom@19.2.8`, `react-router-dom@7.18.2` → `react-router@7.18.2` (transitive).
2. `package.json` ranges: `"react": "^19.2.7"`, `"react-dom": "^19.2.7"`, `"react-router-dom": "7.18.2"` (exact).
3. Import audit: 14 files imported from `react-router-dom` — `App.tsx`, `routes/ProtectedRoute.tsx` (+`.test.tsx`), `routes/PublicOnlyRoute.tsx` (+`.test.tsx`), `layouts/PublicLayout.tsx`, `layouts/AppLayout.tsx`, `components/navigation/PublicSidebar.tsx`, `components/navigation/AppSidebar.tsx` (+`.test.tsx`), `pages/LandingPage.tsx`, `pages/LoginPage.tsx` (+`.test.tsx`), `pages/ModulePlaceholderPage.tsx`.
4. `RouterProvider`/`HydratedRouter` usage: zero (grep-confirmed).
5. React/ReactDOM vs. the v8 floor (`>=19.2.7`): `19.2.8` already satisfies it — **no React/ReactDOM upgrade needed** (Option A of the migration plan did not trigger).

**Migration steps taken:**
1. `package.json`: removed `"react-router-dom": "7.18.2"`, added `"react-router": "8.3.0"` (exact).
2. Clean reinstall: removed `frontend/node_modules` and `frontend/package-lock.json`, ran `npm install`.
3. Mechanical import rewrite across all 14 files: `from 'react-router-dom'` → `from 'react-router'`. Named imports themselves were unchanged (every symbol the app uses — `BrowserRouter`, `Routes`, `Route`, `Navigate`, `NavLink`, `Link`, `useNavigate`, `useLocation`, `Outlet`, `MemoryRouter` — is confirmed exported from `react-router`'s main entry point in `8.3.0`, via both its `.d.ts` and a runtime `require('react-router')` check). No `react-router/dom` import was needed since `RouterProvider`/`HydratedRouter` are not used. No routing behavior, route paths, or URLs were changed.

**Versions — before → after:**
- `react`: `19.2.8` → `19.2.8` (unchanged; already met the `>=19.2.7` floor)
- `react-dom`: `19.2.8` → `19.2.8` (unchanged)
- `react-router-dom`: `7.18.2` → **removed**
- `react-router`: `7.18.2` (transitive) → **`8.3.0`** (exact, direct dependency)

**Post-migration validation:**
- `npm ls react react-dom react-router react-router-dom` → `react@19.2.8`, `react-dom@19.2.8`, `react-router@8.3.0`; `react-router-dom` absent from the tree entirely.
- `npm audit --omit=dev` → **found 0 vulnerabilities.**
- `npm run lint` → 0 warnings, 0 errors.
- `npm run type-check` → passed.
- `npx vitest run --reporter=verbose` → **28/28 tests passed**, no React warnings in stderr (same coverage as before — login form, both required-field validations, show/hide password, remember-username prefill/removal, success navigation, server-error display, duplicate-submission prevention, password-never-in-localStorage, route guards, logout flow, asset preview, landing page).
- `npm run build` → passed (`vite build` via `vite@8.2.0`).
- Backend (unaffected by a frontend-only change, rerun anyway): `manage.py check` clean, `makemigrations --check --dry-run` → no changes, `migrate` → no-op, `manage.py test` → **16/16 passed**.
- Login, logout, protected-route redirect, and public-only-route redirect behavior is unchanged — same components, same logic, only the import source changed; the full existing test suite (which exercises all four flows) passing unmodified in behavior is the evidence for this.

**No `npm audit fix --force` was run at any point in this migration.**

## Checkpoint 4 — Employee Registration Wizard and EmployeeProfile

### Architecture decisions
- Domain boundaries per explicit direction: `accounts` app owns Django `User` creation, registration orchestration, and username/email/password validation (`accounts/registration.py`, `accounts/views.py::register_view`); a new `employees` app owns `EmployeeProfile` and its validators (`employees/models.py`, `employees/validators.py`); `faceauth` remains untouched and empty — `FaceCredential`/`FaceLoginAttempt` are Checkpoint 5 work only.
- Registration stays a plain Django view (not DRF `APIView`), consistent with the Checkpoint 3 CSRF rationale already in this document — CSRF is enforced unconditionally by the real `CsrfViewMiddleware`, not delegated to DRF's session-authentication CSRF path.
- Backend validation lives in a dedicated `accounts/registration.py` module (`validate_registration(post_data, files) -> (errors, cleaned)`) rather than inline in the view, so the view stays a thin orchestrator around validate → atomic-create → serialize.
- Photo validation trusts neither the filename extension nor the client `Content-Type` header: `employees/validators.py::validate_profile_photo` decodes the image with Pillow (`Image.verify()` then a second `Image.open()` to read the confirmed `format`) and checks that against an explicit allow-list (`PROFILE_PHOTO_ALLOWED_CONTENT_TYPES` in `settings.py`).
- Safe storage filenames: `employees/models.py::profile_photo_upload_path` discards the original filename entirely and generates `profile_photos/<uuid4 hex>.<ext>`.

### Backend implementation
- New `employees` app registered in `INSTALLED_APPS`, migration `employees/migrations/0001_initial.py` applied.
- `EmployeeProfile` model: `user` (`OneToOneField` to `User`, `CASCADE`), `employee_id` (unique, `RegexValidator` limiting to letters/numbers/hyphens), `designation`, `department`, `location`, `manager_name`, `date_of_joining`, `phone` (`RegexValidator`, international-friendly), `date_of_birth`, `profile_photo` (optional `ImageField`), `registration_status` (`TextChoices`: `PENDING_FACE_ENROLLMENT` default, `ACTIVE`, `REJECTED`, `SUSPENDED`), `created_at`, `updated_at`. `clean()` rejects a `date_of_birth` of today or later (invoked via `full_clean()` in Django Admin). Registered in `employees/admin.py` with list display, filters, and search.
- `POST /api/v1/auth/register/` (`accounts/urls.py`, `accounts/views.py::register_view`): validates the full multipart payload, then creates `User` (`is_active=False`) and `EmployeeProfile` (`registration_status=PENDING_FACE_ENROLLMENT` by field default) inside a single `transaction.atomic()` block. No Django session is created — the endpoint never calls `login()`. On an `IntegrityError` after a photo was already written to storage, the orphaned file is deleted before returning the error.
- `Pillow==12.3.0` added to `backend/requirements.txt`. `settings.py` gained `PROFILE_PHOTO_MAX_BYTES` (5 MB) and `PROFILE_PHOTO_ALLOWED_CONTENT_TYPES` (`image/jpeg`, `image/png`, `image/webp`). `mdaiw/urls.py` serves `MEDIA_URL` from `MEDIA_ROOT` when `DEBUG=True`.

### Frontend implementation
- `types/registration.ts` — `AccountRegistrationData`, `EmployeeRegistrationData`, `RegistrationFormData`, `RegistrationFieldErrors`, `RegistrationResponse` (success/validation-error union), `RegistrationStatus`.
- `api/client.ts` — added `registerEmployee(formData: FormData)`; the existing `apiRequest` wrapper was fixed to skip the automatic `Content-Type: application/json` header when the request body is a `FormData` instance (previously it would have always set JSON content type, which breaks multipart boundary negotiation — this bug did not manifest before because no caller had ever passed a `FormData` body until this checkpoint).
- `forms/` (new, shared across future checkpoints too) — `FormField`, `PasswordField` (extracted from `LoginPage`'s inline show/hide pattern), `CheckboxField`, `SelectField`, `DateField`, `PhotoUploader` (object-URL preview with `useEffect` cleanup, client-side type/size validation before the file ever reaches parent state), `ValidationSummary`.
- `registration/` (new) — `RegistrationWizard` (state/orchestration), `RegistrationStepper` (4-step visual states: upcoming/active/completed), `AccountDetailsStep`, `EmployeeDetailsStep`, `FaceEnrollmentInfoStep` (informational only — no `getUserMedia` call, verified by a test that spies on `navigator.mediaDevices.getUserMedia` and asserts it is never invoked), `ReviewSubmitStep` (passwords excluded, edit-buttons jump back to step 1/2, its own object-URL preview with cleanup), `RegistrationSuccess`, plus `validation.ts` (client-side mirrors of the backend rules) and `fieldMap.ts` (maps backend `snake_case` field errors back to the correct step/field for both display and step-navigation-on-error).
- `pages/RegisterPage.tsx` replaced the static placeholder with `<RegistrationWizard />`.

### Backend tests
`backend/employees/tests.py` (2 tests) + `backend/accounts/tests.py` `RegistrationEndpointTests` (31 tests): successful registration, user+profile created together, new user inactive, status `PENDING_FACE_ENROLLMENT`, no session created, missing/duplicate username, missing/malformed/duplicate-case-insensitive work email, missing password, mismatched passwords, weak password rejected by Django's validators, duplicate employee ID, missing first/last name/designation/department/location, invalid/future date of birth, invalid date of joining, invalid phone, valid photo upload, unsupported file type, oversized upload, corrupt image, CSRF enforcement, atomic-rollback-on-duplicate-employee-id (pre-flight validation prevents any partial `User` row), password absent from every response, and a `FaceCredential` model absence check (`apps.get_model('faceauth', 'FaceCredential')` raises `LookupError`, confirming Checkpoint 4 created no face-related record of any kind). Total backend: **49 tests, all passing**.

### Frontend tests
`registration/RegistrationWizard.test.tsx` (21 tests): renders, all four step labels, Step 1 required validation, password mismatch, show/hide password, valid Step 1→2 navigation, Step 2 required validation, phone validation, date-of-birth-in-future validation, photo preview, unsupported-type rejection (using `userEvent.setup({ applyAccept: false })` to bypass the input's `accept` attribute the way a maliciously-renamed file would), oversized rejection, backward navigation preserving data, Face Enrollment informational step with a `getUserMedia` spy proving no camera call, review screen excluding passwords, edit-from-review returning to the right step, confirmation-checkbox gate, duplicate-submission prevention, backend-error-to-field mapping, success screen with pending-status display, and password-never-in-storage. All 28 pre-existing frontend tests still pass unmodified. Total frontend: **49 tests, all passing** (28 pre-existing + 21 new).

### Validation results
- Frontend: `npm audit --omit=dev` → 0 vulnerabilities; `npm run lint` → 0 warnings/errors; `npm run type-check` → passed; `npx vitest run` → 49/49 passed; `npm run build` → passed.
- Backend: `manage.py check` → clean; `makemigrations --check --dry-run` → no changes; `migrate` → applied cleanly; `manage.py test` → 49/49 passed.

### Manual verification (live `manage.py runserver`, curl)
Performed against a temporary local port (`127.0.0.1:8123`) so the developer's normal dev server port was left untouched:
1. `GET /api/v1/health/` → 200.
2. `GET /api/v1/auth/csrf/` → cookie set; registration submitted as `multipart/form-data` with the CSRF token header → `201 Created`, response body matched the spec's example shape exactly (`user_id`, `username`, `employee_id`, `work_email`, `registration_status`, `face_enrollment_required` — no password, no filesystem path).
3. Confirmed via Django shell: the created `User.is_active` is `False` and `EmployeeProfile.registration_status` is `PENDING_FACE_ENROLLMENT`.
4. `POST /api/v1/auth/login/` with the new (inactive) account's correct username/password → `401`, `{"code": "INVALID_CREDENTIALS", "message": "Invalid username or password."}` — identical to any other failed login, never revealing the account is pending.
5. Repeated registration with a real JPEG `profile_photo` (generated via Pillow) → `201`; confirmed the file was written to `media/profile_photos/<uuid>.jpg` (original filename discarded) and that no path appeared anywhere in the JSON response.
6. Confirmed the pre-existing real superuser account (created by the user outside this session) was completely unaffected: its `password` hash and `last_login` timestamp were read before and after this checkpoint's work and are byte-identical, and `is_active`/`is_superuser` remain `True`. Its actual plaintext password is unknown to this session and was never needed or requested — this check is sufficient to prove Checkpoint 4 did not touch that row, without live-testing a real login for that account. This mirrors the same evidentiary standard used for the CSRF/session checks in Checkpoint 3.
7. All test data created during manual verification (`manual.tester`, `manual.tester2`, their `EmployeeProfile` rows, and the uploaded test photo) was deleted afterward via the Django ORM/filesystem; the temporary dev server on port 8123 was stopped. The developer's real data (the one pre-existing superuser) was the only row touched by a read, never a write.

### Risks and honest limitations carried forward
- The Chrome browser extension was still not available this session (same limitation noted in Checkpoint 3) — full click-through-the-actual-wizard-in-a-real-browser verification was substituted with the automated RTL suite (which exercises the real rendered components, not mocks of them) plus the curl-based backend flow above. This should be redone with a real browser once the extension is available.
- `EmployeeProfile.clean()`'s date-of-birth-in-the-future check is defensive (used by Django Admin's `ModelForm`); the registration endpoint performs its own equivalent check directly in `accounts/registration.py` before any database write, so the two are intentionally redundant rather than the endpoint depending on `full_clean()`.

## Checkpoint 5 — Face Enrollment, Liveness Validation and Face Recognition Login

**Status: Complete.** Every layer (models, service, encryption, endpoints, frontend camera/liveness flow, tests) is implemented, passing automated validation, and has now been confirmed by the user through real webcam manual verification (see "Real webcam manual verification" below) covering every mandatory item.

### Security position
Defense-in-depth per the approved architecture: biometric consent, browser camera permission, randomized active-liveness challenge (backend-issued, frontend-guided via MediaPipe), backend single-face validation, backend DeepFace anti-spoofing, multi-frame identity consistency (cosine distance across all frames in a set, using DeepFace's own pre-tuned threshold — never an invented one), encrypted embedding storage (Fernet/MultiFernet), one-to-one username-based verification (never one-to-many search), rate limiting/lockout, and password fallback always available. This is explicitly documented as an MVP implementation, not certified production-grade biometric liveness — see "Known limitations" below.

### Dependencies
Full resolved set pinned in `backend/requirements.txt`: `deepface==0.0.100`, `retina-face==0.0.18`, `tensorflow==2.21.0`, `tf-keras==2.21.0` (added after discovering the incompatibility below), `cryptography==50.0.0`, `numpy==2.5.1`, `opencv-python==5.0.0.93` (deepface hard-depends on the GUI build directly in its own metadata — `opencv-python-headless` cannot be substituted without patching deepface itself), plus deepface's full transitive tree (pandas, keras, mtcnn, Flask, etc. — all pinned exactly). `pip check` reports no broken requirements. Frontend: `@mediapipe/tasks-vision@0.10.35` (exact), `npm audit --omit=dev` reports 0 vulnerabilities.

### Discovered and fixed: retina-face vs. Keras 3
While performing real (non-mocked) verification, the very first live face-detection call crashed with `ValueError: A KerasTensor cannot be used as input to a TensorFlow function.` — `retina-face==0.0.18`'s model-construction code (`retinaface_model.py`) calls raw `tf.shape()` on a `KerasTensor`, which TensorFlow 2.21's default Keras 3 backend rejects. This is a genuine upstream compatibility gap between the versions the checkpoint specified, not a defect introduced by this project's own code (which already never lets a raw DeepFace/TensorFlow exception reach an API response, regardless). **Fix:** `backend/mdaiw/settings.py` sets `os.environ.setdefault('TF_USE_LEGACY_KERAS', '1')` at settings-load time, routing `tf.keras` through the installed `tf-keras` package (Keras-2-API compatible) instead of Keras 3. Verified by reproducing the exact same face-detection call against the exact same input twice — crashed without the flag, returned a clean `NO_FACE` result with it — see `backend/README.md`'s "Known issue and fix" section for the full reproduction.

### Model/asset cache directories
`backend/.face-models/` (git-ignored) — `DEEPFACE_HOME` is redirected here via `os.environ.setdefault` in `settings.py`, confirmed by inspecting the directory after a real download: `.face-models/.deepface/weights/retinaface.h5` (~119 MB). `frontend/public/assets/mediapipe/` (git-ignored: `*.task` and `wasm/`) — `frontend/scripts/setup-face-landmarker.ps1` copies the WASM vision runtime out of `node_modules/@mediapipe/tasks-vision/wasm` (no network needed, already on disk after `npm install`) and downloads `face_landmarker.task` from Google's model CDN (network needed, once).

### Backend implementation
- `faceauth/models.py` — `FaceCredential` (OneToOne `User`; `encrypted_embedding` TextField, `model_name`, `detector_backend`, `distance_metric`, `enrollment_frame_count`, `is_active`, `revoked_at`, `last_verified_at`), `FaceChallenge` (`token_hash` unique, `purpose` ENROLL/LOGIN, nullable `user` FK, `challenge_actions` JSONField, `expires_at`, `used_at`, `failed_attempts`), `FaceLoginAttempt` (nullable `user` FK, `username_hash`, `success`, `reason_code`, `distance`, `threshold`, `ip_hash`, `user_agent_hash`). Migration `faceauth/migrations/0001_initial.py`. Admin registration explicitly excludes `encrypted_embedding` from every surface (`list_display`, `readonly_fields`, and `exclude`).
- `faceauth/hashing.py` — `generate_token()` (`secrets.token_urlsafe(32)`), `hash_token()` (SHA-256, only the hash is ever stored), `keyed_hash()` (HMAC-SHA256 with `DJANGO_SECRET_KEY` as a pepper, used only to pseudonymize username/IP/user-agent for audit logs — unrelated to and never used for biometric embedding encryption).
- `faceauth/encryption.py` — `MultiFernet` over `FACE_EMBEDDING_ENCRYPTION_KEYS` (comma-separated; first key encrypts, all decrypt, enabling rotation). Embedding serialized as JSON (never pickle) with model/metric/detector metadata before encryption. Raises `EncryptionKeyMissing` when unconfigured and `EmbeddingDecryptionFailed` for corrupt/untrusted ciphertext — both are safe-failure conditions the calling view maps to a generic error, never a crash.
- `faceauth/tokens.py` — `issue_enrollment_token`/`verify_enrollment_token` using `django.core.signing` (`FACE_ENROLLMENT_TOKEN_TTL_SECONDS`, default 900s). Re-checks `is_active`/`registration_status` at verify time (not just signature/expiry), which is what makes a token issued before a successful enrollment unusable afterward even though it would still cryptographically verify.
- `faceauth/lockout.py` — computes lockout purely from `FaceLoginAttempt` rows: counts failures since the most recent success (so a success resets the counter) within `FACE_FAILURE_WINDOW_MINUTES` (15), locks for `FACE_LOCK_MINUTES` (30) if `FACE_MAX_FAILED_ATTEMPTS` (5) is reached. Never touches password login.
- `faceauth/throttling.py` — simple `django.core.cache` counter (default LocMemCache, fine for this MVP's single-process dev target — no Redis introduced) for enrollment-resume rate limiting.
- `faceauth/service.py` — every DeepFace/TensorFlow call isolated behind small wrapper functions (`_extract_faces`, `_represent`, `_verification_threshold`) so tests can mock them without ever importing TensorFlow. `decode_frame` validates size then verifies real image content with Pillow (`CAMERA_FRAME_INVALID` on failure) before any model call runs. `analyze_single_face` enforces exactly one real (non-spoofed) face (`NO_FACE`/`MULTIPLE_FACES`/`LIVENESS_FAILED`). `process_enrollment_frames`/`process_verification_frames` extract per-frame embeddings and reject cross-frame inconsistency (`INCONSISTENT_FRAMES`) using DeepFace's own pre-tuned cosine threshold (`deepface.modules.verification.find_threshold`) — never an invented number. `enroll()`/`verify()` tie it all together; `verify()` also checks the stored credential's model/metric metadata matches current config (`MODEL_MISMATCH`) before comparing.
- `faceauth/views.py` — `challenge_view`, `enroll_view`, `verify_view`, `status_view`, `enrollment_view` (DELETE), `enrollment_resume_view`. All plain Django views (same CSRF rationale as `accounts` — real `CsrfViewMiddleware` enforcement, not DRF's session-authentication-gated CSRF path). `verify_view` always returns the identical generic `FACE_AUTHENTICATION_FAILED` body regardless of cause, recording the true `reason_code` only on `FaceLoginAttempt` for internal audit. `enroll_view` wraps `FaceCredential` creation + `User.is_active = True` + `EmployeeProfile.registration_status = ACTIVE` in one `transaction.atomic()` block.
- `accounts/views.py::register_view` now also calls `faceauth.tokens.issue_enrollment_token(user)` and includes it as `registration.enrollment_token` in the success response.
- `mdaiw/urls.py` mounts `faceauth.urls` at `api/v1/auth/face/`. `mdaiw/settings.py` gained `FACE_EMBEDDING_ENCRYPTION_KEYS` (replacing the unused singular Checkpoint-2-era placeholder), `FACE_FAILURE_WINDOW_MINUTES`, `FACE_LOCK_MINUTES` (15→30 to match this checkpoint's explicit policy), `FACE_CHALLENGE_TTL_SECONDS`, `FACE_ENROLLMENT_TOKEN_TTL_SECONDS`, `FACE_MAX_FRAMES`, `FACE_FRAME_MAX_BYTES`, `FACE_ENROLLMENT_RESUME_MAX_ATTEMPTS/WINDOW_MINUTES`, `FACE_MODEL_CACHE_DIR`/`DEEPFACE_HOME` redirection, `TF_USE_LEGACY_KERAS`, and `DATA_UPLOAD_MAX_MEMORY_SIZE`/`FILE_UPLOAD_MAX_MEMORY_SIZE` sized to comfortably cover `FACE_MAX_FRAMES` × `FACE_FRAME_MAX_BYTES` (Django itself rejects an oversized multipart request before any of our own validation or model inference runs).

### Frontend implementation
- `hooks/useCamera.ts` — `getUserMedia` only on explicit `start()` call (never on mount), `{video:{facingMode:'user'}, audio:false}`, maps `NotAllowedError`/`NotFoundError`/`NotReadableError` to distinct statuses, `stop()` stops every track and clears `video.srcObject`, cleanup on unmount via `useEffect` return, `captureFrame()` draws the current frame to an off-DOM canvas and resolves a JPEG `Blob`.
- `hooks/useFaceLandmarker.ts` — loads `FaceLandmarker` from the local `/assets/mediapipe/` WASM+model path (not a CDN), `numFaces: 1`, blendshapes + facial transformation matrices enabled. Exports pure, independently-tested functions `faceCount()` and `isActionComplete()` (yaw estimated from the transformation matrix for `LOOK_CENTER`/`TURN_LEFT`/`TURN_RIGHT`; `eyeBlinkLeft`/`eyeBlinkRight` blendshape score for `BLINK`) — documented as a coarse UX-guidance heuristic only; the backend independently re-validates liveness and identity on every submitted frame regardless of what this reports.
- `face-recognition/` — `CameraPreview`, `FaceFrameOverlay` (reuses the supplied `face-scan-frame.svg`), `LivenessChallenge`, `CaptureProgress`, `FaceProcessingState`, `FaceAuthError`, `BiometricConsent` (unchecked by default).
- `pages/FaceEnrollmentPage.tsx` — resume-form stage (when the in-memory token was lost, e.g. a refresh) → consent → camera → liveness capture (auto-advances through the randomized action list, one frame per completed action, guarded against duplicate capture) → processing → success (calls `getCurrentUser()` then `AuthContext.setAuthenticatedUser()`, navigates to `/dashboard`) → error (retry or password fallback). Camera is stopped on success, failure, cancel, and unmount.
- `pages/FaceLoginPage.tsx` — username + consent → camera → liveness capture → verification. On success, `submitVerification`'s response already includes the full `user` object (unlike enroll), so `AuthContext.setAuthenticatedUser()` is called directly without an extra request, then navigates to `/dashboard`. On failure, generic `FaceAuthError` with password fallback.
- `context/AuthProvider.tsx`/`types/auth.ts` — added `setAuthenticatedUser(user)` to `AuthContextValue`, since Face Enrollment/Face Recognition login create a Django session out-of-band (not through the existing `login()` password flow) and need a way to hydrate the same context.
- `pages/LoginPage.tsx` — the previously `disabled` "Sign in with Face Recognition" button is now enabled and navigates to `/face-login`, passing the typed username via router state.
- `App.tsx` — added `/face-enrollment` (outside `ProtectedRoute`/`PublicOnlyRoute` — reachable by pending, genuinely unauthenticated users, which is the entire point) and `/face-login` (under `PublicOnlyRoute`, alongside `/login`/`/register`).

### Backend tests
`faceauth/tests.py` (54 tests, DeepFace fully mocked via `_extract_faces`/`_represent`/`_verification_threshold` patches, temporary Fernet keys via `override_settings`): challenge creation (enroll/login/unknown-username), randomized-actions structural check, token-hash-not-raw-token, invalid/expired/single-use/wrong-purpose challenge rejection, CSRF enforcement (challenge/enroll/verify/deletion), consent required, zero/multiple-face rejection, spoof rejection, inconsistent-frames rejection, corrupt-image rejection, oversized-frame rejection, successful enrollment (+ user activated, profile ACTIVE, credential decryptable, no plaintext embedding in DB, no file fields on the model, embedding never in response), atomic rollback on credential conflict, missing-encryption-key safe failure, successful/failed/inactive-user/missing-credential/revoked-credential/corrupt-credential verification, generic-failure-identical-across-causes, lockout after 5 failures + reset on success, password login unaffected during lockout, session created on success, status endpoint (authentication required, hides embedding), deletion (valid/invalid password, CSRF), enrollment-resume (correct/incorrect password, unknown username, already-active account, no session created, throttling). `accounts/tests.py::test_no_facecredential_created` updated from a Checkpoint-4-era "model doesn't exist" check to a real "registration alone creates zero `FaceCredential` rows" functional check, since the model now genuinely exists. **Total backend: 103 tests, all passing** (49 pre-existing + 54 new).

### Frontend tests
`hooks/useCamera.test.ts` (9): no request before `start()`, ready/denied/unavailable/busy/unsupported/insecure-context statuses, track stopped on `stop()` and on unmount. `hooks/useFaceLandmarker.test.ts` (11): `faceCount`/`isActionComplete` pure-function unit tests including real yaw-matrix math for `TURN_LEFT`/`TURN_RIGHT` and blendshape-score math for `BLINK` (no mocking — these are genuinely exercised, not stubbed). `pages/FaceEnrollmentPage.test.tsx` (9) and `pages/FaceLoginPage.test.tsx` (8): consent gating, camera not requested before user action, permission-error display, one-capture-per-action (asserted via mock call count), full success path (submission → `getCurrentUser`/`setAuthenticatedUser` → `/dashboard`), failure path with camera stopped, cancel with camera stopped and redirect, resume-form flow, router-state username prefill, no frames/tokens/credentials ever written to Local/Session Storage. One test added to `pages/LoginPage.test.tsx` for the newly-enabled Face Recognition button. **Total frontend: 87 tests, all passing** (49 pre-existing + 38 new).

### Validation results
- Frontend: `npm audit --omit=dev` → 0 vulnerabilities; `npm run lint` → 0 warnings/errors; `npm run type-check` → passed; `npx vitest run` → 87/87 passed; `npm run build` → passed.
- Backend: `pip check` → no broken requirements; `manage.py check` → clean; `makemigrations --check --dry-run` → no changes; `manage.py test` → 103/103 passed.

### Real (non-mocked) script/HTTP-level verification performed by the assistant
Performed earlier in this checkpoint, before real webcam access was available, against the actual installed DeepFace/TensorFlow/RetinaFace stack (not mocked), via a temporary local port (`127.0.0.1:8125`) so the developer's normal dev port was left untouched:
1. Cold model download: first real `analyze_single_face` call downloaded RetinaFace weights (~119 MB) to `backend/.face-models/.deepface/weights/retinaface.h5` (confirming `DEEPFACE_HOME` redirection works) and completed in **45.0 seconds**; a second call in a fresh process with weights already cached took **31.4 seconds** (import-chain-dominated, not network — this cost is paid once per server process, not per request).
2. This is where the retina-face/Keras-3 incompatibility (documented above) was actually discovered: a later real detection call crashed with the KerasTensor `ValueError`. Reproduced deterministically, root-caused to `retinaface_model.py`'s `tf.shape()` call, fixed via `TF_USE_LEGACY_KERAS=1`, and reproduced again post-fix returning a clean result — both reproductions used the identical input file.
3. Full real HTTP flow after the fix: registered a real pending user via `POST /register/` → received a genuine signed `enrollment_token` → `POST /face/challenge/` with `purpose=ENROLL` returned a genuinely **randomized** 3-action subset (observed two different orderings across two runs: `["BLINK","LOOK_CENTER","TURN_RIGHT"]` and `["TURN_LEFT","TURN_RIGHT","LOOK_CENTER"]`) → `POST /face/enroll/` with 3 synthetic solid-color JPEG frames correctly returned `{"success": false, "code": "NO_FACE", ...}` — proving the complete real stack (token verification, challenge validation, frame decoding, real RetinaFace detection) is genuinely wired end-to-end.
4. All test users/profiles/challenges created during this verification were deleted afterward; the temporary dev server was stopped; no data belonging to the developer's real accounts was touched.

### Real webcam manual verification (user-performed)
The user completed the full webcam click-through and confirmed every mandatory item:
- Real webcam permission and preview
- Biometric consent
- Randomized liveness challenge
- Face Enrollment
- User activated after enrollment
- `EmployeeProfile` changed to `ACTIVE`
- Encrypted `FaceCredential` created
- No raw Face Recognition frames retained
- Camera tracks stopped after completion and cancellation
- Face Recognition login
- Django session restoration after refresh
- Incorrect-person rejection
- Photograph/screen-replay behaviour
- Face failure lockout
- Password-login fallback
- Generic public failure messages
- No passwords, frames, embeddings, or biometric tokens in browser storage

This closes the gap flagged in the prior update of this document (implementation complete but manual verification pending) — Checkpoint 5 is now fully verified end-to-end by a human with a real camera, not just by automated tests and script/HTTP-level checks.

### Known limitations (documented per the master prompt's honesty requirement)
- This is an MVP liveness implementation (randomized-action + anti-spoofing + cross-frame consistency), not a certified, production-grade biometric liveness system — specialist evaluation is recommended before any production use.
- The frontend's yaw/blink heuristics (`isActionComplete`) are coarse UX guidance only; they do not gate security in any way — the backend independently re-validates every frame regardless of what the client believed was true.
- `/face/verify/`'s challenge-issuance step does not defend against timing-based username enumeration (a nonexistent username's challenge is created identically to a real one, but request latency for the subsequent verify call could theoretically differ) — noted as a gap, not engineered around, given MVP scope.
- `django.core.cache`'s default LocMemCache backs enrollment-resume throttling — fine for this MVP's single-process target, would need a shared backend (still not Redis/Celery per the Module-1 infra exclusion, but something process-shared) for a real multi-process deployment.

## Checkpoint status

| Checkpoint | Description | Status |
|---|---|---|
| 0 | Environment and project preparation | Complete |
| 1 | Repository audit and implementation tracking | Complete |
| 2 | Foundation, design system and asset integration | Complete |
| 3 | Password login and Django session authentication | Complete |
| 4 | Employee registration wizard | Complete |
| 5 | Face Recognition enrollment and login | Complete |
| 6 | Yukti text and voice assistant | Not started |
| 7 | Dashboard, profile, settings and responsive navigation | Not started |
| 8 | Security, accessibility, testing and final verification | Not started |
