import type { ComponentProps } from "react";

import { Button } from "@syntheo/ui/components/ui/button";
import { DialogContent } from "@syntheo/ui/components/ui/dialog";
import { cn } from "@syntheo/utils";

export function GlassDialogContent({
  className,
  ...props
}: ComponentProps<typeof DialogContent>) {
  return (
    <DialogContent
      overlayClassName="bg-scrim"
      className={cn([
        "w-[calc(100vw-48px)] max-w-[320px] gap-4 overflow-hidden rounded-[26px] p-5 sm:rounded-[26px]",
        "border-border/45 bg-card/60 backdrop-blur-2xl backdrop-saturate-150",
        "shadow-2xl",
        "[&>button:last-child]:hidden",
        className,
      ])}
      {...props}
    />
  );
}

export function GlassDialogCancelButton({
  className,
  ...props
}: ComponentProps<typeof Button>) {
  return (
    <Button
      type="button"
      variant="ghost"
      className={cn([
        "border-border/70 bg-background/50 text-foreground h-8 rounded-full border px-4 text-xs font-medium shadow-xs",
        "hover:bg-background/80 hover:text-foreground",
        className,
      ])}
      {...props}
    />
  );
}
