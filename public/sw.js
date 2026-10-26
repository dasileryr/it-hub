self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch { data = {} }
  event.waitUntil(self.registration.showNotification(data.title || 'ИТ-Задачи', {
    body: data.body || 'В приложении появилось обновление.',
    icon: './icon-192.png',
    badge: './icon-192.png',
    data: { url: data.url || './#/' },
    tag: data.taskId ? `task-${data.taskId}` : 'it-hub',
  }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(clients.openWindow(event.notification.data?.url || './#/'))
})
