import { useState } from "react";
import { useInstallPrompt } from "./useInstallPrompt";

const DISMISS_KEY = "rummle:install-dismissed";

function dismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

function setDismissed(): void {
  try {
    localStorage.setItem(DISMISS_KEY, "1");
  } catch {
    /* ignore */
  }
}

/**
 * iOS can't be prompted programmatically, so we print the Share → Add to Home
 * Screen steps. We also call out notifications here, since installing is the
 * *only* way to get them on iPhone — that's the main reason an iOS player would
 * bother. Shared by the Home banner and the in-game menu item.
 */
function IOSInstructions({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Install Rummle">
      <div className="card notify-card">
        <h2>Add Rummle to your Home Screen</h2>
        <p>
          Tap the <strong>Share</strong> button in Safari, then{" "}
          <strong>Add to Home Screen</strong>. Rummle then opens full-screen — and
          it's the only way to get “your turn” notifications on iPhone.
        </p>
        <button className="btn btn-primary" onClick={onClose}>
          Got it
        </button>
      </div>
    </div>
  );
}

/** Dismissible "Install Rummle" banner for the Home screen. */
export function InstallBanner() {
  const { installed, canPrompt, needsIOSInstructions, promptInstall } = useInstallPrompt();
  const [hidden, setHidden] = useState(dismissed());
  const [showIOS, setShowIOS] = useState(false);

  if (installed || hidden || (!canPrompt && !needsIOSInstructions)) return null;

  const onInstall = () => {
    if (canPrompt) void promptInstall();
    else setShowIOS(true);
  };

  return (
    <>
      <div className="install-banner">
        <span className="install-text">
          <span aria-hidden="true">📲</span> Install Rummle for full-screen play and turn
          notifications.
        </span>
        <span className="install-actions">
          <button className="btn btn-small" onClick={onInstall}>
            Install
          </button>
          <button
            className="btn btn-icon install-dismiss"
            aria-label="Dismiss"
            onClick={() => {
              setDismissed();
              setHidden(true);
            }}
          >
            ✕
          </button>
        </span>
      </div>
      {showIOS && <IOSInstructions onClose={() => setShowIOS(false)} />}
    </>
  );
}

/** "Install app" item for the in-game overflow menu. */
export function InstallMenuItem({ onDone }: { onDone?: () => void }) {
  const { installed, canPrompt, needsIOSInstructions, promptInstall } = useInstallPrompt();
  const [showIOS, setShowIOS] = useState(false);

  if (installed || (!canPrompt && !needsIOSInstructions)) return null;

  const onClick = async () => {
    if (canPrompt) {
      await promptInstall();
      onDone?.();
    } else {
      // Keep this item (and so the modal) mounted; close the menu only once the
      // iOS instructions are dismissed, or they'd unmount with the dropdown.
      setShowIOS(true);
    }
  };

  return (
    <>
      <button className="menu-item" role="menuitem" onClick={() => void onClick()}>
        <span className="menu-ico" aria-hidden="true">📲</span>
        Install app
      </button>
      {showIOS && (
        <IOSInstructions
          onClose={() => {
            setShowIOS(false);
            onDone?.();
          }}
        />
      )}
    </>
  );
}
