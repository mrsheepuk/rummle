import { useEffect, useState } from "react";

// Surfacing "you can install this as an app" ourselves, because browsers bury it
// (Android/desktop: an address-bar icon or a menu item) or expose nothing at all
// (iOS Safari: the user must use Share → Add to Home Screen). The two platforms
// need different treatment — a programmatic prompt vs printed instructions — so
// the hook reports which one applies.
//
// The `beforeinstallprompt` event is captured in index.html (it can fire before
// this bundle mounts, and is delivered only once) and stashed on
// `window.__installPrompt`; here we read that and listen for changes.

/** The non-standard event Chromium fires when the app is installable. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

declare global {
  interface Window {
    __installPrompt: BeforeInstallPromptEvent | null;
  }
}

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    // iOS marks an installed PWA with this non-standard flag.
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  // iPadOS 13+ reports as a Mac, so also sniff for touch to catch iPads.
  return /iPad|iPhone|iPod/.test(ua) || (ua.includes("Macintosh") && "ontouchend" in document);
}

export interface InstallState {
  /** Already running as an installed PWA — hide all install affordances. */
  installed: boolean;
  /** Chromium offered a native prompt we can trigger from a button. */
  canPrompt: boolean;
  /** iOS, not yet installed — show manual Add-to-Home-Screen steps instead. */
  needsIOSInstructions: boolean;
  /** Fire the native install prompt (no-op unless `canPrompt`). */
  promptInstall: () => Promise<void>;
}

export function useInstallPrompt(): InstallState {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(
    typeof window !== "undefined" ? window.__installPrompt : null,
  );
  const [installed, setInstalled] = useState(isStandalone());

  useEffect(() => {
    // The early listener in index.html owns the event; we just mirror its state.
    const sync = () => {
      setDeferred(window.__installPrompt);
      setInstalled(isStandalone());
    };
    window.addEventListener("installpromptchange", sync);
    sync(); // catch an event that landed between render and effect
    return () => window.removeEventListener("installpromptchange", sync);
  }, []);

  const promptInstall = async () => {
    const evt = window.__installPrompt;
    if (!evt) return;
    await evt.prompt();
    await evt.userChoice;
    window.__installPrompt = null; // the prompt is single-use
    setDeferred(null);
  };

  return {
    installed,
    canPrompt: !!deferred,
    needsIOSInstructions: isIOS() && !installed,
    promptInstall,
  };
}

/** Terse install state for the debug overlay: "inst/can/ios + display-mode". */
export function installDebugState(): string {
  if (typeof window === "undefined") return "n/a";
  const mode = window.matchMedia?.("(display-mode: standalone)").matches ? "standalone" : "browser";
  return `installed=${isStandalone()} bip=${!!window.__installPrompt} ios=${isIOS()} ${mode}`;
}
