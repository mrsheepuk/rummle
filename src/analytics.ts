// Cloudflare Web Analytics — cookieless visitor stats (no consent banner needed).
// Injects the beacon only in production builds and only when a token is set, so
// it never fires against the emulator / local dev. Cloudflare reads the token
// from the script element's own data-cf-beacon attribute.

const BEACON_SRC = "https://static.cloudflareinsights.com/beacon.min.js";

export function initAnalytics(): void {
  const token = import.meta.env.VITE_CF_ANALYTICS_TOKEN;
  if (!import.meta.env.PROD || !token) return;

  const script = document.createElement("script");
  script.defer = true;
  script.src = BEACON_SRC;
  script.setAttribute("data-cf-beacon", JSON.stringify({ token }));
  document.head.appendChild(script);
}
