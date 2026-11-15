// アプリ本体を端末に控えておき、通信がないときでも開けるようにする。
// 方針は「まず通信で最新を取りに行き、だめなら控えを使う」。
// 古い版が居座らないよう、通信できるときは必ず最新を使う。

const CACHE = 'typo-v1';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // 自分のサイトのファイルだけを扱う。動画（blob:）や範囲指定の読み出しには手を出さない
  if (url.origin !== self.location.origin || request.headers.has('range')) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        const response = await fetch(request);
        if (response.ok && response.type === 'basic') {
          cache.put(request, response.clone()).catch(() => undefined);
        }
        return response;
      } catch (error) {
        const cached = await cache.match(request, { ignoreSearch: request.mode === 'navigate' });
        if (cached) return cached;
        throw error;
      }
    })(),
  );
});
