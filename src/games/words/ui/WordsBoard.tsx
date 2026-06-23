import { useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCorners,
  pointerWithin,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { playClack } from "../../../ui/sounds";
import { insertAt, loadSlots, reconcileSlots, slotCountFor, type Slots } from "../../../ui/rackSlots";
import { BOARD_SIZE, CENTER, premiumAt, type LetterTile } from "../types";
import type { Placement } from "../model";
import { LetterTile as LetterTileView } from "./LetterTile";

const PREMIUM_LABEL: Record<string, string> = { DL: "DL", TL: "TL", DW: "DW", TW: "TW" };

export interface WordsBoardHandle {
  /** Tiles staged on the board this turn. */
  staged: Placement[];
  /** Rack tiles tapped for exchange (only meaningful when nothing is staged). */
  selected: string[];
}

// Prefer the cell/slot directly under the pointer, then any it overlaps, then
// nearest — keeps drops accurate across small slots and the board grid.
const collisionDetection: CollisionDetection = (args) => {
  const pointer = pointerWithin(args);
  if (pointer.length > 0) return pointer;
  const rects = rectIntersection(args);
  if (rects.length > 0) return rects;
  return closestCorners(args);
};

type Located = { kind: "slot"; index: number } | { kind: "staged"; placement: Placement };
type Target = { kind: "slot"; index: number } | { kind: "cell"; r: number; c: number };

/**
 * The drag-and-drop play surface. The rack is a free-form grid of tile-shaped
 * slots (gaps allowed) you can rearrange any time to try out words; the board is
 * a 15×15 grid you drag tiles onto — and around — on your turn. Committed tiles
 * are fixed. Tapping (not dragging) a rack tile marks it for exchange.
 */
export function WordsBoard({
  board,
  rack,
  index,
  myTurn,
  storageKey,
  resetNonce,
  onChange,
}: {
  board: Placement[];
  rack: string[];
  index: Map<string, LetterTile>;
  myTurn: boolean;
  storageKey: string;
  resetNonce: number;
  onChange: (handle: WordsBoardHandle) => void;
}) {
  const boardKey = useMemo(() => JSON.stringify(board), [board]);
  const rackKey = useMemo(() => JSON.stringify(rack), [rack]);

  const gridRef = useRef<HTMLDivElement>(null);
  const [cols, setCols] = useState(0);

  const [staged, setStaged] = useState<Placement[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [slots, setSlots] = useState<Slots>(() =>
    reconcileSlots(loadSlots(storageKey) ?? [], rack, slotCountFor(rack.length)),
  );
  const [activeId, setActiveId] = useState<string | null>(null);

  const slotsRef = useRef(slots);
  slotsRef.current = slots;
  const stagedRef = useRef(staged);
  stagedRef.current = staged;

  const prevMyTurn = useRef(myTurn);
  const prevReset = useRef(resetNonce);
  const prevBoard = useRef(boardKey);

  // Committed tiles are fixed; quick lookups by cell.
  const committed = useMemo(() => {
    const m = new Map<string, Placement>();
    for (const p of board) m.set(`${p.r},${p.c}`, p);
    return m;
  }, [boardKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reseed the working play on turn / reset / committed-board changes, without
  // clobbering an in-progress turn or the player's rack layout.
  useEffect(() => {
    const reseed =
      !myTurn || prevMyTurn.current !== myTurn || prevReset.current !== resetNonce || prevBoard.current !== boardKey;

    const workingStaged = reseed ? [] : stagedRef.current;
    const stagedIds = new Set(workingStaged.map((p) => p.tileId));
    const wanted = rack.filter((id) => !stagedIds.has(id));

    if (reseed) {
      setStaged([]);
      setSelected([]);
    }
    setSlots(reconcileSlots(slotsRef.current, wanted, slotCountFor(rack.length, cols)));

    prevMyTurn.current = myTurn;
    prevReset.current = resetNonce;
    prevBoard.current = boardKey;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myTurn, boardKey, rackKey, resetNonce]);

  // Track the rack grid's column count (CSS auto-fill) to keep the slot count a
  // whole number of rows — same approach as Rummle's Board.
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const measure = () => {
      const tmpl = getComputedStyle(grid).gridTemplateColumns;
      const n = tmpl ? tmpl.split(" ").filter(Boolean).length : 0;
      setCols((c) => (n > 0 && n !== c ? n : c));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(grid);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (cols <= 0) return;
    setSlots((prev) =>
      reconcileSlots(prev, prev.filter((s): s is string => s !== null), slotCountFor(rack.length, cols)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cols]);

  const slotsKey = slots.map((s) => s ?? "").join("|");
  const stagedKey = JSON.stringify(staged);
  const selectedKey = selected.join(",");

  // Persist rack layout and report the working play upward.
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(slots));
    } catch {
      /* ignore storage failures */
    }
    onChange({ staged, selected });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slotsKey, stagedKey, selectedKey]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 120, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function locate(id: string): Located | null {
    const si = slots.indexOf(id);
    if (si >= 0) return { kind: "slot", index: si };
    const p = staged.find((p) => p.tileId === id);
    if (p) return { kind: "staged", placement: p };
    return null;
  }

  function classifyOver(overId: string): Target | null {
    if (overId.startsWith("slot-")) return { kind: "slot", index: Number(overId.slice(5)) };
    if (overId.startsWith("cell-")) {
      const [, r, c] = overId.split("-");
      return { kind: "cell", r: Number(r), c: Number(c) };
    }
    return null;
  }

  function handleDragEnd(e: DragEndEvent) {
    const id = String(e.active.id);
    setActiveId(null);
    if (!e.over) return;

    const src = locate(id);
    const target = classifyOver(String(e.over.id));
    if (!src || !target) return;

    // Off-turn, only rack rearranging (slot ↔ slot) is allowed.
    const involvesBoard = src.kind === "staged" || target.kind === "cell";
    if (!myTurn && involvesBoard) return;

    const newSlots = slots.slice();
    let newStaged = staged.slice();
    const removeSource = () => {
      if (src.kind === "slot") newSlots[src.index] = null;
      else newStaged = newStaged.filter((p) => p.tileId !== id);
    };

    if (target.kind === "slot") {
      if (slots[target.index] === id) return; // onto itself
      removeSource();
      // A staged tile recalled to the rack loses any blank assignment.
      if (!insertAt(newSlots, target.index, id)) return; // no room
      setSlots(newSlots);
      setStaged(newStaged);
      setSelected((s) => s.filter((x) => x !== id));
      playClack(0.1);
      return;
    }

    // target cell
    const { r, c } = target;
    if (committed.has(`${r},${c}`)) return; // can't land on a committed tile
    if (newStaged.some((p) => p.r === r && p.c === c)) return; // another staged tile is here

    let letter: string;
    if (src.kind === "staged") {
      letter = src.placement.letter; // moving within the board keeps its letter
    } else {
      const tile = index.get(id);
      if (!tile) return;
      if (tile.isBlank) {
        const ans = window.prompt("Assign a letter to the blank (A–Z):")?.trim().toUpperCase();
        if (!ans || !/^[A-Z]$/.test(ans)) return;
        letter = ans;
      } else {
        letter = tile.letter ?? "";
      }
    }

    removeSource();
    newStaged.push({ r, c, tileId: id, letter });
    setSlots(newSlots);
    setStaged(newStaged);
    setSelected((s) => s.filter((x) => x !== id));
    playClack(0.22);
  }

  function toggleSelect(id: string) {
    if (!myTurn) return;
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  const activeTile = activeId ? index.get(activeId) : null;
  const activeLetter = activeId ? staged.find((p) => p.tileId === activeId)?.letter : undefined;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={(e: DragStartEvent) => setActiveId(String(e.active.id))}
      onDragEnd={handleDragEnd}
    >
      <div className="wboard">
        {Array.from({ length: BOARD_SIZE }, (_, r) => (
          <div key={r} className="wrow">
            {Array.from({ length: BOARD_SIZE }, (_, c) => {
              const fixed = committed.get(`${r},${c}`);
              const stagedHere = staged.find((p) => p.r === r && p.c === c);
              return (
                <BoardCell
                  key={c}
                  r={r}
                  c={c}
                  fixed={fixed}
                  staged={stagedHere}
                  index={index}
                  droppable={myTurn && !fixed}
                />
              );
            })}
          </div>
        ))}
      </div>

      <div className="rack-area">
        <div className="rack-grid wrack-grid" ref={gridRef}>
          {slots.map((tileId, i) => (
            <Slot
              key={i}
              index={i}
              tile={tileId ? index.get(tileId) : undefined}
              selected={tileId ? selected.includes(tileId) : false}
              onSelect={tileId ? () => toggleSelect(tileId) : undefined}
            />
          ))}
        </div>
      </div>

      <DragOverlay>
        {activeTile ? <LetterTileView tile={activeTile} shown={activeLetter ?? undefined} /> : null}
      </DragOverlay>
    </DndContext>
  );
}

function BoardCell({
  r,
  c,
  fixed,
  staged,
  index,
  droppable,
}: {
  r: number;
  c: number;
  fixed: Placement | undefined;
  staged: Placement | undefined;
  index: Map<string, LetterTile>;
  droppable: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `cell-${r}-${c}`, disabled: !droppable });
  const premium = premiumAt(r, c);
  const isCenter = r === CENTER && c === CENTER;
  const occupant = fixed ?? staged;
  const tile = occupant ? index.get(occupant.tileId) : undefined;
  const cls = [
    "wcell",
    premium ? `wcell-${premium.toLowerCase()}` : "",
    isCenter ? "wcell-center" : "",
    occupant ? "wcell-filled" : "",
    isOver ? "wcell-over" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div ref={droppable ? setNodeRef : undefined} className={cls}>
      {occupant ? (
        staged ? (
          <DraggableLetter id={occupant.tileId} tile={tile} shown={occupant.letter} staged />
        ) : (
          <span className="wcell-tile">
            <span className="wcell-letter">{occupant.letter}</span>
            {tile && !tile.isBlank && <span className="wcell-value">{tile.value}</span>}
          </span>
        )
      ) : (
        premium && <span className="wcell-premium">{isCenter ? "★" : PREMIUM_LABEL[premium]}</span>
      )}
    </div>
  );
}

function Slot({
  index,
  tile,
  selected,
  onSelect,
}: {
  index: number;
  tile: LetterTile | undefined;
  selected: boolean;
  onSelect: (() => void) | undefined;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `slot-${index}` });
  return (
    <div ref={setNodeRef} className={`rack-slot${tile ? " filled" : ""}${isOver ? " over" : ""}`}>
      {tile ? <DraggableLetter id={tile.id} tile={tile} selected={selected} onSelect={onSelect} /> : null}
    </div>
  );
}

function DraggableLetter({
  id,
  tile,
  shown,
  selected,
  staged,
  onSelect,
}: {
  id: string;
  tile: LetterTile | undefined;
  shown?: string;
  selected?: boolean;
  staged?: boolean;
  onSelect?: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id });
  if (!tile) return null;
  const style = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    opacity: isDragging ? 0.4 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} onClick={onSelect}>
      {staged ? (
        // A staged tile wears the board-cell face so it sits flush in the grid.
        <span className="wcell-tile wcell-tile-staged">
          <span className="wcell-letter">{shown ?? tile.letter}</span>
          {!tile.isBlank && <span className="wcell-value">{tile.value}</span>}
        </span>
      ) : (
        <LetterTileView tile={tile} shown={shown} selected={selected} />
      )}
    </div>
  );
}
