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

function Normalize-OmniFmEnvValue {
  param([object]$Value)

  $normalized = ([string]$Value).Trim()
  if ($normalized.Length -ge 2) {
    $first = $normalized[0]
    $last = $normalized[$normalized.Length - 1]
    if (($first -eq '"' -and $last -eq '"') -or ($first -eq "'" -and $last -eq "'")) {
      $normalized = $normalized.Substring(1, $normalized.Length - 2)
    }
  }
  return $normalized
}

$envMap = @{}
Get-Content $envFile | ForEach-Object {
  $line = $_.Trim()
  if (-not $line -or $line.StartsWith("#")) { return }
  $parts = $line -split "=", 2
  if ($parts.Count -ne 2) { return }
  $key = $parts[0].Trim()
  $value = Normalize-OmniFmEnvValue -Value $parts[1]
  $envMap[$key] = $value
}

$configuredBots = @()
$seenGap = $false
$seenTokens = @{}
$seenClientIds = @{}
for ($i = 1; $i -le 20; $i++) {
  $tokenKey = "BOT_${i}_TOKEN"
  $clientIdKey = "BOT_${i}_CLIENT_ID"
  $token = [string]($envMap[$tokenKey])
  $clientId = [string]($envMap[$clientIdKey])
  $tokenDefined = $envMap.ContainsKey($tokenKey)
  $clientIdDefined = $envMap.ContainsKey($clientIdKey)

  if (-not $tokenDefined -and -not $clientIdDefined) {
    if ($configuredBots.Count -gt 0) { $seenGap = $true }
    continue
  }

  if ($seenGap -or $i -ne ($configuredBots.Count + 1)) {
    throw "BOT_N Konfiguration muss ohne Luecke bei BOT_1 beginnen."
  }
  if ([string]::IsNullOrWhiteSpace($token)) {
    throw "$tokenKey darf nicht leer sein."
  }
  if ($clientId -notmatch "^[0-9]+$") {
    throw "$clientIdKey muss zusammen mit $tokenKey als numerische Discord-Client-ID gesetzt sein."
  }
  if ($seenTokens.ContainsKey($token)) {
    throw "Discord-Bot-Tokens duerfen nicht doppelt verwendet werden."
  }
  if ($seenClientIds.ContainsKey($clientId)) {
    throw "Discord-Client-IDs duerfen nicht doppelt verwendet werden."
  }
  $seenTokens[$token] = $true
  $seenClientIds[$clientId] = $true
  $configuredBots += $i
}

if ($configuredBots.Count -eq 0) {
  throw "Keine BOT_N Konfiguration in .env gefunden."
}

$commanderIndex = 1
if ($envMap.ContainsKey("COMMANDER_BOT_INDEX")) {
  $parsedCommander = 0
  $rawCommander = [string]$envMap["COMMANDER_BOT_INDEX"]
  if (-not ([int]::TryParse($rawCommander, [ref]$parsedCommander) -and $parsedCommander -ge 1)) {
    throw "COMMANDER_BOT_INDEX=$rawCommander ist ungueltig."
  }
  $commanderIndex = $parsedCommander
}

if ($configuredBots -notcontains $commanderIndex) {
  throw "COMMANDER_BOT_INDEX=$commanderIndex ist nicht vollstaendig mit BOT_N_TOKEN und BOT_N_CLIENT_ID konfiguriert."
}

$workerIndexes = @($configuredBots | Where-Object { $_ -ne $commanderIndex })
$profileNames = @()
$profiles = @()
foreach ($botIndex in $workerIndexes) {
  $profileNames += "worker-$botIndex"
  $profiles += "--profile"
  $profiles += "worker-$botIndex"
}

if ($profileNames.Count -gt 0) {
  $env:COMPOSE_PROFILES = $profileNames -join ","
} else {
  Remove-Item Env:COMPOSE_PROFILES -ErrorAction SilentlyContinue
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

function Get-SplitWorkerContainerIds {
  param([int]$WorkerIndex)

  $service = "omnifm-worker-$WorkerIndex"
  $inspectCommand = @("compose", "-f", $composeFile, "--profile", "worker-$WorkerIndex", "ps", "--all", "--quiet", $service)
  $containerIds = @(& docker @inspectCommand)
  if ($LASTEXITCODE -ne 0) {
    throw "Verwaister Worker konnte nicht sicher geprueft werden: $service"
  }

  return @($containerIds | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) })
}

