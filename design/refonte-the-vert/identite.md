# Identité « 緑茶 Thé vert »

Inspirée des couleurs traditionnelles japonaises (*A Dictionary of Color Combinations*, Sanzo Wada) : une soie écrue, une encre, un vert de pin. L'app doit avoir le calme d'une cérémonie du thé : peu d'éléments, chacun à sa place.

## Couleurs

Valeurs exactes dans `tokens.css` (HSL arrondi ; hex en commentaire). Les noms reprennent ceux du code actuel.

| Jeton | Clair | Sombre | Usage |
|---|---|---|---|
| `background` | `#fbfaf5` 生成り kinari | `#1b1e1a` 墨 sumi | Fond de l'app et de la note |
| `foreground` | `#262a24` | `#ece9df` | Texte, encre des notes de l'utilisateur |
| `card` / `popover` | `#fffefa` | `#232821` | Surfaces surélevées, menus, palette Ctrl K |
| `primary` | `#316745` 千歳緑 chitose-midori | `#7dbf95` | Action principale, capsule, sélection |
| `primary-hover` | `#25553a` | `#97ceaa` | Survol de primary (nouveau) |
| `primary-foreground` | `#fbfaf5` | `#13251a` | Texte sur primary |
| `muted` / `secondary` | `#efeee6` | `#2c322a` | Remplissages calmes, jetons |
| `muted-foreground` | `#5c6357` | `#a7ad9f` | Dates, durées, aides (≥ 5.9:1) |
| `faint` | `#8f968a` | `#7b8274` | Libellés en capitales, placeholder. Jamais pour un texte à lire (nouveau) |
| `accent` | `#e4ede1` | `#24382b` | Survol, ligne sélectionnée |
| `accent-foreground` | `#25553a` | `#9fd2b0` | Texte sur accent |
| `border` / `input` | `#e4e3d8` / `#d8d7cb` | `#343a32` / `#3d443a` | Filets, bordures de champs |
| `recording` | `#c53d43` 紅 beni | `#e5675f` | Écoute en cours, et rien d'autre (nouveau) |
| `seal` | = recording | = recording | Sceau 記 (nouveau) |
| `ai-ink` | = primary | = primary | Texte ajouté par Syntheo (nouveau) |
| `destructive`, `alert*` | rouges | rouges | Suppression, bannières d'erreur |

Un seul bouton `primary` par écran : le bouton Démarrer sur l'accueil, la capsule ensuite.

## Typographie

| Rôle | Police | Taille / interligne | Poids |
|---|---|---|---|
| Salutation (accueil) | Newsreader | 52 / 1.05 | 500 |
| Titre de note, titre de page de paramètres | Newsreader | 40 / 1.1 (paramètres : 36) | 500 |
| Section de compte-rendu | Newsreader | 22 / 1.35 | 500 |
| Corps de note | Geist | 16 / 1.65 | 400 |
| Interface, listes, champs | Geist | 15 / 1.5 | 400 |
| Boutons, capsule | Geist | 14 / 1.4 | 600 |
| Dates, aides | Geist | 13 / 1.4 | 400 |
| Libellé de section | Geist | 11, capitales, espacement 0.08em, `faint` | 600 |
| Adresses, noms de modèles | Geist Mono | 13.5–14 | 400–500 |
| Kanji d'ornement | Noto Serif JP (sous-ensemble 茶備聴結記) | 11 à 300 | 500–700 |

## Espacements, rayons, ombre

- Espacements : 4, 8, 12, 16, 24, 40 px.
- Rayons : 6px (jetons, cases, kbd), 10px (champs, panneaux), 16px (bouton Démarrer), pilule réservée à la capsule.
- Une seule ombre : `shadow-capsule`. Ailleurs, des filets `border` plutôt que des cartes.
- Colonnes : note 760px, accueil 640px, marge de transcription 280px.

## Composants clés

- **Capsule** : fond `primary`, texte `primary-foreground`, pilule, `shadow-capsule`, centrée en bas. Étapes 備 聴 結 avant chaque libellé, étape courante en gras avec `aria-current="step"`. Une seule par fenêtre.
- **StartButton** : pleine largeur de l'accueil, `primary`, rayon 16px, icône micro, titre 19px, aide, jetons des 3 étapes, `Ctrl N`.
- **NoteIndex** (« Reprendre ») : tableau sans carte, lignes séparées par `border`, survol `accent`, date et durée en `muted-foreground`.
- **Provenance** : légende « Vos notes » (`foreground`) / « Complété par Syntheo » (`ai-ink`). Le texte généré n'est jamais en italique ni en gris.
- **Seal** : carré 46px, bordure et kanji 記 en `seal`, rotation −5°, opacité 0.85, en bas à droite du compte-rendu terminé.
- **Carte serveur** (paramètres) : adresse en mono, bouton « Tester la connexion », pastille d'état (connecté · latence / injoignable / test en cours), protocole détecté, modèles en boutons radio, « Avancé » replié.

## Clins d'œil japonais

Décoratifs, jamais porteurs d'information, toujours `aria-hidden`, au plus un par zone :

| Où | Quoi | Rendu |
|---|---|---|
| Capsule | 備 · 聴 · 結 devant chaque étape | 11px, opacité 0.6 |
| Accueil | 茶 en filigrane à droite | 300px, `primary` à 6 % |
| Note terminée | sceau 記 (« consigné ») | voir Seal |

Pas de mascotte ni de personnage chibi dans le parcours principal.

## Ton

Français, vouvoiement, phrases courtes. Les boutons disent ce qui se passe (« Commencer l'écoute », « Tester la connexion »). Les erreurs disent quoi faire : « Le serveur n'a pas répondu. Vérifiez qu'il est démarré et que vous êtes sur le bon réseau (VPN, Tailscale), puis relancez le test. »
