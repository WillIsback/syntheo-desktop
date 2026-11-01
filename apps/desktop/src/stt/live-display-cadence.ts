// Rythme d'affichage de la transcription en direct (issue 287).
//
// Le natif envoie un événement de transcription à chaque réponse du moteur,
// soit 10 à 20 par seconde (partiels et mots finaux). L'état métier les
// applique tous, aussitôt et dans l'ordre (persistance, détection de
// blocage, toasts) : seul l'affichage est regroupé ici. Chaque battement
// relit l'état courant, donc rien n'est perdu ni réordonné.
//
// Pourquoi 4 battements par seconde (250 ms) :
// - Perception : un sous-titre en direct paraît vivant dès 3 à 5 mises à jour
//   par seconde ; au-delà l'œil ne gagne rien. 4 Hz est le milieu de cette
//   plage, et 250 ms de retard au plus restent sous le seuil où un texte
//   « suit » la parole (un mot dure environ 300 ms à l'oral).
// - Coût : sur le laptop de référence (i7-10510U, rendu logiciel WebKit), un
//   rendu de la marge coûte C ≈ 15 à 30 ms (rendu React, mise en page,
//   peinture). À 20 rendus par seconde, cela prend 30 à 60 % du fil
//   principal ; à 4 Hz, 6 à 12 %.
// - Frappe : une frappe qui tombe pendant un rendu attend sa fin. La
//   probabilité vaut rythme × C : 20 × 25 ms = 50 % à 20 Hz, 4 × 25 ms = 10 %
//   à 4 Hz, 2 × 25 ms = 5 % à 2 Hz. Le rendu React est en plus lancé en
//   transition (`startTransition`), donc interruptible par une frappe ; la
//   mise en page et la peinture, elles, ne le sont pas, d'où la baisse à 2 Hz
//   tant que l'utilisateur écrit (frappe dans l'éditeur de notes depuis moins
//   de 800 ms, soit l'intervalle entre deux mots d'une saisie lente).
// - Les mots finaux attendent le même battement que les partiels : ils ne
//   changent pas de place à l'écran, seulement de style.
// - Fenêtre masquée : aucun rendu. Les battements sont suspendus et l'état
//   s'accumule ; au retour, un seul rendu affiche tout d'un coup.

export const LIVE_DISPLAY_INTERVAL_MS = 250;
export const LIVE_DISPLAY_TYPING_INTERVAL_MS = 500;
export const NOTE_TYPING_WINDOW_MS = 800;

const NOTE_EDITOR_SELECTOR = ".ProseMirror";

let lastNoteTypingAt = Number.NEGATIVE_INFINITY;
let typingListenerInstalled = false;

function onNoteInput(event: Event) {
  const target = event.target;
  if (target instanceof Element && target.closest(NOTE_EDITOR_SELECTOR)) {
    lastNoteTypingAt = Date.now();
  }
}

function installNoteTypingListener() {
  if (typingListenerInstalled || typeof document === "undefined") return;
  typingListenerInstalled = true;
  // Phase de capture, passif : rien ne retarde la frappe elle-même.
  const options = { capture: true, passive: true } as const;
  document.addEventListener("keydown", onNoteInput, options);
  document.addEventListener("beforeinput", onNoteInput, options);
}

export function isTypingInNotes(now = Date.now()): boolean {
  return now - lastNoteTypingAt < NOTE_TYPING_WINDOW_MS;
}

export function resetNoteTypingForTests() {
  lastNoteTypingAt = Number.NEGATIVE_INFINITY;
}

function isDocumentHidden() {
  return (
    typeof document !== "undefined" && document.visibilityState === "hidden"
  );
}

export type LiveDisplayCadence = {
  // Un changement est arrivé : il sera affiché au prochain battement.
  request: () => void;
  // L'appelant vient d'afficher l'état courant lui-même (changement d'état de
  // l'écoute) : plus rien n'est en attente, et le battement repart de là.
  cancel: () => void;
  dispose: () => void;
};

// `flush` relit l'état courant et l'affiche. Il n'est jamais appelé de façon
// synchrone depuis `request` : les événements reçus dans la même tâche sont
// toujours regroupés.
export function createLiveDisplayCadence(
  flush: () => void,
): LiveDisplayCadence {
  installNoteTypingListener();
  let pending = false;
  let disposed = false;
  let lastFlushAt = Number.NEGATIVE_INFINITY;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const interval = (now: number) =>
    isTypingInNotes(now)
      ? LIVE_DISPLAY_TYPING_INTERVAL_MS
      : LIVE_DISPLAY_INTERVAL_MS;

  const run = () => {
    pending = false;
    lastFlushAt = Date.now();
    flush();
  };

  const tick = () => {
    timer = null;
    if (disposed || !pending || isDocumentHidden()) return;
    const now = Date.now();
    // La frappe a pu commencer depuis la programmation du battement.
    const due = lastFlushAt + interval(now);
    if (now < due) {
      timer = setTimeout(tick, due - now);
      return;
    }
    run();
  };

  const schedule = () => {
    if (disposed || timer !== null || !pending || isDocumentHidden()) return;
    const now = Date.now();
    timer = setTimeout(tick, Math.max(0, lastFlushAt + interval(now) - now));
  };

  const onVisibilityChange = () => {
    if (isDocumentHidden()) {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      return;
    }
    // Retour au premier plan : tout ce qui s'est accumulé, d'un coup.
    if (pending && timer === null) timer = setTimeout(tick, 0);
    lastFlushAt = Number.NEGATIVE_INFINITY;
  };
  document.addEventListener("visibilitychange", onVisibilityChange);

  return {
    request: () => {
      pending = true;
      schedule();
    },
    cancel: () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      pending = false;
      lastFlushAt = Date.now();
    },
    dispose: () => {
      disposed = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      document.removeEventListener("visibilitychange", onVisibilityChange);
    },
  };
}
