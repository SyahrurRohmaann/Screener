self.addEventListener("install", (event) => event.waitUntil(self.skipWaiting()));
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let payload = {};
  try { payload = event.data?.json() || {}; } catch {}
  const text = (value, fallback, max) => typeof value === "string" ? value.slice(0, max) : fallback;
  event.waitUntil(self.registration.showNotification(text(payload.title, "Sinyal baru", 100), {
    body: text(payload.body, "Buka Screener untuk melihat sinyal.", 240),
    tag: text(payload.tag, "screener-signal", 100),
    icon: "/icons/icon-192.png",
    data: { url: text(payload.url, "/", 200) },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  let url = event.notification.data?.url || "/";
  try {
    const destination = new URL(url, self.location.origin);
    if (destination.origin !== self.location.origin || destination.pathname !== "/") url = "/";
  } catch { url = "/"; }
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      const clientUrl = new URL(client.url);
      if (clientUrl.origin === self.location.origin && clientUrl.pathname === "/") {
        try {
          await client.focus();
          client.postMessage({ type: "open-signal", url });
          return;
        } catch {}
      }
    }
    await self.clients.openWindow(url);
  })());
});
