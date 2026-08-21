# Prepares the local, git-ignored MediaPipe assets used by Face Enrollment
# and Face Recognition login liveness guidance:
#   1. Copies the WASM vision runtime out of node_modules (already on disk
#      after `npm install`, no network access needed).
#   2. Downloads the Face Landmarker model (.task) from Google's public
#      model CDN — this step does need network access, once.
#
# Neither output is committed to Git (see .gitignore). For a production
# deployment, host both under your own static asset domain instead of
# depending on this CDN URL or a dev machine's local copy.

$ErrorActionPreference = 'Stop'

$repoRoot = Join-Path $PSScriptRoot '..'
$wasmSource = Join-Path $repoRoot 'node_modules\@mediapipe\tasks-vision\wasm'
$wasmTarget = Join-Path $repoRoot 'public\assets\mediapipe\wasm'
$modelTarget = Join-Path $repoRoot 'public\assets\mediapipe\face_landmarker.task'
$modelUrl = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'

if (-not (Test-Path $wasmSource)) {
    throw "MediaPipe package not found at $wasmSource. Run 'npm install' first."
}

New-Item -ItemType Directory -Force -Path $wasmTarget | Out-Null
Copy-Item -Path (Join-Path $wasmSource '*') -Destination $wasmTarget -Force
Write-Host "Copied WASM vision runtime to $wasmTarget"

New-Item -ItemType Directory -Force -Path (Split-Path $modelTarget) | Out-Null
Write-Host "Downloading Face Landmarker model to $modelTarget ..."
Invoke-WebRequest -Uri $modelUrl -OutFile $modelTarget
Write-Host "Done. Model size:" (Get-Item $modelTarget).Length "bytes."
