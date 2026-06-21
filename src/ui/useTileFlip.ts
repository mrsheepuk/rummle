import { useLayoutEffect, useRef } from "react";

/** How long a moved/entered tile keeps its highlight before it has fully faded. */
const HIGHLIGHT_MS = 5000;

/**
 * Lingering highlight so a spectator can see what changed. It's a separate,
 * long Web Animation (not part of the brief glide) that keeps fading on its
 * own — so several tiles can be mid-fade at once and earlier moves stay visible
 * as new ones arrive. Outline (not box-shadow) so it doesn't clobber the tile's
 * own resting shadow, and it reverts cleanly when the fade ends.
 */
function highlight(node: HTMLElement) {
  node.animate(
    [
      { outline: "3px solid rgba(255, 224, 130, 0.95)", outlineOffset: "1px" },
      { outline: "3px solid rgba(255, 224, 130, 0)", outlineOffset: "1px" },
    ],
    { duration: HIGHLIGHT_MS, easing: "linear" },
  );
}

/**
 * FLIP animation for table tiles when an opponent's move streams in.
 *
 * Drafts arrive as discrete, throttled snapshots (see GameView), so we tween
 * between keyframes the opponent published rather than mirror their cursor.
 * Each tile carries a stable `data-tile-id`, so on every change of `key` we
 * measure where every tile *now* is, compare to where it *was* last render, and
 * play the difference: tiles that moved glide from their old box, tiles that
 * appeared fade/scale in. Uses the Web Animations API so it composes on top of
 * React/dnd-kit inline transforms without clobbering them.
 *
 * The lingering highlight is gated on `signatures` (a per-tile fingerprint of
 * its position *within its group*, e.g. its left neighbour) rather than raw
 * pixel movement: adding a tile to one group reflows the table and slides other
 * groups around, but those tiles weren't actually changed — they still glide,
 * but only genuinely-involved tiles (new, or whose group context changed) light
 * up.
 *
 * Returns a ref to attach to the container whose `[data-tile-id]` descendants
 * should animate. Pass `enabled` (we only animate while spectating), a `key`
 * that changes whenever the board content does, and the signature map.
 */
export function useTileFlip<T extends HTMLElement>(
  enabled: boolean,
  key: string,
  signatures: Map<string, string>,
) {
  const containerRef = useRef<T>(null);
  const prev = useRef<Map<string, DOMRect>>(new Map());
  const prevSig = useRef<Map<string, string>>(new Map());

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const nodes = Array.from(container.querySelectorAll<HTMLElement>("[data-tile-id]"));
    const next = new Map<string, DOMRect>();
    for (const node of nodes) next.set(node.dataset.tileId!, node.getBoundingClientRect());

    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    // Skip the first pass (nothing to compare to) and any pass where we're not
    // animating; just record positions so the next change has a baseline.
    if (enabled && !reduced && prev.current.size > 0) {
      for (const node of nodes) {
        const id = node.dataset.tileId!;
        const now = next.get(id)!;
        const old = prev.current.get(id);
        // "Involved" in the change: new on the table, or its group context
        // (left neighbour) changed. A tile merely shoved by reflow keeps its
        // context, so it glides but doesn't light up.
        const affected = !old || prevSig.current.get(id) !== signatures.get(id);
        if (!old) {
          // Entering: a tile the opponent just laid on the table.
          node.animate(
            [
              { opacity: 0, transform: "scale(0.8)" },
              { opacity: 1, transform: "scale(1)" },
            ],
            { duration: 180, easing: "ease-out" },
          );
        } else {
          const dx = old.left - now.left;
          const dy = old.top - now.top;
          if (dx || dy) {
            // Glide from the previous slot — even for reflow-pushed tiles, so
            // groups slide smoothly.
            node.animate(
              [
                { transform: `translate(${dx}px, ${dy}px)` },
                { transform: "translate(0, 0)" },
              ],
              { duration: 240, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
            );
          }
        }
        // Slow-fading highlight (see `highlight`) so the eye can follow what
        // actually changed even as later moves stream in.
        if (affected) highlight(node);
      }
    }

    prev.current = next;
    prevSig.current = signatures;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);

  return containerRef;
}
