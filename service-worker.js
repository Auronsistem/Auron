/* AUREON service worker: push notifications only; no aggressive offline cache. */
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data ? event.data.text() : "" };
  }

  const title = payload.title || "AUREON";
  const options = {
    body: payload.body || "Tienes una notificación nueva.",
    icon: "./icons/aureon.svg",
    badge: "./icons/aureon.svg",
    tag: payload.tag || "aureon-notification",
    renotify: Boolean(payload.renotify),
    data: { url: payload.url || "./", type: payload.type || "general" },
    vibrate: payload.type === "call" ? [250, 120, 250, 120, 400] : [120, 60, 120]
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || "./", self.registration.scope).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if (client.url.startsWith(self.registration.scope) && "focus" in client) {
        await client.focus();
        if ("navigate" in client && client.url !== target) await client.navigate(target);
        return;
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow(target);
  })());
});
