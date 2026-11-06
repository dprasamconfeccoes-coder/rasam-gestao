const CACHE_PREFIX = 'rasam-gestao-shell-'
const CACHE = `${CACHE_PREFIX}v3`
const LEGACY_CACHE = 'rasam-gestao-shell-v2'
const SHELL = ['./', './index.html', './manifest.webmanifest']

async function cacheLatestShell() {
  const cache = await caches.open(CACHE)
  await Promise.all(SHELL.map(async (path) => {
    const url = new URL(path, self.registration.scope)
    url.searchParams.set('__sw_shell_refresh', CACHE)
    const response = await fetch(url.href, { cache: 'no-store', credentials: 'same-origin' })
    if (!response.ok) throw new Error(`Não foi possível atualizar o shell: ${path}`)
    await cache.put(new URL(path, self.registration.scope), response)
  }))
}

self.addEventListener('install', (event) => {
  event.waitUntil(cacheLatestShell())
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys()
    const upgradingLegacyClients = cacheNames.includes(LEGACY_CACHE)
    await Promise.all(cacheNames
      .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE)
      .map((name) => caches.delete(name)))
    await self.clients.claim()

    // v2 clients have no controllerchange handler; navigate them once to load
    // the new application bundle and its automatic-update registration code.
    if (upgradingLegacyClients) {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      await Promise.all(clients.map(async (client) => {
        if ('navigate' in client) {
          try { await client.navigate(client.url) } catch (_) { /* a closed tab is harmless */ }
        }
      }))
    }
  })())
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        // A unique query avoids stale HTML in both the browser cache and the
        // Pages/CDN edge cache. It is only used for this internal fetch; the
        // address shown in the user's browser is unchanged.
        const url = new URL(request.url)
        url.searchParams.set('__sw_refresh', String(Date.now()))
        const response = await fetch(url.href, { cache: 'no-store', credentials: 'same-origin' })
        if (response.ok) {
          const cache = await caches.open(CACHE)
          await cache.put(new URL('./index.html', self.registration.scope), response.clone())
        }
        return response
      } catch (_) {
        return (await caches.match(request))
          || (await caches.match(new URL('./index.html', self.registration.scope)))
          || Response.error()
      }
    })())
    return
  }

  event.respondWith(fetch(request).catch(async () => (await caches.match(request)) || Response.error()))
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
