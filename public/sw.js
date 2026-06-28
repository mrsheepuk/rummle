// Service worker for "your turn" notifications.
//
// Two roles:
//  - Display: the page calls registration.showNotification() through this SW for
//    in-tab pings, because mobile browsers (Android Chrome and friends) forbid
//    the `new Notification()` constructor ("Illegal constructor").
//  - Push: the `push` handler below shows a notification pushed by the
//    turn-change Cloud Function, so it arrives even when the tab is closed.
//
// Deliberately no `fetch` handler — this SW must not intercept requests or cache
// anything, so it can't interfere with the app's offline/reconnect behaviour.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// A turn-change push arrived. Show it — unless a game tab is already focused, in
// which case the player is looking (and the in-tab path covers it); that keeps
// the "only when you're away" rule the client applies.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = data.title || "Your turn!";
  const options = {
    body: data.body || "It's your turn",
    tag: data.tag || "rummle-turn",
    icon: "/favicon.svg",
    data: { url: data.url || "/" },
  };
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      if (clients.some((c) => c.focused)) return undefined;
      return self.registration.showNotification(title, options);
    }),
  );
});

// Focus an existing game tab if one is open, otherwise open one.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data && event.notification.data.url;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url || "/");
      return undefined;
    }),
  );
});
