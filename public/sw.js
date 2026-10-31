const CACHE = 'rasam-gestao-shell-v2'
const SHELL = ['./', './index.html', './manifest.webmanifest']

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return
  event.respondWith(fetch(request).catch(() => caches.match(request)))
})

self.addEventListener('push', (event) => {
  let data = { title: 'RF Gestão', body: 'Há uma nova atualização no seu painel.', url: './' }
  try { data = { ...data, ...(event.data ? event.data.json() : {}) } } catch (_) { /* payload opcional */ }
  event.waitUntil(self.registration.showNotification(data.title, {
    body: data.body,
    icon: './brand/rf-logo.png',
    badge: './brand/rf-logo.png',
    tag: data.tag || 'rasam-gestao-alerta',
    data: { url: data.url || './' },
  }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = new URL(event.notification.data?.url || './', self.location.origin).href
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
    const client = clients.find((item) => 'focus' in item)
    if (client) { client.navigate(target); return client.focus() }
    return self.clients.openWindow(target)
  }))
})
