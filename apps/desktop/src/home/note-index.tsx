import { Trans, useLingui } from "@lingui/react/macro";
import { type KeyboardEvent, useCallback, useRef } from "react";

import { cn } from "@syntheo/utils";

import { formatDuration, formatIndexDate } from "./format";
import type { RecentNote } from "./queries";

// « Reprendre » : tableau sans carte, lignes séparées par un filet `border`,
// survol `accent`. Chaque ligne a un bouton (titre) ; flèches haut/bas pour
// passer d'une note à l'autre.
export function NoteIndex({
  notes,
  onOpen,
}: {
  notes: readonly RecentNote[];
  onOpen: (sessionId: string) => void;
}) {
  const { t, i18n } = useLingui();
  const tableRef = useRef<HTMLTableElement>(null);

  const moveFocus = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
      const delta =
        event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
      if (!delta) return;
      const buttons =
        tableRef.current?.querySelectorAll<HTMLButtonElement>(
          "button[data-note-open]",
        ) ?? [];
      const next = buttons[index + delta];
      if (next) {
        event.preventDefault();
        next.focus();
      }
    },
    [],
  );

  if (notes.length === 0) return null;

  return (
    <section aria-labelledby="home-resume-title">
      <h2
        id="home-resume-title"
        className="text-faint mb-0.5 text-[11px] font-semibold tracking-[0.08em] uppercase"
      >
        <Trans>Resume</Trans>
      </h2>
      <table ref={tableRef} className="w-full border-collapse">
        <tbody>
          {notes.map((note, index) => {
            const title = note.title || t`Untitled`;
            const duration = formatDuration(note.durationMs);
            return (
              <tr
                key={note.id}
                onClick={() => onOpen(note.id)}
                className="group hover:bg-accent focus-within:bg-accent cursor-pointer motion-safe:transition-colors"
              >
                <td className="border-border text-muted-foreground w-[110px] border-t px-1 py-3 text-[13px] whitespace-nowrap">
                  {formatIndexDate(note.createdAt, i18n.locale)}
                </td>
                <td className="border-border border-t px-1 py-3 text-[15px]">
                  <button
                    type="button"
                    data-note-open
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpen(note.id);
                    }}
                    onKeyDown={(event) => moveFocus(event, index)}
                    className={cn([
                      "text-foreground w-full truncate rounded-sm text-left",
                      "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
                    ])}
                  >
                    {title}
                  </button>
                </td>
                <td className="border-border text-muted-foreground border-t px-1 py-3 text-right text-[13px] whitespace-nowrap">
                  {duration}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
