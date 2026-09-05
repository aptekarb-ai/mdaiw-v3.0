# Module-4 — Local Runtime Guide

Authoritative local development instructions for Module-4, as of commit
`97ddb9a`. Read this before starting any dev server for Module-4 work.

## Port ownership — do not violate this

| Service | Port | Owner |
|---|---|---|
| Module-1 frontend | **5173** | Module-1 — do not touch, do not reconfigure, do not kill its process while working on Module-4 |
| Module-4 frontend | **5174** | This module |
| Module-4 backend | **8001** | This module (Module-3's own backend default is 8000 — a *different* port, on purpose) |
| Module-3 | its own runtime | Do not assume Module-3 uses Module-4's ports at all. Module-3 will be rebuilt separately from scratch — do not couple any Module-4 work to Module-3's current runtime. |

**Why 5174/8001 specifically:** the backend's own `.env` already hard-codes
`CORS_ALLOWED_ORIGINS=http://localhost:5174`, `CSRF_TRUSTED_ORIGINS=http://localhost:5174`,
and `FRONTEND_URL=http://localhost:5174` — 5174 is the origin the backend
actually trusts for cookie-based session auth. `frontend/.env.local` points
`VITE_API_BASE_URL=http://localhost:8001` specifically to keep Module-4's
backend isolated from Module-3's own default of 8000.

## Starting Module-4

From `frontend/`:

```powershell
npm run dev:5174
```

This runs `vite --port 5174 --strictPort`. **`--strictPort` is intentional
and important**: if port 5174 is already occupied (e.g. by a stale process
from a previous session), Vite will **fail to start with a clear error**
instead of silently falling forward to 5175/5176 — which is exactly the
failure mode that broke browser-based authentication testing once before
(see the incident note below). Do not remove `--strictPort` and do not add
a fallback.

From `backend/`, with the project's virtualenv activated:

```powershell
.venv\Scripts\activate
python manage.py runserver 0.0.0.0:8001
```

(Adjust the venv activation path to your shell; on Windows Git Bash /
PowerShell this repo's own venv lives at `backend/.venv`.)

## If port 5174 is already in use

Do **not** assume it's safe to kill whatever holds it. Identify ownership
first:

```powershell
Get-NetTCPConnection -LocalPort 5174 | Format-Table LocalAddress,LocalPort,State,OwningProcess
Get-CimInstance Win32_Process -Filter "ProcessId=<PID>" | Select-Object ProcessId,ParentProcessId,CommandLine
```

Only stop a process you can positively identify as your own stale Module-4
frontend (its `CommandLine` will show `vite --port 5174 --strictPort` or
similar, and you'll recognize it as something *you* started). Never stop a
process you can't identify, and never touch anything bound to port 5173.

## If port 8001 is already in use

Same rule: identify via `Get-NetTCPConnection -LocalPort 8001` +
`Get-CimInstance Win32_Process` before stopping anything. A stray backend
instance from an unrelated session should be left alone if it isn't yours
and isn't actually blocking your own new instance (Windows can allow a
`127.0.0.1`-bound stale listener and your own fresh `0.0.0.0`-bound listener
to coexist on the same port number without conflict).

## Incident note (why `--strictPort` exists)

Earlier in this project's history, `npm run dev` (no port pinning) was used
for Module-4 testing. Port 5173 was legitimately held by Module-1, so Vite
auto-incremented — but a stale, week-old zombie process was *also* squatting
5174, so Vite kept incrementing further, landing on 5176. The backend's CORS
config only trusts 5174, so the frontend on 5176 could never authenticate.
This was misdiagnosed at first as a browser-automation sandbox limitation;
the real cause was the stale process plus the lack of `strictPort`. `npm run
dev:5174` with `--strictPort` makes this class of failure impossible to miss
silently again — it fails loudly at startup instead.

## Verifying you're on the right ports

```powershell
Get-NetTCPConnection -LocalPort 5173,5174,8001 -ErrorAction SilentlyContinue |
  Format-Table LocalAddress,LocalPort,State,OwningProcess -AutoSize
```

You should see exactly one listener on 5174 (your new Vite process) and one
on 8001 (your new Django process), and 5173 should show whatever PID
Module-1's own dev server is using — untouched by anything you just did.

## Logging in for manual/browser testing

Use any existing employee account in the local dev database, or create one
via `python manage.py shell` (`set_password` on an existing user) for a
disposable QA credential. There is no seeded "default" account documented
here on purpose — do not assume one exists in a fresh database.
