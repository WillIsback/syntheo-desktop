# Syntheo Desktop et le RGPD

Document de référence pour une personne ou une organisation qui évalue Syntheo
Desktop. Il est mis à jour à chaque changement de flux réseau ou de stockage.

**Principe** : Syntheo Desktop est un client local. Il n'a ni serveur, ni base
centrale, ni compte, et n'émet aucune télémétrie. L'éditeur n'accède à aucune donnée et n'est
pas responsable de traitement : l'utilisateur l'est, sur son poste.

> **État au 2026-10-25 : transition en cours.** Deux écarts avec la cible
> subsistent jusqu'aux chantiers indiqués ; ils sont repris dans les sections
> concernées.
>
> - **Audio hors capture** (chantier 04c-B) : la capture de réunion n'écrit
>   plus aucun audio sur disque (chantier 04c-A). Restent des fichiers audio
>   **temporaires** pour la dictée (WAV dans le dossier temporaire du système,
>   supprimé après transcription, mais laissé dans ce dossier temporaire si l'application plante avant), l'import ou le dépôt d'un fichier audio
>   (copie normalisée dans le dossier de la note, supprimée dès la transcription réussie ; pour un import dont la transcription échoue, la copie reste jusqu'au chantier 04c-B) et le découpage interne du traitement batch.
> - **Providers** (chantier 04b) : des adaptateurs d'inférence cloud hérités
>   (OpenAI, Anthropic, Deepgram…) restent sélectionnables. La cible est
>   **endpoints on-premise uniquement**.

## Données stockées

Tout est stocké sur le poste, dans le dossier de données de l'application
(`syntheo` sous le répertoire de données de l'utilisateur, par exemple
`~/.local/share/syntheo` sous Linux).

| Donnée                                     | Où                                                                                                                                               | Durée                                 | Suppression                                                                              |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------- | ---------------------------------------------------------------------------------------- |
| Transcripts (texte, horodatage, locuteurs) | base SQLite locale `app.db`                                                                                                                      | jusqu'à suppression par l'utilisateur | suppression de la réunion dans l'application, ou du dossier de données                   |
| Notes et comptes rendus générés            | base SQLite locale                                                                                                                               | idem                                  | idem                                                                                     |
| Contacts, dossiers, réglages               | base SQLite locale                                                                                                                               | idem                                  | idem                                                                                     |
| Clés d'API des endpoints d'inférence       | trousseau du système (Keychain, Secret Service, Credential Manager) ; jamais en clair dans la base                                               | jusqu'à suppression du provider       | retrait du provider dans les réglages                                                    |
| Index de recherche plein texte (tantivy)   | dossier de données (copie indexée des transcripts et notes)                                                                                      | tant que les réunions existent        | suit la suppression des réunions, ou suppression du dossier de données                   |
| Journaux techniques `app.log`              | dossier de logs de l'application ; contenu filtré par un module de masquage (`RedactingWriter`), rotation par taille                             | rotation automatique                  | suppression du dossier de logs                                                           |
| Exports (Markdown, etc.)                   | dossier export choisi par l'utilisateur                                                                                                          | sous le contrôle de l'utilisateur     | suppression des fichiers exportés                                                        |
| Audio d'une réunion                        | **jamais sur disque** : en mémoire le temps d'être envoyé à l'endpoint STT ; une coupure de transcription laisse un trou daté dans le transcript | —                                     | —                                                                                        |
| Audio de la dictée ou d'un import          | fichier temporaire (voir l'état en tête de document)                                                                                             | jusqu'à la fin de la transcription    | automatique, sauf WAV de dictée après un plantage et import dont la transcription échoue |

Aucune de ces données n'est envoyée à l'éditeur.

## Flux réseau

- **Endpoints d'inférence configurés par l'utilisateur**, et eux seuls : ASR
  (OpenAI Realtime, vLLM Realtime, NVIDIA NIM WebSocket/gRPC,
  `/v1/audio/transcriptions`) et LLM (API OpenAI-compatible). L'audio de la
  capture et le texte (transcript, notes, prompts) y transitent.
- **TLS recommandé** dès que l'endpoint n'est pas sur la machine ou un réseau de
  confiance (par exemple via un reverse proxy ou un VPN).
- Un endpoint exploité par un tiers devient **sous-traitant de l'utilisateur**
  (art. 28 RGPD) : contrat et localisation des données à vérifier.
- **Autres flux encore présents** (à retirer ou rendre optionnels dans les
  chantiers suivants) :
  - aperçu des liens GitHub collés dans une note : requête **non
    authentifiée** vers l'API publique `api.github.com` (état de l'issue ou de
    la PR) ; le numéro et le dépôt du lien sont transmis à GitHub ;
  - icônes de certains écrans chargées depuis `api.iconify.design` (aucune
    donnée personnelle transmise, mais une requête réseau) ;
  - téléchargement des modèles locaux (STT/LLM sur l'appareil) depuis
    `models.anarlog.so`, uniquement quand l'utilisateur le déclenche.
- **Pas de compte, pas de synchronisation, pas de rapport d'erreur, pas de
  mise à jour automatique** (les mises à jour passent par les GitHub Releases,
  téléchargées par l'utilisateur).
- Intégrations restantes : Apple Calendar et Rappels (EventKit, **locaux** à
  macOS, sans réseau). Les intégrations hébergées héritées (calendriers Google
  et Outlook, Linear, GitHub via le service Anarlog) sont désactivées :
  sans compte, elles ne peuvent plus s'authentifier.

## Garanties techniques

- **Aucun compte ni authentification** : le code d'authentification hérité
  (Supabase, plugin `auth`) est supprimé.
- **Aucune télémétrie émise** : analytics et Sentry sont neutralisés (client
  d'analytics sans destination, Sentry jamais initialisé) ; leur code et leurs
  dépendances sont encore présents et seront retirés.
- **Clés dans le trousseau du système**, pas dans la base.
- **Aucun audio de réunion sur disque** : la session de capture ne démarre plus
  d'enregistreur, la rétention est figée à « aucune » et un test Rust vérifie
  qu'aucun fichier audio n'apparaît dans le dossier de session ; ni lecteur, ni
  retranscription, ni empreintes vocales. Dictée et import : voir l'état en
  tête de document.
- **Garde-fou dans les tests** : `apps/desktop/src/no-cloud-imports.test.ts`
  échoue si un module cloud ou d'authentification retiré est réimporté.
- **Vérification de bout en bout prévue** : une capture réseau pendant une
  session complète ne doit montrer que les endpoints d'inférence configurés
  (et, tant qu'ils existent, les flux listés plus haut).

## Responsabilités de l'utilisateur

- **Informer les participants** avant d'enregistrer une réunion (art. 13 et 14
  RGPD). En France, enregistrer une conversation privée à l'insu des
  participants est puni par l'article 226-1 du Code pénal ; en entreprise, les
  salariés doivent être informés. Un rappel désactivable au démarrage d'une
  capture est prévu (phase 6 de la migration) ; en attendant, l'application
  propose un message d'information à partager avec les participants.
- **Choisir les endpoints d'inférence** et en assumer le traitement : un
  endpoint auto-hébergé reste sous le contrôle de l'utilisateur ; un endpoint
  tiers est un sous-traitant.
- **Gérer la durée de conservation** des transcripts et des notes, et les
  supprimer quand ils ne sont plus nécessaires.
- **Analyse d'impact (AIPD)** : à envisager par une organisation qui déploie
  l'outil à grande échelle ou pour des réunions sensibles (art. 35 RGPD).
- **Protéger le poste** (chiffrement du disque, session verrouillée) : les
  données y sont stockées en clair dans la base locale.
