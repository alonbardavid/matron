// The service worker of the installed app. It exists for reminders alone: it
// shows what the server pushes (backend/notifications/src/web-push.ts) and
// opens the page a tap points at. It handles no fetch, so it never stands
// between the app and the network, and every request still reaches the router.

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  const message = readMessage(event);
  event.waitUntil(
    self.registration.showNotification(message.title, {
      body: message.body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: message.tag,
      data: { url: message.url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(openPage(event.notification.data?.url ?? "/"));
});

function readMessage(event) {
  try {
    return event.data.json();
  } catch {
    return { title: "Matron", body: "Something is coming up", url: "/", tag: "matron" };
  }
}

async function openPage(url) {
  const windows = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });
  const open = windows.find((client) => "focus" in client);
  if (!open) {
    await self.clients.openWindow(url);
    return;
  }
  await open.focus();
  // navigate() is refused for a window this worker does not control yet.
  await open.navigate(url).catch(() => self.clients.openWindow(url));
}
