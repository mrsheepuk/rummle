import type { Tile } from "../game/types";

export function TileView({ tile, dragging }: { tile: Tile; dragging?: boolean }) {
  if (tile.kind === "joker") {
    return (
      <div className={`tile tile-joker${dragging ? " tile-dragging" : ""}`}>
        <span className="tile-face">★</span>
      </div>
    );
  }
  return (
    <div
      className={`tile tile-${tile.color}${dragging ? " tile-dragging" : ""}`}
      data-color={tile.color}
    >
      <span className="tile-face">{tile.value}</span>
    </div>
  );
}
