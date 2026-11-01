# Désinstalle Syntheo Desktop sous Windows.
#
#   # Interactif : propose les deux modes
#   irm https://raw.githubusercontent.com/WillIsback/syntheo-desktop/main/scripts/uninstall.ps1 | iex
#
#   # Avec options (voir ce qui serait retiré, sans rien supprimer)
#   & ([scriptblock]::Create((irm https://raw.githubusercontent.com/WillIsback/syntheo-desktop/main/scripts/uninstall.ps1))) -Purge -DryRun
#
# Modes :
#   -KeepData   Désinstaller l'application : programme (installeur NSIS ou MSI),
#               lancement au démarrage et raccourcis. Vos réunions, réglages et
#               clés d'API sont conservés.
#   -Purge      Désinstallation complète : l'application, plus la base de
#               données (réunions, notes, transcriptions), les journaux, le
#               cache, la configuration et les clés d'API du Gestionnaire
#               d'identification.
#
# Options :
#   -DryRun     Liste ce qui serait retiré, sans rien supprimer.
#   -Yes        Ne demande pas de confirmation.
#
# Ne touche jamais : vos exports, la CLI `syntheo` installée par cargo, ni la
# configuration de vos agents (Claude, Codex, OpenCode).
param(
  [switch]$KeepData,
  [switch]$Purge,
  [switch]$DryRun,
  [switch]$Yes
)

$ErrorActionPreference = "Stop"
$KeyringService = "fr.willisback.syntheo.secure-store"
$Identifiers = @("fr.willisback.syntheo", "fr.willisback.syntheo.dev")
$RunKeys = @(
  "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run",
  "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run"
)

function Die([string]$Message) {
  Write-Host "erreur: $Message" -ForegroundColor Red
  # `throw` plutôt que `exit` : `irm … | iex` s'exécute dans la session
  # courante, et `exit` fermerait le terminal de l'utilisateur.
  throw $Message
}

if ($KeepData -and $Purge) { Die "choisissez -KeepData ou -Purge, pas les deux" }

$Mode = if ($Purge) { "purge" } elseif ($KeepData) { "keep-data" } else { $null }
if (-not $Mode) {
  Write-Host "Que voulez-vous désinstaller ?"
  Write-Host ""
  Write-Host "  1) L'application seulement : vos réunions, réglages et clés d'API sont conservés"
  Write-Host "     (utile pour réinstaller ou changer de version)."
  Write-Host "  2) Tout : l'application, plus vos réunions, notes, transcriptions, journaux,"
  Write-Host "     cache, configuration et clés d'API. Irréversible."
  Write-Host ""
  switch (Read-Host "Votre choix [1/2, Entrée pour annuler]") {
    "1" { $Mode = "keep-data" }
    "2" { $Mode = "purge" }
    default { Write-Host "Annulé."; return }
  }
}

# --- Inventaire ---
# Programmes installés : NSIS (portée utilisateur, HKCU) ou MSI (souvent HKLM).
$UninstallRoots = @(
  "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*",
  "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*",
  "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*"
)
$Programs = @(Get-ItemProperty -Path $UninstallRoots -ErrorAction SilentlyContinue |
  Where-Object { $_.DisplayName -match '^Syntheo( Dev)?$' -and $_.UninstallString })

$Autostart = @()
foreach ($Key in $RunKeys) {
  $Values = Get-ItemProperty -Path $Key -ErrorAction SilentlyContinue
  if ($Values) {
    foreach ($Name in @("Syntheo", "Syntheo Dev")) {
      if ($null -ne $Values.$Name) { $Autostart += [pscustomobject]@{ Key = $Key; Name = $Name } }
    }
  }
}

$DataPaths = @()
$Credentials = @()
if ($Mode -eq "purge") {
  $Candidates = @(Join-Path $env:APPDATA "syntheo")
  foreach ($Id in $Identifiers) {
    $Candidates += Join-Path $env:APPDATA $Id
    $Candidates += Join-Path $env:LOCALAPPDATA $Id
  }
  $DataPaths = @($Candidates | Where-Object { Test-Path -LiteralPath $_ })

  # Clés d'API (crate keyring) : toute cible du Gestionnaire d'identification
  # qui contient le nom de service de Syntheo.
  $Credentials = @(cmdkey /list 2>$null |
    Select-String -Pattern "target=(\S*$([regex]::Escape($KeyringService))\S*)" |
    ForEach-Object { $_.Matches[0].Groups[1].Value })
}

