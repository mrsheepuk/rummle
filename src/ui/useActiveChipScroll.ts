import { useEffect, useRef } from "react";

/**
 * Keeps the active player's chip visible in the horizontally-scrolling
 * turn-track. Attach the returned ref to whichever chip is currently active;
 * on each turn change we nudge it into view. `scrollIntoView` with "nearest"
 * is a no-op when the chip is already fully visible, so it only scrolls when
 * needed — and we drop the smooth animation under prefers-reduced-motion.
 */
export function useActiveChipScroll(activeId: string | null | undefined) {
  const activeChipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const chip = activeChipRef.current;
    if (!chip) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    chip.scrollIntoView({
      behavior: reduce ? "auto" : "smooth",
      inline: "nearest",
      block: "nearest",
    });
  }, [activeId]);

  return activeChipRef;
}
