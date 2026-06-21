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
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Tile } from "../game/types";
import type { MeldIds } from "../game/rules";
import { analyzeMeld } from "../game/melds";
import { rackSortByNumberKey, rackSortKey } from "../game/tiles";
import { playClack } from "./sounds";
import { TileView } from "./TileView";
import { useTileFlip } from "./useTileFlip";

/** Rack slots are laid out by CSS (auto-fill), so this is just how many slots
 * to provide: the hand plus spare room for gaps, with a sensible minimum. */
const NEW_MELD = "new-meld";

type Slots = (string | null)[];
type Melds = Record<string, string[]>;

export interface BoardHandle {
  table: MeldIds[];
  rack: string[];
}

const isMeldKey = (k: string) => k.startsWith("meld-");
const meldNum = (k: string) => Number(k.slice(5));

/** True when the dragged tile's centre has crossed past the centre of the tile
 * it was dropped on — i.e. it should land to the *right* of that tile, not the
 * left. Lets you drop onto the right half of the last tile to append. */
function droppedAfter(e: DragEndEvent): boolean {
  const over = e.over?.rect;
  const active = e.active.rect.current.translated;
  if (!over || !active) return false;
  return active.left + active.width / 2 > over.left + over.width / 2;
}

// Prefer the slot/zone directly under the pointer, then any it overlaps, then
// nearest corner. Keeps drops accurate for both small slots and large zones.
const collisionDetection: CollisionDetection = (args) => {
  const pointer = pointerWithin(args);
  if (pointer.length > 0) return pointer;
  const rects = rectIntersection(args);
  if (rects.length > 0) return rects;
  return closestCorners(args);
};

/** Enough slots to hold the hand plus spare room for gaps. The CSS grid wraps
 * these to fit whatever width is available; we round the count up to a whole
 * number of rows for the columns currently shown (`cols`) so the last row is
 * always complete — every slot the player can see is one they can drop into. */
function slotCountFor(handSize: number, cols = 0): number {
  const base = Math.max(21, handSize + Math.max(7, Math.ceil(handSize * 0.4)));
  return cols > 0 ? Math.ceil(base / cols) * cols : base;
}

/**
 * Insert `id` at slot `t`, shifting the run of tiles starting at `t` toward the
 * nearest gap so an occupied target makes room rather than swapping. Shifts
 * right into the first empty slot at/after `t` (a deliberate gap further right
 * stops the shift); if the rack is packed solid from `t` onward, falls back to
 * shifting left into the nearest gap before `t`. Mutates `slots`; returns false
 * (no change) only when there is no empty slot anywhere to absorb the insert.
 */
function insertAt(slots: Slots, t: number, id: string): boolean {
  let gap = -1;
  for (let i = t; i < slots.length; i++) if (slots[i] === null) { gap = i; break; }
  if (gap >= 0) {
    for (let i = gap; i > t; i--) slots[i] = slots[i - 1]!;
    slots[t] = id;
    return true;
  }
  for (let i = t; i >= 0; i--) if (slots[i] === null) { gap = i; break; }
  if (gap < 0) return false;
  for (let i = gap; i < t; i++) slots[i] = slots[i + 1]!;
  slots[t] = id;
  return true;
}

/**
 * Keeps each tile in the slot the player put it in (preserving gaps), drops
 * tiles no longer in hand, and places genuinely new tiles (drawn) in the first
 * free slot *after the last tile in the rack* so a freshly drawn tile is easy
 * to spot. This is what lets a player's free-form rack layout persist across
 * turns and reloads.
 */
