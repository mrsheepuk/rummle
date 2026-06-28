import { useState } from "react";
import { setPrimed, shouldPrime } from "./notifications";
import { enableTurnNotifications } from "./notificationActions";

/**
 * A one-time priming dialog shown when a playing game is open and the browser
 * permission is still undecided. It explains *why* before we trigger the
 * browser's own "… wants to send you notifications" prompt — whose text we can't
 * customise — so the player isn't ambushed and we don't burn the one-shot prompt
 * on someone who isn't ready. Either choice marks the priming flag so it never
 * reappears in this browser.
 */
export function NotifyPrompt({ uid, active }: { uid: string; active: boolean }) {
  // Decide visibility once on mount: `shouldPrime` reads the permission +
  // primed flag, which only change via this dialog, so there's no live value to
  // track.
  const [show, setShow] = useState(active && shouldPrime());

  if (!show) return null;

  const enable = async () => {
    // Full opt-in: request permission, set the preference, and register the push
    // subscription — not just the bare permission prompt.
    await enableTurnNotifications(uid);
    setShow(false);
  };
  const dismiss = () => {
    setPrimed();
    setShow(false);
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Turn notifications">
      <div className="card notify-card">
        <h2>Get a nudge on your turn?</h2>
        <p>
          It's easy to wander off mid-game. We can pop up a notification the moment
          it's your turn — only ever for your turn, never anything else.
        </p>
        <p className="notify-hint">
          Tap “Enable” and your browser will ask to confirm. You can switch it off
          anytime in the game menu.
        </p>
        <button className="btn btn-primary" onClick={() => void enable()}>
          Enable notifications
        </button>
        <button className="btn btn-link" onClick={dismiss}>
          Not now
        </button>
      </div>
    </div>
  );
}
