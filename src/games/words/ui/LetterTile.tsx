import type { LetterTile as LetterTileT } from "../types";

/**
 * The one canonical letter tile, used identically on the rack and the board so
 * a tile looks the same wherever it sits. Interaction (drag) is owned by the
 * draggable wrapper in WordsBoard; this is just the face. A blank shows a star
 * until it's been assigned a letter. Mirrors the colour-blind-friendly
 * redundancy from Rummle's TileView (letter + value).
 */
export function LetterTile({
  tile,
  /** Effective letter to show (a blank's assigned letter). */
  shown,
  /** "staged" = placed this turn (accent ring); "fixed" = committed (locked);
   *  "draft" = an opponent's in-progress tile we're spectating (fades in). */
  variant,
}: {
  tile: LetterTileT;
  shown?: string;
  variant?: "staged" | "fixed" | "draft";
}) {
  const letter = shown ?? tile.letter;
  const cls = ["wtile", tile.isBlank ? "wtile-blank" : "", variant ? `wtile-${variant}` : ""]
    .filter(Boolean)
    .join(" ");
  return (
    <span className={cls}>
      <span className="wtile-face">{letter ?? "★"}</span>
      {!tile.isBlank && <span className="wtile-value">{tile.value}</span>}
    </span>
  );
}