function Remove-StaleSplitWorkers {
  $expectedWorkers = @($workerIndexes)

  foreach ($workerIndex in 1..20) {
    if ($expectedWorkers -contains $workerIndex) { continue }

    $service = "omnifm-worker-$workerIndex"
    $containerIds = @(Get-SplitWorkerContainerIds -WorkerIndex $workerIndex)
    if ($containerIds.Count -eq 0) { continue }

    Write-Host "Bereinige verwaisten Split-Worker: $service"
    # No --volumes: this may remove only the exact Compose worker container.
    $removeCommand = @("compose", "-f", $composeFile, "--profile", "worker-$workerIndex", "rm", "--stop", "--force", $service)
    & docker @removeCommand
    if ($LASTEXITCODE -ne 0) {
      throw "Verwaister Worker konnte nicht sicher entfernt werden: $service"
    }

    $remainingIds = @(Get-SplitWorkerContainerIds -WorkerIndex $workerIndex)
    if ($remainingIds.Count -gt 0) {
      throw "Verwaister Worker ist trotz Bereinigung weiterhin vorhanden: $service"
    }
  }
}

function Get-RunningComposeServices {
  $statusCommand = @("compose", "-f", $composeFile, "ps", "--services", "--filter", "status=running")
  $services = @(& docker @statusCommand)
  if ($LASTEXITCODE -ne 0) {
    throw "Aktive Compose-Services konnten nicht sicher geprueft werden."
  }

  return @($services | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) })
}

function Test-RunningCommanderRequiresStopBeforeSplitStart {
  $runningServices = @(Get-RunningComposeServices)
  if ($runningServices -notcontains "omnifm") {
    return $false
  }

  $identityCommand = @("compose", "-f", $composeFile, "exec", "-T", "omnifm", "sh", "-lc", 'printf "%s\t%s" "${BOT_PROCESS_ROLE:-}" "${COMMANDER_BOT_INDEX:-}"')
  $identityLines = @(& docker @identityCommand)
  if ($LASTEXITCODE -ne 0) {
    Write-Warning "Aktiver Commander konnte nicht gelesen werden; er wird vor dem Split-Start vorsorglich gestoppt."
    return $true
  }

  $identity = (($identityLines | ForEach-Object { [string]$_ }) -join "`n").Trim()
  $parts = $identity -split "`t", 2
  $runningRole = if ($parts.Count -ge 1) { $parts[0].Trim() } else { "" }
  $runningIndex = 0
  $validIndex = $parts.Count -eq 2 -and [int]::TryParse($parts[1].Trim(), [ref]$runningIndex) -and $runningIndex -ge 1

  if ($runningRole -ne "commander" -or -not $validIndex) {
    Write-Warning "Aktiver omnifm-Container ist kein bekannter Split-Commander; er wird vor dem Split-Start vorsorglich gestoppt."
    return $true
  }
  if ($runningIndex -ne $commanderIndex) {
    Write-Host "Commander-Wechsel BOT_$runningIndex -> BOT_${commanderIndex}: alter Commander wird vor den Workern gestoppt."
    return $true
  }

  return $false
}

function Stop-RunningCommanderForTopologyChange {
  $stopCommand = @("compose", "-f", $composeFile, "stop", "-t", "20", "omnifm")
  & docker @stopCommand
  if ($LASTEXITCODE -ne 0) {
    throw "Commander konnte vor dem Topologie-Wechsel nicht sauber gestoppt werden."
  }

  $remainingServices = @(Get-RunningComposeServices)
  if ($remainingServices -contains "omnifm") {
    throw "Commander ist trotz Stop-Anforderung noch aktiv. Split-Start wird nicht fortgesetzt."
  }
}

function Prepare-SplitTopologyBeforeStart {
  Remove-StaleSplitWorkers
  if (Test-RunningCommanderRequiresStopBeforeSplitStart) {
    Stop-RunningCommanderForTopologyChange
  }
}

Prepare-SplitTopologyBeforeStart

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
