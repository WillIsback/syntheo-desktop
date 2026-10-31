// Ctrl ⇧ N : « commencer l'écoute ». Ailleurs dans l'app, ce raccourci crée une
// note et lance l'écoute ; dans une note encore en préparation, il doit lancer
// l'écoute de cette note-là. La note active enregistre ici son action, que le
// raccourci global consulte avant de créer une nouvelle note.
type StartHandler = () => void;

let currentHandler: StartHandler | null = null;

export function registerPreparedNoteStart(handler: StartHandler) {
  currentHandler = handler;
  return () => {
    if (currentHandler === handler) {
      currentHandler = null;
    }
  };
}

export function startPreparedNoteFromShortcut(): boolean {
  if (!currentHandler) {
    return false;
  }

  currentHandler();
  return true;
}
