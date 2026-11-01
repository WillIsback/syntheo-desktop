# Identité « 緑茶 Thé vert »

Inspirée des couleurs traditionnelles japonaises (_A Dictionary of Color Combinations_, Sanzo Wada) : une soie écrue, une encre, un vert de pin. L'app doit avoir le calme d'une cérémonie du thé : peu d'éléments, chacun à sa place.

## Couleurs

Valeurs exactes dans `tokens.css` (HSL arrondi ; hex en commentaire). Les noms reprennent ceux du code actuel.

| Jeton                   | Clair                           | Sombre                | Usage                                                                                                                     |
| ----------------------- | ------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `background`            | `#fbfaf5` 生成り kinari         | `#1b1e1a` 墨 sumi     | Fond de l'app et de la note                                                                                               |
| `foreground`            | `#262a24`                       | `#ece9df`             | Texte, encre du compte-rendu complété par Syntheo                                                                         |
| `card` / `popover`      | `#fffefa`                       | `#232821`             | Surfaces surélevées, menus, palette Ctrl K                                                                                |
| `primary`               | `#316745` 千歳緑 chitose-midori | `#7dbf95`             | Action principale, capsule, sélection                                                                                     |
| `primary-hover`         | `#25553a`                       | `#97ceaa`             | Survol de primary (nouveau)                                                                                               |
| `primary-foreground`    | `#fbfaf5`                       | `#13251a`             | Texte sur primary                                                                                                         |
| `muted` / `secondary`   | `#efeee6`                       | `#2c322a`             | Remplissages calmes, jetons                                                                                               |
| `muted-foreground`      | `#5c6357`                       | `#a7ad9f`             | Dates, durées, aides (≥ 5.9:1)                                                                                            |
| `faint`                 | `#8f968a`                       | `#7b8274`             | Libellés en capitales, placeholder. Jamais pour un texte à lire (nouveau)                                                 |
| `accent`                | `#e4ede1`                       | `#24382b`             | Survol, ligne sélectionnée                                                                                                |
| `accent-foreground`     | `#25553a`                       | `#9fd2b0`             | Texte sur accent                                                                                                          |
| `border` / `input`      | `#e4e3d8` / `#d8d7cb`           | `#343a32` / `#3d443a` | Filets, bordures de champs                                                                                                |
| `recording`             | `#c53d43` 紅 beni               | `#e5675f`             | Écoute en cours, et rien d'autre (nouveau)                                                                                |
| `seal`                  | = recording                     | = recording           | Sceau 記 (nouveau)                                                                                                        |
| `user-ink`              | = primary                       | = primary             | Notes personnelles de l'utilisateur (nouveau, ≥ 4.5:1 sur background et card) ; le texte de Syntheo reste en `foreground` |
| `destructive`, `alert*` | rouges                          | rouges                | Suppression, bannières d'erreur                                                                                           |

Un seul bouton `primary` par écran : le bouton Démarrer sur l'accueil, la capsule ensuite.

## Palettes (Paramètres › Apparence)

Thé vert reste la palette par défaut. Deux palettes de la maquette (`maquettes/parcours-note.html`, objet `PAL`) s'y ajoutent, chacune en clair **et** en sombre, combinables avec le choix clair / sombre / système :

| Palette                | Kanji (sélecteur) | Filigrane de l'accueil | Fond      | Primaire         | Accent         | Encre     | Rouge d'écoute |
| ---------------------- | ----------------- | ---------------------- | --------- | ---------------- | -------------- | --------- | -------------- |
| 緑茶 Thé vert (défaut) | 緑茶              | 茶                     | `#fbfaf5` | `#316745` 千歳緑 | `#e4ede1`      | `#262a24` | `#c53d43` 紅   |
| 藤 Glycine             | 藤                | 藤                     | `#fcfbf9` | `#674a8c` 江戸紫 | `#ece6f4` 白藤 | `#2c2732` | `#c53d43` 紅   |
| 臙脂 Laque et encre    | 臙脂              | 紅                     | `#fffffc` | `#9f353a` 臙脂   | `#f9e8e6` 桜   | `#1f1c1c` | `#d3381c` 朱   |

