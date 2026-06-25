import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
import { CSS } from "@dnd-kit/utilities";
import { playClack } from "../../../ui/sounds";
import { insertAt, loadSlots, reconcileSlots, type Slots } from "../../../ui/rackSlots";
import { useScrollEdges, type ScrollEdges } from "../../../ui/useScrollEdges";
import { BOARD_SIZE, CENTER, RACK_SIZE, premiumAt, type LetterTile } from "../types";
import type { Placement } from "../model";
import { LetterTile as LetterTileView } from "./LetterTile";

const PREMIUM_LABEL: Record<string, string> = { DL: "DL", TL: "TL", DW: "DW", TW: "TW" };
const EXCHANGE = "exchange-tray";
/** One row of square slots: the rack plus a couple spare for rearranging room.
 * Kept small so the row fits a phone width without horizontal scrolling. */
const RACK_SLOTS = RACK_SIZE + 2;

/** Maps "which edges can still scroll" to the fade-width CSS vars the mask reads. */
function fadeVars(e: ScrollEdges): React.CSSProperties {
  const on = "var(--fade-size)";
  return {
    ["--fade-l"]: e.left ? on : "0px",
    ["--fade-r"]: e.right ? on : "0px",
    ["--fade-t"]: e.top ? on : "0px",
    ["--fade-b"]: e.bottom ? on : "0px",
  } as React.CSSProperties;
}

export interface WordsBoardHandle {
  /** Tiles staged on the board this turn. */
  staged: Placement[];
  /** Rack tiles dragged into the exchange tray. */
  exchange: string[];
}

// Prefer the cell/slot directly under the pointer, then any it overlaps, then
// nearest — keeps drops accurate across the rack and the board grid.
const collisionDetection: CollisionDetection = (args) => {
  const pointer = pointerWithin(args);
  if (pointer.length > 0) return pointer;
  const rects = rectIntersection(args);
  if (rects.length > 0) return rects;
  return closestCorners(args);
};

type Located =
  | { kind: "slot"; index: number }
  | { kind: "staged"; placement: Placement }
  | { kind: "exchange" };
type Target = { kind: "slot"; index: number } | { kind: "cell"; r: number; c: number } | { kind: "exchange" };

/**
 * The drag-and-drop play surface. The rack is a single row of square slots
 * (gaps allowed; Rummle's exact insert/shift mechanics) you can rearrange any
 * time to try out words. The board is a 15×15 grid in a scrollable "slippy"
 * viewport — drag tiles onto it, and around it, on your turn; pan to see more
 * while the rack stays in view. Drag rack tiles into the exchange tray to swap.
 */
