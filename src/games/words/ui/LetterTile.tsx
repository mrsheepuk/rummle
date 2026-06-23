import type { LetterTile as LetterTileT } from "../types";

/**
 * A single letter tile. On the rack it shows its own letter and point value; a
 * blank shows a star until it's been assigned a letter on the board. Mirrors the
 * colour-blind-friendly redundancy idea from Rummle's TileView (letter + value,
 * not colour alone).
 */
export function LetterTile({
  tile,
  /** Effective letter to show (a blank's assigned letter on the board). */
  shown,
  selected,
  onClick,
}: {
  tile: LetterTileT;
  shown?: string;
  selected?: boolean;
  onClick?: () => void;
}) {
  const letter = shown ?? tile.letter;
  const cls = [
    "wtile",
    tile.isBlank ? "wtile-blank" : "",
    selected ? "wtile-selected" : "",
    onClick ? "wtile-clickable" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button type="button" className={cls} onClick={onClick} disabled={!onClick}>
      <span className="wtile-face">{letter ?? "★"}</span>
      <span className="wtile-value">{tile.isBlank ? "" : tile.value}</span>
    </button>
  );
}