**Mécanisme.** L'attribut `data-palette="fuji|enji"` sur `<html>` (Thé vert : pas d'attribut) sélectionne dans `tokens.css` les blocs `[data-palette="…"]` (clair) et `[data-palette="…"].dark, [data-palette="…"] .dark` (sombre), qui redéfinissent le jeu **complet** de jetons. La valeur est un paramètre synchronisé (`general.palette`, défaut `cha` ; absente ou inconnue = Thé vert), recopiée dans `localStorage` (`syntheo-palette`) pour que `public/theme-boot.js` l'applique avant React, comme le thème. Les fenêtres flottantes et les aperçus lisent `DesignPalettes` (`packages/design-system/src/index.ts`) ; `DesignColors` reste l'alias de Thé vert.

**Dérivation.** Mêmes relations que Thé vert : `card` un cran plus clair que `background` en clair (plus clair aussi en sombre), `primary-foreground` = `background`, `accent-foreground` = `primary-hover`, `ring` = `user-ink` = `chart-1` = `primary`, `seal` = `recording`, `secondary` = `muted`, `muted-foreground` et `faint` repris de la maquette. En sombre : fond encre teinté de la teinte de la palette (L 11 %), `card` L 14–15 %, `muted` L 18–19 %, primaire éclairci (L 72–74 %) avec un texte foncé dessus. Les catégories `chart-2…5` reprennent 藍, 山吹, 江戸紫, 紅, 千歳緑 en évitant de doubler le primaire : Glycine remplace 江戸紫 par 千歳緑, Laque et encre remplace 紅 par 千歳緑.

**Les deux rouges de Laque et encre.** `primary` (臙脂 `#9f353a`, rouge laque froid et sombre) et `recording` (朱 `#d3381c`, vermillon chaud et vif) sont posés l'un sur l'autre dans la capsule (bouton « Commencer l'écoute », point d'écoute). Le 紅 `#c53d43` de Thé vert n'y ferait qu'un écart ΔE76 ≈ 14 avec le primaire ; le 朱 de la maquette donne ΔE76 ≈ 35 (≈ 36 en sombre, `#e5939a` rosé contre `#f0704f` orangé), au-dessus du seuil de 25 vérifié par `theme-contrast.test.ts` pour toutes les palettes. `destructive` et `alert*` suivent la même famille 朱 (`#b5321b` en clair) plutôt que le rouge laque, pour ne pas ressembler au bouton primaire. Le libellé du bouton d'écoute reste la vraie distinction : la couleur n'est jamais le seul indice.

### 藤 Glycine

| Jeton                           | Clair                                   | Sombre                                  |
| ------------------------------- | --------------------------------------- | --------------------------------------- |
| `background`                    | `#fcfbf9`                               | `#1c1a20`                               |
| `foreground`                    | `#2c2732`                               | `#ece9f0`                               |
| `card` / `popover`              | `#ffffff`                               | `#24212a`                               |
| `primary`                       | `#674a8c`                               | `#b39bd6`                               |
| `primary-hover`                 | `#583d7b`                               | `#c6b3e2`                               |
| `primary-foreground`            | `#fcfbf9`                               | `#1b1326`                               |
| `muted` / `secondary`           | `#f0eef2`                               | `#2e2a35`                               |
| `muted-foreground`              | `#635c6b`                               | `#aca6b4`                               |
| `faint`                         | `#958e9c`                               | `#7f7888`                               |
| `accent`                        | `#ece6f4`                               | `#33294a`                               |
| `accent-foreground`             | `#583d7b`                               | `#cdbde6`                               |
| `border`                        | `#e9e5ec`                               | `#36323e`                               |
| `input`                         | `#dcd7e1`                               | `#403b49`                               |
| `recording` / `seal`            | `#c53d43`                               | `#e5675f`                               |
| `user-ink` / `ring` / `chart-1` | `#674a8c`                               | `#b39bd6`                               |
| `destructive`                   | `#b23a3f`                               | `#e0676b`                               |
| `destructive-foreground`        | `#ffffff`                               | `#2c1112`                               |
| `alert`                         | `#fbecea`                               | `#3a1c1d`                               |
| `alert-foreground`              | `#a33237`                               | `#f0938d`                               |
| `alert-border`                  | `#f0c9c6`                               | `#5a2a2b`                               |
| `chart-2 … chart-5`             | `#165e83` `#93691a` `#316745` `#c53d43` | `#6aa9cf` `#d9ad5b` `#7dbf95` `#e5675f` |

