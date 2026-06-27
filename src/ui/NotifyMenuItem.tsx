import { useState } from "react";
import { notificationPermission, notifyEnabled, setNotifyEnabled } from "./notifications";

/**
 * Shared overflow-menu item that toggles "your turn" notifications. Renders
 * nothing where the API is unsupported (e.g. an iPhone Safari tab). When the
 * browser has blocked notifications it shows as a disabled hint, since only the
 * user can unblock that in their browser settings. Used by both game menus.
 */
export function NotifyMenuItem({ onDone }: { onDone?: () => void }) {
  const [perm, setPerm] = useState(notificationPermission());
  const [on, setOn] = useState(notifyEnabled());

  if (perm === "unsupported") return null;

  if (perm === "denied") {
    return (
      <button className="menu-item" role="menuitem" disabled>
        <span className="menu-ico" aria-hidden="true">🔕</span>
        Notifications blocked
      </button>
    );
  }

  const toggle = async () => {
    const next = await setNotifyEnabled(!on);
    setOn(next);
    setPerm(notificationPermission());
    onDone?.();
  };

  return (
    <button className="menu-item" role="menuitem" onClick={() => void toggle()}>
      <span className="menu-ico" aria-hidden="true">{on ? "🔔" : "🔕"}</span>
      {on ? "Turn notifications: on" : "Notify me on my turn"}
    </button>
  );
}