function Get-Size([string]$Path) {
  $Bytes = (Get-ChildItem -LiteralPath $Path -Recurse -Force -File -ErrorAction SilentlyContinue |
    Measure-Object -Property Length -Sum).Sum
  if (-not $Bytes) { return "vide" }
  return "{0:N1} Mo" -f ($Bytes / 1MB)
}

# --- Récapitulatif ---
Write-Host ""
Write-Host ("Mode : " + $(if ($Mode -eq "purge") { "désinstallation complète" } else { "application seulement (données conservées)" }))
if ($Programs.Count -eq 0 -and $Autostart.Count -eq 0 -and $DataPaths.Count -eq 0 -and $Credentials.Count -eq 0) {
  Write-Host "Rien à retirer : Syntheo ne semble pas installé pour cet utilisateur."
  return
}
foreach ($Program in $Programs) { Write-Host "  programme  $($Program.DisplayName) $($Program.DisplayVersion)" }
foreach ($Entry in $Autostart) { Write-Host "  démarrage  $($Entry.Name) ($($Entry.Key))" }
foreach ($Path in $DataPaths) { Write-Host "  données    $Path ($(Get-Size $Path))" }
if ($Credentials.Count -gt 0) { Write-Host "  clés d'API $($Credentials.Count) entrée(s) du Gestionnaire d'identification" }

if ($DryRun) {
  Write-Host ""
  Write-Host "Simulation (-DryRun) : rien n'a été supprimé."
  return
}

if (-not $Yes) {
  Write-Host ""
  if ($Mode -eq "purge") {
    if ((Read-Host "Cette suppression est irréversible. Tapez EFFACER pour confirmer") -cne "EFFACER") {
      Write-Host "Annulé."; return
    }
  } elseif ((Read-Host "Continuer ? [o/N]") -notmatch '^[oOyY]$') {
    Write-Host "Annulé."; return
  }
}

# --- Désinstallation ---
Get-Process -Name "syntheo", "Syntheo", "Syntheo Dev" -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 1

foreach ($Program in $Programs) {
  Write-Host "Désinstallation de $($Program.DisplayName)..."
  if ($Program.PSChildName -match '^\{[0-9A-Fa-f-]+\}$') {
    # MSI : msiexec demande l'élévation si le produit est installé pour la machine.
    $Process = Start-Process -FilePath "msiexec.exe" -ArgumentList "/x", $Program.PSChildName, "/qn", "/norestart" -Wait -PassThru
  } else {
    # NSIS : /S = désinstallation silencieuse.
    $Uninstaller = ($Program.UninstallString -replace '^"([^"]+)".*$', '$1')
    $Process = Start-Process -FilePath $Uninstaller -ArgumentList "/S" -Wait -PassThru
  }
  if ($Process.ExitCode -ne 0) {
    Write-Host "  le désinstalleur a renvoyé le code $($Process.ExitCode) : vérifiez Paramètres > Applications." -ForegroundColor Yellow
  }
}

foreach ($Entry in $Autostart) {
  Remove-ItemProperty -Path $Entry.Key -Name $Entry.Name -ErrorAction SilentlyContinue
}
foreach ($Path in $DataPaths) {
  Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction SilentlyContinue
  if (Test-Path -LiteralPath $Path) {
    Write-Host "  impossible de supprimer entièrement $Path (fichier ouvert ?)" -ForegroundColor Yellow
  }
}
foreach ($Target in $Credentials) {
  cmdkey "/delete:$Target" | Out-Null
}

Write-Host ""
Write-Host "Syntheo est désinstallé."
if ($Mode -eq "keep-data") {
  Write-Host "Vos données sont conservées dans $(Join-Path $env:APPDATA 'syntheo') : une réinstallation les retrouvera."
}
Write-Host "Non touchés : vos exports, la CLI installée par cargo, la configuration de vos agents."
Write-Host "Si vous aviez relié Claude, Codex ou OpenCode à Syntheo, retirez-les dans leurs réglages."