export function WordsBoard({
  board,
  rack,
  index,
  myTurn,
  zoomed,
  spectated,
  storageKey,
  resetNonce,
  onChange,
}: {
  board: Placement[];
  rack: string[];
  index: Map<string, LetterTile>;
  myTurn: boolean;
  /** Zoomed-in (slippy) view vs fit-whole-board; drives re-centring. */
  zoomed: boolean;
  /** When spectating, the active player's in-progress placements (read-only). */
  spectated?: Placement[];
  storageKey: string;
  resetNonce: number;
  onChange: (handle: WordsBoardHandle) => void;
}) {
  const boardKey = useMemo(() => JSON.stringify(board), [board]);
  const rackKey = useMemo(() => JSON.stringify(rack), [rack]);

  const { ref: viewportRef, edges: boardEdges } = useScrollEdges<HTMLDivElement>();
  const { ref: rackRef, edges: rackEdges } = useScrollEdges<HTMLDivElement>();

  const [staged, setStaged] = useState<Placement[]>([]);
  const [exchange, setExchange] = useState<string[]>([]);
  const [slots, setSlots] = useState<Slots>(() =>
    reconcileSlots(loadSlots(storageKey) ?? [], rack, RACK_SLOTS),
  );
  const [activeId, setActiveId] = useState<string | null>(null);

  const slotsRef = useRef(slots);
  slotsRef.current = slots;
  const stagedRef = useRef(staged);
  stagedRef.current = staged;
  const exchangeRef = useRef(exchange);
  exchangeRef.current = exchange;

  const prevMyTurn = useRef(myTurn);
  const prevReset = useRef(resetNonce);
  const prevBoard = useRef(boardKey);

  const committed = useMemo(() => {
    const m = new Map<string, Placement>();
    for (const p of board) m.set(`${p.r},${p.c}`, p);
    return m;
  }, [boardKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Opponent's in-progress tiles (spectating only), shown read-only.
  const spectatedMap = useMemo(() => {
    const m = new Map<string, Placement>();
    for (const p of spectated ?? []) m.set(`${p.r},${p.c}`, p);
    return m;
  }, [spectated]);

  // Centre the board viewport whenever we enter the zoomed view (and on mount if
  // it starts zoomed), so the player lands in the middle rather than top-left.
  // Fit view fills the viewport, so there's nothing to centre there.
  useLayoutEffect(() => {
    const vp = viewportRef.current;
    if (!vp || !zoomed) return;
    vp.scrollLeft = (vp.scrollWidth - vp.clientWidth) / 2;
    vp.scrollTop = (vp.scrollHeight - vp.clientHeight) / 2;
  }, [zoomed]);

  // Reseed the working play on turn / reset / committed-board changes, without
  // clobbering an in-progress turn or the player's rack layout.
  useEffect(() => {
    const reseed =
      !myTurn || prevMyTurn.current !== myTurn || prevReset.current !== resetNonce || prevBoard.current !== boardKey;

    const workingStaged = reseed ? [] : stagedRef.current;
    const workingExchange = reseed ? [] : exchangeRef.current;
    const held = new Set([...workingStaged.map((p) => p.tileId), ...workingExchange]);
    const wanted = rack.filter((id) => !held.has(id));

    if (reseed) {
      setStaged([]);
      setExchange([]);
    }
    setSlots(reconcileSlots(slotsRef.current, wanted, RACK_SLOTS));

    prevMyTurn.current = myTurn;
    prevReset.current = resetNonce;
    prevBoard.current = boardKey;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myTurn, boardKey, rackKey, resetNonce]);

  const slotsKey = slots.map((s) => s ?? "").join("|");
  const stagedKey = JSON.stringify(staged);
  const exchangeKey = exchange.join(",");

  // Persist rack layout and report the working play upward.
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(slots));
    } catch {
      /* ignore storage failures */
    }
    onChange({ staged, exchange });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slotsKey, stagedKey, exchangeKey]);

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
    if (exchange.includes(id)) return { kind: "exchange" };
    return null;
  }

  function classifyOver(overId: string): Target | null {
    if (overId === EXCHANGE) return { kind: "exchange" };
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
    const involvesBoard = src.kind !== "slot" || target.kind !== "slot";
    if (!myTurn && involvesBoard) return;

    const newSlots = slots.slice();
    let newStaged = staged.slice();
    let newExchange = exchange.slice();
    const removeSource = () => {
      if (src.kind === "slot") newSlots[src.index] = null;
      else if (src.kind === "staged") newStaged = newStaged.filter((p) => p.tileId !== id);
      else newExchange = newExchange.filter((x) => x !== id);
    };

    if (target.kind === "slot") {
      if (slots[target.index] === id) return; // onto itself
      removeSource(); // a tile returning to the rack loses any blank assignment
      if (!insertAt(newSlots, target.index, id)) return; // no room
      setSlots(newSlots);
      setStaged(newStaged);
      setExchange(newExchange);
      playClack(0.1);
      return;
    }

    if (target.kind === "exchange") {
      removeSource();
      newExchange.push(id);
      setSlots(newSlots);
      setStaged(newStaged);
      setExchange(newExchange);
      playClack(0.16);
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
    setExchange(newExchange);
    playClack(0.22);
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
      <div className="wboard-frame">
        <div className="wboard-viewport" ref={viewportRef}>
          <div className="wboard">
            {Array.from({ length: BOARD_SIZE }, (_, r) => (
              <div key={r} className="wrow">
                {Array.from({ length: BOARD_SIZE }, (_, c) => {
                  const fixed = committed.get(`${r},${c}`);
                  const stagedHere = staged.find((p) => p.r === r && p.c === c);
                  const draftHere = !fixed && !stagedHere ? spectatedMap.get(`${r},${c}`) : undefined;
                  return (
                    <BoardCell
                      key={c}
                      r={r}
                      c={c}
                      fixed={fixed}
                      staged={stagedHere}
                      draft={draftHere}
                      index={index}
                      droppable={myTurn && !fixed}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
        {/* Soft dark edge-shadow shown only where the board can still scroll —
            makes the surface look like it passes under the frame. */}
        <div className="wedges" aria-hidden="true" style={fadeVars(boardEdges)} />
      </div>

      <div className="rack-area">
        <div className="wrack-frame">
          <div className="wrack-row" ref={rackRef}>
            {slots.map((tileId, i) => (
              <Slot key={i} index={i} tile={tileId ? index.get(tileId) : undefined} />
            ))}
          </div>
          <div className="wedges" aria-hidden="true" style={fadeVars(rackEdges)} />
        </div>
        {myTurn && <ExchangeTray ids={exchange} index={index} />}
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
  draft,
  index,
  droppable,
}: {
  r: number;
  c: number;
  fixed: Placement | undefined;
  staged: Placement | undefined;
  draft: Placement | undefined;
  index: Map<string, LetterTile>;
  droppable: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `cell-${r}-${c}`, disabled: !droppable });
  const premium = premiumAt(r, c);
  const isCenter = r === CENTER && c === CENTER;
  const occupant = fixed ?? staged ?? draft;
  const tile = occupant ? index.get(occupant.tileId) : undefined;
  const cls = [
    "wcell",
    premium ? `wcell-${premium.toLowerCase()}` : "",
    isCenter ? "wcell-center" : "",
    isOver ? "wcell-over" : "",
  ]
    .filter(Boolean)
    .join(" ");

  function content() {
    if (!occupant || !tile) {
      return premium ? <span className="wcell-premium">{isCenter ? "★" : PREMIUM_LABEL[premium]}</span> : null;
    }
    if (staged) return <DraggableLetter id={occupant.tileId} tile={tile} shown={occupant.letter} variant="staged" />;
    if (fixed) return <LetterTileView tile={tile} shown={occupant.letter} variant="fixed" />;
    // Spectated draft tile — read-only, fades in (keyed by tile so it re-animates
    // when an opponent moves a tile into this cell).
    return <LetterTileView key={occupant.tileId} tile={tile} shown={occupant.letter} variant="draft" />;
  }

  return (
    <div ref={droppable ? setNodeRef : undefined} className={cls}>
      {content()}
    </div>
  );
}

function Slot({ index, tile }: { index: number; tile: LetterTile | undefined }) {
  const { setNodeRef, isOver } = useDroppable({ id: `slot-${index}` });
  return (
    <div ref={setNodeRef} className={`wrack-slot${tile ? " filled" : ""}${isOver ? " over" : ""}`}>
      {tile ? <DraggableLetter id={tile.id} tile={tile} /> : null}
    </div>
  );
}

function ExchangeTray({ ids, index }: { ids: string[]; index: Map<string, LetterTile> }) {
  const { setNodeRef, isOver } = useDroppable({ id: EXCHANGE });
  return (
    <div ref={setNodeRef} className={`wexchange${isOver ? " over" : ""}${ids.length ? " has-tiles" : ""}`}>
      {ids.length === 0 ? (
        <span className="wexchange-hint">Drag tiles here to exchange them</span>
      ) : (
        ids.map((id) => {
          const tile = index.get(id);
          return tile ? <DraggableLetter key={id} id={id} tile={tile} /> : null;
        })
      )}
    </div>
  );
}

function DraggableLetter({
  id,
  tile,
  shown,
  variant,
}: {
  id: string;
  tile: LetterTile;
  shown?: string;
  variant?: "staged" | "fixed";
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id });
  const style = { transform: CSS.Translate.toString(transform), opacity: isDragging ? 0.4 : 1 };
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <LetterTileView tile={tile} shown={shown} variant={variant} />
    </div>
  );
}
