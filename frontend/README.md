# MDAIW Frontend

React 19 + TypeScript + Vite SPA for Module-1 of the MarketOne Digital AI
Workspace. React Router 8 (no `react-router-dom`), plain global CSS with
design tokens, Vitest + React Testing Library.

## Setup (Windows 10 PowerShell)

```powershell
cd frontend
npm install
npm run dev
```

## Face Recognition local assets (Checkpoint 5)

Face Enrollment and Face Recognition login use MediaPipe Face Landmarker in
the browser for live liveness guidance. Its model and WASM runtime are
git-ignored local assets — run once after `npm install`:

```powershell
.\scripts\setup-face-landmarker.ps1
```

This copies the WASM vision runtime out of `node_modules/@mediapipe/tasks-vision/wasm`
(no network needed) and downloads `face_landmarker.task` (~3.6 MB) from
Google's public model CDN into `public/assets/mediapipe/` (network needed,
once). Neither is committed — see `.gitignore`. For a production deployment,
host both yourself instead of depending on this CDN URL at runtime.

Camera access (`getUserMedia`) requires a secure context: `localhost` is
permitted without HTTPS; any other host needs HTTPS.

## Validation commands

```powershell
npm run lint
npm run type-check
npm run test
npm run build
npm audit --omit=dev
```

## Routes added in Checkpoint 5

```text
/face-enrollment   — post-registration real Face Enrollment (consent, camera, liveness capture, submit)
/face-login        — Face Recognition login (username, consent, camera, liveness capture, verify)
```

`LoginPage`'s "Sign in with Face Recognition" button now navigates to
`/face-login`. `RegistrationSuccess` navigates to `/face-enrollment`, passing
the enrollment authorization token via React Router location `state` — held
in memory only, never Local/Session Storage, never in the URL.
