# Notice

## Origine

Syntheo Desktop est un projet indépendant, dérivé du code source d'**Anarlog**,
l'application de prise de notes de réunion de Fastrepl, Inc.

| | |
|---|---|
| Projet source | Anarlog — <https://github.com/fastrepl/anarlog> |
| Licence de la source | MIT (partie communautaire, hors `enterprise/`) |
| Révision importée | `a0d5bd049ea883e04dc74db31d1ef58c4c06faab` (2026-10-24) |
| Titulaire des droits sur la source | Copyright (c) 2023-present Fastrepl, Inc. |

Le code a été importé dans un nouveau dépôt, avec un historique neuf. Syntheo
Desktop n'est ni affilié à Fastrepl ni soutenu par Fastrepl, et n'a pas vocation
à être fusionné dans Anarlog. « Anarlog » est une marque de Fastrepl, Inc. : elle
n'est citée ici que pour indiquer l'origine du code.

La notice de copyright et le texte de la licence MIT d'origine sont conservés
dans [`LICENSE`](LICENSE), comme l'exige la licence.

## Non repris lors de l'import

- `enterprise/`, `LICENSE.enterprise`, `LICENSING.md` : composants sous licence
  commerciale Fastrepl, non redistribuables ; aucun code n'en est issu.
- Intégration continue, outillage de publication et d'exploitation de Fastrepl
  (`.github/workflows`, `.github/{scripts,reports,plugin}`, `bitrise.yml`,
  `render.yaml`, `openstatus.*`, `RELEASE_AUDIT.md`, `OBSERVABILITY.md`).

## Modifications principales

Le détail et l'avancement sont dans
[`docs/superpowers/specs/2026-10-24-syntheo-desktop-migration-design.md`](docs/superpowers/specs/2026-10-24-syntheo-desktop-migration-design.md).
En résumé :

- identité Syntheo (nom, identifiant d'application, logo, thème, français) ;
- providers d'inférence **on-premise uniquement** (protocoles OpenAI-compatible
  et NVIDIA NIM) ; les 33 adaptateurs de transcription cloud (Deepgram,
  AssemblyAI, Soniox, ElevenLabs, Gladia, Speechmatics, Azure, Google, AWS…),
  le crate `soniox` et le provider « custom » compatible Deepgram sont
  supprimés ; les 33 providers LLM cloud (Anarlog, Claude, ChatGPT, Copilot,
  OpenRouter, Bedrock, Gemini, Mistral…) aussi, avec leurs SDK `@ai-sdk/*`, le
  plugin `bedrock`, la crate `openrouter` et l'évaluation de templates via
  OpenRouter : seul reste un serveur OpenAI-compatible ;
- **inférence embarquée retirée** : transcription locale (whisper.cpp,
  Soniqo, Apple Speech, Argmax), LLM Apple Intelligence, diarisation pyannote
  locale, empreintes vocales et téléchargement de modèles (plugins `local-stt`
  et `local-llm`, et les crates qui ne servaient qu'à eux) ;
- **aucun audio sur disque, sur aucun chemin** : enregistreur de capture,
  réglage de rétention, lecteur audio, retranscription et empreintes vocales
  retirés ; une coupure de transcription laisse un trou daté ; la dictée
  produit un WAV en mémoire, l'import lit le fichier à son emplacement
  d'origine sans copie, et le découpage batch se fait en mémoire ;
- intégrations cloud hors IA, télémétrie, compte et abonnement retirés :
  authentification Supabase (`apps/desktop/src/auth`, `plugins/auth`, sous-commande
  CLI `auth` et source `cloud`), partage de notes et de sessions, synchronisation
  cloud, intégrations Nango (calendriers Google/Outlook, CRM, Google Drive),
  facturation et paywall (`@anlg/pricing`) ;
  conformité RGPD documentée dans [`docs/conformite/rgpd.md`](docs/conformite/rgpd.md) ;
- applications hors périmètre retirées du dépôt, qui ne contient plus que le
  client desktop et la CLI : serveur `apps/api` (proxys de transcription et de
  LLM, facturation, synchronisation), site `apps/web`, application mobile
  `apps/mobile`, webhooks Stripe `apps/stripe`, application watchOS `apps/watch`,
  packages `@anlg/supabase`, `@anlg/pricing` et `mobile-bridge-rn`, dossier
  `supabase/`, et les 34 crates qui ne servaient qu'à eux (`api-*`,
  `transcribe-proxy`, `llm-proxy`, `supabase-auth`, `supabase-storage`, `nango`,
  `mobile-bridge`, `updater-core`, etc.) ;
- templates Syntheo, templates traduits en français, générateur de templates.

## Correctifs portés depuis Anarlog

Chaque correctif repris manuellement d'une version ultérieure d'Anarlog est listé
ici (révision Anarlog, PR Syntheo Desktop).

_Aucun pour l'instant._
