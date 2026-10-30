// Silhouette de l'icône Syntheo (carré arrondi à trois barres), monochrome
// pour hériter de la couleur du texte.
const SYNTHEO_MARK_VIEW_BOX = "0 0 32 32";

export function SyntheoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox={SYNTHEO_MARK_VIEW_BOX}
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M7 0h18a7 7 0 0 1 7 7v18a7 7 0 0 1-7 7H7a7 7 0 0 1-7-7V7a7 7 0 0 1 7-7ZM4.8 6.4v3.2h22.4V6.4ZM4.8 14.4v3.2h22.4v-3.2ZM4.8 22.4v3.2h14.4v-3.2Z"
      />
    </svg>
  );
}
