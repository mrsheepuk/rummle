// Lightweight connection-event log for diagnosing reconnection on mobile, where
// the dev console isn't reachable. A ring buffer of recent events feeds an
// on-screen overlay (see DebugOverlay) so a user can reproduce a frozen-tab
// stall on their phone and read back exactly what the Firestore listener,
// visibility, and network signals did. Gated by `debugEnabled()` so it's inert
// for normal players; enable with `?debug=1` (sticky via localStorage).

export type ConnEventKind =
  | "snapshot" // a game snapshot arrived (detail: fromCache/pending/turn)
  | "visible" // tab foregrounded
  | "hidden" // tab backgrounded
  | "online" // browser regained network
  | "offline" // browser lost network
  | "resync" // forceResync lifecycle (start/done/skip)
  | "probe" // manual server read result
  | "notify" // "your turn" notification decision (gate + outcome)
  | "note"; // ad-hoc marker

export interface ConnEvent {
  /** Wall-clock ms (Date.now()) when logged. */
  t: number;
  kind: ConnEventKind;
  detail?: string;
}

const BUFFER = 100;
let events: ConnEvent[] = [];
const listeners = new Set<() => void>();

let enabled: boolean | null = null;

/** Whether debug instrumentation is on. Sticky once `?debug=1` is seen. */
export function debugEnabled(): boolean {
  if (enabled !== null) return enabled;
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get("debug") === "1") window.localStorage.setItem("rummle:debug", "1");
    if (params.get("debug") === "0") window.localStorage.removeItem("rummle:debug");
    enabled = window.localStorage.getItem("rummle:debug") === "1";
  } catch {
    enabled = false;
  }
  return enabled;
}

export function logConn(kind: ConnEventKind, detail?: string): void {
  if (!debugEnabled()) return;
  events = [...events, { t: Date.now(), kind, detail }].slice(-BUFFER);
  listeners.forEach((l) => l());
  // Also emit to the console for anyone who *can* attach a remote inspector.
  // eslint-disable-next-line no-console
  console.log(`[conn] ${kind}${detail ? " " + detail : ""}`);
}

export function getConnLog(): ConnEvent[] {
  return events;
}

export function clearConnLog(): void {
  events = [];
  listeners.forEach((l) => l());
}

export function subscribeConnLog(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