### 臙脂 Laque et encre

| Jeton                           | Clair                                   | Sombre                                  |
| ------------------------------- | --------------------------------------- | --------------------------------------- |
| `background`                    | `#fffffc`                               | `#1e1a1a`                               |
| `foreground`                    | `#1f1c1c`                               | `#eee8e6`                               |
| `card` / `popover`              | `#ffffff`                               | `#272121`                               |
| `primary`                       | `#9f353a`                               | `#e5939a`                               |
| `primary-hover`                 | `#86272c`                               | `#edadb2`                               |
| `primary-foreground`            | `#fffffc`                               | `#2a1214`                               |
| `muted` / `secondary`           | `#f5f0ee`                               | `#322a2a`                               |
| `muted-foreground`              | `#66615f`                               | `#b2a8a6`                               |
| `faint`                         | `#9a9591`                               | `#877d7b`                               |
| `accent`                        | `#f9e8e6`                               | `#432629`                               |
| `accent-foreground`             | `#86272c`                               | `#f1bcc0`                               |
| `border`                        | `#efe6e3`                               | `#3a3131`                               |
| `input`                         | `#e3d9d6`                               | `#443a3a`                               |
| `recording` / `seal`            | `#d3381c`                               | `#f0704f`                               |
| `user-ink` / `ring` / `chart-1` | `#9f353a`                               | `#e5939a`                               |
| `destructive`                   | `#b5321b`                               | `#ec7356`                               |
| `destructive-foreground`        | `#ffffff`                               | `#2c120c`                               |
| `alert`                         | `#fdece6`                               | `#3d1f18`                               |
| `alert-foreground`              | `#a62f1a`                               | `#f39a83`                               |
| `alert-border`                  | `#f3cbbf`                               | `#5e2e23`                               |
| `chart-2 … chart-5`             | `#165e83` `#93691a` `#674a8c` `#316745` | `#6aa9cf` `#d9ad5b` `#a98bcf` `#7dbf95` |

### Contrastes vérifiés

`apps/desktop/src/styles/theme-contrast.test.ts` vérifie ≥ 4.5:1 pour les mêmes 33 paires texte / fond dans chaque palette et chaque mode (valeurs HSL arrondies de `tokens.css`) :

| Palette        | Mode   | Paire la plus faible         | Contraste | primary / background | foreground / background | ΔE76 primary ↔ recording |
| -------------- | ------ | ---------------------------- | --------- | -------------------- | ----------------------- | ------------------------ |
| Thé vert       | clair  | `chart-3` sur `background`   | 4.68:1    | 6.26:1               | 14.04:1                 | 82                       |
| Thé vert       | sombre | `destructive` sur `card`     | 4.55:1    | 7.83:1               | 13.85:1                 | 81                       |
| Glycine        | clair  | `chart-3` sur `background`   | 4.72:1    | 6.90:1               | 14.19:1                 | 67                       |
| Glycine        | sombre | `destructive` sur `card`     | 4.71:1    | 6.99:1               | 14.57:1                 | 63                       |
| Laque et encre | clair  | `recording` sur `background` | 4.79:1    | 6.77:1               | 16.67:1                 | 35                       |
| Laque et encre | sombre | `destructive` sur `card`     | 5.42:1    | 7.44:1               | 14.29:1                 | 36                       |

