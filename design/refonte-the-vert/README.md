# Chantier : refonte de l'interface « Thé vert »

Ce dossier décrit la refonte de l'UI de Syntheo Desktop : nouvelle identité visuelle (緑茶 Thé vert) et nouveau parcours de note (« document vivant » en trois étapes). C'est la référence pour toute PR du chantier. Les maquettes priment sur ce texte en cas de doute visuel ; ce texte prime sur les maquettes pour le comportement.

## Contenu du dossier

| Fichier | Rôle |
|---|---|
| `README.md` | Ce brief : principes, périmètre, découpage en lots, critères d'acceptation. |
| `identite.md` | Règles de l'identité : couleurs, typo, formes, composants, clins d'œil japonais. |
| `tokens.css` | Copie de `packages/design-system/src/tokens.css` (format HSL, clair + sombre, palettes Thé vert, Glycine et Laque et encre). |
| `maquettes/parcours-note.html` | Maquette cliquable de l'accueil et du parcours Préparer → Écouter → Synthèse. **Seule la piste C (« Document vivant ») est retenue**, avec la palette « Thé vert ». Les pistes A et B restent pour l'historique. |
| `maquettes/parametres.html` | Maquette cliquable de la fenêtre des paramètres (clair et sombre). |

Ouvrir une maquette : `open design/refonte-the-vert/maquettes/parcours-note.html#piste-c` (ou double-clic). Elles chargent Geist et Newsreader depuis Google Fonts pour l'aperçu uniquement ; l'app, elle, doit embarquer ses polices (voir Lot 0).

Références en ligne (privées, compte du propriétaire) : design system <https://claude.ai/artifact/1tXWJ3GX8qfFtVukqmxdQr>, parcours <https://claude.ai/artifact/LFH1w9mLn7f1EQz1hNuAAD>, paramètres <https://claude.ai/artifact/XhcWJ1NAVWXYut7jK3kqUq>.

## Principes

1. **Un employé, pas un service.** Usage personnel, hébergement local. Pas de compte, de cloud, d'équipe ou de facturation à l'écran. Une seule mention technique : l'état des serveurs locaux.
2. **Un document vivant.** Une note passe d'une fiche (Préparer) à une prise de notes avec la transcription en marge (Écouter), puis à un compte-rendu (Synthèse) sans changer d'écran.
3. **Trois étapes toujours visibles** dans la capsule flottante en bas : 備 Préparer · 聴 Écouter · 結 Synthèse, avec la seule action utile du moment.
4. **Qui a écrit quoi.** Le compte-rendu que Syntheo complète est à l'encre `foreground`, jamais en italique ni en gris ; les notes personnelles de l'utilisateur sont à l'encre `user-ink` (le primaire de la palette : vert pour Thé vert), avec une légende.
5. **Accueil guidé.** Salutation, prochaine réunion de l'agenda, un seul grand bouton « Démarrer une réunion », puis la liste « Reprendre ».

## Règles du projet qui s'appliquent

Rappel de `AGENTS.md` et `docs/architecture.mdx`, à vérifier dans chaque PR :

- Aucune ressource distante à l'exécution : **polices embarquées** (`@fontsource…` ou fichiers locaux), pas de Google Fonts.
- Audio jamais écrit sur disque, y compris pour « Essayer avec ma voix » dans les paramètres.
- Pas de télémétrie, de compte ni de facturation.
- Texte en français d'abord, via Lingui. Corriger au passage les libellés restés en anglais (« Set as default », « Add tag », « New Template », « API setup »…).
- Conventional Commits ; chaque PR référence l'issue de son lot (`Closes #N`).

## Découpage en lots

Un lot = une issue = une PR. Les lots 1 à 5 dépendent du lot 0 ; ils sont ensuite indépendants entre eux.

### Lot 0 · Fondations (tokens, polices, fond)

