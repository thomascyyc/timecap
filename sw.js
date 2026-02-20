// TimeCap Service Worker — push notifications only, no fetch caching

self.addEventListener('push', (event) => {
  let data = { title: 'TimeCap', body: 'A capsule has returned.' };

  if (event.data) {
    try {
      data = event.data.json();
    } catch {
      data.body = event.data.text();
    }
  }

  event.waitUntil(
    self.registration.showNotification(data.title || 'TimeCap', {
      body: data.body,
      icon: '/favicon.ico',
      badge: '/favicon.ico',
      data: { capsuleId: data.capsuleId },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Focus existing dashboard tab if open
      for (const client of clientList) {
        if (client.url.includes('/dashboard') && 'focus' in client) {
          return client.focus();
        }
      }
      // Otherwise open dashboard
      return clients.openWindow('/dashboard.html');
    })
  );
});
