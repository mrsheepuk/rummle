import { useEffect, useRef, useState } from "react";

export interface ScrollEdges {
  top: boolean;
  right: boolean;
  bottom: boolean;
  left: boolean;
}

const NONE: ScrollEdges = { top: false, right: false, bottom: false, left: false };

/**
 * Tracks which edges of a scroll container still have content beyond the
 * viewport, so the UI can show a fade only where you can actually scroll. Re-
 * measures on scroll and on resize (content or container). Shared by the word
 * game's board viewport and rack; usable by any scrollable surface.
 */
export function useScrollEdges<T extends HTMLElement>(): { ref: React.RefObject<T>; edges: ScrollEdges } {
  const ref = useRef<T>(null);
  const [edges, setEdges] = useState<ScrollEdges>(NONE);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const eps = 1; // sub-pixel slack so a fully-scrolled edge reads as closed
      const next: ScrollEdges = {
        left: el.scrollLeft > eps,
        right: el.scrollLeft < el.scrollWidth - el.clientWidth - eps,
        top: el.scrollTop > eps,
        bottom: el.scrollTop < el.scrollHeight - el.clientHeight - eps,
      };
      setEdges((prev) =>
        prev.left === next.left && prev.right === next.right && prev.top === next.top && prev.bottom === next.bottom
          ? prev // unchanged — skip the re-render (scroll fires a lot)
          : next,
      );
    };
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    // Observe the container *and* its content: a zoom/size change resizes the
    // content (not the viewport), which still changes what's scrollable.
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => {
      el.removeEventListener("scroll", measure);
      ro.disconnect();
    };
  }, []);

  return { ref, edges };
}
