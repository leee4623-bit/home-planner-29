/* 웹 글꼴을 화면 표시를 막지 않게 불러옵니다(오프라인이면 기본 글꼴). CSP상 인라인 스크립트를 쓰지 않기 위해 파일로 분리. */
(function () {
  var l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = 'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans+KR:wght@400;500;600;700&display=swap';
  document.head.appendChild(l);
})();
