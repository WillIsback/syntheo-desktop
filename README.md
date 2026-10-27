<div align="center">

<h1>Syntheo Desktop</h1>

<p>
  <b>Le bloc-notes de réunion qui reste chez vous.</b>
  <br />
  Transcription en temps réel et comptes rendus structurés, avec les modèles
  open-weight de <i>votre</i> infrastructure. Aucun cloud, aucun audio conservé.
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

Les installateurs graphiques (Windows, macOS, Linux) et les scripts
d'installation en une ligne arriveront avec la première release : voir
[#4](https://github.com/WillIsback/syntheo-desktop/issues/4).
En attendant, l'application se construit depuis les sources :
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
