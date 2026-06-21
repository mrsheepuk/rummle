import type { Color, Tile } from "../game/types";

// Each suit carries a distinct *shape* as well as a colour, so the suit is
// never communicated by colour alone — critical for colour-blind players. The
// shape shows as a corner "pip"; greyscale or any CVD type still distinguishes
// suits by shape + lightness.
const SUIT_SHAPE: Record<Color, string> = {
  blue: "●",
  red: "▲",
  orange: "◆",
  black: "■",
};

export function TileView({ tile, dragging }: { tile: Tile; dragging?: boolean }) {
  if (tile.kind === "joker") {
    return (
      <div
        className={`tile tile-joker${dragging ? " tile-dragging" : ""}`}
        aria-label="joker"
      >
        <span className="tile-face">★</span>
      </div>
    );
  }
  return (
    <div
      className={`tile tile-${tile.color}${dragging ? " tile-dragging" : ""}`}
      data-color={tile.color}
      aria-label={`${tile.color} ${tile.value}`}
    >
      <span className="tile-pip" aria-hidden="true">
        {SUIT_SHAPE[tile.color]}
      </span>
      <span className="tile-face">{tile.value}</span>
    </div>
  );
}
