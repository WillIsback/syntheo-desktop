import { useReducedMotion } from "motion/react";

import { cn } from "@syntheo/utils";

// Profil des barres : plus hautes au centre, comme dans la maquette.
const BAR_PROFILE = [0.45, 0.75, 1, 0.75, 0.45];
const MIN_SCALE = 0.2;

export function LevelMeter({
  amplitude,
  muted = false,
}: {
  amplitude: number;
  muted?: boolean;
}) {
  const reduceMotion = useReducedMotion();
  const level = muted ? 0 : Math.max(0, Math.min(1, amplitude));
  // Mouvement réduit : niveau figé, sans animation des barres.
  const animated = !reduceMotion && !muted;

  return (
    <span
      aria-hidden="true"
      data-level-meter
      data-animated={animated ? "true" : "false"}
      className="flex h-5 items-center gap-0.5"
    >
      {BAR_PROFILE.map((weight, index) => {
        const scale = animated
          ? MIN_SCALE + (1 - MIN_SCALE) * level * weight
          : weight * 0.5;
        return (
          <i
            key={index}
            className={cn([
              "bg-primary-foreground block h-full w-0.5 origin-center rounded-full",
              animated
                ? "transition-transform duration-100 ease-out"
                : "opacity-70",
            ])}
            style={{ transform: `scaleY(${scale})` }}
          />
        );
      })}
    </span>
  );
}
