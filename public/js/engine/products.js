/*
 * 실제 금융상품 비교 계산
 * ------------------------------------------------------------
 * 자료 출처
 *  - 예·적금, 전세자금대출: 금융감독원 「금융상품 한눈에」 공시 API(FSS_API_KEY가 설정된 서버만). 키가 없거나 조회에
 *    실패하면 상품을 만들어 채우지 않고 '자료 없음/조회 실패'로 표시합니다.
 *  - 정책형 저축·정책 대출: public/js/data/policies.js (출처 URL·확인일이 있는 조건만, 미확인 조건은 조건부 계산)
 *  - 투자상품: 연결된 공식 공시 자료가 없어 표시하지 않음
 * 비교 원칙
 *  - 같은 범주 안에서만, 같은 납입액·기간·세금(일반과세 15.4%) 가정으로 계산
 *  - 우대금리는 고객이 '충족 확인'한 경우에만 확정 결과에 적용, 그 밖에는 조건부 결과로 따로 표시
 *  - 최고금리 순위를 매기지 않음(정렬은 기관명 또는 같은 가정의 기본금리 기준 수령액만)
 */
(function (root) {
  'use strict';
  var Calc = root.FP ? root.FP.Calc : null, Policies = root.FP ? root.FP.Policies : null, CDm = root.FP ? root.FP.ClientData : null;
  if (typeof module !== 'undefined' && module.exports) { Calc = require('./calc.js'); Policies = require('../data/policies.js'); CDm = require('./clientData.js'); }

  var TAX = 0.154;
  var CATS = { deposit: '정기예금', saving: '적금', policy: '정책형 저축', investment: '투자상품', loan: '대출상품' };
  var GRP = { '020000': '은행', '030300': '저축은행', '030200': '여신전문금융회사', '050000': '보험회사', '060000': '금융투자회사' };
  var FSS_URL = 'https://finlife.fss.or.kr';
  var JOIN_DENY = { '1': '제한 없음', '2': '서민전용', '3': '일부 제한' };

  function protection(grp) {
    if (grp === '020000' || grp === '030300') return { protected: true, text: '예금자보호 대상: 1인당 금융회사별 원금·이자 합산 1억원까지(2025-09-01부터)', principalRisk: '원금 손실 가능성 없음(금리 확정형). 보호 한도 초과분은 보호되지 않음' };
    return { protected: null, text: '예금자보호 해당 여부 확인 필요', principalRisk: '확인 필요' };
  }
  function txt(s) { s = (s == null ? '' : String(s)).trim(); return s; }

  // 금융감독원 공시 → 공통 형태(필드명은 「금융상품 한눈에」 오픈API 안내 기준. 실제 응답으로 한 번 더 확인 필요)
  function fromFss(category, base, options, grp, fetchedAt) {
    var opts = (options || []).map(function (o) {
      if (category === 'loan') return { rpay: txt(o.rpay_type_nm), rateType: txt(o.lend_rate_type_nm), min: num(o.lend_rate_min), max: num(o.lend_rate_max), avg: num(o.lend_rate_avg) };
      return { term: Number(o.save_trm), rateType: txt(o.intr_rate_type_nm) || (o.intr_rate_type === 'M' ? '복리' : '단리'), base: num(o.intr_rate), max: num(o.intr_rate2), rsrv: txt(o.rsrv_type_nm) || null };
    });
    var pr = protection(grp);
    return {
      id: 'fss:' + category + ':' + base.fin_co_no + ':' + base.fin_prdt_cd, source: 'fss', category: category, grp: grp, grpLabel: GRP[grp] || grp,
      company: txt(base.kor_co_nm), name: txt(base.fin_prdt_nm), kind: CATS[category] + (category === 'loan' ? '(전세자금대출)' : ''),
      options: opts,
      conditions: txt(base.spcl_cnd) || '공시된 우대조건 없음',
      eligibility: [txt(base.join_member), base.join_deny ? '가입제한: ' + (JOIN_DENY[String(base.join_deny)] || base.join_deny) : ''].filter(Boolean).join(' · ') || '공시 없음',
      joinWay: txt(base.join_way), monthlyLimit: base.max_limit != null && base.max_limit !== '' ? Number(base.max_limit) : null,
      afterMaturity: txt(base.mtrt_int), etc: txt(base.etc_note),
      support: '정부·기업 지원금 없음',
      tax: category === 'loan' ? '해당 없음' : '이자소득세 15.4% 일반과세 가정(비과세·세금우대 적용 여부는 본인 자격 확인)',
      fees: category === 'loan' ? ['부대비용: ' + (txt(base.loan_inci_expn) || '공시 없음'), '중도상환수수료: ' + (txt(base.erly_rpay_fee) || '공시 없음'), '연체이자율: ' + (txt(base.dly_rate) || '공시 없음')].join(' / ') : '공시 항목 없음(가입 전 기관 확인)',
      loanLimit: category === 'loan' ? txt(base.loan_lmt) || '공시 없음' : null,
      earlyTermination: '공시 항목에 없음 — 중도해지 이율은 가입 기관 상품설명서 확인 필요(목표일 전 해지 시 원금만 계산)',
      protection: pr.text, principalRisk: pr.principalRisk, taxFree: false,
      sourceUrl: FSS_URL, sourceTitle: '금융감독원 「금융상품 한눈에」 공시(' + txt(base.dcls_month) + ' 공시분)', disclosedMonth: txt(base.dcls_month), checkedAt: fetchedAt
    };
  }
  function num(v) { var n = Number(v); return v === null || v === undefined || v === '' || !isFinite(n) ? null : n; }

  // 정책형 저축·정책 대출(공식 발표·공고로 확인한 조건만 확정, 나머지는 조건부)
  function policyProducts() {
    var P = Policies, S = P.SOURCES, out = [];
    var src = function (k) { return S[k] ? { title: S[k].title, url: S[k].url } : null; };
    var yf = P.get('youthFuture'), sm = P.get('smeSaving'), yl = P.get('youthLease');
    out.push({
      id: 'policy:youthFuture', source: 'policy', category: 'policy', policyId: 'youthFuture', company: '참여 은행·우체국(은행별 금리 상이)', name: '청년미래적금', kind: '정책형 저축(정부기여금 매칭)',
      options: [{ term: yf.fields.term.value, rateType: '단리 가정', base: null, max: null }],
      bankRateUnknown: true, govRate: yf.fields.govRateGeneral.value, govRatePref: yf.fields.govRatePreferred.value,
      conditions: '정부기여금: 일반형 납입액의 6%, 우대형 12%(우대형 요건은 ' + yf.fields.incomePreferred.note + ') · 은행 우대금리는 참여 은행이 정함',
      eligibility: [yf.fields.age.value, yf.fields.incomeGeneral.value, yf.fields.household.value + '(' + yf.fields.household.note + ')'].join(' · '),
      joinWay: yf.fields.recruit.value + ' / ' + yf.fields.recruitNext.value + '(' + yf.fields.recruitNext.note + ')', recruitFrom: '2026-12', recruitTentative: true,
      monthlyLimit: yf.fields.monthlyLimit.value, support: '정부기여금(납입액 매칭, 이자율 아님). 지급 시점: ' + yf.fields.payoutDate.note,
      tax: '이자소득 비과세(금융위원회 발표 기준)', taxFree: true, fees: '공식 자료에 수수료 언급 없음',
      earlyTermination: yf.fields.earlyTermination.note, protection: '은행 적금 원리금은 예금자보호 대상(1인당 1억원). 정부기여금의 보호 여부는 확인 필요', principalRisk: '원금 손실 가능성 없음(적금)',
      sources: [src('mtnLaunch'), src('fscTF')], sourceTitle: '금융위원회 발표·보도(확인일 ' + yf.checkedAt + ')', sourceUrl: S.fscTF.url, checkedAt: yf.checkedAt,
      rules: { ageMin: 19, ageMax: 34, incomeMax: 60000000, prefIncomeMax: 36000000 }
    });
    out.push({
      id: 'policy:smeSaving', source: 'policy', category: 'policy', policyId: 'smeSaving', company: '중소벤처기업진흥공단·협약은행', name: '중소기업 재직자 우대 저축공제', kind: '정책형 저축(기업 지원금 매칭)',
      options: [{ term: sm.fields.term.value, rateType: '단리 가정', base: null, max: sm.fields.bankRate.value * 100 }],
      bankRateUnknown: true, companyRate: sm.fields.companyRate.value, companyNeedsJoin: true,
      conditions: '기업 지원: 근로자 납입액의 20%(' + sm.fields.companyJoin.note + ') · 은행 우대금리 최대 4.5%(최대치, 개인별 적용 금리 확인 필요)',
      eligibility: sm.fields.eligibility.note + ' · 소속 기업 참여 필요',
      joinWay: sm.fields.monthlyRange.value, monthlyLimit: sm.fields.monthlyLimit.value, monthlyMin: 100000,
      support: '기업 지원금 20%(소속 기업 참여 확정 시에만 확정 계산)', tax: sm.fields.taxFree.note, taxFree: false, fees: '공식 자료에서 확인하지 못함',
      earlyTermination: sm.fields.earlyTermination.note, protection: '예금자보호 해당 여부 확인 필요', principalRisk: '원금 손실 가능성 낮음(적립식 공제) — 상품설명서 확인 필요',
      sources: [src('heraldSme')], sourceTitle: '제도 개선 보도(확인일 ' + sm.checkedAt + ')', sourceUrl: S.heraldSme.url, checkedAt: sm.checkedAt
    });
    out.push({
      id: 'policy:youthLease', source: 'policy', category: 'loan', policyId: 'youthLease', company: '주택도시기금(수탁은행)', name: '청년전용 버팀목전세자금', kind: '정책 대출(전세자금)',
      options: yl.fields.rateTable.value.map(function (r) { return { rpay: '', rateType: '변동금리', min: r.rate, max: r.rate, avg: null, note: '연소득 ' + Math.round(r.max / 10000).toLocaleString('ko-KR') + '만원 이하' }; }),
      conditions: '중소기업 취업청년 ' + yl.fields.smePref.value + '%p 우대(' + yl.fields.smePref.note + ') · ' + yl.fields.prefCap.note,
      eligibility: [yl.fields.age.value, yl.fields.income.value, yl.fields.asset.value, yl.fields.house.value].join(' · '),
      joinWay: yl.fields.approval.value, monthlyLimit: null, support: '정책 금리(기금)', tax: '해당 없음', fees: '보증료 등 부대비용은 수탁은행 확인', loanLimit: yl.fields.limit.note,
      earlyTermination: '중도상환수수료: 공식 자료에서 확인하지 못함', protection: '대출상품(예금자보호 해당 없음)', principalRisk: '대출 — 원리금 상환 의무',
      sources: [src('ggHousing')], sourceTitle: '경기도 주거복지포털 안내(확인일 ' + yl.checkedAt + ')', sourceUrl: S.ggHousing.url, checkedAt: yl.checkedAt
    });
    return out;
  }

  // ---------- 고객 상황 ----------
  function ageAt(birthYm, ym) { if (!Calc.ymValid(birthYm) || !Calc.ymValid(ym)) return null; return Math.floor(Calc.ymDiff(birthYm, ym) / 12); }
  function clientSituation(cd, today) {
    var g = function (p) { var v = CDm.get(cd || {}, p); return v === undefined ? null : v; };
    var missing = [];
    var need = function (p) { var v = g(p); if (v === null || v === '') missing.push(CDm.label(p)); return v; };
    var net = need('income.netMonthly'), es = need('expenses.essential'), op = need('expenses.optional');
    var debts = Array.isArray(cd && cd.debts) ? cd.debts : null; if (!debts) missing.push('부채');
    var prods = Array.isArray(cd && cd.products) ? cd.products : [];
    var debtPay = (debts || []).reduce(function (s, d) { return s + (Number(d.payment) || 0); }, 0);
    var prodPay = prods.reduce(function (s, p) { return s + (Number(p.monthly) || 0); }, 0);
    var free = missing.length ? null : net - es - op - debtPay - prodPay;
    var nowYm = today ? (today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0')) : null;
    var high = (debts || []).filter(function (d) { return Number(d.balance) > 0; }).sort(function (a, b) { return b.rate - a.rate; })[0] || null;
    return {
      monthlyFree: free, missing: missing, moveMonth: g('goal.moveMonth'), emergencyFund: g('assets.emergencyFund'), emergencyTarget: g('goal.emergencyTarget'),
      housingFund: g('assets.housingFund'), highDebt: high, age: ageAt(g('profile.birthMonth'), nowYm), annualGross: g('profile.annualGross'), companySize: g('profile.companySize'), nowYm: nowYm
    };
  }

  // ---------- 같은 가정으로 계산 ----------
  function interest(kind, amount, months, ratePct, rateType) {
    var r = (ratePct || 0) / 100 / 12, comp = /복리/.test(rateType || '');
    if (kind === 'deposit') return comp ? amount * (Math.pow(1 + r, months) - 1) : amount * r * months;
    var s = 0; for (var k = 1; k <= months; k++) s += comp ? amount * (Math.pow(1 + r, k) - 1) : amount * r * k;
    return s;
  }
  function pickOption(p, months) {
    var c = (p.options || []).filter(function (o) { return o.term === months; });
    if (!c.length) return null;
    return c.filter(function (o) { return /자유/.test(o.rsrv || ''); })[0] || c[0];
  }

  /*
   * a = { monthly, months, lump, startMonth, prefMet:{[id]:true|false|null}, prefType:'general'|'preferred' }
   * 반환: confirmed(확정 조건만), conditional(확인 안 된 조건까지 넣었을 때), goal(목표 연결 판단), notes
   */
  function evaluate(p, a, sit) {
    var months = Number(a.months), M = Number(a.monthly) || 0, L = Number(a.lump) || 0;
    var res = { id: p.id, category: p.category, notes: [], available: true };
    if (p.category === 'loan' || p.category === 'investment') { res.available = false; res.notes.push('예상 수령액 계산 대상이 아닙니다.'); return res; }
    var opt = p.category === 'policy' ? p.options[0] : pickOption(p, months);
    var term = p.category === 'policy' ? opt.term : months;
    if (!opt) { res.available = false; res.notes.push(months + '개월 상품이 공시되어 있지 않습니다.'); return res; }
    if (p.category === 'policy' && term !== months) res.notes.push('정책상품은 만기가 ' + term + '개월로 정해져 있어 비교 기간(' + months + '개월) 대신 실제 만기로 계산했습니다.');
    var kind = p.category === 'deposit' ? 'deposit' : 'saving';
    var principal = kind === 'deposit' ? L : M * term;
    if (kind === 'saving' && p.monthlyLimit && M > p.monthlyLimit) { res.notes.push('월 납입한도(' + man(p.monthlyLimit) + ')를 넘습니다. 한도까지만 납입 가능합니다.'); }
    if (kind === 'saving' && p.monthlyMin && M < p.monthlyMin) { res.notes.push('최소 납입액(' + man(p.monthlyMin) + ')보다 적습니다.'); }
    var met = a.prefMet ? a.prefMet[p.id] : null;
    var calc = function (rate, extraRate) {
      var intr = interest(kind, kind === 'deposit' ? L : M, term, rate || 0, opt.rateType);
      var tax = p.taxFree ? 0 : intr * TAX;
      var support = (extraRate || 0) * principal;
      return { rate: rate, interest: intr, tax: tax, support: support, net: principal + intr - tax + support };
    };
    if (p.source === 'fss') {
      res.confirmed = Object.assign(calc(opt.base), { label: '기본금리 ' + opt.base + '% (' + opt.rateType + ')' });
      if (opt.max != null && opt.max > opt.base) {
        var c2 = Object.assign(calc(opt.max), { label: '최고금리 ' + opt.max + '% — 우대조건 모두 충족 시' });
        if (met === true) { res.confirmed = Object.assign(c2, { label: '최고금리 ' + opt.max + '% (고객이 우대조건 충족을 확인)' }); res.notes.push('우대조건 충족은 고객 확인 기준입니다. 가입 기관에서 실제 적용 여부를 확인하세요.'); }
        else if (met === false) res.notes.push('우대조건을 충족하지 않는 것으로 표시해 기본금리만 적용했습니다.');
        else res.conditional = c2;
      }
    } else if (p.policyId === 'youthFuture') {
      // 은행 금리 미확인 → 0% 가정. 일반형 6%는 확정, 우대형 12%는 요건 표현이 엇갈려 조건부
      var prefOk = sit && sit.annualGross != null && sit.annualGross <= p.rules.prefIncomeMax && sit.companySize === 'sme';
      res.confirmed = Object.assign(calc(0, p.govRate), { label: '정부기여금 6%(일반형) · 은행 금리 미확인(0% 가정)' });
      if (prefOk) res.conditional = Object.assign(calc(0, p.govRatePref), { label: '우대형 12% — 요건 최종 공고 확인 시' });
      res.notes.push('은행 금리는 참여 은행이 정해 아직 확인하지 못했습니다. 확인되면 그만큼 늘어납니다.');
      if (p.recruitTentative) res.notes.push('2차 모집(2026년 12월)은 보도상 ‘잠정’입니다.');
      var elig = [];
      if (sit) {
        if (sit.age == null) elig.push('나이: 출생 연월 미입력'); else elig.push('나이 만 ' + sit.age + '세 → ' + (sit.age >= p.rules.ageMin && sit.age <= p.rules.ageMax ? '충족' : '미충족'));
        if (sit.annualGross == null) elig.push('총급여 미입력'); else elig.push('총급여 ' + man(sit.annualGross) + ' → 일반형 ' + (sit.annualGross <= p.rules.incomeMax ? '충족' : '미충족') + ', 우대형 ' + (prefOk ? '소득·기업 규모 충족(요건 확인 필요)' : '해당 없음'));
        elig.push('가구소득 기준: 확인 필요');
      }
      res.eligibility = elig;
    } else if (p.policyId === 'smeSaving') {
      var join = a.prefMet ? a.prefMet[p.id] : null;
      res.confirmed = Object.assign(calc(0, join === true ? p.companyRate : 0), { label: join === true ? '기업 지원 20% 포함(고객이 회사 참여 확인) · 은행 금리 미확인(0% 가정)' : '은행 금리·기업 참여 미확인(원금만)' });
      if (join !== true) res.conditional = Object.assign(calc(opt.max, p.companyRate), { label: '회사 참여 + 은행 우대금리 최대 4.5% 적용 시(최대치)' });
      if (sit && sit.companySize && sit.companySize !== 'sme') res.notes.push('입력한 회사 규모가 중소기업이 아니어서 가입 대상이 아닐 수 있습니다.');
    }
    // 목표 연결
    var start = a.startMonth || (p.recruitFrom && sit && sit.nowYm && Calc.ymDiff(sit.nowYm, p.recruitFrom) > 0 ? p.recruitFrom : (sit && sit.nowYm ? Calc.ymAdd(sit.nowYm, 1) : null));
    if (p.recruitFrom && start && Calc.ymDiff(p.recruitFrom, start) < 0) start = p.recruitFrom;
    var maturity = start ? Calc.ymAdd(start, term) : null;
    var g = { start: start, maturity: maturity, term: term };
    if (sit && sit.moveMonth && maturity) {
      g.matures = Calc.ymDiff(maturity, sit.moveMonth) >= 0;
      var paidMonths = Math.max(0, Math.min(term, Calc.ymDiff(start, sit.moveMonth)));
      g.usableAtGoal = g.matures ? res.confirmed.net : (kind === 'deposit' ? L : M * paidMonths);
      g.usableNote = g.matures ? '만기 지급액(확정 조건 기준)' : '목표일까지 만기가 안 됨 → 중도해지 시 원금만 계산(중도해지 이율·지원금 회수 조건 미확인)';
    } else g.usableNote = '이사 예정월(목표일)이 입력되지 않아 판단할 수 없습니다.';
    if (kind === 'saving') {
      if (!sit || sit.monthlyFree == null) g.afford = { ok: null, text: '판단 불가 — 미입력: ' + (sit ? sit.missing.join(', ') : '고객 정보') };
      else g.afford = { ok: M <= sit.monthlyFree, text: '월 여유자금 ' + man(sit.monthlyFree) + ' 중 ' + man(M) + ' 납입' + (M <= sit.monthlyFree ? '' : ' → 부족 ' + man(M - sit.monthlyFree)) };
    } else {
      g.afford = sit && sit.housingFund != null ? { ok: L <= sit.housingFund, text: '주거자금 ' + man(sit.housingFund) + ' 중 ' + man(L) + ' 예치' + (L <= sit.housingFund ? '' : ' → 부족') } : { ok: null, text: '주거자금 미입력' };
    }
    var imp = [];
    if (sit && sit.emergencyFund != null && sit.emergencyTarget != null && sit.emergencyFund < sit.emergencyTarget) {
      var gap = sit.emergencyTarget - sit.emergencyFund;
      if (kind === 'saving' && sit.monthlyFree != null && sit.moveMonth && sit.nowYm) {
        var left = (sit.monthlyFree - M) * Math.max(1, Calc.ymDiff(sit.nowYm, sit.moveMonth));
        imp.push(left >= gap ? '납입 후에도 목표일까지 비상금 부족분(' + man(gap) + ')을 채울 여유가 있습니다.' : '납입하면 목표일까지 비상금 부족분(' + man(gap) + ')을 다 채우기 어렵습니다.');
      } else imp.push('비상금이 목표보다 ' + man(gap) + ' 부족합니다. 비상금을 먼저 채우는지 확인하세요.');
    }
    if (sit && sit.highDebt) {
      var eff = res.confirmed && principal ? ((res.confirmed.net - principal) / principal) / (term / 12) * 100 : 0;
      if (sit.highDebt.rate > eff) imp.push(sit.highDebt.name + '(연 ' + sit.highDebt.rate + '%) 잔액이 있어, 같은 돈으로 먼저 갚는 쪽이 이 상품의 세후 연 환산 ' + eff.toFixed(2) + '%보다 유리할 수 있습니다.');
    }
    g.impact = imp;
    g.riskFit = '원금 손실 가능성이 낮은 상품 — 3년 안에 쓸 주거 핵심자금 용도에 맞음(위험성향과 무관하게 가능)';
    res.goal = g;
    return res;
  }

  // 이 상품을 계획에 반영해보기: 실행 기준 계획에 상품을 넣어 전후 비교(저장은 확인 후 별도)
  function applyToPlan(plan, p, a, r) {
    var d = JSON.parse(JSON.stringify(plan));
    var base = d.basis.baseMonth;
    var start = r.goal.start && Calc.ymDiff(base, r.goal.start) >= 1 ? r.goal.start : Calc.ymAdd(base, 1);
    var entry = { id: 'x' + Date.now().toString(36).slice(-5), name: p.company.split('(')[0] + ' ' + p.name + '(검토)', policyId: p.policyId || 'generic', enabled: true, startMonth: start, termMonths: r.goal.term,
      monthly: p.category === 'deposit' ? 0 : Number(a.monthly) || 0, lump: p.category === 'deposit' ? Number(a.lump) || 0 : 0,
      interestRate: r.confirmed ? r.confirmed.rate || 0 : 0, compound: /복리/.test((p.options[0] || {}).rateType || ''), taxFree: !!p.taxFree, paidSoFar: 0,
      govRate: p.policyId === 'youthFuture' ? p.govRate : 0, govConfirmed: p.policyId === 'youthFuture', companyRate: p.policyId === 'smeSaving' ? p.companyRate : 0, companyConfirmed: p.policyId === 'smeSaving' && a.prefMet && a.prefMet[p.id] === true,
      note: '상품 비교에서 반영(확정 조건만) · 실제 가입 아님', productRef: p.id };
    d.products = (d.products || []).concat([entry]);
    return d;
  }
  // ym: 비교할 달(상품 납입이 시작되는 달). 그 달의 월 여유자금(소득−생활비−상환−납입)과 목표일 부족액을 비교
  function compare(planBefore, planAfter, ym) {
    var b = Calc.simulate(planBefore), a = Calc.simulate(planAfter);
    var t = ym ? Math.max(1, Calc.ymDiff(planBefore.basis.baseMonth, ym)) : 1;
    var m = function (r) { var x = r.rows[Math.min(t, r.rows.length - 1)]; return { ym: x.ym, surplus: x.surplus, productContrib: x.productContrib, gap: r.gap, status: r.status, usable: r.at.usableHousing, emergency: r.at.emergencyBal, debtFree: r.debtFree }; };
    return { before: m(b), after: m(a), warnings: a.warnings.filter(function (w) { return !b.warnings.some(function (x) { return x.text === w.text; }); }) };
  }

  function man(v) { return Math.round(Number(v) / 10000).toLocaleString('ko-KR') + '만원'; }
  function stale(meta, days) { if (!meta || !meta.fetchedAt) return true; return (Date.now() - new Date(meta.fetchedAt).getTime()) / 864e5 > (days || 7); }

  var Products = { CATS: CATS, GRP: GRP, TAX: TAX, fromFss: fromFss, policyProducts: policyProducts, clientSituation: clientSituation, evaluate: evaluate, interest: interest, applyToPlan: applyToPlan, compare: compare, stale: stale };
  if (typeof module !== 'undefined' && module.exports) module.exports = Products;
  else { root.FP = root.FP || {}; root.FP.Products = Products; }
})(this);
