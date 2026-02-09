import { CacheableResponsePlugin } from 'workbox-cacheable-response';
import { ExpirationPlugin } from 'workbox-expiration';
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { registerRoute, NavigationRoute } from 'workbox-routing';
import {
  StaleWhileRevalidate,
  CacheFirst,
  NetworkFirst,
} from 'workbox-strategies';

const CACHE_NAMES = {
  static: 'static-resources-v1',
  images: 'images-v1',
  fonts: 'fonts-v1',
  appShell: 'app-shell-v1',
};

const DAY_IN_SECONDS = 24 * 60 * 60;

cleanupOutdatedCaches();

precacheAndRoute(self.__WB_MANIFEST || []);

registerRoute(
  ({ request }) =>
    request.destination === 'script' || request.destination === 'style',
  new StaleWhileRevalidate({
    cacheName: CACHE_NAMES.static,
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({
        maxEntries: 60,
        maxAgeSeconds: 30 * DAY_IN_SECONDS,
      }),
    ],
  }),
);

registerRoute(
  ({ request }) => request.destination === 'image',
  new CacheFirst({
    cacheName: CACHE_NAMES.images,
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({
        maxEntries: 100,
        maxAgeSeconds: 60 * DAY_IN_SECONDS,
      }),
    ],
  }),
);

registerRoute(
  ({ request }) => request.destination === 'font',
  new CacheFirst({
    cacheName: CACHE_NAMES.fonts,
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({
        maxEntries: 10,
        maxAgeSeconds: 365 * DAY_IN_SECONDS,
      }),
    ],
  }),
);

const networkFirstHandler = new NetworkFirst({
  cacheName: CACHE_NAMES.appShell,
  plugins: [
    new CacheableResponsePlugin({ statuses: [0, 200] }),
    new ExpirationPlugin({
      maxEntries: 10,
      maxAgeSeconds: 7 * DAY_IN_SECONDS,
    }),
  ],
  networkTimeoutSeconds: 3,
});

registerRoute(
  new NavigationRoute(networkFirstHandler, {
    denylist: [/^\/_/, /\/api\//],
  }),
);

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('sync', (event) => {
  if (event.tag === 'mutation-sync') {
    event.waitUntil(processMutationQueue());
  }
});

async function processMutationQueue() {
  const clients = await self.clients.matchAll();
  for (const client of clients) {
    client.postMessage({ type: 'SYNC_MUTATIONS' });
  }
}

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => !Object.values(CACHE_NAMES).includes(name))
            .map((name) => caches.delete(name)),
        );
      }),
    ]),
  );
});
