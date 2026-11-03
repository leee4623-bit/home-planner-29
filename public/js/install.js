/*
 * 설치 기능 (PWA)
 * ------------------------------------------------------------
 * - 서비스 워커 등록과 업데이트 처리: 새 버전이 설치되면 배너를 띄우고,
 *   사용자가 '업데이트'를 누르면 새 서비스 워커를 활성화한 뒤 새로고침합니다.
 * - 안드로이드·데스크톱 크롬/엣지: beforeinstallprompt 이벤트로 설치 창을 띄웁니다.
 * - 아이폰·아이패드(사파리): 설치 창을 띄울 수 없으므로 '공유 → 홈 화면에 추가' 안내를 보여줍니다.
 * 서비스 워커는 https 또는 localhost에서만 동작합니다.
 */
(function (root) {
  'use strict';
  var deferredPrompt = null;
  var listeners = [];
  var waitingWorker = null;

  function notify() { listeners.forEach(function (fn) { try { fn(state()); } catch (e) { /* 무시 */ } }); }

  function platform() {
    var ua = root.navigator.userAgent || '';
    var ios = /iPad|iPhone|iPod/.test(ua) || (ua.indexOf('Macintosh') >= 0 && root.navigator.maxTouchPoints > 1);
    if (ios) return 'ios';
    if (/Android/i.test(ua)) return 'android';
    return 'desktop';
  }

  function isStandalone() {
    try {
      return root.matchMedia('(display-mode: standalone)').matches || root.navigator.standalone === true;
    } catch (e) { return false; }
  }

  function swSupported() {
    if (root.FP_PREVIEW) return false; // 미리보기(아티팩트)에서는 설치 불가
    return 'serviceWorker' in root.navigator && (root.location.protocol === 'https:' || root.location.hostname === 'localhost' || root.location.hostname === '127.0.0.1');
  }

  function state() {
    return { platform: platform(), standalone: isStandalone(), canPrompt: !!deferredPrompt, swSupported: swSupported(), updateReady: !!waitingWorker };
  }

  function registerSW() {
    if (!swSupported()) return;
    root.navigator.serviceWorker.register('sw.js').then(function (reg) {
      if (reg.waiting && root.navigator.serviceWorker.controller) { waitingWorker = reg.waiting; notify(); }
      reg.addEventListener('updatefound', function () {
        var nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', function () {
          // 이미 이전 버전이 동작 중일 때만 '업데이트' 안내 (첫 설치는 안내하지 않음)
          if (nw.state === 'installed' && root.navigator.serviceWorker.controller) { waitingWorker = nw; notify(); }
        });
      });
      // 앱을 다시 열 때마다 새 버전 확인
      root.document.addEventListener('visibilitychange', function () { if (root.document.visibilityState === 'visible') reg.update().catch(function () {}); });
    }).catch(function () { /* 등록 실패 시 일반 웹페이지로 동작 */ });

    // 첫 설치 때(이전 버전이 없을 때)는 새로고침하지 않음 — 입력 중인 화면이 사라지지 않도록
    var hadController = !!root.navigator.serviceWorker.controller, reloading = false;
    root.navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (!hadController || reloading) { hadController = true; return; }
      reloading = true; root.location.reload();
    });
  }

  function applyUpdate() {
    if (waitingWorker) waitingWorker.postMessage({ type: 'SKIP_WAITING' });
  }

  function prompt() {
    if (!deferredPrompt) return Promise.resolve('unavailable');
    var p = deferredPrompt; deferredPrompt = null; notify();
    p.prompt();
    return p.userChoice.then(function (c) { return c.outcome; });
  }

  root.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); deferredPrompt = e; notify(); });
  root.addEventListener('appinstalled', function () { deferredPrompt = null; notify(); });

  // 플랫폼별 설치 안내 문구
  var GUIDE = {
    ios: ['사파리에서 이 페이지를 엽니다. (다른 브라우저 앱은 iOS 버전에 따라 홈 화면 추가가 안 될 수 있습니다)', '아래쪽(아이패드는 위쪽)의 공유 버튼(네모에 위 화살표)을 누릅니다.', '목록을 내려 ‘홈 화면에 추가’를 누르고, 오른쪽 위 ‘추가’를 누릅니다.', '홈 화면의 ‘내집플래너’ 아이콘으로 실행하면 주소창 없이 앱처럼 열립니다.'],
    android: ['크롬에서 이 페이지를 엽니다.', '‘앱 설치’ 버튼을 누르거나, 오른쪽 위 ⋮ 메뉴에서 ‘앱 설치’ 또는 ‘홈 화면에 추가’를 누릅니다.', '설치 후 홈 화면이나 앱 목록의 아이콘으로 실행합니다.'],
    desktop: ['크롬 또는 엣지에서 이 페이지를 엽니다.', '‘앱 설치’ 버튼을 누르거나, 주소창 오른쪽의 설치 아이콘(모니터에 화살표)을 누릅니다.', '설치 후 바탕화면·시작 메뉴·Dock에서 별도 창으로 실행됩니다.']
  };

  root.FP = root.FP || {};
  root.FP.Install = {
    init: registerSW,
    state: state,
    prompt: prompt,
    applyUpdate: applyUpdate,
    onChange: function (fn) { listeners.push(fn); },
    GUIDE: GUIDE
  };
})(this);
