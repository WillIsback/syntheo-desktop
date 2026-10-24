# Syntheo Desktop — plan de migration (fork Anarlog)

Date : 2026-10-24 · Statut : proposé

## Intention

- **Syntheo** (Next.js, dépôt `syntheo-mvp`) devient **syntheo-web**.
- Un fork d'**Anarlog** (`fastrepl/anarlog`, MIT hors `enterprise/`) devient **Syntheo Desktop**, sous l'identité Syntheo.
- On garde **toute la mécanique d'Anarlog** : capture micro et audio système, transcription temps réel, fusion des notes avec le transcript (enhance), templates, stockage local SQLite.
- On y apporte ce qui fait Syntheo : la marque et l'UI, les templates et leur **générateur IA**, le français, la gestion des locuteurs et un rappel d'information des participants.
- Aucun paywall, aucune télémétrie vers Fastrepl.
- **Uniquement des providers custom on-premise** : la transcription et le résumé passent exclusivement par des API standard de moteurs d'inférence open-weight (OpenAI-compatible, NVIDIA NIM), pointées vers l'infra de l'utilisateur, par exemple Voxtral Mini 4B Realtime ou Nemotron ASR, et un LLM servi par vLLM. **Tous les adaptateurs vers des providers cloud sont retirés.**

## Principe directeur : migrer des idées, pas du code

Les deux stacks ne se recouvrent presque pas. Syntheo, c'est Next 16, Auth.js, Postgres avec RLS, S3 et WhisperX en batch. Anarlog, c'est Tauri 2, React 19, TanStack, SQLite, et des prompts Jinja en Rust.

Dans les faits, on ne porte que trois types d'éléments : des **données** (tokens, logo, templates), des **prompts**, et quelques **composants** réécrits avec `@anlg/ui`. Tout le reste de Syntheo est remplacé par l'équivalent Anarlog, souvent meilleur.

## Inventaire : quoi migrer, quoi abandonner

| Élément Syntheo                                            | Décision                                                                          | Destination dans le fork                                                                                                                                                              |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Logo (`public/favicon/icon.svg`, bleu `#1A73E8`, 3 barres) | **Migrer**                                                                        | `src-tauri/icons/syntheo/` (`tauri icon`), onboarding, tray                                                                                                                           |
| Tokens `--syn-*` (`src/components/tokens.css`)             | **Migrer** (conversion en HSL)                                                    | `packages/design-system/src/tokens.css` (`:root`) plus un thème sombre **à créer** (Syntheo n'en a pas)                                                                               |
| Palette des locuteurs s1–s4                                | **Migrer**                                                                        | couleurs des segments de locuteurs (`stt/speaker-context.ts`, timeline)                                                                                                               |
| 4 templates intégrés (`src/data/sessions.ts`)              | **Migrer** : Markdown `#` → `sectionsJson`                                        | nouvelle migration `crates/db-app/migrations/2026xxxx_syntheo_templates.sql`, épinglés                                                                                                |
| Format Markdown des templates (`# Titre` + consigne)       | **Migrer** comme format d'import et d'export                                      | parseur `markdown ⇄ sections` dans `apps/desktop/src/templates/`                                                                                                                      |
| Générateur de templates (`/api/templates/generate`)        | **Migrer et améliorer**                                                           | nouveau module TS côté desktop (voir Phase 4)                                                                                                                                         |
| Prompt « compte rendu » en JSON (`llm.service.ts`)         | **Abandonner**                                                                    | l'enhance d'Anarlog (streaming, notes + transcript, validateur et retry) le remplace ; on n'en reprend que le ton FR                                                                  |
| Renommage des locuteurs                                    | **Migrer le comportement**                                                        | vérifier l'existant Anarlog et compléter si besoin                                                                                                                                    |
| Consentement RGPD en 2 étapes (`ConsentDialog`)            | **Remplacer**                                                                     | rappel « informez les participants » au démarrage d'une capture, désactivable ; conformité documentée dans `docs/conformite/rgpd.md` (voir « RGPD »)                                  |
| Export DOCX (`src/lib/session-export.ts`, lib `docx`)      | **Migrer si absent** (Anarlog fait du Markdown, `automations/markdown-export.ts`) | menu d'export de la note                                                                                                                                                              |
| Export JSON « mes données »                                | Optionnel                                                                         | —                                                                                                                                                                                     |
| Auth.js, Postgres/RLS, Drizzle, S3/MinIO, upload présigné  | **Abandonner**                                                                    | données 100 % locales (SQLite Anarlog)                                                                                                                                                |
| WhisperX batch + polling (API maison asynchrone)           | **Abandonner**                                                                    | STT temps réel via un provider custom ; import de fichier audio = mode batch Anarlog (`listener2-core`, `recording_import_jobs`) vers un endpoint standard `/v1/audio/transcriptions` |
| Stockage audio S3/MinIO (`${userId}/${sessionId}`)         | **Abandonner**                                                                    | **aucune conservation de l'audio** (voir « Règle audio »)                                                                                                                             |
| Composants Next (`SessionDetail`, `Sidebar`…)              | **Ne pas porter**                                                                 | l'UI d'Anarlog reste, seulement restylée                                                                                                                                              |
| Mock data, `REPORT_LOOKUP`                                 | Abandonner                                                                        | —                                                                                                                                                                                     |

## Projet, identité et dépôt

- **Workspace** : `/home/will/work/syntheo-desktop`.
- **Nouveau dépôt Git, sans lien avec l'original** : le code est importé depuis l'instantané d'Anarlog `a0d5bd049ea883e04dc74db31d1ef58c4c06faab` (2026-10-24), dans un **historique neuf**. On ne reprend ni les commits ni les contributeurs d'Anarlog, et il n'y a pas de remote `upstream`. Le projet ne sera jamais fusionné vers Anarlog.
- **Dépôt** : `github.com/WillIsback/syntheo-desktop` (Actions, CodeQL, Releases), avec un miroir Forgejo `wderue/syntheo-desktop`, sur le même modèle que le projet OC P5.
- **Identité propre** : nom **Syntheo Desktop**, identifiant `fr.willisback.syntheo`, logo et palette Syntheo, README et docs en français.
- **Attribution (obligatoire, licence MIT)** : `LICENSE` conserve la notice `Copyright (c) 2023-present Fastrepl, Inc.` et ajoute celle de Syntheo Desktop. `NOTICE.md` indique la source (dépôt, révision importée, date) et ce qui a été retiré. Le README a une section « Origine ». Anarlog est une marque de Fastrepl : on ne s'en sert que pour citer la source.
- **Retirés dès l'import** : `enterprise/`, `LICENSE.enterprise` et `LICENSING.md` (licence commerciale, que nous n'avons pas le droit de redistribuer), les CI et l'outillage d'exploitation Fastrepl (`.github/workflows`, `.github/{scripts,reports,plugin}`, `bitrise.yml`, `render.yaml`, `openstatus.*`, `RELEASE_AUDIT.md`, `OBSERVABILITY.md`). Les applications hors périmètre (`apps/web`, `apps/mobile`, `apps/api`, `apps/stripe` et leurs packages exclusifs) sont retirées dans le chantier 04d, une fois le graphe de dépendances vérifié.

