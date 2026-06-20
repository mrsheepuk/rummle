import { useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Tile } from "../game/types";
import type { MeldIds } from "../game/rules";
import { analyzeMeld } from "../game/melds";
import { rackSortKey } from "../game/tiles";
import { TileView } from "./TileView";

const RACK = "rack";
const NEW_MELD = "new-meld";

type Containers = Record<string, string[]>;

export interface BoardHandle {
  table: MeldIds[];
  rack: string[];
  dirty: boolean;
}

/**
 * The play surface for the active player: a drag-and-drop board where tiles
 * move between the rack and table melds. The committed game state is the
 * source of truth; edits here are local until the player commits or resets.
 */
export function Board({
  table,
  rack,
  index,
  interactive,
  onChange,
}: {
  table: MeldIds[];
  rack: string[];
  index: Map<string, Tile>;
  interactive: boolean;
  onChange: (handle: BoardHandle) => void;
}) {
  const [containers, setContainers] = useState<Containers>(() => buildContainers(table, rack));
  const [meldOrder, setMeldOrder] = useState<string[]>(() => meldKeys(table));
  const [activeId, setActiveId] = useState<string | null>(null);
  const nextMeldId = useRef(table.length);

  // Re-seed local state whenever the committed game state changes (new turn,
  // an opponent's move, etc.). A signature avoids clobbering an in-progress
  // drag on unrelated re-renders.
  const signature = useMemo(
    () => JSON.stringify({ table, rack }),
    [table, rack],
  );
  useEffect(() => {
    setContainers(buildContainers(table, rack));
    setMeldOrder(meldKeys(table));
    nextMeldId.current = table.length;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  // Report the current table/rack up to the parent for commit.
  useEffect(() => {
    const tableMelds = meldOrder
      .map((k) => containers[k] ?? [])
      .filter((m) => m.length > 0);
    onChange({ table: tableMelds, rack: containers[RACK] ?? [], dirty: signature !== JSON.stringify({ table: tableMelds, rack: containers[RACK] ?? [] }) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containers, meldOrder]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 120, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function findContainer(id: string): string | undefined {
    if (id in containers) return id;
    return Object.keys(containers).find((key) => containers[key]!.includes(id));
  }

  function handleDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }

  function handleDragOver(e: DragOverEvent) {
    const { active, over } = e;
    if (!over) return;
    const activeContainer = findContainer(String(active.id));
    let overContainer = findContainer(String(over.id)) ?? String(over.id);
    if (overContainer === NEW_MELD) overContainer = materializeNewMeld();
    if (!activeContainer || activeContainer === overContainer) return;

    setContainers((prev) => {
      const from = prev[activeContainer] ?? [];
      const to = prev[overContainer] ?? [];
      if (!from.includes(String(active.id))) return prev;
      const overIndex = to.indexOf(String(over.id));
      const insertAt = overIndex >= 0 ? overIndex : to.length;
      return {
        ...prev,
        [activeContainer]: from.filter((t) => t !== String(active.id)),
        [overContainer]: [...to.slice(0, insertAt), String(active.id), ...to.slice(insertAt)],
      };
    });
  }

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    setActiveId(null);
    if (!over) return;
    const container = findContainer(String(active.id));
    const overContainer = findContainer(String(over.id));
    if (!container || container !== overContainer) return;
    const items = containers[container]!;
    const oldIndex = items.indexOf(String(active.id));
    const newIndex = items.indexOf(String(over.id));
    if (oldIndex !== newIndex && newIndex >= 0) {
      setContainers((prev) => ({ ...prev, [container]: arrayMove(prev[container]!, oldIndex, newIndex) }));
    }
  }

  function materializeNewMeld(): string {
    const key = `meld-${nextMeldId.current++}`;
    setContainers((prev) => ({ ...prev, [key]: [] }));
    setMeldOrder((prev) => [...prev, key]);
    return key;
  }

  function sortRack() {
    setContainers((prev) => {
      const sorted = [...(prev[RACK] ?? [])].sort((a, b) => {
        const ta = index.get(a);
        const tb = index.get(b);
        if (!ta || !tb) return 0;
        return rackSortKey(ta) - rackSortKey(tb);
      });
      return { ...prev, [RACK]: sorted };
    });
  }

  const activeTile = activeId ? index.get(activeId) : null;
  const visibleMelds = meldOrder.filter((k) => (containers[k] ?? []).length > 0);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div className="table-area">
        {visibleMelds.length === 0 && (
          <p className="table-empty">No melds on the table yet.</p>
        )}
        {visibleMelds.map((key) => (
          <MeldRow key={key} id={key} items={containers[key] ?? []} index={index} disabled={!interactive} />
        ))}
        {interactive && <NewMeldDrop />}
      </div>

      <div className="rack-area">
        <div className="rack-header">
          <span>Your tiles ({(containers[RACK] ?? []).length})</span>
          {interactive && (
            <button className="btn btn-small" onClick={sortRack} type="button">
              Sort
            </button>
          )}
        </div>
        <MeldRow id={RACK} items={containers[RACK] ?? []} index={index} disabled={!interactive} variant="rack" />
      </div>

      <DragOverlay>{activeTile ? <TileView tile={activeTile} dragging /> : null}</DragOverlay>
    </DndContext>
  );
}

function MeldRow({
  id,
  items,
  index,
  disabled,
  variant,
}: {
  id: string;
  items: string[];
  index: Map<string, Tile>;
  disabled: boolean;
  variant?: "rack" | "meld";
}) {
  const { setNodeRef } = useDroppable({ id });
  const tiles = items.map((tid) => index.get(tid)).filter(Boolean) as Tile[];
  const analysis = variant === "rack" || items.length === 0 ? null : analyzeMeld(tiles);
  const cls = ["meld-row", variant === "rack" ? "rack-row" : "meld", analysis && !analysis.valid ? "meld-invalid" : "", analysis?.valid ? "meld-valid" : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <div ref={setNodeRef} className={cls}>
      <SortableContext items={items} strategy={horizontalListSortingStrategy}>
        {items.map((tid) => {
          const tile = index.get(tid);
          if (!tile) return null;
          return <SortableTile key={tid} id={tid} tile={tile} disabled={disabled} />;
        })}
      </SortableContext>
      {variant !== "rack" && analysis && (
        <span className="meld-points">{analysis.valid ? `${analysis.points}` : "✗"}</span>
      )}
    </div>
  );
}

function SortableTile({ id, tile, disabled }: { id: string; tile: Tile; disabled: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled,
  });
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
    <div ref={setNodeRef} className={`new-meld-drop${isOver ? " over" : ""}`}>
      Drop here to start a new meld
    </div>
  );
}

function meldKeys(table: MeldIds[]): string[] {
  return table.map((_, i) => `meld-${i}`);
}

function buildContainers(table: MeldIds[], rack: string[]): Containers {
  const out: Containers = { [RACK]: [...rack] };
  table.forEach((meld, i) => {
    out[`meld-${i}`] = [...meld];
  });
  return out;
}
