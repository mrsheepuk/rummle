import { useEffect, useState } from "react";
import { clearConnLog, getConnLog, logConn, subscribeConnLog } from "../sync/connectionLog";
import { forceResync } from "../sync/connection";
import { probeGameFromServer } from "../sync/gameSync";
import { notifyDebugState, showTurnNotification } from "./notifications";
import { installDebugState } from "./useInstallPrompt";

// On-screen connection diagnostics for mobile, where the dev console can't be
// reached. Rendered only when `?debug=1` is set. Shows live network/visibility
// state plus a rolling event log, and offers manual triggers so we can tell a
// detection failure (manual resync recovers) from a kick that doesn't help
// (manual resync does nothing — needs a heavier recovery).

export function DebugOverlay({ gameId, stale }: { gameId: string | null; stale: boolean }) {
  const [, force] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => subscribeConnLog(() => force((n) => n + 1)), []);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const log = getConnLog();
  const lastSnap = [...log].reverse().find((e) => e.kind === "snapshot");
  const snapAge = lastSnap ? Math.round((now - lastSnap.t) / 1000) : null;

  async function probe() {
    if (!gameId) return;
    const started = Date.now();
    try {
      const r = await probeGameFromServer(gameId);
      logConn("probe", `ok in ${Date.now() - started}ms turn=${r?.turn ?? "?"} status=${r?.status ?? "?"}`);
    } catch (e) {
      logConn("probe", `FAILED in ${Date.now() - started}ms: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (collapsed) {
    return (
      <button className="dbg-fab" onClick={() => setCollapsed(false)}>
        🐞 {stale ? "stale" : "live"}
      </button>
    );
  }

  return (
    <div className="dbg-panel">
      <div className="dbg-head">
        <strong>conn debug</strong>
        <button className="dbg-x" onClick={() => setCollapsed(true)}>
          ▾
        </button>
      </div>
      <div className="dbg-stats">
        <span className={navigator.onLine ? "ok" : "bad"}>
          net {navigator.onLine ? "online" : "offline"}
        </span>
        <span>vis {document.visibilityState}</span>
        <span className={document.hasFocus() ? "ok" : "bad"}>focus {document.hasFocus() ? "yes" : "no"}</span>
        <span className={stale ? "bad" : "ok"}>{stale ? "stale" : "live"}</span>
        <span>snap {snapAge === null ? "—" : `${snapAge}s ago`}</span>
        <span>notify {notifyDebugState()}</span>
        <span>install {installDebugState()}</span>
      </div>
      <div className="dbg-actions">
        <button onClick={() => void forceResync("debug-button")}>Resync</button>
        <button onClick={() => void probe()} disabled={!gameId}>
          Probe
        </button>
        <button
          onClick={() => {
            void showTurnNotification({ who: "Debug", gameLabel: "test", gameId: gameId ?? "test" }).then((res) =>
              logConn("notify", `manual test → ${res.ok ? `fired:${res.via}` : `skip:${res.reason}`}`),
            );
          }}
        >
          Test
        </button>
        <button onClick={() => clearConnLog()}>Clear</button>
      </div>
      <ol className="dbg-log">
        {[...log].reverse().map((e, i) => (
          <li key={log.length - i}>
            <code>{clock(e.t)}</code> <b>{e.kind}</b> {e.detail}
          </li>
        ))}
      </ol>
    </div>
  );
}

function clock(t: number): string {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
