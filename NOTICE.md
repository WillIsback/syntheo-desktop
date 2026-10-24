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
  et NVIDIA NIM) ; adaptateurs cloud retirés ;
- aucune conservation de l'audio ;
- intégrations cloud hors IA, télémétrie, compte et abonnement retirés ;
- templates Syntheo, templates traduits en français, générateur de templates.

## Correctifs portés depuis Anarlog

Chaque correctif repris manuellement d'une version ultérieure d'Anarlog est listé
ici (révision Anarlog, PR Syntheo Desktop).

_Aucun pour l'instant._
