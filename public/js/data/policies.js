/*
 * 청년 정책·금융상품 자료
 * ------------------------------------------------------------
 * 각 조건은 { value, status, source } 형태입니다.
 *  - status: 'confirmed'(공식·공식 발표 인용 자료로 확인) | 'needsCheck'(확인 필요 — 계산에 자동 적용하지 않음)
 *  - 확인일(checkedAt)이 지난 자료는 가입·신청 전에 다시 확인해야 합니다.
 * 계산 엔진은 status가 'confirmed'인 조건만 자동으로 사용합니다.
 * 수치를 바꿀 때는 출처 URL과 확인일을 함께 고치세요.
 */
(function (root) {
  'use strict';
  var CHECKED = '2026-11-02';

  var SOURCES = {
    fscTF: { title: '금융위원회 보도자료 「청년미래적금 관계기관 TF 킥오프」 (2025-09-12)', url: 'https://fsc.go.kr/po010101/85279' },
    mtnLaunch: { title: 'MTN 「최대 연 19.4% 효과 청년미래적금 나온다」 — 금융위원회 발표 보도 (2026-06-21)', url: 'https://news.mtn.co.kr/news-detail/2026062115572892311' },
    heraldSme: { title: '헤럴드경제 「중기 재직자 우대저축공제 제도 개선」 (2026-03-31)', url: 'https://www.heraldk.com/article/2026033116045141890' },
    taxtimes: { title: '한국세정신문 — 국세청 문답 기반 중소기업 취업자 감면 안내 (2023-01-04)', url: 'https://www.taxtimes.co.kr/news/article.html?no=257932' },
    lawBill1: { title: '국회 입법예고 의안 제2219089호 (현행 연 200만원 한도·2026-12-31 일몰 기재)', url: 'https://opinion.lawmaking.go.kr/gcom/nsmLmSts/out/2219089/detailRP' },
    lawBill2: { title: '국회 입법예고 의안 제2219332호 (현행 청년 90% 감면 기재, 개정안 심사 중)', url: 'https://opinion.lawmaking.go.kr/gcom/nsmLmSts/out/2219332/detailRP' },
    ggHousing: { title: '경기도 주거복지포털 「청년전용 버팀목 전세자금대출」', url: 'https://housing.gg.go.kr/html/24204.do' }
  };

  function c(value, src, note) { return { value: value, status: 'confirmed', source: src, note: note || '' }; }
  function n(value, src, note) { return { value: value, status: 'needsCheck', source: src || null, note: note || '' }; }

  var POLICIES = [
    {
      id: 'youthFuture',
      name: '청년미래적금',
      kind: 'saving',
      agency: '금융위원회 (취급: 은행·우체국)',
      checkedAt: CHECKED,
      fields: {
        recruit: c('1차 2026-06-22 ~ 2026-07-03 (2주)', 'mtnLaunch', '이후 가입 기회는 2차 모집에 따름'),
        recruitNext: n('2차 모집 2026년 12월 잠정', 'mtnLaunch', '보도에 ‘잠정’으로만 나옴 — 확정 공고 확인 필요'),
        age: c('만 19~34세 (1차: 1991-01-01 ~ 2007-08-07 출생)', 'mtnLaunch'),
        incomeGeneral: c('일반형(정부기여 6%): 직전연도 총급여 6,000만원 이하(종합소득 4,800만원 이하)', 'mtnLaunch'),
        incomePreferred: n('우대형(정부기여 12%): 총급여 3,600만원 이하 중소기업 재직자 — TF 발표에서는 ‘중소기업 신규 취업 후 6개월 이내 가입·3년 근속’ 요건으로 설명', 'mtnLaunch', '두 자료의 표현이 달라 최종 공고 확인 필요'),
        household: n('가구 중위소득 200% 이하 (2025-09 TF 발표 기준)', 'fscTF', '출시 보도에는 가구소득 기준이 나오지 않음'),
        monthlyLimit: c(500000, 'mtnLaunch', '월 최대 50만원 자유 납입'),
        term: c(36, 'mtnLaunch', '만기 3년'),
        govRateGeneral: c(0.06, 'mtnLaunch', '납입액의 6%를 정부가 매칭(이자율 아님)'),
        govRatePreferred: c(0.12, 'mtnLaunch', '납입액의 12% 매칭(이자율 아님)'),
        bankRate: n(null, 'fscTF', '은행별 금리는 참여은행이 정함 — 가입 은행 금리 확인 필요'),
        taxFree: c(true, 'mtnLaunch', '이자소득 비과세'),
        payoutDate: n('정부기여금 지급 시점(매월 적립 / 만기 일괄)', null, '공식 자료에서 확인하지 못함'),
        earlyTermination: n('중도해지 시 기여금·비과세 처리, 특별중도해지 사유', null, '공식 자료에서 확인하지 못함 — 중도해지 시나리오 비활성'),
        overlap: c('청년도약계좌와 중복 가입 불가 (갈아타기 허용)', 'mtnLaunch')
      }
    },
    {
      id: 'smeSaving',
      name: '중소기업 재직자 우대 저축공제',
      kind: 'saving',
      agency: '중소벤처기업부·중소벤처기업진흥공단·협약은행',
      checkedAt: CHECKED,
      fields: {
        term: c(60, 'heraldSme', '만기 5년'),
        monthlyRange: c('월 10만~50만원', 'heraldSme'),
        monthlyLimit: c(500000, 'heraldSme'),
        companyRate: c(0.20, 'heraldSme', '근로자 납입액의 20%를 기업이 추가 지원 — 소속 기업 참여가 있어야 함'),
        companyJoin: n('소속 기업의 참여 여부', 'heraldSme', '2026-03부터 재직자가 직접 신청하면 공단이 기업에 참여를 안내 — 실제 참여 확정은 개별 확인'),
        bankRate: c(0.045, 'heraldSme', '은행 우대금리 최대 4.5% (최대치이며 개인별 적용 금리 확인 필요)'),
        eligibility: n('가입 대상 세부 요건', null, '공식 공고 확인 필요'),
        earlyTermination: n('중도해지 시 기업기여금·이자 처리', null, '확인하지 못함 — 만기 전 잔액은 주거자금으로 계산하지 않음'),
        taxFree: n(null, null, '과세 여부 확인 필요 — 확인 전까지 이자에 일반과세(15.4%) 가정')
      }
    },
    {
      id: 'taxRelief',
      name: '중소기업 취업 청년 소득세 감면 (조세특례제한법 제30조)',
      kind: 'tax',
      agency: '국세청 (원천징수의무자인 회사에 감면신청서 제출)',
      checkedAt: CHECKED,
      fields: {
        rate: c(0.9, 'lawBill2', '청년은 소득세의 90% 감면'),
        years: c(5, 'taxtimes', '청년은 취업일부터 5년'),
        annualCap: c(2000000, 'lawBill1', '과세기간(1년)별 200만원 한도'),
        deadline: c('2026-12-31까지 취업한 경우 (현행 일몰)', 'lawBill1', '일몰 폐지·한도 상향 개정안이 국회 심사 중 — 통과 여부 확인 필요'),
        age: n('청년 연령 기준(근로계약 체결일 기준 만 15~34세)', 'taxtimes', '2023년 자료 기준 — 현행 연령 기준 확인 필요'),
        period: n('감면기간의 정확한 기산(최초 취업일, 재취업 시 처리)', null, '본인의 최초 감면 대상 취업일을 회사·국세청에서 확인'),
        company: c('중소기업기본법상 중소기업, 시행령 열거 업종만 (공공기관·금융보험업 등 제외)', 'taxtimes'),
        method: c('회사에 감면신청서 제출 → 매월 원천징수에 반영, 누락 시 연말정산·경정청구', 'taxtimes')
      }
    },
    {
      id: 'youthLease',
      name: '청년전용 버팀목전세자금',
      kind: 'loan',
      agency: '주택도시기금 (수탁은행 심사)',
      checkedAt: CHECKED,
      fields: {
        age: c('만 19~34세 무주택 세대주(예비 포함)', 'ggHousing'),
        income: c('부부합산 연소득 5,000만원 이하', 'ggHousing'),
        asset: c('순자산 3.37억원 이하', 'ggHousing'),
        house: c('전용 85㎡ 이하, 임차보증금 3억원 이하', 'ggHousing'),
        limit: c(150000000, 'ggHousing', '호당 1.5억원 이내(만 25세 미만 단독세대주 1.2억), 신규계약은 전세금의 80% 이내'),
        ltv: c(0.8, 'ggHousing'),
        rateTable: c([{ max: 20000000, rate: 2.2 }, { max: 40000000, rate: 2.5 }, { max: 60000000, rate: 2.9 }, { max: 75000000, rate: 3.3 }], 'ggHousing', '변동금리, 보증금 3억원 이하·부부합산 연소득 기준. 지방 주택 0.2%p 인하'),
        smePref: c(0.3, 'ggHousing', '중소기업 취업(창업)청년 0.3%p — 2024-04-26 신규분부터 최대 4년, 대기업·공기업·공무원 제외'),
        prefCap: c(0.5, 'ggHousing', '일반 우대 합계 상한 0.5%p, 최종 금리 연 1.0% 하한'),
        term: c('2년, 4회 연장 최장 10년', 'ggHousing'),
        approval: c('수탁은행 서류심사·보증기관 심사 후 확정 (예상액은 승인액 아님)', 'ggHousing'),
        tenureLimit: c('1년 미만 재직자는 한도가 2,000만원 이하로 제한될 수 있음', 'ggHousing')
      }
    }
  ];

  function get(id) { for (var i = 0; i < POLICIES.length; i++) if (POLICIES[i].id === id) return POLICIES[i]; return null; }
  function val(id, key) { var p = get(id); var f = p && p.fields[key]; return f && f.status === 'confirmed' ? f.value : null; }

  var Policies = { CHECKED: CHECKED, SOURCES: SOURCES, LIST: POLICIES, get: get, val: val };
  if (typeof module !== 'undefined' && module.exports) module.exports = Policies;
  else { root.FP = root.FP || {}; root.FP.Policies = Policies; }
})(this);
