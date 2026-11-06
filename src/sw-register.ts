export function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return

  let hadController = Boolean(navigator.serviceWorker.controller)
  let refreshing = false

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) {
      hadController = true
      return
    }
    if (refreshing) return
    refreshing = true
    window.location.reload()
  })

  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then((registration) => {
      const checkForUpdate = () => {
        if (document.visibilityState !== 'visible') return
        void registration.update().catch(() => undefined)
      }

      // Check on first load, when the tab returns to the foreground, and
      // periodically while the app remains open.
      checkForUpdate()
      window.addEventListener('focus', checkForUpdate)
      document.addEventListener('visibilitychange', checkForUpdate)
      const interval = window.setInterval(checkForUpdate, 5 * 60 * 1000)
      window.addEventListener('pagehide', () => window.clearInterval(interval), { once: true })
    }).catch(() => undefined)
  }, { once: true })
}
