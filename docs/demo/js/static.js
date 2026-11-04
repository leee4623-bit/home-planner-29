window.FP_STATIC = true;
document.addEventListener('DOMContentLoaded', function () {
  var bar = document.createElement('div'); bar.className = 'preview-bar'; bar.setAttribute('role', 'note');
  bar.innerHTML = '<strong>시연판</strong> — 서버 없이 이 브라우저 안에서 동작합니다. 데이터는 이 기기(브라우저)에만 저장되며 <strong>다른 기기·설계사와 실시간 동기화되지 않습니다</strong>. 권한 분리도 시연용입니다(실제 동기화·보안은 서버판). <button type="button" class="link-btn" id="exportDemo">내 데이터 내보내기</button> · <button type="button" class="link-btn" id="resetDemo">시연 데이터 처음으로</button>';
  document.body.insertBefore(bar, document.body.firstChild);
  document.getElementById('exportDemo').addEventListener('click', function () {
    var d = FP.MockServer.exportData();
    if (!d) return FP.UI.toast('고객 계정으로 로그인한 뒤 내보낼 수 있습니다.', true);
    var txt = JSON.stringify(d, null, 2);
    if (!FP.UI.download('재무플래너-내보내기.json', txt, 'application/json')) FP.UI.dialog({ title: '내보내기', body: '<textarea rows="10" readonly>' + FP.UI.esc(txt) + '</textarea>' });
    else FP.UI.toast('파일을 받았습니다. 서버판의 ‘내 정보·실적 입력’ 아래 ‘기존 브라우저 데이터 가져오기’에서 내용을 확인한 뒤 가져올 수 있습니다.');
  });
  document.getElementById('resetDemo').addEventListener('click', function () {
    FP.UI.dialog({ title: '시연 데이터를 처음으로 되돌릴까요?', body: '<p>이 기기에서 저장한 계획 버전·기록·설문·알림이 모두 지워지고 처음 시연 상태로 돌아갑니다.</p>', actions: [{ text: '취소' }, { text: '처음으로', cls: 'btn-danger', onClick: function () { FP.MockServer.reset(); location.hash = ''; location.reload(); } }] });
  });
});
