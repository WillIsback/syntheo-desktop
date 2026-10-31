import { forwardRef, type TextareaHTMLAttributes } from "react";

import { cn } from "@syntheo/utils";

/** Champ sans bordure, mais avec un focus visible (anneau `ring`). */
export const inlineFieldClassName =
  "-mx-1 rounded-sm px-1 outline-hidden focus-visible:ring-2 focus-visible:ring-ring/50 placeholder:text-faint disabled:cursor-default";

/**
 * Zone de texte « d'une ligne » qui grandit avec son contenu.
 *
 * Un `<input>` supprimerait les retours à la ligne des consignes déjà
 * enregistrées : on garde un `<textarea>` dont la hauteur suit le nombre de
 * lignes (`field-sizing: content` quand le moteur le gère).
 */
export const LineTextarea = forwardRef<
  HTMLTextAreaElement,
  Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "rows"> & {
    value: string;
  }
>(function LineTextarea({ value, className, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      value={value}
      rows={Math.max(1, value.split("\n").length)}
      className={cn([
        "field-sizing-content w-full resize-none border-0 bg-transparent p-0",
        inlineFieldClassName,
        className,
      ])}
      {...props}
    />
  );
});
