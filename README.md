<div align="center">

<h1>Syntheo Desktop</h1>

<p>
  <b>Le bloc-notes de réunion qui reste chez vous.</b>
  <br />
  Transcription en temps réel et comptes rendus structurés, avec les modèles
  open-weight de <i>votre</i> infrastructure. Aucun cloud, aucun audio conservé.
</p>

<p>
  <a href="https://github.com/WillIsback/syntheo-desktop/releases/latest/download/Syntheo-windows-x64-setup.exe"><img alt="Télécharger pour Windows" src="https://img.shields.io/badge/Windows-t%C3%A9l%C3%A9charger-0078D4?logo=windows11&logoColor=white" /></a>
  <a href="https://github.com/WillIsback/syntheo-desktop/releases/latest/download/Syntheo-linux-x86_64.AppImage"><img alt="Télécharger pour Linux" src="https://img.shields.io/badge/Linux-t%C3%A9l%C3%A9charger-FCC624?logo=linux&logoColor=black" /></a>
  <a href="https://github.com/WillIsback/syntheo-desktop/releases/latest"><img alt="Signé par Azure Artifact Signing" src="https://img.shields.io/badge/code%20sign%C3%A9-Azure%20Artifact%20Signing-0078D4?logo=microsoftazure&logoColor=white" /></a>
  <a href="LICENSE"><img alt="Licence MIT" src="https://img.shields.io/badge/licence-MIT-green" /></a>
</p>

</div>

> **Statut** : en cours de construction. Le code de départ est celui d'Syntheo
> (voir [Origine](#origine)) ; la transformation en Syntheo Desktop suit le
> [plan de migration](docs/superpowers/specs/2026-10-24-syntheo-desktop-migration-design.md).

## Ce que fait Syntheo Desktop

- **Transcription en temps réel** du micro et de l'audio système, en français.
- **Comptes rendus** générés à partir de vos notes et du transcript, guidés par
  des **templates** (réunion générale, comité conformité / RGPD, point projet,
  standup… et un **générateur de templates** par IA).
- **Inférence on-premise uniquement** : l'application ne parle qu'aux endpoints
  que vous configurez, via les protocoles standard des moteurs open-weight :
  - ASR : OpenAI Realtime, vLLM Realtime (ex. Voxtral Mini 4B Realtime),
    NVIDIA NIM (WebSocket et gRPC), `/v1/audio/transcriptions` ;
  - LLM : API OpenAI-compatible (vLLM, SGLang, llama.cpp, Ollama, TGI, NIM).
- **Aucune conservation de l'audio** : il n'existe qu'en mémoire, le temps
  d'être transcrit. Seuls le transcript et la note sont enregistrés, localement.
- **Ni compte, ni abonnement, ni télémétrie.**

Données, flux réseau et responsabilités au regard du RGPD :
[docs/conformite/rgpd.md](docs/conformite/rgpd.md).

## Installation

### Linux — script en une ligne (AppImage)

```bash
curl -fsSL https://raw.githubusercontent.com/WillIsback/syntheo-desktop/main/scripts/install.sh | bash
```

Le script télécharge l'AppImage de la dernière release dans `~/.local/bin`,
vérifie sa somme SHA256, l'enregistre comme `Syntheo-<version>.AppImage` et
crée le lien `syntheo`.

Pour **tester une release précise** (toutes les versions publiées) :

```bash
curl -fsSL https://raw.githubusercontent.com/WillIsback/syntheo-desktop/main/scripts/install.sh | bash -s -- --version v0.1.1
```

> Sur **Arch / Omarchy**, l'AppImage nécessite FUSE 2 : `sudo pacman -S fuse2`.
> Plusieurs versions peuvent coexister (fichiers `Syntheo-<version>.AppImage`).

### Debian / Ubuntu

Le script installe aussi le paquet `.deb` :

```bash
curl -fsSL https://raw.githubusercontent.com/WillIsback/syntheo-desktop/main/scripts/install.sh | bash -s -- --deb
sudo apt install ~/.local/bin/Syntheo_*_amd64.deb   # ou : sudo apt install ./Syntheo_*.deb
```

### Windows

**Télécharger l'installeur** (recommandé si tu n'utilises pas le terminal) :
[`Syntheo-windows-x64-setup.exe`](https://github.com/WillIsback/syntheo-desktop/releases/latest/download/Syntheo-windows-x64-setup.exe)
— ou le `.msi` :
[`Syntheo-windows-x64.msi`](https://github.com/WillIsback/syntheo-desktop/releases/latest/download/Syntheo-windows-x64.msi).

L'installeur est **signé** (Azure Artifact Signing) : Windows l'attribue à
**William Derue**. SmartScreen peut encore afficher un avertissement sur les
premières versions, le temps que la réputation du binaire se construise.

**Script en une ligne** — télécharge, vérifie la somme SHA256
(`SHA256SUMS-windows`) et installe silencieusement (portée utilisateur, sans
élévation) :

```powershell
irm https://raw.githubusercontent.com/WillIsback/syntheo-desktop/main/scripts/install.ps1 | iex
```

Pour **installer une release précise** :

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/WillIsback/syntheo-desktop/main/scripts/install.ps1))) -Version v0.3.1
```

### Paquets

Les `.deb`, AppImage, `.msi` et `.exe` sont aussi téléchargeables depuis la page
[Releases](https://github.com/WillIsback/syntheo-desktop/releases) (chaque
release publie `SHA256SUMS` et `SHA256SUMS-windows`, ainsi qu'une attestation de
provenance vérifiable avec `gh attestation verify`).

### macOS

Les paquets macOS ne sont pas encore publiés. En attendant, l'application se
construit depuis les sources :
[CONTRIBUTING.md › Construire depuis les sources](CONTRIBUTING.md#construire-depuis-les-sources).

## Développement

- Desktop : `apps/desktop` (Tauri 2, React 19, TypeScript, Vite, Tailwind).
- Rust : `crates/` et `plugins/` (capture audio, adaptateurs STT, SQLite,
  templates Jinja des prompts).
- Contribution, conventions de commit et gates de CI :
  [CONTRIBUTING.md](CONTRIBUTING.md).

## Origine

Syntheo Desktop est un projet indépendant, dérivé d'**[Anarlog](https://github.com/fastrepl/anarlog)**
(Fastrepl, Inc., licence MIT), importé à la révision `a0d5bd0` du 2026-10-24
dans un nouveau dépôt. Merci à l'équipe Anarlog pour cette base open source.
Le détail de ce qui a été repris, retiré et modifié est dans
[NOTICE.md](NOTICE.md). Syntheo Desktop n'est ni affilié à Fastrepl ni soutenu
par Fastrepl.

Syntheo Desktop est le pendant poste de travail de **syntheo-web**.

## Licence

[MIT](LICENSE) : © 2026 William Derue (Syntheo Desktop), © 2023 Fastrepl, Inc. (code d'origine).
