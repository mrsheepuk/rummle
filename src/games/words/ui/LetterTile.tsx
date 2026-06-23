import type { LetterTile as LetterTileT } from "../types";

/**
 * A presentational rack/overlay letter tile. Interaction (drag, tap-to-select)
 * is owned by the draggable wrapper in WordsBoard, so this is just the face.
 * A blank shows a star until it's been assigned a letter. Mirrors the
 * colour-blind-friendly redundancy from Rummle's TileView (letter + value).
 */
export function LetterTile({
  tile,
  /** Effective letter to show (a blank's assigned letter). */
  shown,
  selected,
}: {
  tile: LetterTileT;
  shown?: string;
  selected?: boolean;
}) {
  const letter = shown ?? tile.letter;
  const cls = ["wtile", tile.isBlank ? "wtile-blank" : "", selected ? "wtile-selected" : ""]
    .filter(Boolean)
    .join(" ");
  return (
    <span className={cls}>
      <span className="wtile-face">{letter ?? "★"}</span>
      <span className="wtile-value">{tile.isBlank ? "" : tile.value}</span>
    </span>
  );
}
