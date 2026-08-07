param(
  [switch]$Build
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $repoRoot ".env"
$composeFile = Join-Path $repoRoot "docker-compose.split.yml"

if (-not (Test-Path $envFile)) {
  throw ".env wurde nicht gefunden: $envFile"
}

if (-not (Test-Path $composeFile)) {
  throw "docker-compose.split.yml wurde nicht gefunden: $composeFile"
}

$envMap = @{}
Get-Content $envFile | ForEach-Object {
  $line = $_.Trim()
  if (-not $line -or $line.StartsWith("#")) { return }
  $parts = $line -split "=", 2
  if ($parts.Count -ne 2) { return }
  $key = $parts[0].Trim()
  $value = $parts[1]
  $envMap[$key] = $value
}

$configuredBots = @()
for ($i = 1; $i -le 20; $i++) {
  $tokenKey = "BOT_${i}_TOKEN"
  $clientIdKey = "BOT_${i}_CLIENT_ID"
  $token = [string]($envMap[$tokenKey])
  $clientId = [string]($envMap[$clientIdKey])
  if (-not [string]::IsNullOrWhiteSpace($token) -and -not [string]::IsNullOrWhiteSpace($clientId)) {
    $configuredBots += $i
  }
}

if ($configuredBots.Count -eq 0) {
  throw "Keine BOT_N Konfiguration in .env gefunden."
}

$commanderIndex = 1
if ($envMap.ContainsKey("COMMANDER_BOT_INDEX")) {
  $parsedCommander = 0
  if ([int]::TryParse([string]$envMap["COMMANDER_BOT_INDEX"], [ref]$parsedCommander) -and $parsedCommander -ge 1) {
    $commanderIndex = $parsedCommander
  }
}

$profiles = @()
foreach ($botIndex in $configuredBots) {
  if ($botIndex -eq $commanderIndex) { continue }
  $profiles += "--profile"
  $profiles += "worker-$botIndex"
}

$runtimeDataDir = Join-Path $repoRoot "runtime-data"
$legacyRuntimeDirectories = @("logs", "bot-state", "song-history")
foreach ($name in $legacyRuntimeDirectories) {
  $legacyDir = Join-Path $repoRoot $name
  $targetDir = Join-Path $runtimeDataDir $name
  if (Test-Path $legacyDir -PathType Leaf) {
    throw "Legacy runtime path must be a directory before migration: $legacyDir"
  }
  if (-not (Test-Path $legacyDir -PathType Container)) { continue }
  New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
  Get-ChildItem -LiteralPath $legacyDir -Force | ForEach-Object {
    if (($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw "Refusing to migrate symlinked runtime artifact: $($_.FullName)"
    }
    $destination = Join-Path $targetDir $_.Name
    if (Test-Path $destination) {
      Write-Host "Behalten: runtime-data/$name/$($_.Name) existiert bereits"
    } else {
      Copy-Item -LiteralPath $_.FullName -Destination $destination -Recurse
      Write-Host "Migriert: $name/$($_.Name) -> runtime-data/$name/$($_.Name)"
    }
  }
}

$runtimeDirectories = @($runtimeDataDir, (Join-Path $runtimeDataDir "logs"), (Join-Path $runtimeDataDir "bot-state"), (Join-Path $runtimeDataDir "song-history"))
foreach ($directory in $runtimeDirectories) {
  if (Test-Path $directory -PathType Leaf) {
    throw "Runtime path must be a directory: $directory"
  }
  New-Item -ItemType Directory -Path $directory -Force | Out-Null
}

$runtimeFiles = @(
  "stations.json", "bot-state.json", "custom-stations.json", "command-permissions.json", "guild-languages.json",
  "song-history.json", "listening-stats.json", "dashboard.json", "scheduled-events.json", "coupons.json",
  "premium.json", "discordbotlist.json", "botsgg.json", "topgg.json", "vote-events.json",
  "operator-incidents.json", "runtime-incidents.json", "owner-audit.json"
)
foreach ($filename in $runtimeFiles) {
  $target = Join-Path $runtimeDataDir $filename
  $legacy = Join-Path $repoRoot $filename
  if (Test-Path $target -PathType Container) {
    throw "Runtime JSON path is a directory: $target"
  }
  if (-not (Test-Path $target)) {
    if (Test-Path $legacy -PathType Leaf) {
      Copy-Item -LiteralPath $legacy -Destination $target
      Write-Host "Migriert: $filename -> runtime-data"
    } elseif ($filename -eq "stations.json") {
      Set-Content -LiteralPath $target -Value '{"stations":{},"qualityPreset":"custom"}' -NoNewline
    } else {
      Set-Content -LiteralPath $target -Value '{}' -NoNewline
    }
  }
}

$command = @("compose", "-f", $composeFile)
$command += $profiles
$command += @("up", "-d")
if ($Build) {
  $command += "--build"
}

Write-Host "Commander-Bot: BOT_$commanderIndex"
$workerNames = ($configuredBots | Where-Object { $_ -ne $commanderIndex } | ForEach-Object { "BOT_$_" }) -join ", "
Write-Host "Worker-Bots: $workerNames"
Write-Host "Starte Split-Setup..."

& docker @command
