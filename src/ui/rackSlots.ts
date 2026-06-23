// Free-form rack-slot helpers, shared by both games' play surfaces. The rack is
// a grid of tile-shaped slots (gaps allowed) the player can arrange however they
// like; layout persists across turns and reloads. Extracted from Rummle's Board
// so the word game reuses exactly the same behaviour rather than a divergent copy.

export type Slots = (string | null)[];

/**
 * Enough slots to hold the hand plus spare room for gaps. The CSS grid wraps
 * these to fit whatever width is available; we round the count up to a whole
 * number of rows for the columns currently shown (`cols`) so the last row is
 * always complete — every slot the player can see is one they can drop into.
 */
export function slotCountFor(handSize: number, cols = 0): number {
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
export function insertAt(slots: Slots, t: number, id: string): boolean {
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
export function reconcileSlots(prev: Slots, wanted: string[], len: number): Slots {
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

export function loadSlots(key: string): Slots | null {
  try {
    const p = JSON.parse(localStorage.getItem(key) ?? "null");
    if (Array.isArray(p) && p.every((x) => x === null || typeof x === "string")) return p as Slots;
  } catch {
    /* ignore corrupt / old-format storage */
  }
  return null;
}
