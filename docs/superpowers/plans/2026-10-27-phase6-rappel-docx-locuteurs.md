# Phase 6 — rappel participants, export DOCX, palette locuteurs (lot 09)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter le rappel non bloquant « informez les participants » (désactivable), l'export DOCX d'une note, et la palette de couleurs des locuteurs s1–s4.

**Architecture:** Le rappel est un réglage booléen (`capture_reminder_enabled`, activé par défaut) et un toast d'information au démarrage d'une capture. L'export DOCX produit un fichier `.docx` depuis la note (lib `docx`) et s'ajoute au menu d'export existant. La palette s1–s4 est un jeu de couleurs appliqué aux segments de locuteurs.

**Tech Stack:** React 19, Tauri 2, TanStack Query/Form, `docx` (à ajouter), Lingui, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-24-syntheo-desktop-migration-design.md` (Phase 6). Tokens Syntheo : `packages/design-system/src/tokens.css` (bleu `#1a73e8`, vert `#0f9d58`, orange `#e37400`, violet `#a142f4`).

## Global Constraints

- Aucun provider cloud ; aucun audio sur disque ; aucune télémétrie.
- Textes d'interface en français (le catalogue `fr` est rempli — ajouter les nouvelles chaînes puis `i18n:extract`/`compile`).
- Réglages ajoutés au schéma `apps/desktop/src/settings/schema.ts` (défauts explicites).
- `pnpm exec dprint fmt` avant de pousser ; Conventional Commits ; PR `Closes #N` + `[skip release]`.

## Review Focus

- Réglage désactivé → aucun rappel au démarrage → test (Task 1/2).
- Rappel non bloquant : la capture démarre quand même (pas de modale) → test (Task 2).
- Export DOCX : une note → fichier `.docx` valide, sans dépendance cloud → test (Task 4).
- Locuteurs : deux locuteurs distincts reçoivent des couleurs distinctes, stables et accessibles (contraste) → test (Task 3).

---

### Task 1: Réglage `capture_reminder_enabled`

**Files:**

- Modify: `apps/desktop/src/settings/schema.ts` (nouvelle clé, défaut `true`)
- Modify: `apps/desktop/src/settings/general/meeting-settings.tsx` (nouvelle `SettingSwitchRow`)
- Modify: `apps/desktop/src/settings/general/index.tsx` (câblage `MeetingSettingsView`)
- Test: `apps/desktop/src/settings/general/meeting-settings.test.tsx`

**Interfaces:**

- Produces: clé de réglage `capture_reminder_enabled: boolean` (défaut `true`) ; prop `captureReminder: SettingItem` sur `MeetingSettingsView`.

- [ ] **Step 1: Écrire le test qui échoue** : `MeetingSettingsView` affiche « Rappeler d'informer les participants » et appelle `onChange` avec `false`.
- [ ] **Step 2: Vérifier l'échec** — `pnpm -F @syntheo/desktop test src/settings/general/meeting-settings.test.tsx`.
- [ ] **Step 3: Implémenter** : ajouter au schéma

```ts
capture_reminder_enabled: {
  type: "boolean",
  path: ["general", "capture_reminder_enabled"],
  default: true as boolean,
},
```

ajouter la prop et le `SettingSwitchRow` (titre « Rappeler d'informer les participants », description « Affiche un rappel au démarrage d'une capture. »), et câbler dans `index.tsx` sur `values.capture_reminder_enabled`.

- [ ] **Step 4: Vérifier** — test + `typecheck` verts.
- [ ] **Step 5: Commit et PR** — `feat(settings): réglage du rappel d'information des participants`.

---

### Task 2: Rappel non bloquant au démarrage de capture

**Files:**

