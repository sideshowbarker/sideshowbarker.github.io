// ホーム画面に追加したあと、ネットが無くても遊べるようにファイルをためておく（https で開いたときだけ動く）
const CACHE = 'grape-sim-v6';
const FILES = ['./', './index.html', './matter.min.js', './lang.js', './news.js', './sound.js', './shop.js', './mods.js', './game.js', './manifest.json',
               './icon-192.png', './icon-512.png'];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// まずネットから取りに行って、だめならためておいた物を使う
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(fetch(e.request).then((r) => {
    const copy = r.clone();
    caches.open(CACHE).then((c) => c.put(e.request, copy));
    return r;
  }).catch(() => caches.match(e.request)));
});
