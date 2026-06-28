import { useState } from "react";
import { notificationPermission, notifyEnabled } from "./notifications";
import { disableTurnNotifications, enableTurnNotifications } from "./notificationActions";

/**
 * Shared overflow-menu item that toggles "your turn" notifications. Renders
 * nothing where the API is unsupported (e.g. an iPhone Safari tab). When the
 * browser has blocked notifications it shows as a disabled hint, since only the
 * user can unblock that in their browser settings. Used by both game menus.
 *
 * `uid` is the real authenticated uid, used to register/clear this account's
 * push subscription (so closed-tab pings reach the right player).
 */
export function NotifyMenuItem({ uid, onDone }: { uid: string; onDone?: () => void }) {
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
    if (on) {
      await disableTurnNotifications(uid);
      setOn(false);
    } else {
      setOn(await enableTurnNotifications(uid));
    }
    setPerm(notificationPermission());
    onDone?.();
  };

  return (
    <button className="menu-item" role="menuitem" onClick={() => void toggle()}>
      <span className="menu-ico" aria-hidden="true">{on ? "🔕" : "🔔"}</span>
      {on ? "Disable turn notifications" : "Enable turn notifications"}
    </button>
  );
}
