# Installe Syntheo Desktop depuis les GitHub Releases (Windows x64).
#
#   irm https://raw.githubusercontent.com/WillIsback/syntheo-desktop/main/scripts/install.ps1 | iex
#
#   # Une release précise (pour tester une version donnée)
#   & ([scriptblock]::Create((irm https://raw.githubusercontent.com/WillIsback/syntheo-desktop/main/scripts/install.ps1))) -Version v0.3.0
#
# Options :
#   -Version <tag>   Release à installer (défaut : latest). Accepte vX.Y.Z.
#   -DownloadOnly    Télécharge et vérifie l'installeur sans l'exécuter.
#
# L'installeur NSIS n'est pas encore signé : Windows SmartScreen affiche un
# avertissement au premier lancement (Informations complémentaires > Exécuter
# quand même). Le script vérifie la somme SHA256 publiée dans la release.
param(
  [string]$Version = "latest",
  [switch]$DownloadOnly
)

$ErrorActionPreference = "Stop"
$Repo = "WillIsback/syntheo-desktop"

function Die([string]$Message) {
  Write-Host "erreur: $Message" -ForegroundColor Red
  # `throw` plutôt que `exit` : `irm … | iex` s'exécute dans la session courante,
  # et `exit` fermerait le terminal de l'utilisateur.
  throw $Message
}

# Windows PowerShell 5.1 default is TLS 1.0; GitHub needs 1.2+.
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$Headers = @{ "User-Agent" = "syntheo-install" }

$Architecture = $env:PROCESSOR_ARCHITECTURE
if ($Architecture -ne "AMD64") {
  Die "ce script ne gère que Windows x64 (détecté : $Architecture)"
}

# Résout le tag de la release.
if ($Version -eq "latest") {
  try {
    $Release = Invoke-RestMethod -UseBasicParsing -Headers $Headers -Uri "https://api.github.com/repos/$Repo/releases/latest"
  } catch {
    Die "aucune release publiée (ou accès GitHub impossible)"
  }
  $Tag = $Release.tag_name
} else {
  $Tag = $Version
}
$Tag = ($Tag -split "\?")[0]
$VersionNumber = $Tag -replace '^v', ''

$Asset = "Syntheo_${VersionNumber}_x64-setup.exe"
$BaseUrl = "https://github.com/$Repo/releases/download/$Tag"
$AssetUrl = "$BaseUrl/$Asset"
$SumsUrl = "$BaseUrl/SHA256SUMS-windows"

Write-Host "Syntheo Desktop $Tag (NSIS, x64)"

$DownloadDir = Join-Path $env:TEMP "syntheo-install"
New-Item -ItemType Directory -Force -Path $DownloadDir | Out-Null
$Target = Join-Path $DownloadDir $Asset

Write-Host "Téléchargement de $Asset..."
try {
  Invoke-WebRequest -UseBasicParsing -Headers $Headers -Uri $AssetUrl -OutFile $Target
} catch {
  Die "téléchargement impossible : $AssetUrl (cette release publie-t-elle bien un installeur x64 ?)"
}

# Vérifie la somme SHA256 si le manifeste de la release est disponible.
# Le téléchargement du manifeste est isolé : un manifeste absent ne doit pas
# masquer un échec de vérification.
$Sums = $null
try {
  $Sums = (Invoke-WebRequest -UseBasicParsing -Headers $Headers -Uri $SumsUrl).Content
} catch {
  # Manifeste absent : on continue, comme install.sh sur Linux.
}
if ($Sums) {
  $Expected = $null
  foreach ($Line in @($Sums -split "`n")) {
    $Fields = $Line.Trim() -split '\s+'
    if ($Fields.Count -ge 2 -and ($Fields[1] -eq $Asset -or $Fields[1] -eq "./$Asset")) {
      $Expected = $Fields[0].ToLower()
      break
    }
  }
  if ($Expected) {
    $Actual = (Get-FileHash -Algorithm SHA256 -Path $Target).Hash.ToLower()
    if ($Actual -ne $Expected) {
      Remove-Item -Force $Target
      Die "somme SHA256 invalide pour $Asset"
    }
    Write-Host "SHA256 vérifié."
  }
}

if ($DownloadOnly) {
  Write-Host "Téléchargé (non installé) : $Target"
  return
}

Write-Host "Installation..."
# NSIS : /S = installation silencieuse (portée utilisateur, pas d'élévation).
$Process = Start-Process -FilePath $Target -ArgumentList "/S" -Wait -PassThru
if ($Process.ExitCode -ne 0) {
  Die "l'installeur a échoué (code $($Process.ExitCode))"
}

Write-Host ""
Write-Host "Installé. Lancez Syntheo depuis le menu Démarrer (ou la barre des tâches)."
Write-Host "Paquet non signé : SmartScreen affiche un avertissement au premier lancement."
