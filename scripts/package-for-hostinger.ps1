# Empaqueta el repo (git archive) y copia backend/.env.production -> backend/.env dentro del zip.
# Hostinger no recibe .env.production (esta en .gitignore); el runtime carga backend/.env.
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$prodEnv = Join-Path $root 'backend\.env.production'
if (-not (Test-Path $prodEnv)) {
  Write-Error "No existe backend/.env.production. Crealo con tus credenciales de produccion (no se sube a git)."
}
$tmp = Join-Path $env:TEMP ("greg-hostinger-build-" + [guid]::NewGuid().ToString('n'))
$srcZip = Join-Path $tmp 'src.zip'
$outDir = Join-Path $tmp 'out'
$finalZip = Join-Path $env:TEMP 'greg-tracker-hostinger-deploy.zip'
New-Item -ItemType Directory -Path $tmp -Force | Out-Null
try {
  Push-Location $root
  git archive --format=zip -o $srcZip HEAD
  if ($LASTEXITCODE -ne 0) { throw 'git archive failed' }
  Expand-Archive -LiteralPath $srcZip -DestinationPath $outDir -Force
  $targetEnv = Join-Path $outDir 'backend\.env'
  Copy-Item -LiteralPath $prodEnv -Destination $targetEnv -Force
  if (Test-Path $finalZip) { Remove-Item -LiteralPath $finalZip -Force }
  Compress-Archive -Path (Join-Path $outDir '*') -DestinationPath $finalZip -Force
  Write-Host "OK: $finalZip"
}
finally {
  Pop-Location
  if (Test-Path $tmp) { Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue }
}
