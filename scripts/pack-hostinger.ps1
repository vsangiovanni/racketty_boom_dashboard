param(
  [switch]$IncludeProductionEnv
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$stage = Join-Path $root '.hostinger-stage'
$zip = Join-Path $root 'hostinger-deploy.zip'

function Test-ShouldSkip {
  param([string]$Name, [string]$ParentPath)
  $n = $Name
  $parentLeaf = Split-Path -Leaf $ParentPath
  if ($n -eq 'node_modules') { return $true }
  if ($n -eq '.git') { return $true }
  if ($n -eq '.hostinger-stage') { return $true }
  if ($n.StartsWith('deploy_stage_')) { return $true }
  if ($n -match '\.(zip|tgz)$') { return $true }
  if ($n -eq '.env') { return $true }
  if ($n -eq '.env.production') { return $true }
  if ($n -eq '.env.produccion') { return $true }
  if ($n -eq 'docs' -and $ParentPath -eq $root) { return $true }
  if ($parentLeaf -eq 'backend' -and ($n -eq 'package.json' -or $n -eq 'package-lock.json')) { return $true }
  return $false
}

function Copy-ProjectTree {
  param([string]$Src, [string]$Dst)
  foreach ($item in Get-ChildItem -LiteralPath $Src -Force) {
    if (Test-ShouldSkip -Name $item.Name -ParentPath $Src) { continue }
    $target = Join-Path $Dst $item.Name
    if ($item.PSIsContainer) {
      New-Item -ItemType Directory -Path $target -Force | Out-Null
      Copy-ProjectTree -Src $item.FullName -Dst $target
    } else {
      Copy-Item -LiteralPath $item.FullName -Destination $target -Force
    }
  }
}

function Write-ZipFromFolder {
  param([string]$SourceDir, [string]$ZipPath)
  if (Test-Path $ZipPath) { Remove-Item -LiteralPath $ZipPath -Force }
  $sourceFull = (Resolve-Path $SourceDir).Path.TrimEnd('\')
  $archive = [System.IO.Compression.ZipFile]::Open(
    $ZipPath,
    [System.IO.Compression.ZipArchiveMode]::Create
  )
  try {
    Get-ChildItem -LiteralPath $sourceFull -Recurse -File -Force | ForEach-Object {
      $full = $_.FullName
      $rel = $full.Substring($sourceFull.Length).TrimStart('\')
      $entryName = $rel.Replace('\', '/')
      $null = [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
        $archive,
        $full,
        $entryName,
        [System.IO.Compression.CompressionLevel]::Optimal
      )
    }
  } finally {
    $archive.Dispose()
  }
}

if (Test-Path $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
New-Item -ItemType Directory -Path $stage -Force | Out-Null
Copy-ProjectTree -Src $root -Dst $stage

if ($IncludeProductionEnv) {
  $prodSrc = Join-Path $root 'backend\.env.production'
  if (Test-Path -LiteralPath $prodSrc) {
    $backendStage = Join-Path $stage 'backend'
    if (-not (Test-Path -LiteralPath $backendStage)) { New-Item -ItemType Directory -Path $backendStage -Force | Out-Null }
    Copy-Item -LiteralPath $prodSrc -Destination (Join-Path $backendStage '.env.production') -Force
    Write-Host 'Incluido backend/.env.production en el zip (no compartas el archivo; alternativa: variables en hPanel).'
  } else {
    Write-Warning 'IncludeProductionEnv: no existe backend\.env.production'
  }
}

$pkg = Join-Path $stage 'package.json'
$entry = Join-Path $stage 'server.js'
if (-not (Test-Path -LiteralPath $pkg)) { throw "Falta package.json en la raiz del stage." }
if (-not (Test-Path -LiteralPath $entry)) { throw "Falta server.js en la raiz del stage." }
$raw = [System.IO.File]::ReadAllText($pkg, [System.Text.UTF8Encoding]::new($false))
if ([string]::IsNullOrWhiteSpace($raw)) { throw "package.json del stage esta vacio." }
try {
  $null = $raw | ConvertFrom-Json
} catch {
  throw "package.json no es JSON valido: $($_.Exception.Message)"
}

Write-ZipFromFolder -SourceDir $stage -ZipPath $zip
Remove-Item -LiteralPath $stage -Recurse -Force

Write-Host "Listo: $zip"