- Remplacer `packages/design-system/src/tokens.css` par `tokens.css` de ce dossier ; aligner `DesignColors` dans `packages/design-system/src/index.ts`.
- Exposer les nouveaux jetons à Tailwind (`@theme` de `packages/ui/src/styles/globals.css` et `apps/desktop/src/styles/globals.css`) : `primary-hover`, `faint`, `recording`, `seal`, `user-ink`, `shadow-capsule`.
- Polices : Geist (interface) et Newsreader (titres de note), embarquées ; Noto Serif JP en sous-ensemble limité aux kanji 茶備聴結記. Remplacer `--font-sans` (Inter) et ajouter `--font-serif`, `--font-kanji`.
- Retirer le motif décoratif de fond (vague) des surfaces principales : le fond est uni `background`.
- Mettre à jour `apps/desktop/src/styles/theme-tokens.test.ts` et `font-tokens.test.ts` (ils figent aujourd'hui le bleu et Inter).

### Lot 1 · Accueil

Maquette : `parcours-note.html#piste-c`, écran « Accueil ».
- Colonne centrée (`home-width` 640px) : « Bonjour {prénom}. » en serif 52px, ligne « Votre prochaine réunion : … » depuis le calendrier.
- Bouton `StartButton` : « Démarrer une réunion », aide « Titre et participants repris depuis l'agenda », jetons des 3 étapes, `Ctrl N`.
- Liste « Reprendre » (`NoteIndex`) : date, titre, durée, sans carte.
- Pied : « Tout est traité sur votre serveur local ». Filigrane 茶 discret.
- Capsule réduite à « Rechercher une note » (`Ctrl K`).

### Lot 2 · Note « document vivant » et capsule

Maquette : écrans 1, 2 et 3 de la piste C.
- **Préparer** : titre serif, fiche (type de réunion = modèle, participants, sources d'écoute, langue), zone de notes libre. Capsule : « Annuler » · « Commencer l'écoute » (`Ctrl ⇧ N`, couleur `recording`).
- **Écouter** : notes de l'utilisateur dans la colonne principale ; transcription dans une marge droite (`margin-width` 280px) qui défile. Capsule : point `recording`, chrono, niveau sonore, « Terminer ».
- **Synthèse** : compte-rendu fusionnant notes et texte généré, légende de provenance, actions en cases à cocher, sceau 記 en fin de note. Capsule : « Copier » · « Exporter » · « Demander à la note » (`Ctrl J`).
- La capsule remplace les onglets Résumé / Notes / Transcript et la barre « Posez toutes vos questions ». La transcription complète reste accessible depuis la marge.

### Lot 3 · Navigation

- La barre latérale permanente des notes disparaît ; l'historique passe par l'accueil (« Reprendre ») et une palette `Ctrl K`.
- Garder la barre de menus (Fichier, Modifier, Afficher, Aide).

### Lot 4 · Paramètres

Maquette : `parametres.html`.
- Menu en 4 groupes : **Moi** (Profil, Apparence, Notifications), **Mes serveurs** (Transcription, Synthèse), **Écrire** (Dictée, Dictionnaire), **Mes réunions** (Modèles, Réunions, Calendrier, Dossiers, Contacts). **Retirer « Analyses ».**
- « Général » devient « Profil » ; « Intelligence » devient « Synthèse ».
- Transcription et Synthèse : une carte serveur (adresse, « Tester la connexion », protocole détecté, choix du modèle d'un clic, clé d'API dans « Avancé »). États : non testé, test en cours, connecté (latence), injoignable avec un message qui dit quoi faire. Pastille d'état dans le menu et rappel en bas du menu. Protocoles limités à ceux d'`owhisper-client`.
- Dictée : lignes régulières libellé / réglage, consignes Wayland/X11 repliées, champ d'essai.
- L'utilisateur configure lui-même ses serveurs (pas de configuration imposée par un administrateur pour l'instant).

### Lot 5 · Éditeur de modèles

Maquette : `parametres.html`, section Modèles.
- Liste groupée : Par défaut (Automatique), Mes favoris (★), Tous les modèles ; « + Nouveau modèle ».
- Un modèle se lit comme le compte-rendu : nom en serif, description, « Utilisé pour » (indices du mode Automatique, remplace les tags), sections = titre + consigne d'une ligne, réordonnables.
- « Proposer des sections » appelle le serveur de synthèse local.
- Mode « Aperçu » montrant la forme de la synthèse.
- Si trois colonnes (menu + liste + éditeur) s'avèrent trop étroites, ouvrir Modèles dans sa propre vue avec un retour.

### Lot 6 · Finitions

- Thème sombre vérifié écran par écran (contraste ≥ 4.5:1 pour le texte).
- Clins d'œil japonais (voir `identite.md`), tous `aria-hidden`.
- Nouveau logo dans la palette (le carré bleu actuel est hors identité).

## Critères d'acceptation communs

- Aucune couleur en dur dans les composants : uniquement les jetons.
- Clair et sombre corrects ; `prefers-reduced-motion` respecté (niveau sonore, curseur).
- Navigation clavier complète, focus visible (`ring`).
- `pnpm -r typecheck` et les tests vitest existants passent ; tests mis à jour quand ils figent l'ancienne palette.
- Les tests de garde du dépôt (`no-cloud-imports`, `no-audio-at-rest`, `no-telemetry`…) restent verts.