## Typographie

| Rôle                                       | Police                                             | Taille / interligne                       | Poids   |
| ------------------------------------------ | -------------------------------------------------- | ----------------------------------------- | ------- |
| Salutation (accueil)                       | Newsreader                                         | 52 / 1.05                                 | 500     |
| Titre de note, titre de page de paramètres | Newsreader                                         | 40 / 1.1 (paramètres : 36)                | 500     |
| Section de compte-rendu                    | Newsreader                                         | 22 / 1.35                                 | 500     |
| Corps de note                              | Geist                                              | 16 / 1.65                                 | 400     |
| Interface, listes, champs                  | Geist                                              | 15 / 1.5                                  | 400     |
| Boutons, capsule                           | Geist                                              | 14 / 1.4                                  | 600     |
| Dates, aides                               | Geist                                              | 13 / 1.4                                  | 400     |
| Libellé de section                         | Geist                                              | 11, capitales, espacement 0.08em, `faint` | 600     |
| Adresses, noms de modèles                  | Geist Mono                                         | 13.5–14                                   | 400–500 |
| Kanji d'ornement                           | Noto Serif JP (sous-ensemble 茶備聴結記藤紅緑臙脂) | 11 à 300                                  | 500–700 |

## Espacements, rayons, ombre

- Espacements : 4, 8, 12, 16, 24, 40 px.
- Rayons : 6px (jetons, cases, kbd), 10px (champs, panneaux), 16px (bouton Démarrer), pilule réservée à la capsule.
- Une seule ombre : `shadow-capsule`. Ailleurs, des filets `border` plutôt que des cartes.
- Colonnes : note 760px, accueil 640px, marge de transcription 280px.

## Composants clés

- **Capsule** : fond `primary`, texte `primary-foreground`, pilule, `shadow-capsule`, centrée en bas. Étapes 備 聴 結 avant chaque libellé, étape courante en gras avec `aria-current="step"`. Une seule par fenêtre.
- **StartButton** : pleine largeur de l'accueil, `primary`, rayon 16px, icône micro, titre 19px, aide, jetons des 3 étapes, `Ctrl N`.
- **NoteIndex** (« Reprendre ») : tableau sans carte, lignes séparées par `border`, survol `accent`, date et durée en `muted-foreground`.
- **Provenance** : légende « Vos notes » (`user-ink`, le primaire de la palette) / « Complété par Syntheo » (`foreground`). Le texte généré n'est jamais en italique ni en gris ; les cases à cocher des actions prennent l'encre du texte qui les porte.
- **Seal** : carré 46px, bordure et kanji 記 en `seal`, rotation −5°, opacité 0.85, en bas à droite du compte-rendu terminé.
- **Carte serveur** (paramètres) : adresse en mono, bouton « Tester la connexion », pastille d'état (connecté · latence / injoignable / test en cours), protocole détecté, modèles en boutons radio, « Avancé » replié.

## Clins d'œil japonais

Décoratifs, jamais porteurs d'information, toujours `aria-hidden`, au plus un par zone :

| Où            | Quoi                                                               | Rendu                  |
| ------------- | ------------------------------------------------------------------ | ---------------------- |
| Capsule       | 備 · 聴 · 結 devant chaque étape                                   | 11px, opacité 0.6      |
| Accueil       | 茶 en filigrane à droite (藤 pour Glycine, 紅 pour Laque et encre) | 300px, `primary` à 6 % |
| Note terminée | sceau 記 (« consigné »)                                            | voir Seal              |

Pas de mascotte ni de personnage chibi dans le parcours principal.

## Ton

