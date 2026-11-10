/*
 * 심사위원 둘러보기(명세 6-4): ① 설계 전후 진단 → ② 민감도 시나리오 → ③ 실행 기록과 경보 → ④ 원금·비교모형·실제 상품 비교.
 * 단계마다 화면을 옮기고, 안내 문장은 지금 계산 결과로 만든다.
 */
(function (root) {
  'use strict';

  var P = root.Planner;
  var ui = P.ui;
  var fmt = P.format;

  var SEEN_KEY = 'jaemu-planner-tour-seen';

  function cond(j, k) { return j.conditions.filter(function (x) { return x.key === k; })[0]; }

  var STEPS = [
    {
      title: '설계 전후 진단',
      view: { role: 'planner', plannerPage: 'diagnosis' },
      text: function (c) {
        var b = c.d.beforePlan;
        if (!b) return '설계 전·후 판정과 진단 지표를 나란히 봅니다.';
        var jb = P.engine.runPlan(c.state, b.id).judgement;
        var ja = P.engine.runPlan(c.state, c.state.activePlanId).judgement;
        return '설계 전(' + b.targetMonth + ')은 ' + jb.label + ', 주거 ' + fmt.short(cond(jb, 'housing').shortfall) + '만원 부족. ' +
          '설계 후(' + c.d.plan.targetMonth + ')는 ' + ja.label + (cond(ja, 'housing').met ? '' : ', 주거 ' + fmt.short(cond(ja, 'housing').shortfall) + '만원 부족') + '입니다. ' +
          '진단 지표 표의 "바뀐 원인" 칸에서 무엇 때문에 달라졌는지 확인하세요.';
      }
    },
    {
      title: '민감도 시나리오',
      view: { role: 'planner', plannerPage: 'tools', tool: 'scenario', scn: null },
      text: function () {
        return '보고서 표 17의 민감도를 그대로 넣어 두었습니다. 기본으로 고른 것은 2027-11부터 6개월 소득 20% 감소(그 기간 생활비 185만원)입니다. ' +
          '실직(3개월, 생활비 165만원·연금 중지), 생활비 2.3% 상승, 보증금 400만원 상승 중 하나를 골라 [선택한 시나리오로 비교]를 눌러 보세요. 그래프는 기본안과 고른 시나리오 하나만 보여 줘요.';
      }
    },
    {
      title: '실행 기록과 경보',
      view: { role: 'customer', tab: 'alerts' },
      text: function (c) {
        var n = (c.state.alerts || []).filter(function (a) { return a.status !== '해소'; }).length;
        return '고객이 매달 실수령·생활비·저축·연금 납입을 기록하면 계획과 비교해 경보를 띄웁니다(보고서 표 20 기준: 생활비 2개월 연속 초과, 비상금 5개월분 아래, 실수령 10% 이상 감소). ' +
          '지금 활성 경보는 ' + n + '건입니다. 이번 달 기록 탭에서 금액을 넣어 보면 경보가 바로 바뀝니다.';
      }
    },
    {
      title: '원금·비교모형·실제 상품 비교',
      view: { role: 'customer', tab: 'plan' },
      text: function () {
        return '목표월 2029-10의 주거자금을 세 가지로 나란히 봅니다. A 원금 기준(수익률 0%) 4,166.4만원, B 세후 연 2% 비교모형 4,240.2만원, C 실제 자유적금(연 3.85%) 적용 4,216.6만원. ' +
          '"마지막 월 납입 제외" 칸은 잔금일이 월급날보다 빠를 때의 재원입니다. 상품은 추천이 아니라 비교 예시예요.';
      }
    }
  ];

  function markSeen() {
    try { root.localStorage.setItem(SEEN_KEY, '1'); } catch (e) { /* 무시 */ }
  }
  ui.tourSeen = function () {
    try { return root.localStorage.getItem(SEEN_KEY) === '1'; } catch (e) { return false; }
  };

  function go(i) {
    var s = STEPS[i];
    ui.setView(Object.assign({ tour: i, more: null, confirm: null }, s.view));
  }

  /** 화면 아래에 붙는 안내 패널 */
  ui.tourPanel = function (c) {
    var i = c.view.tour;
    if (i === null || i === undefined || !STEPS[i]) return '';
    var s = STEPS[i];
    return '<aside class="tour" role="dialog" aria-modal="false" aria-labelledby="tour-t">' +
      '<div class="tour-step">둘러보기 ' + (i + 1) + ' / ' + STEPS.length + '</div>' +
      '<h2 id="tour-t">' + ['①', '②', '③', '④'][i] + ' ' + ui.esc(s.title) + '</h2>' +
      '<p>' + ui.esc(s.text(c)) + '</p>' +
      '<div class="btn-row">' +
      (i > 0 ? '<button class="btn btn-sm" data-action="tour-go" data-step="' + (i - 1) + '">이전</button>' : '') +
      (i < STEPS.length - 1 ? '<button class="btn btn-sm btn-primary" data-action="tour-go" data-step="' + (i + 1) + '">다음</button>'
        : '<button class="btn btn-sm btn-primary" data-action="tour-end">둘러보기 끝내기</button>') +
      (i < STEPS.length - 1 ? '<button class="btn btn-sm" data-action="tour-end">그만 보기</button>' : '') +
      '</div></aside>';
  };

  /** 첫 방문 안내 카드(고객 홈 맨 위) */
  ui.tourWelcome = function (c) {
    // 둘러보기는 설계 예시(가상 고객) 수치로 설명하므로 예시 고객일 때만 권한다
    if (!c.state.customer.isExample || ui.tourSeen() || (c.view.tour !== null && c.view.tour !== undefined)) return '';
    return '<section class="card welcome" aria-labelledby="welcome-h"><h2 id="welcome-h">처음 오셨나요?</h2>' +
      '<p class="small">사례 보고서의 가상 고객(29세 사무직, 보증금 4,000만원 목표)의 주거자금 설계를 설계사 화면과 고객 화면을 오가며 4단계로 보여드려요.</p>' +
      '<div class="btn-row"><button class="btn btn-primary" data-action="tour-start">둘러보기 시작(약 2분)</button>' +
      '<button class="btn" data-action="tour-skip">바로 둘러볼게요</button></div></section>';
  };

  Object.assign(ui.actions, {
    'tour-start': function () { markSeen(); go(0); },
    'tour-go': function (c, el) { go(Number(el.getAttribute('data-step'))); },
    'tour-end': function () { markSeen(); ui.setView({ tour: null }, true); },
    'tour-skip': function () { markSeen(); ui.setView({ tour: null }, true); }
  });

  ui.TOUR_STEPS = STEPS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