function reconcileSlots(prev: Slots, wanted: string[], len: number): Slots {
  const want = new Set(wanted);
  const placed = new Set<string>();
  const slots: Slots = [];
  let lastFilled = -1;
  for (let i = 0; i < len; i++) {
    const id = prev[i] ?? null;
    if (id && want.has(id) && !placed.has(id)) {
      slots[i] = id;
      placed.add(id);
      lastFilled = i;
    } else {
      slots[i] = null;
    }
  }
  // Drawn tiles slot in just past the last occupied position…
  const newcomers = wanted.filter((id) => !placed.has(id));
  let cursor = lastFilled + 1;
  for (const id of newcomers) {
    while (cursor < len && slots[cursor] !== null) cursor++;
    if (cursor < len) {
      slots[cursor] = id;
      placed.add(id);
    }
  }
  // …falling back to earlier gaps only if we ran out of room at the end.
  if (placed.size < want.size) {
    let early = 0;
    for (const id of wanted) {
      if (placed.has(id)) continue;
      while (early < len && slots[early] !== null) early++;
      if (early < len) {
        slots[early] = id;
        placed.add(id);
      }
    }
  }
  return slots;
}

function rebuildMelds(table: MeldIds[]): Melds {
  const m: Melds = {};
  table.forEach((tiles, i) => (m[`meld-${i}`] = [...tiles]));
  return m;
}

function pruneEmpty(melds: Melds): Melds {
  const out: Melds = {};
  for (const k of Object.keys(melds)) if ((melds[k] ?? []).length > 0) out[k] = melds[k]!;
  return out;
}

function loadSlots(key: string): Slots | null {
  try {
    const p = JSON.parse(localStorage.getItem(key) ?? "null");
    if (Array.isArray(p) && p.every((x) => x === null || typeof x === "string")) return p as Slots;
  } catch {
    /* ignore corrupt / old-format storage */
  }
  return null;
}

type Located = { kind: "slot"; index: number } | { kind: "meld"; key: string };
type Target =
  | { kind: "slot"; index: number }
  | { kind: "meld"; key: string; index: number }
  | { kind: "newmeld" };

/** Keeps a meld display order in sync with the meld set: drop removed keys,
 * append new ones (by id) so reordering survives tile edits. */
function syncOrder(order: string[], melds: Melds): string[] {
  const keys = Object.keys(melds).filter(isMeldKey);
  const present = new Set(keys);
  const kept = order.filter((k) => present.has(k));
  const keptSet = new Set(kept);
  const added = keys.filter((k) => !keptSet.has(k)).sort((a, b) => meldNum(a) - meldNum(b));
  return [...kept, ...added];
}

/**
 * The play surface. The rack is a free-form grid of tile-shaped slots the
 * player can arrange however they like (gaps allowed), rearrangeable at any
 * time. The table melds are ordered lists, editable only on the player's turn.
 */
