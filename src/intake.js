/*
 * 고객정보 입력(첫 화면)의 항목 정의·검사·상태 만들기. 화면과 분리된 순수 함수라 Node에서 테스트한다.
 *
 * - 입력값(values)은 화면 입력칸과 같은 이름의 문자열 묶음이다. 빈 칸 = 미확인, '0' = 실제 0원.
 * - 고객정보에는 '지금 사실'만 넣는다. 설계안(생활비 200, 대출 700 상환, 연금 월 10, 목적자금 110 등)은
 *   계획 버전(plans)에 따로 두고, 고객정보 수정이 설계안의 수동 조정값을 덮어쓰지 않는다.
 * - 계산에 쓰는 금액 칸은 미확인이면 0으로 계산하고 customer.unknown에 이름을 남겨 화면에 '미확인'으로 표시한다.
 */
(function (root) {
  'use strict';

  var isNode = typeof module !== 'undefined' && module.exports;
  var dates = isNode ? require('./dates.js') : root.Planner.dates;
  var demo = isNode ? require('../data/demo.js') : root.Planner.demo;

  /* ---------- 항목 정의 ---------- */

  var SECTIONS = [
    { key: 'basic', title: '기본정보' },
    { key: 'income', title: '소득과 지출' },
    { key: 'assets', title: '자산과 부채' },
    { key: 'goal', title: '목표와 선호' }
  ];

  // 월 생활비 항목: [키, 이름, 기본 필수 여부]
  var LIVING = [
    ['rent', '월세·관리비', true],
    ['transport', '교통비', true],
    ['food', '식비·생필품', true],
    ['telecom', '통신·구독', true],
    ['insurance', '보험료', true],
    ['parents', '부모 지원', true],
    ['health', '건강·자기계발', true],
    ['leisure', '여가·쇼핑', false],
    ['irregular', '비정기 적립', false],
    ['otherEss', '기타 필수 지출', true],
    ['otherOpt', '기타 선택 지출', false]
  ];

  var SIZES = ['중소기업', '중견기업', '대기업', '공공기관', '기타'];
  var HOUSEHOLDS = ['미혼 1인 가구', '기혼', '기타'];
  var PRINCIPAL = ['단기 주거자금은 원금손실 회피', '일부 가격 변동 감수', '미확인'];
  var NEW_LOAN = ['결혼 전 신규 신용대출 추가 없음', '필요하면 검토', '미확인'];
  var METHODS = [['equalPrincipal', '원금균등'], ['annuity', '원리금균등']];

  function money(key, label, section, o) {
    return Object.assign({ key: key, label: label, section: section, type: 'money', unit: '만원', min: 0, max: 100000 }, o || {});
  }

  var FIELDS = [
    { key: 'name', label: '이름(또는 별칭)', section: 'basic', type: 'text', maxLength: 30, hint: '비우면 "이름 미입력"으로 표시' },
    { key: 'age', label: '만 나이', section: 'basic', type: 'number', unit: '세', required: true, min: 15, max: 100, step: 1 },
    { key: 'household', label: '가구 형태', section: 'basic', type: 'select', options: HOUSEHOLDS },
    { key: 'companySize', label: '회사 규모', section: 'basic', type: 'select', options: SIZES },
    { key: 'job', label: '직업·고용 형태', section: 'basic', type: 'text', maxLength: 40 },
    { key: 'tenure', label: '재직 연차', section: 'basic', type: 'number', unit: '년 차', min: 1, max: 50, step: 1 },
    { key: 'baseDate', label: '기준일', section: 'basic', type: 'date', required: true, hint: '이 날의 자산·부채 기준. 설계 시작월은 기준일이 속한 달' },

    money('grossPrevYear', '연 총급여(세전)', 'income', { unit: '만원/년', hint: '정책상품 조건 확인에만 씀' }),
    money('netMonthly', '월 실수령', 'income', { unit: '만원/월', required: true, min: 1, max: 10000 }),
    money('existingSaving', '기존 저축·투자', 'income', { unit: '만원/월', hint: '참고용(계산은 실수령 − 지출 − 상환으로 함)' }),
    { key: 'existingSavingNote', label: '기존 저축·투자 구성', section: 'income', type: 'text', maxLength: 60 },

    money('depositCurrent', '현재 임차보증금', 'assets', { hint: '돌려받을 금액' }),
    { key: 'depositReturnMonth', label: '보증금 반환 예정월', section: 'assets', type: 'month', hint: '비우면 목표 시점에 반환된다고 봄' },
    money('cash', '현금·입출금예금', 'assets'),
    money('savings', '만기 예·적금', 'assets', { hint: '해지손실 없이 쓸 수 있는 금액' }),
    money('investment', '투자자산(ETF 등) 순현금화 금액', 'assets', { hint: '팔았을 때 비용을 뺀 금액' }),
    money('pension', '연금저축', 'assets', { hint: '노후 목적, 주거자금에 넣지 않음' }),
    money('emergency', '따로 모아 둔 비상금', 'assets'),
    money('housing', '따로 모아 둔 주거자금', 'assets'),
    { key: 'debtName', label: '부채 이름', section: 'assets', type: 'text', maxLength: 20, group: 'debt' },
    money('debtBalance', '부채 잔액', 'assets', { group: 'debt' }),
    { key: 'debtRate', label: '연 금리', section: 'assets', type: 'number', unit: '%', min: 0, max: 30, step: 0.01, group: 'debt' },
    { key: 'debtMonths', label: '잔여 상환 기간', section: 'assets', type: 'number', unit: '개월', min: 1, max: 600, step: 1, group: 'debt' },
    { key: 'debtMethod', label: '상환 방식', section: 'assets', type: 'select', options: METHODS.map(function (m) { return m[1]; }), group: 'debt' },

    { key: 'targetMonth', label: '목표 시점(이사월)', section: 'goal', type: 'month', required: true },
    money('depositTarget', '목표 보증금', 'goal', { required: true, min: 1 }),
    money('movingCost', '부대비용(이사·중개 등)', 'goal'),
    money('emergencyTarget', '비상금 목표', 'goal', { required: true }),
    { key: 'keepSpending', label: '유지하고 싶은 지출', section: 'goal', type: 'text', maxLength: 80 },
    { key: 'principalPref', label: '주거자금 원금손실에 대한 선호', section: 'goal', type: 'select', options: PRINCIPAL },
    { key: 'newLoanPref', label: '신규 대출 계획', section: 'goal', type: 'select', options: NEW_LOAN },
    { key: 'memo', label: '메모', section: 'goal', type: 'text', maxLength: 120 }
  ];
  // 생활비 항목은 '소득과 지출' 구역의 표로 따로 그린다(금액 + 필수 여부).
  LIVING.forEach(function (l) {
    FIELDS.push(money('lv_' + l[0], l[1], 'income', { unit: '만원/월', max: 10000, living: true, defaultEssential: l[2] }));
  });

  var BY_KEY = {};
  FIELDS.forEach(function (f) { BY_KEY[f.key] = f; });

  // 미확인이면 0으로 계산하는 금액 칸(고객정보 키)
  var UNKNOWN_KEYS = ['grossPrevYear', 'cash', 'savings', 'investment', 'pension', 'emergency', 'housing', 'depositCurrent', 'movingCost', 'existingSaving'];

  /* ---------- 설계 예시(사례 보고서 가상 고객의 '초기' 정보) ---------- */

  var EXAMPLE = {
    name: '가상 고객 B',
    age: '29',
    household: '미혼 1인 가구',
    companySize: '중소기업',
    job: '정규직 사무직',
    tenure: '3',
    baseDate: '2026-11-03',
    grossPrevYear: '4500',
    netMonthly: '320',
    existingSaving: '50',
    existingSavingNote: '세부 구성 미확인',
    depositCurrent: '1000',
    depositReturnMonth: '',
    cash: '200',
    savings: '600',
    investment: '400',
    pension: '100',
    emergency: '0',
    housing: '0',
    debtName: '신용대출',
    debtBalance: '1000',
    debtRate: '7.2',
    debtMonths: '36',
    debtMethod: '원금균등',
    targetMonth: '2029-10',
    depositTarget: '4000',
    movingCost: '150',
    emergencyTarget: '990',
    keepSpending: '부모 지원, 건강·자기계발 지출 유지',
    principalPref: PRINCIPAL[0],
    newLoanPref: NEW_LOAN[0],
    memo: '',
    lv_rent: '70', lv_transport: '10', lv_food: '60', lv_telecom: '8', lv_insurance: '8',
    lv_parents: '15', lv_health: '12', lv_leisure: '42', lv_irregular: '10', lv_otherEss: '0', lv_otherOpt: '0'
  };
  LIVING.forEach(function (l) { EXAMPLE['ess_' + l[0]] = l[2] ? 'on' : ''; });

  function exampleValues() {
    return JSON.parse(JSON.stringify(EXAMPLE));
  }

  function emptyValues() {
    var v = {};
    FIELDS.forEach(function (f) { v[f.key] = ''; });
    LIVING.forEach(function (l) { v['ess_' + l[0]] = l[2] ? 'on' : ''; });
    v.debtMethod = '원금균등';
    return v;
  }

  /** 입력칸에 무언가 적혀 있는가(필수 여부 체크박스·기본 선택값은 빼고) */
  function hasContent(values) {
    var blank = emptyValues();
    return FIELDS.some(function (f) {
      var v = String((values || {})[f.key] === undefined ? '' : values[f.key]).trim();
      if (f.type === 'select') return v !== '' && v !== String(blank[f.key] || '');
      return v !== '';
    });
  }

  /* ---------- 검사 ---------- */

  function str(values, k) {
    var v = values[k];
    return v === undefined || v === null ? '' : String(v).trim();
  }

  /**
   * 필수값·숫자 범위·날짜 순서를 검사한다.
   * @returns {{ok, errors:{key:message}, data:{key:number|string|null}}} data의 null = 미확인
   */
  function validate(values) {
    values = values || {};
    var errors = {};
    var data = {};
    FIELDS.forEach(function (f) {
      var raw = str(values, f.key);
      if (raw === '') {
        data[f.key] = null;
        if (f.required) errors[f.key] = f.label + '을(를) 입력해 주세요.';
        return;
      }
      if (f.type === 'money' || f.type === 'number') {
        var n = Number(raw.replace(/,/g, ''));
        if (!Number.isFinite(n)) { errors[f.key] = '숫자로 입력해 주세요.'; return; }
        if (f.min !== undefined && n < f.min) { errors[f.key] = f.min === 0 ? '0 이상으로 입력해 주세요.' : f.min + (f.unit && f.unit.indexOf('만원') === 0 ? '만원' : '') + ' 이상으로 입력해 주세요.'; return; }
        if (f.max !== undefined && n > f.max) { errors[f.key] = f.max + ' 이하로 입력해 주세요(단위 ' + (f.unit || '') + ').'; return; }
        if (f.step === 1 && Math.round(n) !== n) { errors[f.key] = '정수로 입력해 주세요.'; return; }
        data[f.key] = n;
      } else if (f.type === 'month') {
        if (!dates.isValidYM(raw)) { errors[f.key] = '연도-월(예: 2029-10) 형식으로 입력해 주세요.'; return; }
        data[f.key] = raw;
      } else if (f.type === 'date') {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || !dates.isValidYM(raw.slice(0, 7)) || Number(raw.slice(8, 10)) < 1 || Number(raw.slice(8, 10)) > 31) {
          errors[f.key] = '날짜(예: 2026-11-03) 형식으로 입력해 주세요.'; return;
        }
        data[f.key] = raw;
      } else if (f.type === 'select') {
        if (f.options.indexOf(raw) < 0) { errors[f.key] = '목록에서 골라 주세요.'; return; }
        data[f.key] = raw;
      } else {
        data[f.key] = raw.slice(0, f.maxLength || 200);
      }
    });
    LIVING.forEach(function (l) { data['ess_' + l[0]] = str(values, 'ess_' + l[0]) === 'on'; });

    // 날짜 순서
    var base = data.baseDate ? data.baseDate.slice(0, 7) : null;
    if (base && data.targetMonth && !errors.targetMonth && dates.parseYM(data.targetMonth) <= dates.parseYM(base)) {
      errors.targetMonth = '목표 시점은 기준일(' + base + ')보다 뒤여야 합니다.';
    }
    if (base && data.depositReturnMonth && !errors.depositReturnMonth && dates.parseYM(data.depositReturnMonth) < dates.parseYM(base)) {
      errors.depositReturnMonth = '반환 예정월은 기준일 이후여야 합니다.';
    }
    // 생활비: 하나 이상
    var livingSum = LIVING.reduce(function (s, l) { return s + (data['lv_' + l[0]] || 0); }, 0);
    var livingAny = LIVING.some(function (l) { return data['lv_' + l[0]] !== null && data['lv_' + l[0]] !== undefined; });
    if (!livingAny) errors.lv_rent = '월 생활비 항목을 하나 이상 입력해 주세요(없는 항목은 0).';
    else if (livingSum <= 0) errors.lv_rent = '월 생활비 합계가 0입니다. 실제 지출을 입력해 주세요.';
    // 부채: 잔액이 있으면 금리·기간 필요
    if (data.debtBalance > 0) {
      if (data.debtRate === null && !errors.debtRate) errors.debtRate = '잔액이 있으면 연 금리를 입력해 주세요.';
      if (data.debtMonths === null && !errors.debtMonths) errors.debtMonths = '잔액이 있으면 잔여 기간을 입력해 주세요.';
    }
    // 월 지출이 실수령을 크게 넘으면 오류(입력 실수일 가능성이 큼)
    if (data.netMonthly && livingSum > data.netMonthly * 3 && !errors.lv_rent) {
      errors.lv_rent = '월 생활비 합계(' + livingSum + '만원)가 월 실수령의 3배를 넘습니다. 단위(만원/월)를 확인해 주세요.';
    }
    return { ok: Object.keys(errors).length === 0, errors: errors, data: data };
  }

  /* ---------- 입력값 → 고객정보·설계 전 계획 ---------- */

  function nz(x) { return x === null || x === undefined ? 0 : x; }

  function livingTotals(data) {
    var ess = 0;
    var opt = 0;
    var items = [];
    LIVING.forEach(function (l) {
      var v = data['lv_' + l[0]];
      var e = !!data['ess_' + l[0]];
      if (v !== null && v !== undefined) {
        if (e) ess += v; else opt += v;
      }
      items.push({ key: l[0], label: l[1], amount: v === undefined ? null : v, essential: e });
    });
    return { essential: ess, optional: opt, items: items };
  }

  function buildDebt(data) {
    if (!(data.debtBalance > 0)) return null;
    var bal = data.debtBalance;
    var rate = Math.round(nz(data.debtRate) * 10000) / 1000000; // 7.2 → 0.072(부동소수 오차 제거)
    var n = Math.max(1, Math.round(nz(data.debtMonths) || 1));
    var method = data.debtMethod === '원리금균등' ? 'annuity' : 'equalPrincipal';
    var d = { name: data.debtName || '부채', balance: bal, rate: rate, remainingMonths: n };
    if (method === 'equalPrincipal') {
      d.method = 'equalPrincipal';
      d.monthlyPrincipal = bal / n;
      d.monthlyPayment = bal / n + bal * rate / 12;
      d.note = '잔여 ' + n + '개월 원금균등 상환';
    } else {
      var r = rate / 12;
      d.monthlyPayment = r > 0 ? bal * r / (1 - Math.pow(1 + r, -n)) : bal / n;
      d.note = '잔여 ' + n + '개월 원리금균등 상환';
    }
    return d;
  }

  /** 검사를 통과한 data → 고객정보(사실만). prev가 있으면 이 화면에 없는 항목(설문 결과 등)은 이어받는다. */
  function buildCustomer(data, prev) {
    prev = prev || {};
    var base = data.baseDate.slice(0, 7);
    var lt = livingTotals(data);
    var unknown = UNKNOWN_KEYS.filter(function (k) { return data[k] === null; });
    LIVING.forEach(function (l) { if (data['lv_' + l[0]] === null) unknown.push('lv_' + l[0]); });
    var debt = buildDebt(data);
    var otherDebts = (prev.debts || []).slice(1); // 이 화면은 부채 1개만 다룬다. 나머지는 그대로 둔다.
    var c = Object.assign({}, prev, {
      name: data.name || '이름 미입력',
      age: data.age,
      // 만 나이만 받으므로 정책 조건 계산용 출생 연월은 기준월 − 나이 − 6개월로 가정한다(birthAssumed).
      birth: dates.addMonths(base, -(data.age * 12 + 6)),
      birthAssumed: true,
      firstJob: data.tenure ? (Number(base.slice(0, 4)) - (data.tenure - 1)) + '-01' : null,
      tenure: data.tenure,
      job: data.job || '',
      companySize: data.companySize || '',
      household: data.household || '',
      region: prev.region || '',
      grossPrevYear: nz(data.grossPrevYear),
      netMonthly: data.netMonthly,
      taxExemption: prev.taxExemption === undefined ? null : prev.taxExemption,
      cash: nz(data.cash),
      savings: nz(data.savings),
      emergency: nz(data.emergency),
      housing: nz(data.housing),
      investment: nz(data.investment),
      pension: nz(data.pension),
      depositReturn: data.depositCurrent > 0 ? { amount: data.depositCurrent, month: data.depositReturnMonth || data.targetMonth, note: data.depositReturnMonth ? '' : '반환월 미확인 — 목표 시점에 반환된다고 가정' } : null,
      debts: (debt ? [debt] : []).concat(otherDebts),
      goal: { depositTarget: data.depositTarget, movingCost: nz(data.movingCost), emergencyTarget: data.emergencyTarget, emergencyBasis: '고객 입력 목표' },
      livingItems: lt.items,
      existingSaving: { monthly: data.existingSaving, note: data.existingSavingNote || '' },
      preferences: { keepSpending: data.keepSpending || '', principal: data.principalPref || '', newLoan: data.newLoanPref || '', memo: data.memo || '' },
      risk: Object.assign({ institution: null, appSurvey: null }, prev.risk || {}, {
        note: [data.principalPref, data.newLoanPref].filter(function (x) { return x && x !== '미확인'; }).join(' · ') || (prev.risk && prev.risk.note) || ''
      }),
      unknown: unknown
    });
    delete c.livingDetail; // 예전 형식(기존·조정이 섞인 표)은 쓰지 않는다
    return c;
  }

  function beforePlan(data, prevPlan) {
    var lt = livingTotals(data);
    return Object.assign({}, prevPlan || {}, {
      id: (prevPlan && prevPlan.id) || 'before-v1',
      kind: '설계 전',
      date: data.baseDate,
      name: '설계 전 진단',
      memo: '입력한 생활비 ' + round1(lt.essential + lt.optional) + '만원 유지, 부채는 약정대로 상환, 자산 재배치 없음',
      startMonth: data.baseDate.slice(0, 7),
      targetMonth: data.targetMonth,
      essential: lt.essential,
      optional: lt.optional,
      extraRepayment: 0,
      pensionMonthly: 0,
      initial: {},
      products: [],
      parentId: null,
      author: '앱(고객정보 입력)'
    });
  }

  function round1(x) { return Math.round(x * 10) / 10; }

  /* ---------- 상태 만들기(처음 입력) ---------- */

  /**
   * 처음 입력을 마친 상태를 만든다.
   * @param {object} values 화면 입력값
   * @param {string} source 'example'(설계 예시를 불러와 저장) | 'manual'
   * @returns {{ok, errors, state}}
   */
  function buildState(values, source) {
    var v = validate(values);
    if (!v.ok) return { ok: false, errors: v.errors, state: null };
    var d = v.data;
    var tpl = demo.getDemo(); // 가정·경보 기준·설계안 틀
    var s = {
      schemaVersion: 1,
      activePlanId: 'before-v1',
      customer: buildCustomer(d, null),
      plans: [beforePlan(d, null)],
      initial: {},
      assumptions: tpl.assumptions,
      assumptionNotes: tpl.assumptionNotes,
      settings: tpl.settings,
      records: [],
      scheduledPayments: [],
      proposals: [],
      alerts: [],
      changeLog: [{ at: d.baseDate, who: '고객', what: '고객정보 입력 완료', version: 'before-v1' }],
      intake: { done: true, source: source === 'example' ? 'example' : 'manual', savedAt: d.baseDate }
    };
    if (source === 'example') {
      // 예시는 기준일·설계 시작월을 고정한다(오늘 날짜로 계산 기간이 바뀌지 않게).
      s.demoToday = d.baseDate;
      s.demoVersion = tpl.demoVersion;
      s.caseSource = tpl.caseSource;
      s.customer.isExample = true;
      var design = tpl.plans.filter(function (p) { return p.kind === '설계 후'; });
      design.forEach(function (p) { s.plans.push(p); });
      if (design.length) {
        s.activePlanId = design[0].id;
        s.changeLog.push({ at: d.baseDate, who: '설계사', what: '보고서 설계안을 계획 버전으로 추가(고객정보와 별도)', version: design[0].id });
      }
      var diff = diffFromExample(values);
      if (diff.length) {
        s.review = [{ at: d.baseDate, dismissed: false, items: ['설계 예시에서 바꾼 항목: ' + diff.join(', ') + '. 보고서 설계안은 예시 값 기준으로 만든 것이므로 설계사 화면에서 다시 검토하세요.'] }];
      }
    }
    return { ok: true, errors: {}, state: s };
  }

  function diffFromExample(values) {
    var ex = exampleValues();
    var out = [];
    FIELDS.forEach(function (f) {
      var a = str(values, f.key);
      var b = str(ex, f.key);
      if (f.type === 'money' || f.type === 'number') { if ((a === '' ? null : Number(a)) !== (b === '' ? null : Number(b))) out.push(f.label); }
      else if (a !== b) out.push(f.label);
    });
    LIVING.forEach(function (l) { if ((str(values, 'ess_' + l[0]) === 'on') !== (ex['ess_' + l[0]] === 'on')) out.push(l[1] + ' 필수 여부'); });
    return out;
  }

  /* ---------- 저장된 상태 → 입력값(수정 화면) ---------- */

  function fmtNum(x) {
    if (x === null || x === undefined || x === '') return '';
    var n = Number(x);
    return Number.isFinite(n) ? String(Math.round(n * 100) / 100) : '';
  }

  function fromState(state) {
    var c = (state && state.customer) || {};
    var unk = c.unknown || [];
    var v = emptyValues();
    var m = function (k, val) { v[k] = unk.indexOf(k) >= 0 ? '' : fmtNum(val); };
    v.name = c.name && c.name !== '이름 미입력' ? c.name : '';
    var today = (state && (state.demoToday || (state.intake && state.intake.savedAt))) || null;
    var bp = (state.plans || []).filter(function (p) { return p.kind === '설계 전'; }).slice(-1)[0] || (state.plans || [])[0] || {};
    v.baseDate = today || (bp.startMonth ? bp.startMonth + '-01' : '');
    var ym = v.baseDate ? v.baseDate.slice(0, 7) : null;
    v.age = c.age !== undefined && c.age !== null ? fmtNum(c.age) : (c.birth && ym ? fmtNum(dates.ageAt(c.birth, ym)) : '');
    v.household = HOUSEHOLDS.indexOf(c.household) >= 0 ? c.household : '';
    v.companySize = SIZES.indexOf(c.companySize) >= 0 ? c.companySize : '';
    v.job = c.job || '';
    v.tenure = c.tenure ? fmtNum(c.tenure) : (c.firstJob && ym ? fmtNum(Number(ym.slice(0, 4)) - Number(c.firstJob.slice(0, 4)) + 1) : '');
    m('grossPrevYear', c.grossPrevYear);
    v.netMonthly = fmtNum(c.netMonthly);
    v.existingSaving = c.existingSaving && c.existingSaving.monthly !== null && c.existingSaving.monthly !== undefined ? fmtNum(c.existingSaving.monthly) : '';
    v.existingSavingNote = (c.existingSaving && c.existingSaving.note) || '';
    var dr = c.depositReturn || null;
    v.depositCurrent = dr ? fmtNum(dr.amount) : (unk.indexOf('depositCurrent') >= 0 ? '' : '0');
    v.depositReturnMonth = dr && dr.month && !/미확인/.test(dr.note || '') ? dr.month : '';
    ['cash', 'savings', 'investment', 'pension', 'emergency', 'housing'].forEach(function (k) { m(k, c[k]); });
    var d0 = (c.debts || [])[0];
    if (d0) {
      v.debtName = d0.name || '';
      v.debtBalance = fmtNum(d0.balance);
      v.debtRate = fmtNum(Number(d0.rate) * 100);
      v.debtMonths = d0.remainingMonths ? fmtNum(d0.remainingMonths)
        : d0.method === 'equalPrincipal' && d0.monthlyPrincipal > 0 ? fmtNum(Math.round(d0.balance / d0.monthlyPrincipal)) : '';
      v.debtMethod = d0.method === 'equalPrincipal' ? '원금균등' : '원리금균등';
    }
    var g = c.goal || {};
    v.targetMonth = bp.targetMonth || '';
    v.depositTarget = fmtNum(g.depositTarget);
    m('movingCost', g.movingCost);
    v.emergencyTarget = fmtNum(g.emergencyTarget);
    var pr = c.preferences || {};
    v.keepSpending = pr.keepSpending || '';
    v.principalPref = PRINCIPAL.indexOf(pr.principal) >= 0 ? pr.principal : '';
    v.newLoanPref = NEW_LOAN.indexOf(pr.newLoan) >= 0 ? pr.newLoan : '';
    v.memo = pr.memo || '';
    if (c.livingItems) {
      c.livingItems.forEach(function (it) {
        v['lv_' + it.key] = it.amount === null || it.amount === undefined ? '' : fmtNum(it.amount);
        v['ess_' + it.key] = it.essential ? 'on' : '';
      });
    } else {
      // 예전 저장본: 항목별 생활비가 없으면 설계 전 계획의 합계를 '기타' 칸에 옮긴다.
      v.lv_otherEss = fmtNum(bp.essential);
      v.lv_otherOpt = fmtNum(bp.optional);
    }
    return v;
  }

  /* ---------- 고객정보 수정 ---------- */

  var WATCH = [
    ['netMonthly', '월 실수령'], ['living', '월 생활비'], ['assets', '자산'], ['debt', '부채'], ['goal', '목표'], ['targetMonth', '목표 시점'], ['baseDate', '기준일']
  ];

  /**
   * 고객정보를 고친다. 설계 전 계획(사실 기반)은 새 입력으로 다시 맞추고,
   * 설계안(설계 후·수정안)의 수동 조정값은 그대로 두되 다시 검토할 부분을 알린다.
   * @returns {{ok, errors, state, changed:[이름], notices:[문장]}}
   */
  function applyEdit(state, values, who) {
    var v = validate(values);
    if (!v.ok) return { ok: false, errors: v.errors, state: null, changed: [], notices: [] };
    var d = v.data;
    var s = JSON.parse(JSON.stringify(state));
    var old = s.customer || {};
    var oldVals = fromState(state);
    var newC = buildCustomer(d, old);
    if (old.isExample) newC.isExample = true;

    var oldBefore = (s.plans || []).filter(function (p) { return p.kind === '설계 전'; }).slice(-1)[0] || null;
    var oldLiving = oldBefore ? oldBefore.essential + oldBefore.optional : null;
    var lt = livingTotals(d);

    var changedKeys = FIELDS.filter(function (f) {
      var a = str(values, f.key);
      var b = str(oldVals, f.key);
      if (f.type === 'money' || f.type === 'number') return (a === '' ? null : Number(a)) !== (b === '' ? null : Number(b));
      return a !== b;
    }).map(function (f) { return f.key; });
    LIVING.forEach(function (l) { if ((str(values, 'ess_' + l[0]) === 'on') !== (str(oldVals, 'ess_' + l[0]) === 'on')) changedKeys.push('ess_' + l[0]); });
    var changed = changedKeys.map(function (k) { return BY_KEY[k] ? BY_KEY[k].label : (k.indexOf('ess_') === 0 ? LIVING.filter(function (l) { return 'ess_' + l[0] === k; })[0][1] + ' 필수 여부' : k); });
    if (!changedKeys.length) return { ok: true, errors: {}, state: state, changed: [], notices: [] };

    s.customer = newC;
    // 설계 전 계획: 사실 기반이므로 새 입력으로 맞춘다(같은 id 유지).
    if (oldBefore) {
      var idx = s.plans.indexOf(s.plans.filter(function (p) { return p.id === oldBefore.id; })[0]);
      s.plans[idx] = beforePlan(d, oldBefore);
    } else {
      s.plans.unshift(beforePlan(d, null));
    }
    if (d.baseDate && s.intake) s.intake.savedAt = d.baseDate;
    if (s.demoToday && changedKeys.indexOf('baseDate') >= 0) s.demoToday = d.baseDate;

    var has = function (re) { return changedKeys.some(function (k) { return re.test(k); }); };
    var notices = [];
    var design = (s.plans || []).filter(function (p) { return p.kind !== '설계 전'; });
    if (has(/^(lv_|ess_)/) && oldLiving !== null && Math.abs(oldLiving - (lt.essential + lt.optional)) > 1e-9) {
      notices.push('설계 전 진단의 월 생활비를 ' + round1(oldLiving) + '만원에서 ' + round1(lt.essential + lt.optional) + '만원으로 바꿨습니다.');
    } else if (has(/^(lv_|ess_)/)) {
      notices.push('생활비 항목 구성(필수·선택)을 바꿨습니다. 설계 전 진단에 반영했습니다.');
    }
    design.forEach(function (p) {
      var why = [];
      if (has(/^(lv_|ess_)/)) why.push('생활비(필수 ' + round1(p.essential) + '·선택 ' + round1(p.optional) + '만원)');
      if (has(/^netMonthly$/)) why.push('월 배분(실수령이 바뀜)');
      if (has(/^(cash|savings|investment|emergency|housing)$/) && p.initial && (p.initial.repayFromCash || p.initial.emergencyFromCash || p.initial.liquidate)) {
        why.push('초기 자산 재배치' + (p.initial.repayFromCash ? '(대출 ' + p.initial.repayFromCash + '만원 상환 등)' : ''));
      }
      if (has(/^debt/) && (p.debtOverrides || (p.initial && p.initial.repayFromCash))) why.push('대출 상환 계획');
      if (has(/^targetMonth$/) && p.targetMonth !== d.targetMonth) why.push('목표 시점(설계안은 ' + p.targetMonth + ' 그대로)');
      if (has(/^baseDate$/) && p.startMonth !== d.baseDate.slice(0, 7)) why.push('시작월(설계안은 ' + p.startMonth + ' 그대로)');
      if (has(/^(depositTarget|movingCost|emergencyTarget)$/) && p.goal) why.push('설계안에 따로 정한 목표');
      if (why.length) notices.push('설계안 「' + (p.name || p.id) + '」의 ' + why.join(', ') + '은(는) 고치지 않았습니다. 바뀐 고객정보에 맞는지 다시 검토하세요.');
      // 재배치 금액이 새 자산보다 크면 알린다
      if (p.initial && (p.initial.repayFromCash || p.initial.emergencyFromCash)) {
        var avail = newC.cash + ((p.initial.liquidate || []).indexOf('savings') >= 0 ? newC.savings : 0) + ((p.initial.liquidate || []).indexOf('investment') >= 0 ? newC.investment : 0);
        var need = nz(p.initial.repayFromCash) + nz(p.initial.emergencyFromCash);
        if (need > avail + 1e-9) notices.push('설계안 「' + (p.name || p.id) + '」은 초기 재배치에 ' + need + '만원이 필요하지만 입력한 현금화 가능 자산은 ' + round1(avail) + '만원입니다.');
      }
    });
    if (has(/^(depositTarget|movingCost|emergencyTarget|netMonthly|cash|savings|investment|pension|debt|depositCurrent|depositReturnMonth)/)) {
      notices.push('모든 계획의 결과(목표 판정·그래프)는 새 고객정보로 다시 계산했습니다.');
    }

    s.changeLog = s.changeLog || [];
    s.changeLog.push({ at: d.baseDate, who: who || '고객', what: '고객정보 수정: ' + changed.join(', '), version: s.activePlanId });
    s.review = (s.review || []).concat([{ at: d.baseDate, dismissed: false, changed: changed, items: notices }]);
    return { ok: true, errors: {}, state: s, changed: changed, notices: notices };
  }

  /** 예전 저장본에 입력 완료 표시가 없으면 붙인다(자동 삭제 없이 이전). */
  function migrateIntake(state) {
    if (!state || state.intake) return state;
    var s = JSON.parse(JSON.stringify(state));
    s.intake = { done: true, source: s.demoVersion ? 'example' : 'migrated', savedAt: s.demoToday || null };
    if (s.demoVersion && s.customer && /가상/.test(s.customer.name || '')) s.customer.isExample = true;
    return s;
  }

  var api = {
    SECTIONS: SECTIONS,
    FIELDS: FIELDS,
    LIVING: LIVING,
    BY_KEY: BY_KEY,
    METHODS: METHODS,
    exampleValues: exampleValues,
    emptyValues: emptyValues,
    hasContent: hasContent,
    validate: validate,
    buildCustomer: buildCustomer,
    buildState: buildState,
    fromState: fromState,
    applyEdit: applyEdit,
    diffFromExample: diffFromExample,
    migrateIntake: migrateIntake,
    livingTotals: livingTotals
  };

  if (isNode) {
    module.exports = api;
  } else {
    root.Planner = root.Planner || {};
    root.Planner.intake = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