Français, vouvoiement, phrases courtes. Les boutons disent ce qui se passe (« Commencer l'écoute », « Tester la connexion »). Les erreurs disent quoi faire : « Le serveur n'a pas répondu. Vérifiez qu'il est démarré et que vous êtes sur le bon réseau (VPN, Tailscale), puis relancez le test. »

## Récit

Pourquoi le thé : ce récit est la source unique. La page `docs/philosophy.mdx` reprend la version longue, le README et l'accueil guidé la version courte. On ne réécrit pas ailleurs : on recopie.

**Règle.** Chaque référence au thé doit expliquer un choix du produit. Si la phrase dit autant de choses sur Syntheo une fois la référence retirée, la référence est décorative : on la coupe. Les libellés fonctionnels restent en français clair (« Synthèse », « Commencer l'écoute »).

**Version longue (≈ 150 mots).**

> Syntheo porte le thé dans son nom : Syn·thé·o, ce qu'on rassemble autour du thé. Au Japon, un _chakai_ (茶会) réunit un hôte et ses invités pour un moment préparé avec soin. Un participant en garde ensuite le _kaiki_ (会記) : son propre carnet de la rencontre.
>
> Une note Syntheo suit ce déroulé. **備 Préparer** : avant la réunion, vous choisissez son type et ajoutez les participants. **聴 Écouter** : vous prenez vos notes, la transcription défile en marge. **結 Synthèse** : Syntheo complète vos notes en compte rendu, et le sceau 記 marque la note terminée. Vos notes restent en vert, le texte de Syntheo à l'encre.
>
> Une réunion ne se rejoue pas (一期一会, _ichi-go ichi-e_, « une rencontre, une seule fois ») : Syntheo ne conserve jamais l'audio, seule la note reste. Et ce qui s'y dit ne sort pas de chez vous : transcription et synthèse passent uniquement par vos serveurs, sans compte ni télémétrie.

**Version courte (≈ 40 mots).**

> Syn·thé·o : ce qu'on rassemble autour du thé. Comme le _kaiki_, le carnet qu'un invité garde d'une réunion de thé, votre compte rendu part de vos notes. La réunion ne se rejoue pas : l'audio n'est jamais conservé, seule la note reste.

**Ce que le rituel explique.**

| Choix du produit                  | Dans le rituel                                                                                                                             | Garantie                                                                        |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| Le compte rendu part de vos notes | le _kaiki_ est le carnet d'un participant, pas un procès-verbal                                                                            | vos notes en `user-ink`, le texte de Syntheo en `foreground` (`provenance.tsx`) |
| L'audio n'est jamais conservé     | 一期一会 : le moment ne se rejoue pas, seul le _kaiki_ reste                                                                               | `docs/data-and-privacy.mdx`, `docs/conformite/rgpd.md`                          |
| Rien n'est envoyé à l'éditeur     | le _chakai_ se tient dans une pièce fermée ; vos serveurs d'inférence apportent le thé depuis l'extérieur, mais c'est vous qui les invitez | pas de compte, pas de télémétrie (`no-telemetry.test.ts`)                       |
| L'étape Préparer                  | la préparation de l'hôte fait déjà partie de l'attention portée aux invités                                                                | fiche : type de réunion, participants, écoute                                   |

**Termes vérifiés.** _Chakai_ (茶会) : réunion de thé où un hôte reçoit ses invités. _Kaiki_ (会記, _chakaiki_ 茶会記) : le compte rendu d'un _chakai_ (invités, ustensiles, repas) ; les plus anciens, comme le _Matsuya kaiki_ (1533-1650) ou le _Tennōjiya kaiki_, sont tenus par des marchands qui notent les réunions auxquelles ils assistent. 一期一会 : l'idée remonte au _Yamanoue Sōji ki_ (recevoir chaque fois comme si c'était la seule) ; la formule est fixée par Ii Naosuke dans le _Chanoyu ichie shū_ (茶湯一会集, vers 1857).

**Écartés.** L'ateji 心手緒 (« shin-te-o ») : ce n'est pas un mot japonais et il n'apprend rien sur le produit, les étapes 備 聴 結 portent déjà le sens. Pas de pinceau, de papier de riz, de cerisiers ni de « sagesse zen ».