- Modify: `apps/desktop/src/stt/useStartListening.ts` (toast d'information au démarrage si le réglage est actif)
- Test: `apps/desktop/src/stt/useStartListening.test.ts`

**Interfaces:**

- Consumes: `useConfigValue("capture_reminder_enabled")` ; `toast` de `@syntheo/ui/components/ui/toast`.
- Produces: message `CAPTURE_REMINDER_MESSAGE = "Pensez à informer les participants de la transcription."`.

- [ ] **Step 1: Écrire le test qui échoue** : au démarrage d'une capture avec le réglage actif, `toast.info` est appelé avec le message (id stable `capture-reminder`) ; avec le réglage inactif, aucun toast de ce type.
- [ ] **Step 2: Vérifier l'échec** — `pnpm -F @syntheo/desktop test src/stt/useStartListening.test.ts`.
- [ ] **Step 3: Implémenter** : dans le chemin de démarrage de `useStartListening`, après le lancement effectif, si `capture_reminder_enabled` alors `toast.info(CAPTURE_REMINDER_MESSAGE, { id: "capture-reminder", duration: 8000 })`. Aucune modale, aucun blocage.
- [ ] **Step 4: Vérifier** — test + `typecheck` verts.
- [ ] **Step 5: Commit et PR** — `feat(stt): rappel d'information des participants au démarrage`.

---

### Task 3: Palette des locuteurs s1–s4

**Files:**

- Create: `apps/desktop/src/stt/speaker-palette.ts`
- Modify: `apps/desktop/src/stt/utils.ts` (ou le composant qui colore les locuteurs) pour consommer la palette
- Test: `apps/desktop/src/stt/speaker-palette.test.ts`

**Interfaces:**

- Produces: `export const SPEAKER_PALETTE: readonly string[]` (s1–s4 : `#1a73e8`, `#0f9d58`, `#e37400`, `#a142f4`) ; `export function speakerColor(index: number): string` (cyclique, stable).

- [ ] **Step 1: Écrire le test qui échoue** : `speakerColor(0..3)` renvoie les 4 couleurs dans l'ordre, `speakerColor(4)` revient à s1, `speakerColor(-1)`/`speakerColor(7)` restent dans la palette.
- [ ] **Step 2: Vérifier l'échec** — `pnpm -F @syntheo/desktop test src/stt/speaker-palette.test.ts`.
- [ ] **Step 3: Implémenter** la palette + `speakerColor`, puis l'appliquer là où les locuteurs sont colorés (segments/timeline).
- [ ] **Step 4: Vérifier** — test + `typecheck` verts.
- [ ] **Step 5: Commit et PR** — `feat(stt): palette de couleurs des locuteurs`.

---

### Task 4: Export DOCX

**Files:**

- Modify: `apps/desktop/package.json` (dépendance `docx`)
- Create: `apps/desktop/src/session/export/docx.ts` (note → `.docx`)
- Modify: le menu d'export (note) pour ajouter « Exporter en DOCX »
- Test: `apps/desktop/src/session/export/docx.test.ts`

**Interfaces:**

- Produces: `export async function noteToDocxBlob({ title, markdown, participants? }): Promise<Blob>`.

- [ ] **Step 1: Écrire le test qui échoue** : un titre + un markdown (avec titres `#`, paragraphes, liste) produisent un `Blob` non vide de type `application/vnd.openxmlformats-officedocument.wordprocessingml.document`.
- [ ] **Step 2: Vérifier l'échec** — `pnpm -F @syntheo/desktop test src/session/export/docx.test.ts`.
- [ ] **Step 3: Implémenter** : `pnpm --filter @syntheo/desktop add docx` ; mapper le Markdown (via un parseur minimal : titres, paragraphes, listes) en `Document`/`Paragraph`/`HeadingLevel` ; `Packer.toBlob`. Ajouter l'entrée de menu (réutiliser le mécanisme d'export/partage existant, ex. `automations/markdown-export.ts`).
- [ ] **Step 4: Vérifier** — test + `typecheck` verts.
- [ ] **Step 5: Commit et PR** — `feat(export): export DOCX de la note`.

---

### Task 5: Vérification finale du lot 09

- [ ] `pnpm -F @syntheo/desktop typecheck` + Vitest complet verts.
- [ ] `pnpm -F @syntheo/desktop i18n:check` vert (nouvelles chaînes extraites/traduites).
- [ ] `pnpm exec dprint check` vert.
- [ ] Contrôle manuel : rappel visible au démarrage, export DOCX ouvrable, couleurs de locuteurs distinctes.

## Notes de risque

- **`docx`** : nouvelle dépendance desktop ; vérifier la licence (MIT) et la taille. Si le menu d'export est fortement couplé au Markdown, l'entrée DOCX peut réutiliser le même chemin de sérialisation.
- **Rappel** : ne doit jamais bloquer ni retarder le démarrage (toast uniquement).
- **Palette** : viser un contraste suffisant sur fond clair et sombre ; les couleurs Syntheo sont déjà utilisées ailleurs (icônes de templates).
