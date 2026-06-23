import { BOARD_SIZE, CENTER, premiumAt, type LetterTile } from "../types";
import type { Placement } from "../model";

const PREMIUM_LABEL: Record<string, string> = { DL: "DL", TL: "TL", DW: "DW", TW: "TW" };

interface CellState {
  letter: string;
  tileId: string;
  staged: boolean;
}

/**
 * The 15×15 play surface. Committed tiles are fixed; tiles staged this turn are
 * highlighted and can be tapped to recall. With a rack tile selected, tapping an
 * empty square places it (POC tap-to-place; drag-and-drop is a follow-up).
 */
export function WordsBoard({
  board,
  staged,
  index,
  interactive,
  onPlace,
  onRecall,
}: {
  board: Placement[];
  staged: Placement[];
  index: Map<string, LetterTile>;
  interactive: boolean;
  onPlace: (r: number, c: number) => void;
  onRecall: (tileId: string) => void;
}) {
  const cells = new Map<string, CellState>();
  for (const p of board) cells.set(`${p.r},${p.c}`, { letter: p.letter, tileId: p.tileId, staged: false });
  for (const p of staged) cells.set(`${p.r},${p.c}`, { letter: p.letter, tileId: p.tileId, staged: true });

  const rows = [];
  for (let r = 0; r < BOARD_SIZE; r++) {
    const row = [];
    for (let c = 0; c < BOARD_SIZE; c++) {
      const cell = cells.get(`${r},${c}`);
      const premium = premiumAt(r, c);
      const isCenter = r === CENTER && c === CENTER;
      const classes = [
        "wcell",
        premium ? `wcell-${premium.toLowerCase()}` : "",
        isCenter ? "wcell-center" : "",
        cell ? "wcell-filled" : "",
        cell?.staged ? "wcell-staged" : "",
      ]
        .filter(Boolean)
        .join(" ");
      const tile = cell ? index.get(cell.tileId) : undefined;
      const onClick = () => {
        if (!interactive) return;
        if (cell?.staged) onRecall(cell.tileId);
        else if (!cell) onPlace(r, c);
      };
      row.push(
        <div key={c} className={classes} onClick={onClick}>
          {cell ? (
            <span className="wcell-tile">
              <span className="wcell-letter">{cell.letter}</span>
              {tile && !tile.isBlank && <span className="wcell-value">{tile.value}</span>}
            </span>
          ) : (
            premium && <span className="wcell-premium">{isCenter ? "★" : PREMIUM_LABEL[premium]}</span>
          )}
        </div>,
      );
    }
    rows.push(
      <div key={r} className="wrow">
        {row}
      </div>,
    );
  }

  return <div className="wboard">{rows}</div>;
}
