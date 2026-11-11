/*
 * 서비스 워커(https에서만 등록). 앱 파일을 미리 받아 두고, 오프라인에서도 열리게 한다.
 * 네트워크 먼저 받으므로 배포하면 바로 새 파일이 보인다. 파일 목록이 바뀌면 VERSION을 올려 옛 캐시를 지운다.
 * 데이터는 브라우저 저장소에만 있고 여기서 다루지 않는다.
 */
var VERSION = 'jaemu-planner-v5';
var FILES = [
    './',
    './index.html',
    './style.css',
    './manifest.webmanifest',
    './icons/apple-touch-icon.png',
    './icons/icon-192.png',
    './icons/icon-512.png',
    './icons/icon-maskable-512.png',
    './src/dates.js',
    './src/format.js',
    './data/policies.js',
    './data/products.js',
    './src/policy.js',
    './src/judge.js',
    './src/engine.js',
    './src/metrics.js',
    './src/validate.js',
    './src/scenarios.js',
    './src/solver.js',
    './src/risk.js',
    './data/demo.js',
    './src/intake.js',
    './src/store.js',
    './src/tracking.js',
    './src/alerts.js',
    './src/csv.js',
    './src/proposals.js',
    './src/models.js',
    './src/household.js',
    './tests/cases.js',
    './src/ui/components.js',
    './src/ui/chart.js',
    './src/ui/customer-home.js',
    './src/ui/customer-record.js',
    './src/ui/customer-plan.js',
    './src/ui/customer-alerts.js',
    './src/ui/customer-more.js',
    './src/ui/planner-shell.js',
    './src/ui/planner-diagnosis.js',
    './src/ui/planner-design.js',
    './src/ui/planner-review.js',
    './src/ui/tour.js',
    './src/ui/intake.js',
    './src/ui/app.js',
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) { return c.addAll(FILES); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

// 같은 출처 GET만: 네트워크 먼저(팀원이 배포한 새 버전이 바로 보이게), 실패하면(오프라인) 캐시
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  // 브라우저 HTTP 캐시(깃허브 페이지는 최대 10분)를 건너뛰고 서버에 새 파일이 있는지 확인한다
  var fresh = req.mode === 'navigate' ? fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' }) : fetch(req, { cache: 'no-cache' });
  e.respondWith(fresh.then(function (res) {
    if (res && res.ok) {
      var copy = res.clone();
      caches.open(VERSION).then(function (c) { c.put(req, copy); });
    }
    return res;
  }).catch(function () {
    return caches.match(req, { ignoreSearch: true }).then(function (hit) {
      return hit || caches.match('./index.html');
    });
  }));
});
