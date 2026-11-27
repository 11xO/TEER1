import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
const appScope = self.registration.scope;
registerRoute(new NavigationRoute(createHandlerBoundToURL(new URL('index.html', appScope).href), { denylist: [/^\/__\//, /^\/api(?:\/|$)/, /\/[^/?]+\.[^/]+$/] }));
self.addEventListener('install', (event) => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', (event) => event.waitUntil((async () => {
  const names = await caches.keys();
  await Promise.all(names.filter((name) => name.startsWith('teer-v') || name.startsWith('teer-runtime-v')).map((name) => caches.delete(name)));
  await self.clients.claim();
})()));
self.addEventListener('message', (event) => { if (event.data?.type === 'SKIP_WAITING') self.skipWaiting(); });
function safeNotificationURL(value) {
  try { const target = new URL(typeof value === 'string' ? value : appScope, appScope); if (target.origin === self.location.origin) return target.href; } catch { /* Fall back to the app. */ }
  return appScope;
}
self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data?.json() || {}; } catch { payload = { body: event.data?.text() || '' }; }
  if (typeof payload !== 'object' || payload === null) payload = { body: String(payload) };
  const notification = payload.notification || payload;
  const data = payload.data || {};
  event.waitUntil(self.registration.showNotification(notification.title || data.title || 'Teer', {
    body: notification.body || data.body || 'لديك إشعار جديد', icon: new URL('icons/logo-192.webp', appScope).href, badge: new URL('icons/logo-192.webp', appScope).href,
    dir: 'rtl', lang: 'ar', data: { url: safeNotificationURL(notification.click_action || data.url || payload.url) },
  }));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = safeNotificationURL(event.notification.data?.url);
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find((client) => client.url.startsWith(appScope));
    if (existing) { try { if (existing.url !== target) await existing.navigate(target); return await existing.focus(); } catch { /* The client may have closed. */ } }
    return self.clients.openWindow(target);
  })());
});
