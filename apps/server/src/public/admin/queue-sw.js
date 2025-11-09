self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification?.data?.url;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsArr) => {
      const client = clientsArr.find((c) => 'focus' in c);
      if (client) {
        if (url) {
          try { client.navigate(url); } catch {}
        }
        return client.focus();
      }
      if (url && self.clients.openWindow) {
        return self.clients.openWindow(url);
      }
      return null;
    })
  );
});

self.addEventListener('message', (event) => {
  if (!event?.data) return;
  const { type, payload } = event.data;
  if (type !== 'show-notification' || !payload) return;
  const { title, message, tag, url } = payload || {};
  if (!title || !message) return;
  event.waitUntil(
    self.registration.showNotification(title, {
      body: message,
      tag,
      data: { url },
    })
  );
});
