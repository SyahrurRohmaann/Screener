self.addEventListener("push", (event) => {
  let payload = {};
  try { payload = event.data?.json() || {}; } catch {}
  const text = (value, fallback, max) => typeof value === "string" ? value.slice(0, max) : fallback;
  event.waitUntil(self.registration.showNotification(text(payload.title, "Sinyal baru", 100), {
    body: text(payload.body, "Buka Screener untuk melihat sinyal.", 240),
    tag: text(payload.tag, "screener-signal", 100),
    icon: "/icons/icon-192.png",
    data: { url: "/" },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      const url = new URL(client.url);
      if (url.origin === self.location.origin && url.pathname === "/") {
        try { await client.focus(); return; } catch {}
      }
    }
    await self.clients.openWindow("/");
  })());
});
