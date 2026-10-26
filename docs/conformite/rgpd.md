# Syntheo Desktop et le RGPD

Document de référence pour une personne ou une organisation qui évalue Syntheo
Desktop. Il est mis à jour à chaque changement de flux réseau ou de stockage.

**Principe** : Syntheo Desktop est un client local. Il n'a ni serveur, ni base
centrale, ni compte, et n'émet aucune télémétrie. L'éditeur n'accède à aucune donnée et n'est
pas responsable de traitement : l'utilisateur l'est, sur son poste.

> **État au 2026-10-26 :** l'audio ne touche plus jamais le disque, sur aucun
> chemin. La capture de réunion, la dictée, l'import et le dépôt d'un fichier
> audio, ainsi que le découpage interne du traitement batch, travaillent
> entièrement en mémoire ; le fichier importé est lu à son emplacement
> d'origine, sans copie dans le dossier de données.
>
> **Providers** : endpoints on-premise uniquement. La transcription parle aux
> protocoles OpenAI et NVIDIA NIM ; le résumé, le chat et le générateur de
> templates parlent à un seul endpoint LLM configuré, une API
> OpenAI-compatible (vLLM, Ollama, llama.cpp server…).

## Données stockées

Tout est stocké sur le poste, dans le dossier de données de l'application
(`syntheo` sous le répertoire de données de l'utilisateur, par exemple
`~/.local/share/syntheo` sous Linux).

| Donnée                                     | Où                                                                                                                                               | Durée                                 | Suppression                                                            |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------- | ---------------------------------------------------------------------- |
| Transcripts (texte, horodatage, locuteurs) | base SQLite locale `app.db`                                                                                                                      | jusqu'à suppression par l'utilisateur | suppression de la réunion dans l'application, ou du dossier de données |
| Notes et comptes rendus générés            | base SQLite locale                                                                                                                               | idem                                  | idem                                                                   |
| Contacts, dossiers, réglages               | base SQLite locale                                                                                                                               | idem                                  | idem                                                                   |
| Clés d'API des endpoints d'inférence       | trousseau du système (Keychain, Secret Service, Credential Manager) ; jamais en clair dans la base                                               | jusqu'à suppression du provider       | retrait du provider dans les réglages                                  |
| Index de recherche plein texte (tantivy)   | dossier de données (copie indexée des transcripts et notes)                                                                                      | tant que les réunions existent        | suit la suppression des réunions, ou suppression du dossier de données |
| Journaux techniques `app.log`              | dossier de logs de l'application ; contenu filtré par un module de masquage (`RedactingWriter`), rotation par taille                             | rotation automatique                  | suppression du dossier de logs                                         |
| Exports (Markdown, etc.)                   | dossier export choisi par l'utilisateur                                                                                                          | sous le contrôle de l'utilisateur     | suppression des fichiers exportés                                      |
| Audio d'une réunion                        | **jamais sur disque** : en mémoire le temps d'être envoyé à l'endpoint STT ; une coupure de transcription laisse un trou daté dans le transcript | —                                     | —                                                                      |
| Audio de la dictée ou d'un import          | **jamais sur disque**, même temporairement : la dictée produit un WAV en mémoire, l'import lit le fichier à son emplacement d'origine sans copie | —                                     | —                                                                      |

Aucune de ces données n'est envoyée à l'éditeur.

**Aucune inférence sur le poste** : depuis le chantier 04b-2, l'application ne
télécharge ni n'exécute aucun modèle (transcription, LLM, diarisation ou
empreintes vocales). Une version antérieure a pu laisser des fichiers de
modèles dans les dossiers `models/stt` et `models/llm` du dossier de données,
ainsi que dans le cache de modèles Soniqo sous macOS : ils ne sont plus ni lus
ni chargés, et peuvent être supprimés à la main. Les empreintes vocales
qu'une version antérieure a pu enregistrer (vecteurs dans le trousseau du
système, références dans les tables `voiceprint_exemplars` et
`voiceprint_candidates`) sont effacées au démarrage ; si le trousseau refuse
une suppression, l'effacement est retenté au lancement suivant.

## Flux réseau

- **Endpoints d'inférence configurés par l'utilisateur**, et eux seuls : ASR
  (protocole OpenAI : Realtime et `/v1/audio/transcriptions` ; NVIDIA NIM
  WebSocket) et l'endpoint LLM configuré (API OpenAI-compatible). L'audio de
  la capture et le texte (transcript, notes, prompts) y transitent, sans
  empreinte d'appareil ni identifiant de tâche dans les en-têtes. Une URL de transcription non
  reconnue est traitée avec le protocole OpenAI, jamais renvoyée vers un
  service tiers.
- **TLS recommandé** dès que l'endpoint n'est pas sur la machine ou un réseau de
  confiance (par exemple via un reverse proxy ou un VPN). L'application accepte
  HTTP en clair uniquement vers un hôte privé (machine locale, réseau local,
  plage Tailscale, noms `.local`) et exige HTTPS ailleurs.
- Un endpoint exploité par un tiers devient **sous-traitant de l'utilisateur**
  (art. 28 RGPD) : contrat et localisation des données à vérifier.
- **Autres flux encore présents** (à retirer ou rendre optionnels dans les
  chantiers suivants) :
  - aperçu des liens GitHub collés dans une note : requête **non
    authentifiée** vers l'API publique `api.github.com` (état de l'issue ou de
    la PR) ; le numéro et le dépôt du lien sont transmis à GitHub ;
  - icônes de certains écrans chargées depuis `api.iconify.design` (aucune
    donnée personnelle transmise, mais une requête réseau) ;
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
- **Aucun audio sur disque, sur aucun chemin** : la session de capture ne
  démarre plus d'enregistreur, la rétention est figée à « aucune » et un test
  Rust vérifie qu'aucun fichier audio n'apparaît dans le dossier de session ;
  ni lecteur, ni retranscription, ni empreintes vocales. La dictée produit un
  WAV en mémoire, l'import et le dépôt d'un fichier transcrivent depuis
  l'emplacement d'origine sans copie, et le découpage batch se fait en mémoire.
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