export function Board({
  committedTable,
  hand,
  index,
  myTurn,
  storageKey,
  resetNonce,
  sortNonce,
  sortMode,
  onChange,
}: {
  committedTable: MeldIds[];
  hand: string[];
  index: Map<string, Tile>;
  myTurn: boolean;
  storageKey: string;
  resetNonce: number;
  sortNonce: number;
  sortMode: "color" | "number";
  onChange: (handle: BoardHandle) => void;
}) {
  const committedKey = useMemo(() => JSON.stringify(committedTable), [committedTable]);
  const handKey = useMemo(() => JSON.stringify(hand), [hand]);

  // How many columns the rack grid is currently showing. Measured from the DOM
  // (the grid uses CSS auto-fill) so we can keep the slot count a whole multiple
  // of it — see `slotCountFor` and the re-pad effect below.
  const gridRef = useRef<HTMLDivElement>(null);
  const [cols, setCols] = useState(0);

  const [slots, setSlots] = useState<Slots>(() =>
    reconcileSlots(loadSlots(storageKey) ?? [], hand, slotCountFor(hand.length)),
  );
  const [melds, setMelds] = useState<Melds>(() => rebuildMelds(committedTable));
  const [meldOrder, setMeldOrder] = useState<string[]>(() => committedTable.map((_, i) => `meld-${i}`));
  const [activeId, setActiveId] = useState<string | null>(null);

  const nextMeldId = useRef(committedTable.length);
  const slotsRef = useRef(slots);
  slotsRef.current = slots;
  const meldsRef = useRef(melds);
  meldsRef.current = melds;

  const prevMyTurn = useRef(myTurn);
  const prevReset = useRef(resetNonce);
  const prevCommitted = useRef(committedKey);

  // Sync working state with external changes without clobbering an in-progress
  // play or the rack layout.
  useEffect(() => {
    const reseedTable =
      !myTurn ||
      prevMyTurn.current !== myTurn ||
      prevReset.current !== resetNonce ||
      prevCommitted.current !== committedKey;

    const workingMelds = reseedTable ? rebuildMelds(committedTable) : meldsRef.current;
    const committedSet = new Set(committedTable.flat());
    const staged = new Set(
      Object.values(workingMelds)
        .flat()
        .filter((id) => !committedSet.has(id)),
    );
    const wanted = hand.filter((id) => !staged.has(id));

    if (reseedTable) {
      setMelds(workingMelds);
      setMeldOrder(committedTable.map((_, i) => `meld-${i}`));
      nextMeldId.current = committedTable.length;
    }
    setSlots(reconcileSlots(slotsRef.current, wanted, slotCountFor(hand.length, cols)));

    prevMyTurn.current = myTurn;
    prevReset.current = resetNonce;
    prevCommitted.current = committedKey;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myTurn, committedKey, handKey, resetNonce]);

  // Track the grid's column count (CSS auto-fill, so it depends on width). The
  // computed `grid-template-columns` expands to one entry per generated track.
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

  // Re-pad the rack to a whole number of rows whenever the column count changes,
  // keeping every placed tile where it is.
  useEffect(() => {
    if (cols <= 0) return;
    setSlots((prev) =>
      reconcileSlots(prev, prev.filter((s): s is string => s !== null), slotCountFor(hand.length, cols)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cols]);

  const slotsKey = slots.map((s) => s ?? "").join("|");
  const meldsKey = JSON.stringify(melds);
  const orderKey = meldOrder.join(",");

  // Persist rack layout and report the committable table/rack upward.
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(slots));
    } catch {
      /* ignore storage failures */
    }
    const table = syncOrder(meldOrder, melds)
      .map((k) => melds[k] ?? [])
      .filter((m) => m.length > 0);
    onChange({ table, rack: slots.filter((s): s is string => s !== null) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slotsKey, meldsKey, orderKey]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 120, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function locate(id: string): Located | null {
    const si = slots.indexOf(id);
    if (si >= 0) return { kind: "slot", index: si };
    for (const k of Object.keys(melds)) if ((melds[k] ?? []).includes(id)) return { kind: "meld", key: k };
    return null;
  }

  function classifyOver(overId: string, after: boolean): Target | null {
    if (overId.startsWith("slot-")) return { kind: "slot", index: Number(overId.slice(5)) };
    if (overId === NEW_MELD) return { kind: "newmeld" };
    if (overId in melds) return { kind: "meld", key: overId, index: (melds[overId] ?? []).length };
    for (const k of Object.keys(melds)) {
      const i = (melds[k] ?? []).indexOf(overId);
      // Drop on the right half of a tile to land after it, left half to land
      // before — otherwise you can never reach the slot past the last tile.
      if (i >= 0) return { kind: "meld", key: k, index: i + (after ? 1 : 0) };
    }
    const si = slots.indexOf(overId);
    if (si >= 0) return { kind: "slot", index: si };
    return null;
  }

  // Commit a meld change and keep the display order in step.
  function commitMelds(next: Melds) {
    const pruned = pruneEmpty(next);
    setMelds(pruned);
    setMeldOrder((o) => syncOrder(o, pruned));
  }

  function handleDragEnd(e: DragEndEvent) {
    const activeId = String(e.active.id);
    setActiveId(null);
    if (!e.over) return;
    const overId = String(e.over.id);

    // Dragging a whole meld (by its grip) reorders melds on the table.
    if (activeId in melds) {
      if (!myTurn) return;
      const overKey =
        overId in melds ? overId : Object.keys(melds).find((k) => (melds[k] ?? []).includes(overId));
      if (!overKey || overKey === activeId) return;
      setMeldOrder((prev) => {
        const order = syncOrder(prev, melds);
        const from = order.indexOf(activeId);
        const to = order.indexOf(overKey);
        return from < 0 || to < 0 ? prev : arrayMove(order, from, to);
      });
      playClack(0.16);
      return;
    }

    const src = locate(activeId);
    const target = classifyOver(overId, droppedAfter(e));
    if (!src || !target) return;

    // Off-turn, only rack rearranging (slot ↔ slot) is allowed.
    const involvesMeld = src.kind === "meld" || target.kind === "meld" || target.kind === "newmeld";
    if (!myTurn && involvesMeld) return;

    const newSlots = slots.slice();
    const newMelds: Melds = {};
    for (const k of Object.keys(melds)) newMelds[k] = melds[k]!.slice();

    // Reorder within the same meld. target.index is a position in the array as
    // it stands (active still present); removing active first shifts everything
    // after it down one, so adjust the insert point accordingly.
    if (src.kind === "meld" && target.kind === "meld" && src.key === target.key) {
      const arr = newMelds[src.key]!;
      const oldI = arr.indexOf(activeId);
      if (oldI < 0) return;
      arr.splice(oldI, 1);
      const to = target.index > oldI ? target.index - 1 : target.index;
      arr.splice(Math.min(Math.max(to, 0), arr.length), 0, activeId);
      commitMelds({ ...newMelds, [src.key]: arr });
      playClack(0.16);
      return;
    }

    // Remove from source.
    if (src.kind === "slot") newSlots[src.index] = null;
    else newMelds[src.key] = newMelds[src.key]!.filter((x) => x !== activeId);

    if (target.kind === "slot") {
      const t = target.index;
      if (slots[t] === activeId) return; // dropped onto itself
      // Insert (shifting tiles aside) rather than swap; an empty target just
      // places the tile, since the shift starts at the gap.
      if (!insertAt(newSlots, t, activeId)) return; // no room — cancel
      setSlots(newSlots);
      if (src.kind === "meld") commitMelds(newMelds);
      playClack(0.1); // faintest tick for arranging the rack
      return;
    }

    if (target.kind === "meld") {
      const arr = newMelds[target.key] ?? (newMelds[target.key] = []);
      arr.splice(Math.min(target.index, arr.length), 0, activeId);
      commitMelds(newMelds);
      if (src.kind === "slot") setSlots(newSlots);
      playClack(0.22); // tile lands on the table — just a hint
      return;
    }

    // New meld.
    newMelds[`meld-${nextMeldId.current++}`] = [activeId];
    commitMelds(newMelds);
    if (src.kind === "slot") setSlots(newSlots);
    playClack(0.22);
  }

  // Sort the rack when triggered from the header menu (sortNonce bumps).
  const prevSort = useRef(sortNonce);
  useEffect(() => {
    if (prevSort.current === sortNonce) return;
    prevSort.current = sortNonce;
    sortRack();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortNonce]);

  function sortRack() {
    const keyFn = sortMode === "number" ? rackSortByNumberKey : rackSortKey;
    setSlots((prev) => {
      const ids = prev.filter((s): s is string => s !== null);
      ids.sort((a, b) => {
        const ta = index.get(a);
        const tb = index.get(b);
        return ta && tb ? keyFn(ta) - keyFn(tb) : 0;
      });
      const next: Slots = Array.from({ length: prev.length }, (_, i) => ids[i] ?? null);
      return next;
    });
  }

  // Animate the table only when spectating: glide opponents' tiles between
  // melds as their throttled draft snapshots stream in. Key on the *rendered*
  // table (`melds`/`meldOrder`), not the incoming `committedTable` prop — for a
  // spectator `melds` is reseeded from the draft a render later (in the sync
  // effect), so keying on the prop measures the DOM one draft behind and lights
  // up the previously dropped tile instead of the current one.
  const tableRef = useTileFlip<HTMLDivElement>(!myTurn, `${meldsKey}|${orderKey}`);

  const activeTile = activeId ? index.get(activeId) : null;
  const activeMeld = activeId && activeId in melds ? melds[activeId] ?? null : null;
  const meldKeys = syncOrder(meldOrder, melds).filter((k) => (melds[k] ?? []).length > 0);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={(e: DragStartEvent) => setActiveId(String(e.active.id))}
      onDragEnd={handleDragEnd}
    >
      <div className="table-area" ref={tableRef}>
        {meldKeys.length === 0 && <p className="table-empty">No melds on the table yet.</p>}
        <SortableContext items={meldKeys} strategy={rectSortingStrategy}>
          {meldKeys.map((key) => (
            <MeldRow key={key} id={key} items={melds[key] ?? []} index={index} tilesDisabled={!myTurn} canReorder={myTurn} />
          ))}
        </SortableContext>
        {myTurn && <NewMeldDrop />}
      </div>

      <div className="rack-area">
        <div className="rack-grid" ref={gridRef}>
          {slots.map((tileId, i) => (
            <Slot key={i} index={i} tile={tileId ? index.get(tileId) : undefined} />
          ))}
        </div>
      </div>

      <DragOverlay>
        {activeMeld ? (
          <div className="meld-row meld meld-drag-preview">
            {activeMeld.map((tid) => {
              const t = index.get(tid);
              return t ? <TileView key={tid} tile={t} /> : null;
            })}
          </div>
        ) : activeTile ? (
          <TileView tile={activeTile} dragging />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function Slot({ index, tile }: { index: number; tile: Tile | undefined }) {
  const { setNodeRef, isOver } = useDroppable({ id: `slot-${index}` });
  return (
    <div ref={setNodeRef} className={`rack-slot${tile ? " filled" : ""}${isOver ? " over" : ""}`}>
      {tile ? <DraggableTile id={tile.id} tile={tile} /> : null}
    </div>
  );
}

function DraggableTile({ id, tile }: { id: string; tile: Tile }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id });
  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.4 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <TileView tile={tile} />
    </div>
  );
}

function MeldRow({
  id,
  items,
  index,
  tilesDisabled,
  canReorder,
}: {
  id: string;
  items: string[];
  index: Map<string, Tile>;
  tilesDisabled: boolean;
  canReorder: boolean;
}) {
  // Sortable at the meld level: the grip below carries the drag listeners so a
  // whole group can be picked up and reordered without disturbing its tiles.
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id,
    disabled: !canReorder,
  });
  const tiles = items.map((tid) => index.get(tid)).filter(Boolean) as Tile[];
  // Validity drives the meld border colour; the point total is intentionally
  // not shown (tallying it is part of play, and it saved board space).
  const analysis = items.length > 0 ? analyzeMeld(tiles) : null;
  const cls = ["meld-row", "meld", analysis && !analysis.valid ? "meld-invalid" : "", analysis?.valid ? "meld-valid" : ""]
    .filter(Boolean)
    .join(" ");
  const style = { transform: CSS.Translate.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };

  return (
    <div ref={setNodeRef} className={cls} style={style}>
      {canReorder && (
        <span className="meld-grip" {...attributes} {...listeners} aria-label="Move group" title="Drag to move this group">
          ⠿
        </span>
      )}
      <SortableContext items={items} strategy={horizontalListSortingStrategy}>
        {items.map((tid) => {
          const tile = index.get(tid);
          if (!tile) return null;
          return <SortableTile key={tid} id={tid} tile={tile} disabled={tilesDisabled} />;
        })}
      </SortableContext>
    </div>
  );
}

function SortableTile({ id, tile, disabled }: { id: string; tile: Tile; disabled: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled });
  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <TileView tile={tile} />
    </div>
  );
}

function NewMeldDrop() {
  const { setNodeRef, isOver } = useDroppable({ id: NEW_MELD });
  return (
    <div
      ref={setNodeRef}
      className={`new-meld-drop${isOver ? " over" : ""}`}
      aria-label="Start a new meld"
      title="Drop here to start a new meld"
    >
      <span aria-hidden="true">+</span>
    </div>
  );
}
