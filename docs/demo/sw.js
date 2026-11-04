/*
 * 서비스 워커 — 앱 화면 파일만 저장합니다. /api 응답(개인 재무 데이터)은 절대 저장하지 않습니다.
 * 배포 후 파일을 고치면 VERSION을 올려야 사용자에게 '업데이트' 안내가 뜹니다.
 */
var VERSION = 'static-v3.0.0';
var CACHE = 'fp-shell-' + VERSION;
var FILES = ['./', './index.html', './manifest.webmanifest', './css/styles.css', './js/fonts.js',
  './js/data/policies.js', './js/engine/calc.js', './js/engine/clientData.js', './js/engine/products.js', './js/engine/analysis.js', './js/data/riskConfig.js', './js/engine/risk.js', './js/engine/strategies.js', './js/engine/monthly.js', './js/install.js',
  './js/ui/chart.js', './js/ui/components.js', './js/ui/sync.js', './js/ui/planForm.js', './js/ui/planner.js', './js/ui/client.js', './js/ui/features.js', './js/ui/offers.js', './js/ui/clientInput.js', './js/ui/productsView.js', './js/static.js', './js/data/sampleCase.js', './js/linking.js', './js/mockApi.js', './js/ui/app.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png', './icons/apple-touch-icon.png'];

// 브라우저 캐시를 거치지 않고 최신 파일로 저장
self.addEventListener('install', function (e) { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(FILES.map(function (f) { return new Request(f, { cache: 'reload' }); })); })); });
self.addEventListener('message', function (e) { if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting(); });
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) { return Promise.all(ks.filter(function (k) { return k.indexOf('fp-') === 0 && k !== CACHE; }).map(function (k) { return caches.delete(k); })); }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.indexOf('/api/') === 0) return; // 개인 데이터는 항상 네트워크
  if (req.mode === 'navigate') { e.respondWith(fetch(req).catch(function () { return caches.match('./index.html'); })); return; }
  // 앱 파일: 네트워크 우선(항상 최신), 연결이 없을 때만 저장본
  e.respondWith(fetch(req, { cache: 'no-cache' }).then(function (res) { var cp = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, cp); }); return res; }).catch(function () { return caches.match(req); }));
});

// Web Push 수신 — 잠금 화면에는 서버가 보낸 요약만 표시(기본: 금액 없음)
self.addEventListener('push', function (e) {
  var d = {}; try { d = e.data ? e.data.json() : {}; } catch (x) { d = { body: '새 알림이 있습니다.' }; }
  e.waitUntil(self.registration.showNotification(d.title || '재무플래너', { body: d.body || '새 알림이 있습니다. 앱에서 확인해 주세요.', tag: d.tag || 'fp', icon: './icons/icon-192.png', badge: './icons/icon-192.png', data: { url: d.url || '/#inbox' } }));
});
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var url = (e.notification.data && e.notification.data.url) || '/#inbox';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) { if ('focus' in list[i]) { list[i].navigate(url); return list[i].focus(); } }
    return self.clients.openWindow(url);
  }));
});
