// public/sw.js

self.addEventListener('push', function(event) {
  if (!event.data) return;

  try {
    const data = event.data.json();
    
    const options = {
      body: data.body,
      icon: '/uploads/app-logo.png', // Automatically links your home screen logo!
      badge: '/uploads/app-logo.png',
      vibrate: [200, 100, 200],
      data: { url: data.url || '/' }
    };

    event.waitUntil(
      self.registration.showNotification(data.title, options)
    );
  } catch (e) {
    console.error("Error processing push event data bundle:", e);
  }
});

// Wake up the app and focus the window when a user taps the notification banner
self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      if (clientList.length > 0) {
        return clientList[0].focus();
      }
      return clients.openWindow(event.notification.data.url);
    })
  );
});