## Suivi d'Anarlog : veille, pas synchronisation

Le projet suit sa propre route. Aucune synchronisation automatique n'est prévue : pas de merge, pas de rebase.

- **Veille** : de temps en temps, consulter les nouveautés d'Anarlog dans un clone de référence jetable, hors du dépôt. Un correctif utile (sécurité, bug d'un adaptateur conservé) est **réécrit ou porté à la main** dans une PR normale `fix: …`, avec la mention « porté depuis Anarlog <sha> (MIT) » dans le corps de la PR et une ligne dans `NOTICE.md`.
- Les chantiers sont découpés en PR thématiques, dans cet ordre d'implémentation :

| #   | PR (chantier)               | Contenu                                                                                                                                                                                                                                                                          |
| --- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 01  | `brand: constantes`         | `apps/desktop/src/brand.ts` + `crates/brand` (nom, identifiant, hôtes, URL du flux de templates), branchés sur les endroits codés en dur : `storage/global.rs`, `tray_version.rs`, `startup.rs`, `embedded_cli.rs`, `windows/v1.rs`, `floating_bar.rs`, `resource-list/hooks.ts` |
| 02  | `brand: tauri overlay`      | `src-tauri/tauri.conf.syntheo.json` (productName `Syntheo`, identifier `fr.willisback.syntheo`, schéma deep-link `syntheo`, updater désactivé), icônes, `index.html`                                                                                                             |
| 03  | `unlock: billing`           | `deriveBillingInfo()` force `isPro`/`isPaid`/`plan: "pro"` ; suppression des dialogues d'essai et d'upgrade dans `auth/billing.tsx`                                                                                                                                              |
| 04  | `privacy: no phone-home`    | `plugins/analytics` : le `env!("POSTHOG_API_KEY")` + assert devient `option_env!` (télémétrie off) ; Sentry off ; Supabase sans variables d'env ; liens `anarlog.so` neutralisés                                                                                                 |
| 04b | `providers: on-prem only`   | suppression des adaptateurs cloud STT et LLM (Rust et TS) ; voir Phase 5                                                                                                                                                                                                         |
| 04c | `privacy: no audio at rest` | recorder désactivé, rétention figée à `none`, lecteur retiré ; voir « Règle audio »                                                                                                                                                                                              |
| 04d | `cloud: no integrations`    | retrait des intégrations cloud hors IA ; voir « Intégrations cloud »                                                                                                                                                                                                             |
| 05  | `theme: syntheo`            | tokens, `styles/globals.css`, `dark-theme.css`, polices                                                                                                                                                                                                                          |
| 06  | `i18n: fr`                  | locale par défaut `fr`, traduction de `fr/messages.po` (1 603 chaînes)                                                                                                                                                                                                           |
| 07  | `templates: syntheo`        | migration SQL des 4 templates, import/export Markdown                                                                                                                                                                                                                            |
| 08  | `templates: generator`      | générateur IA                                                                                                                                                                                                                                                                    |
| 09  | `providers: custom`         | adaptateurs vLLM realtime et NIM gRPC, préréglages on-premise                                                                                                                                                                                                                    |
| 10  | `features: rappel, docx`    | rappel d'information des participants + export DOCX                                                                                                                                                                                                                              |

