<div align="center">

<h1>Syntheo Desktop</h1>

<p>
  <b>Le bloc-notes de réunion qui reste chez vous.</b>
  <br />
  Transcription en temps réel et comptes rendus structurés, avec les modèles
  open-weight de <i>votre</i> infrastructure. Aucun cloud, aucun audio conservé.
</p>

</div>

> **Statut** : en cours de construction. Le code de départ est celui d'Anarlog
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

## Démarrage rapide

Prérequis : Ubuntu 24.04 (ou équivalent Debian), Node.js ≥ 22.23 et
[rustup](https://rustup.rs) (la version de Rust est fixée par
`rust-toolchain.toml`).

### Développeurs

Ce bloc, exécuté tel quel depuis un dossier vide, installe les dépendances,
construit le paquet `.deb` et vérifie que l'application démarre. Il est rejoué à
l'identique par la CI (`ci-install`).

```bash
git clone https://github.com/WillIsback/syntheo-desktop.git
cd syntheo-desktop
bash scripts/setup-linux-tauri.sh
bash scripts/setup-linux-others.sh
sudo apt-get install -y xvfb
npm install -g pnpm@11.1.1
pnpm install --frozen-lockfile
pnpm -F ui build
POSTHOG_API_KEY=phc_disabled pnpm -F desktop tauri build --ci --bundles deb --config ./src-tauri/tauri.conf.syntheo.json
ls apps/desktop/src-tauri/target/release/bundle/deb/*.deb
# Vérification : l'application doit tenir 30 s sans planter (124 = arrêtée par timeout).
status=0; timeout 30 xvfb-run -a apps/desktop/src-tauri/target/release/syntheo || status=$?; [ "$status" -eq 124 ]
```

> `POSTHOG_API_KEY=phc_disabled` est une valeur factice exigée à la compilation
> par le code hérité ; la télémétrie est retirée dans le chantier « privacy »
> du plan, après quoi cette variable disparaîtra.

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
