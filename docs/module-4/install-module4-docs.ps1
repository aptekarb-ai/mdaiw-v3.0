param(
  [string]$Destination = "C:\Projects\MDAIW\docs\module-4"
)

$Source = Split-Path -Parent $MyInvocation.MyCommand.Path
Write-Host "Installing Module-4 docs from $Source to $Destination"
New-Item -ItemType Directory -Force -Path $Destination | Out-Null
Copy-Item -Path (Join-Path $Source '*') -Destination $Destination -Recurse -Force
Write-Host "Module-4 documentation installed."