**Astuce (chantier 06)** : les chaînes affichées mentionnent « Anarlog » dans environ 580 fichiers source. On écrit « Syntheo » dans les **traductions françaises** et l'app est forcée en `fr`, et, puisqu'aucune synchronisation n'est prévue, on remplace aussi « Anarlog » par « Syntheo » directement dans les sources et les msgid anglais (codemod `scripts/rebrand.sh`, puis `lingui extract`).

## Intégrations cloud hors IA : retirées (chantier 04d)

Syntheo Desktop ne parle qu'aux endpoints d'inférence de l'utilisateur. Tout le reste est retiré du code, pas seulement masqué (liste à confirmer par `cargo tree` et `pnpm why` pendant l'implémentation) :

| Domaine                       | Retiré                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Compte, abonnement, sync      | `plugins/auth`, `plugins/attachment-sync`, `plugins/fs-sync` (si orienté cloud), `crates/{supabase-auth,supabase-storage,cloudsync,db-sync,attachment-sync-core,api-subscription,api-sync,api-cloud,e2ee,s3}`, `apps/desktop/src/{auth,billing,attachment-sync,cloud-api,session-sharing,shared-notes,resource-sharing,enterprise-capture}`, `settings/{sync,team,referrals,developers/cloud-api}`, `settings/plan-gate.tsx` |
| Agendas, contacts, CRM        | `crates/{google-calendar,outlook-calendar,api-calendar,calendar,calendar-interface,api-crm,crm}`, `plugins/calendar`, `apps/desktop/src/{calendar,crm,contacts}` (contacts réduit aux participants saisis localement), étape d'onboarding « calendrier »                                                                                                                                                                     |
| Messagerie, mail, tickets     | `crates/{slack-web,google-mail,api-mail,api-messenger,linear,github-issues,api-ticket,ticket-interface,apple-todo}`, `plugins/{messenger,todo}`, `settings/todo`                                                                                                                                                                                                                                                             |
| Imports de réunions cloud     | `crates/{zoom,api-zoom,api-meeting-import,meeting-import,nango,api-nango}` ; l'import de **fichiers** locaux est conservé                                                                                                                                                                                                                                                                                                    |
| Recherche web, enrichissement | `crates/{exa,jina,api-research,notion,api-notion,loops}`                                                                                                                                                                                                                                                                                                                                                                     |
| Mises à jour Fastrepl         | `plugins/updater2` pointé vers `desktop.anarlog.so` : retiré. Les mises à jour se font via les GitHub Releases (et AUR)                                                                                                                                                                                                                                                                                                      |
| Télémétrie                    | `plugins/analytics`, Sentry Rust et JS, `crates/observability` si orienté cloud                                                                                                                                                                                                                                                                                                                                              |

**Conservé (local)** : SQLite, recherche plein texte (`tantivy`), dossiers, export, dictée, raccourcis, notifications, détection de réunion (`detect`), MCP local (`plugins/mcp`, `local-api`), et Apple Calendar (EventKit, local à macOS, sans effet sur Linux).

**Fait quand** : une capture réseau (`tcpdump`/`ss`) pendant une session complète ne montre que les endpoints d'inférence configurés.

## Phases

### Phase 0 — Renommer Syntheo en syntheo-web (≈ ½ j)

