/* AUREON service worker: push notifications and call actions. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; }
  catch { payload = { body: event.data ? event.data.text() : "" }; }
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const visibleClient = windows.find(client => client.visibilityState === "visible");
    if (visibleClient && payload.type === "message") visibleClient.postMessage({ type: "AUREON_PUSH", payload });
    const isCall = payload.type === "call";
    const options = {
      body: payload.body || "Tienes una notificación nueva.",
      icon: "./icons/aureon.svg",
      badge: "./icons/aureon.svg",
      tag: payload.tag || "aureon-notification",
      renotify: Boolean(payload.renotify),
      silent: false,
      data: { url: payload.url || "./", type: payload.type || "general", callId: payload.callId || null }
    };
    // Android/Chrome admite acciones en las notificaciones. iOS web push puede ignorarlas.
    if (isCall && payload.callId) {
      options.actions = [
        { action: "accept", title: "Aceptar" },
        { action: "reject", title: "Rechazar" }
      ];
      options.requireInteraction = true;
    }
    await self.registration.showNotification(payload.title || "AUREON", options);
  })());
});

self.addEventListener("notificationclick", (event) => {
  const action = event.action;
  const data = event.notification.data || {};
  event.notification.close();
  event.waitUntil((async () => {
    const targetUrl = new URL(data.url || "./", self.registration.scope);
    if (data.type === "call" && data.callId && ["accept", "reject"].includes(action)) {
      targetUrl.searchParams.set("notificationAction", action);
      targetUrl.searchParams.set("callId", data.callId);
    }
    const target = targetUrl.href;
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if (client.url.startsWith(self.registration.scope) && "focus" in client) {
        await client.focus();
        client.postMessage({ type: "AUREON_CALL_ACTION", action, callId: data.callId || null });
        if ("navigate" in client && client.url !== target) await client.navigate(target);
        return;
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow(target);
  })());
});
