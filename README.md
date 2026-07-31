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
# Backend
cd backend
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe manage.py migrate
.\.venv\Scripts\python.exe manage.py runserver

# Frontend (separate terminal)
cd frontend
npm install
npm run dev
```

Copy `.env.example` to `.env` at the repository root (and
`frontend/.env.example` to `frontend/.env`) before running either side; never
commit a real `.env` file.