- Renommer le dépôt GitHub `syntheo-mvp` en `syntheo-web` (GitHub redirige l'ancien nom) et mettre à jour `git remote`.
- `package.json` : `"name": "syntheo-web"`. Mettre à jour le README.
- Miroir public : renommer `WillIsback/Syntheo` en `syntheo-web` et mettre à jour `scripts/publish.sh:6`.
- **Ne pas renommer** la base, l'utilisateur et le volume Postgres `syntheo`, ni le bucket `syntheo-uploads` : aucune valeur ajoutée, et risque de casser la prod et les sauvegardes.
- Au passage : corriger `src/app/layout.tsx` (« Create Next App », `lang="en"` → `fr`).
- **Fait quand** : le déploiement Vercel est vert sous le nouveau nom.

### Phase 1 — Import et build vierge (≈ 1 j)

- **Fait** : import de l'instantané `a0d5bd0` dans un nouveau dépôt, retraits de licence, identité (README, NOTICE, LICENSE) et échafaudage CI/CD.
- Image CI Forgejo Linux : dépendances apt de `scripts/setup-linux-tauri.sh`, Rust 1.94, pnpm 11, Node 22.
- Build `pnpm -F desktop tauri build --bundles appimage,deb` **sans modification**, après avoir appliqué le commit 04 (le build release échoue sinon à cause de PostHog).
- **Fait quand** : l'AppImage démarre sur willomarchy, onboarding passé sans compte.

### Phase 2 — Débrancher Fastrepl (couches 01-04, ≈ 2 j)

- **Fait quand** : `rg -i 'anarlog\.so|posthog|supabase'` sur le trafic réseau (capture pendant une session complète) ne montre plus que les hôtes de l'infra perso.
- **Fait quand** : dictée, dictionnaire et automatisations fonctionnent sans le moindre toast « Pro ».
- **Fait quand** : le dossier de données est `~/.local/share/syntheo`, distinct de celui d'Anarlog.

### Phase 3 — Identité Syntheo (couches 02, 05, 06, ≈ 3 j)

- Conversion des tokens `--syn-*` vers les variables HSL du design system : `--primary` = `#1a73e8`, fond `#f8f9fa`, bordures `#e0e0e0`, textes `#202124`/`#5f6368`/`#9aa0a6`, rayons 6-12.
- Création d'une version sombre dérivée (même teinte de bleu, surfaces neutres).
- Police : en choisir **une**, car Syntheo est incohérent (Google Sans dans les tokens, Geist chargée, Arial dans le body). Choix proposé : Inter ou Geist, embarquée localement.
- Traduction FR : pré-remplissage automatique de `messages.po` par le vLLM du DGX (script batch, glossaire « note », « compte rendu », « modèle »…), puis relecture des écrans principaux. « Anarlog »/« Char »/« Hyprnote » deviennent « Syntheo ».
- Langue de l'enhance : `{{ language }}` fixé à français par défaut.
- **Fait quand** : aucune mention d'Anarlog dans l'UI en `fr` sur onboarding, session, templates et réglages ; les captures d'écran rappellent Syntheo.

### Phase 4 — Templates et générateur (couches 07-08, ≈ 3 j)

**Comment Anarlog utilise un template.** Un template n'est pas un fichier Jinja : c'est une ligne SQLite (`templates.sections_json`). La macro Jinja `template_numbered` (`crates/template-app/assets/_macros.jinja`) l'injecte dans le prompt d'enhance sous forme de sections numérotées. « Adapter au format Anarlog » revient donc à produire ces lignes. C'est fait : **`2026-10-24-syntheo-desktop-templates-fr.sql`** (à côté de ce document), à copier en `crates/db-app/migrations/20261024120000_syntheo_templates_fr.sql`. Il a été validé dans SQLite sur le schéma réel (21 templates, JSON valides, plus aucun libellé anglais) :

- les **17 templates Anarlog traduits en FR** (`UPDATE` par id, titre, description, catégorie, cibles et sections) ;
- les **4 templates Syntheo** convertis et épinglés en tête (`syntheo-general`, `-compliance`, `-project`, `-standup`), avec des icônes Lucide aux couleurs Syntheo.

Les prompts d'enhance (`enhance.*.jinja`) restent en anglais avec `{{ language }}` = français ; les traduire est optionnel.

**Conversion à la volée.** Le format Syntheo `# Titre\nconsigne` correspond exactement au modèle Anarlog `sectionsJson: [{title, description}]`. Parseur :

- une ligne `^#+\s*(.+)` ouvre une section ;
- les lignes suivantes, une fois trimées, forment la `description`.

Le même parseur sert à l'**import** (coller un template Syntheo) et à l'**export** (`sections → markdown`).

**Templates intégrés.**

- Le flux « web templates » (`https://anarlog.so/api/templates`) est désactivé, ou redirigé vers syntheo-web en Phase 7.

**Générateur** (`apps/desktop/src/templates/generator.ts` + bouton « ✨ Générer avec IA » dans `template-form.tsx`) :

- Il utilise **le LLM configuré par l'utilisateur** via `useLLMConnection` (le vLLM du DGX par défaut), donc aucun serveur requis.
- `generateObject` (AI SDK) avec un schéma zod : `{ title, description, category, icon, sections: [{title, description}] (3..6) }`. C'est mieux que Syntheo, qui parse du texte libre et ne remplit ni le nom ni l'icône.
- Le prompt système reprend celui de Syntheo (`TEMPLATE_GEN_SYSTEM_PROMPT`), adapté au format sections.
- Entrée : description libre. Option : « à partir d'une note existante », en réutilisant l'idée de `auto-format-inference.ts`.
- Le résultat **pré-remplit** le formulaire et l'utilisateur valide, comme dans Syntheo. Repli si le modèle ne gère pas le JSON structuré : génération Markdown, puis le parseur ci-dessus.
- **Fait quand** : « comité de pilotage mensuel d'un projet SI » produit un template de 3 à 6 sections avec titre et icône, utilisable directement dans l'enhance ; tests unitaires du parseur et du schéma.

### Phase 5 — Providers on-premise uniquement (couches 04b et 09, ≈ 5 j)

**Principe.** L'app ne connaît plus de marques de providers, seulement des **protocoles standard** de moteurs d'inférence open-weight. L'utilisateur saisit une URL de base, une clé facultative et un modèle (lu dans `/v1/models` quand le protocole le permet).

**Protocoles conservés ou ajoutés.**

| Usage                           | Protocole                                                              | Serveurs visés                                                                                   | Code Anarlog                                                                                                                                                                                                                                                                       |
| ------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| STT temps réel                  | OpenAI Realtime (WebSocket `/v1/realtime?intent=transcription`)        | serveurs qui implémentent le protocole OpenAI                                                    | `adapter/openai` (live), **conservé**, rendu générique (URL et modèle libres)                                                                                                                                                                                                      |
| STT temps réel                  | **vLLM Realtime** (WebSocket `/v1/realtime`, PCM16 16 kHz en base64)   | **Voxtral Mini 4B Realtime** (`vllm serve mistralai/Voxtral-Mini-4B-Realtime-2602`, vLLM ≥ 0.20) | **à vérifier puis à créer** : l'adaptateur OpenAI attend les événements `conversation.item.input_audio_transcription.*`, alors que vLLM a sa propre variante. Spike en début de phase ; si les événements diffèrent, nouvel adaptateur `vllm_realtime` calqué sur `openai/live.rs` |
| STT temps réel                  | NVIDIA NIM / Riva **WebSocket**                                        | Nemotron ASR (DGX, port 9000, via `realtime-shim`)                                               | `adapter/nvidia.rs`, **conservé**                                                                                                                                                                                                                                                  |
| STT temps réel                  | NVIDIA NIM / Riva **gRPC** (`StreamingRecognize`)                      | Nemotron ASR NIM, port 50051, sans shim                                                          | **à créer** : nouvel adaptateur `nvidia_grpc` (tonic + protos Riva)                                                                                                                                                                                                                |
| STT batch (import de fichier)   | OpenAI `/v1/audio/transcriptions`                                      | vLLM (Voxtral, Whisper), speaches / faster-whisper-server                                        | `openai_compatible_batch.rs`, **conservé**                                                                                                                                                                                                                                         |
| Diarisation                     | à la volée seulement (canaux, diarisation renvoyée par le serveur STT) | —                                                                                                | pyannote local **retiré** (il relit l'audio, incompatible avec la règle audio)                                                                                                                                                                                                     |
| LLM (enhance, chat, générateur) | OpenAI `/v1/chat/completions` (streaming, outils)                      | vLLM, SGLang, llama.cpp server, Ollama, LM Studio, TGI, NIM LLM                                  | provider `custom` (`createOpenAICompatible`), **conservé, seul provider**                                                                                                                                                                                                          |

**Retirés.**

- **STT** : `crates/owhisper-client/src/adapter/` est réduit à `openai/`, `nvidia.rs`, `openai_compatible_batch.rs` et l'outillage commun (`http`, `parsing`, `segment`, `url_builder`, `language`). Sont retirés les 37 autres adaptateurs et leurs variantes d'`AdapterKind` (Deepgram, AssemblyAI, Soniox, Speechmatics, Gladia, ElevenLabs, Mistral cloud, Groq, Azure, Google, AWS, pyannote cloud, `anarlog`…). On retire aussi les crates qui ne servent qu'à eux (`soniox`, `pyannote-cloud`, `api-pyannote`, `transcribe-proxy`, `llm-proxy`…, à confirmer par `cargo tree`).
- **LLM** : `settings/ai/llm/shared.tsx` est réduit au provider `custom`. Sont retirés les 33 autres (`anarlog`, claude, chatgpt, copilot, openrouter, groq, mistral, `apple_foundation`…) et leurs dépendances `@ai-sdk/*`.
- **Inférence embarquée** (`local-stt`, whisper.cpp, Soniqo, Apple Speech, `local-llm-core`) : retirée. Tout passe par une API, et ces moteurs étaient de toute façon réservés à macOS.
- `settings/ai/stt/shared.tsx` est réduit aux protocoles du tableau ci-dessus.

**Préréglages fournis** (modifiables, clés saisies dans l'app, **jamais compilées** dans le binaire) :

- STT : « Nemotron ASR (NIM, WebSocket) » → `https://spark-787d-1.tail6cba9f.ts.net/v1/realtime` ; « Voxtral Realtime (vLLM) » → URL à renseigner.
- LLM : « vLLM » → `https://spark-787d-1.tail6cba9f.ts.net/v1` ; modèle non épinglé, lu dans `/v1/models` (cohérent avec `sync-model`).

**Suppression franche.** Les modules retirés sont supprimés du code, avec leurs dépendances (`cargo machete` / `knip` pour vérifier qu'il ne reste aucun résidu).

**Fait quand** :

- `rg -il 'deepgram|assemblyai|soniox|openrouter|anthropic' apps/desktop/src crates/owhisper-client` ne renvoie plus rien (hors tests supprimés) ;
- une réunion de 30 min (audio système et micro) donne une transcription FR en direct avec **chacun** des trois protocoles temps réel, puis une note enhancée avec un template Syntheo via vLLM ;
- un fichier audio importé est transcrit via `/v1/audio/transcriptions`.

### Règle audio : zéro conservation (couche 04c `privacy: no audio at rest`, ≈ 2 j)

**Règle** : l'audio n'est jamais conservé. Il ne vit qu'en mémoire, le temps d'être envoyé à l'endpoint STT. Seuls le transcript et la note sont persistés.

**Constat dans Anarlog** (le comportement observé, « après un échec, l'audio est proposé en lecture et en retranscription batch », vient de là) :

- réglage `audio_retention` avec les valeurs `none` / `oneDay` / `threeDays` / `oneWeek` / `oneMonth` / `forever`, **`forever` par défaut** (`apps/desktop/src/settings/general/index.tsx:192`, `plugins/transcription/src/audio_retention.rs`) ;
- pendant la capture, l'acteur recorder écrit **toujours** sur disque : morceaux dans `<session>/audio-recovery/` (`crates/listener-core/src/actors/recorder/chunks.rs`), puis `<session>/audio.mp3` ;
- avec `retain_audio = false`, le fichier est écrit puis supprimé à l'arrêt (marqueur `.delete-audio-on-stop`, `cleanup_interrupted_audio` au démarrage après un crash) : l'audio passe donc quand même par le disque ;
- `retain_audio` vaut `true` par défaut (`session/supervisor/children.rs:109`) ;
- c'est cet audio que réutilisent la reprise après un échec STT (`apps/desktop/src/stt/capture-audio-recovery.ts`), le batch (`useRunBatch.ts`) et le lecteur (`audio-player/`).

**Changements** :

1. **Recorder désactivé** : l'acteur recorder n'est plus démarré par le superviseur de session (`children.rs`). L'audio va du capteur (micro et système) à l'adaptateur STT, sans écriture disque ni `audio-recovery/`. `retain_audio` est forcé à `false` partout (`children.rs`, `capture_markers.rs`, `api.rs`).
2. **Réglage retiré** : `audio_retention` est figé à `none` et retiré de l'UI. Le balayage `audio_retention` reste actif comme filet de sécurité.
3. **Échec STT** : on emprunte le chemin `!retainAudio` déjà prévu par Anarlog (`capture-audio-recovery.ts` → `markGap()`). Le transcript affiche un **trou daté** (« transcription interrompue 14:32–14:35 ») et l'app tente de se reconnecter à l'endpoint. Aucune proposition de batch ni de lecture.
4. **Lecteur audio et vitesse de lecture retirés** (`audio-player/`) : il n'y a rien à relire.
5. **Import de fichier** : le fichier fourni par l'utilisateur est lu et streamé vers `/v1/audio/transcriptions` depuis son emplacement d'origine, **sans copie** dans le dossier de données. À vérifier dans `recording_import_jobs` : s'il copie le fichier, supprimer cette copie.
6. **Diarisation** : uniquement à la volée (canal micro vs système, plus la diarisation renvoyée par le serveur STT si elle existe). Toute diarisation post-session qui relit l'audio (pyannote local) disparaît avec l'audio : pyannote local est donc **retiré** lui aussi.

**Fait quand** :

- pendant et après une réunion de 30 min, `find ~/.local/share/syntheo -newer <marqueur> -type f \( -name '*.mp3' -o -name '*.wav' -o -name '*.part' -o -path '*audio-recovery*' \)` ne renvoie rien ;
- en coupant l'endpoint STT au milieu d'une réunion, on obtient un trou daté dans le transcript et aucune offre de batch ;
- un test Rust vérifie que le superviseur ne crée aucun fichier audio dans le dossier de session.

### Phase 6 — Fonctions Syntheo restantes (couche 10, ≈ 2 j)

- **Rappel d'information** : au démarrage d'une capture, un rappel non bloquant « Pensez à informer les participants de la transcription » (toast ou bandeau), désactivable dans les réglages (`capture_reminder_enabled`, activé par défaut). Pas de consentement mémorisé : rien n'est collecté par l'éditeur.
- **Export DOCX** : vérifier l'existant Anarlog. Sinon, porter `session-export.ts` (lib `docx`, import dynamique) dans le menu d'export.
- **Locuteurs** : vérifier le renommage et la persistance dans Anarlog ; appliquer la palette s1-s4.

### Phase 7 (optionnelle) — Pont syntheo-web ⇄ desktop

Le desktop sait déjà récupérer des « web templates » sur une URL (`resource-list/hooks.ts`, format `WebTemplate`). syntheo-web peut exposer `GET /api/templates/feed` au format `WebTemplate`. Les templates créés sur le web apparaissent alors dans le desktop, avec un seul catalogue et deux clients.

## RGPD : conformité documentée, pas de dispositif côté éditeur

Décidé le 2026-10-24. Syntheo Desktop n'a ni serveur, ni base centrale, ni compte, ni télémétrie, et ne conserve jamais l'audio : l'éditeur n'accède à aucune donnée et n'est pas responsable de traitement. Le dispositif de syntheo-web (consentement en deux étapes, registre, hébergement) n'est pas repris.

Ce qui reste et doit être documenté :

- les transcripts et notes sont des données personnelles des participants, sous la responsabilité de l'utilisateur, sur son poste ;
- l'audio et le texte transitent vers les endpoints d'inférence configurés ; un endpoint tiers devient sous-traitant de l'utilisateur ;
- l'utilisateur doit informer les participants (art. 13-14 RGPD ; en France, art. 226-1 du Code pénal pour les conversations privées ; information des salariés en entreprise).

Livrables :

1. `docs/conformite/rgpd.md` : inventaire des données (quoi, où, durée, suppression), flux réseau (uniquement les endpoints configurés, TLS recommandé), garanties techniques (aucun audio sur disque, clés dans le trousseau, aucune télémétrie, aucun compte), responsabilités de l'utilisateur (information des participants, choix des endpoints, analyse d'impact éventuelle en entreprise). Document de référence pour une organisation qui évalue l'outil ; mis à jour à chaque changement de flux ou de stockage.
2. Le rappel d'information désactivable (Phase 6).

L'authentification héritée (Supabase, plugin `auth`, étape « compte ») n'a plus de raison d'être et est retirée en premier lot du chantier 04d, avec ce document.

## CI/CD (reprise du modèle OC P5)

**Principe de durée** : les gates de PR restent courtes (< 10 min) ; tout ce qui demande un build complet (`ci-install`, CodeQL Rust) passe en gate de release ou en hebdomadaire.

Même philosophie que `OC-P5_Deployez_un_modele_de_Machine_Learning` : workflows en français, actions épinglées par SHA, permissions minimales, gates bloquantes, SARIF dans l'onglet Sécurité. La partie ML (`ci-model-performance`, `base-image` pour l'image de l'API, gate de score) et les tests Python sont retirés ; les mêmes gates sont transposés à une stack Rust/TypeScript/Tauri.

| Workflow                                      | Déclencheur                                                                        | Gates                                                                                                                                                                                                                                                                                                           | Origine P5                                                                                                                              |
| --------------------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `ci-code-quality`                             | PR                                                                                 | dprint, oxlint + ESLint, `tsc` (desktop), `cargo fmt --check`, `cargo clippy -D warnings` (crates du desktop), titre de PR Conventional Commits, actionlint, zizmor (high bloquant), lockfiles (`pnpm install --frozen-lockfile`, `cargo metadata --locked`)                                                    | ruff → dprint/oxlint/clippy, `uv lock --check` → lockfiles pnpm/cargo, hadolint retiré (pas de Dockerfile)                              |
| `ci-security`                                 | PR, hebdomadaire                                                                   | Dependency Review (licences GPL/AGPL/SSPL refusées, sévérité high), `cargo deny` (advisories, licences, sources), Trivy fs, Gitleaks sur la plage de la PR, registre d'exceptions daté, commentaire de synthèse                                                                                                 | identique, plus `cargo deny` ; Trivy config retiré (pas d'IaC)                                                                          |
| `ci-codeql`                                   | PR (TypeScript seulement, si modifié), gate de `release` (Rust + TS), hebdomadaire | CodeQL `security-extended` en `build-mode: none` ; Rust jamais sur PR (extraction du workspace et de ~1 000 dépendances : > 25 min)                                                                                                                                                                             | SAST de P5, séparé et déporté hors PR pour Rust ; suite `security-and-quality` abandonnée (qualité couverte par clippy, oxlint, ESLint) |
| `ci-test`                                     | PR                                                                                 | Vitest du desktop (3 shards), `cargo test` sur les crates qui portent nos changements (templates, STT, DB, listener), yamllint ; couverture différentielle à 90 % sur les lignes modifiées (Vitest lcov + `cargo llvm-cov` → `diff-cover`) **à ajouter** : il faut d'abord introduire `@vitest/coverage-v8`     | pytest/couverture → Vitest/cargo ; seuil global de 98 % abandonné (code hérité), seuil différentiel conservé                            |
| `ci-traceability`                             | PR                                                                                 | issue référencée (`Closes #`, `Related to #`), type Conventional Commits, cohérence semver déclarée/inférée                                                                                                                                                                                                     | identique                                                                                                                               |
| `ci-install`                                  | hebdomadaire, à la demande (≈ 25 min, hors PR)                                     | rejoue tel quel le bloc « Construire depuis les sources › Linux » de CONTRIBUTING.md sur un runner vierge (dépendances, build `.deb`) puis un smoke test : lancement sous `xvfb-run`, l'app doit tenir 30 s sans panic                                                                                          | `quickstart_test.sh` repris, paramétré par document et section ; le parcours utilisateur passe aux installateurs (#4)                   |
| `release`                                     | push sur main, manuel (dry-run)                                                    | version calculée depuis les commits (feat → minor, fix/perf → patch, `!` → major), gate de cohérence de version, **gate SAST CodeQL Rust + TS** (en parallèle du build), build Linux `.deb` + AppImage, SHA256SUMS, SBOM (Syft), attestation de provenance, GitHub Release avec changelog, notification d'échec | identique, l'image GHCR étant remplacée par les paquets desktop ; installateurs Windows/macOS et scripts en une ligne : #4              |
| `ai-code-review`, `ai-issue-triage`           | —                                                                                  | **retirés le 2026-10-24** (revue et triage IA de P5 non repris pour l'instant)                                                                                                                                                                                                                                  | —                                                                                                                                       |
| `functional-gb10` (**Forgejo**, miroir privé) | push sur main, avant chaque release, manuel                                        | tests fonctionnels contre les vrais moteurs du GB10 (voir ci-dessous)                                                                                                                                                                                                                                           | nouveau                                                                                                                                 |

- **Dependabot** : npm, cargo, github-actions (hebdomadaire, préfixes `chore(deps)` / `chore(ci)`).
- **Modèles** de PR et d'issues, `zizmor.yml`, `.gitleaks.toml` et `security-exceptions.yml` repris de P5.
- **Pourquoi Forgejo pour les tests fonctionnels** : les runners GitHub ne voient ni le LAN ni le tailnet, et un runner auto-hébergé sur un dépôt public exécuterait le code des PR externes au milieu de l'infra. Le runner Forgejo du home-server (`forgejo-runner`) voit le DGX et n'exécute que les branches du miroir privé.

## Tests fonctionnels sur le GB10

Secrets lus dans Bitwarden au moment du job (`bws`, jeton `BWS_ACCESS_TOKEN` en secret Forgejo) : `VLLM_API_KEY`, `ASR_API_KEY`. Fixture : un enregistrement FR libre de droits avec sa transcription de référence, versionné dans `tests/fixtures/`. Rien n'est conservé après les tests (règle audio).

| Test                                                               | Cible sur le GB10                                                                                                                                                              | Critère                                                                        |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| Préflight (**en place**, `.forgejo/workflows/functional-gb10.yml`) | `GET /v1/models` (vLLM, `192.168.1.87:30000`), création de session Realtime du NIM ASR (`192.168.1.87:9000`, 200 avec clé et 401 sans)                                         | vérifié le 2026-10-24 depuis un conteneur identique au runner                  |
| STT temps réel, NIM WebSocket                                      | `ws://192.168.1.87:9000/v1/realtime` en CI (le runner ne résout pas le DNS du tailnet), `wss://spark-787d-1.tail6cba9f.ts.net/v1/realtime` sur un poste (Bearer `ASR_API_KEY`) | WER inférieur à un seuil sur la fixture, premiers mots en moins de 2 s         |
| STT temps réel, NIM gRPC                                           | `192.168.1.87:50051`                                                                                                                                                           | idem                                                                           |
| STT temps réel, vLLM Realtime (Voxtral)                            | fenêtre de test dédiée, voir la contrainte mémoire ci-dessous                                                                                                                  | idem                                                                           |
| STT batch                                                          | `/v1/audio/transcriptions`                                                                                                                                                     | idem                                                                           |
| Enhance                                                            | `/v1/chat/completions` (Qwen servi) avec un template Syntheo                                                                                                                   | toutes les sections du template présentes, dans l'ordre, sans section inventée |
| Générateur de templates                                            | idem                                                                                                                                                                           | JSON valide, 3 à 6 sections, titre et icône                                    |
| Zéro audio sur disque                                              | session complète dans un `HOME` temporaire                                                                                                                                     | aucun `*.mp3`, `*.wav`, `*.part` ni `audio-recovery/`                          |

**Contrainte mémoire du GB10 (non négociable)** : avec Qwen (vLLM, environ 87 Go) et le NIM ASR (environ 7 Go), il reste environ 20 Go. Voxtral Mini 4B Realtime en BF16 demande 16 Go ou plus, donc **jamais en parallèle** des deux : risque d'OOM (deux redémarrages physiques le 2026-10-23). Pour le tester, on suit une procédure explicite, lancée à la main avec l'accord de l'opérateur :

1. Arrêter le NIM ASR.
2. Lancer Voxtral avec un budget mémoire borné (`--gpu-memory-utilization` faible, `--max-model-len` réduit).
3. Lancer les tests.
4. Arrêter Voxtral et relancer l'ASR.

Ne jamais redémarrer le vLLM principal. Les tests NIM et LLM, eux, tournent sur la configuration actuelle sans rien modifier sur le DGX.

## Maintenance

- Veille Anarlog occasionnelle, portage manuel des correctifs utiles (voir « Suivi d'Anarlog »).
- Ne jamais réintroduire de code depuis `enterprise/` (licence commerciale).

## Risques

| Risque                                                                                                                                                                         | Parade                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Les correctifs de sécurité d'Anarlog n'arrivent plus automatiquement                                                                                                           | veille, Dependabot et `cargo deny` sur nos dépendances, portage manuel                                                                |
| Sans endpoint d'inférence joignable, pas de transcription (choix assumé : pas de cloud ni de moteur embarqué), et aucun rattrapage possible puisque l'audio n'est pas conservé | état clair dans l'UI (endpoint injoignable) **avant** de lancer la capture ; trous datés dans le transcript ; reconnexion automatique |
| Le protocole vLLM Realtime diffère d'OpenAI Realtime                                                                                                                           | spike au début de la Phase 5 ; adaptateur dédié si besoin                                                                             |
| L'adaptateur NIM gRPC est entièrement nouveau (protos Riva)                                                                                                                    | commencer par le WebSocket NIM existant ; gRPC en second                                                                              |
| Mémoire du GB10 saturée par un test (Voxtral)                                                                                                                                  | procédure manuelle de la section « Tests fonctionnels » ; la CI ne modifie jamais l'état du DGX                                       |
| Binaires `cloudsync` fermés                                                                                                                                                    | retirés avec la sync cloud (chantier 04d)                                                                                             |
| Qualité de la traduction FR automatique                                                                                                                                        | relecture des écrans principaux ; le reste peut attendre                                                                              |

## Laissé au constructeur

Choix de la police, icônes Lucide associées aux emojis, découpage fin des commits, nom exact des fichiers de migration, dimensionnement de l'image CI.

## Mes choix (à vérifier)

- Ne pas renommer la base, l'utilisateur, le volume Postgres et le bucket S3 de syntheo-web.
- Identifiant d'app `fr.willisback.syntheo`, schéma deep-link `syntheo`, updater désactivé (mises à jour via les GitHub Releases).
- Templates Anarlog traduits sur place (mêmes ids `default-*`), Syntheo épinglés en tête ; prompts d'enhance laissés en anglais avec `language = fr`.
- Inférence embarquée (whisper.cpp, LLM local) retirée en plus des providers cloud.
- Règle audio appliquée au sens strict : **jamais d'écriture sur disque**, même temporaire pendant la session. L'alternative d'un tampon disque supprimé à l'arrêt permettrait de retranscrire après un échec, mais ce serait une conservation.
- Diarisation post-session (pyannote local et cloud) retirée ; seule la diarisation à la volée reste.
- Apple Calendar conservé (local, macOS) ; contacts réduits aux participants saisis à la main.
- Dépôt GitHub public `WillIsback/syntheo-desktop` avec un miroir Forgejo ; historique neuf, aucune synchronisation automatique avec Anarlog.
- Rebrand complet, sources comprises (pas seulement les traductions).
- Générateur exécuté côté desktop avec le LLM de l'utilisateur, pas via syntheo-web.
- Pas de sync cloud dans la v1.
