/*
 * 저장·버전·기록·제안 적용(명세 1절, 6-3, 7절 C3·C4).
 * - 상태 변경 함수는 모두 "새 상태"를 돌려주고 받은 상태를 바꾸지 않는다.
 * - 계획은 덮어쓰지 않고 버전으로 쌓는다. 기록은 같은 달·같은 항목이면 값을 대체한다.
 * - 저장소 읽기·쓰기는 모두 try/catch. 실패하면 메모리 모드로 계속 동작한다.
 */
(function (root) {
  'use strict';

  var isNode = typeof module !== 'undefined' && module.exports;
  var dates = isNode ? require('./dates.js') : root.Planner.dates;
  var demo = isNode ? require('../data/demo.js') : root.Planner.demo;
  var intake = isNode ? require('./intake.js') : root.Planner.intake;

  var STORAGE_KEY = 'jaemu-planner';
  var BACKUP_KEY = 'jaemu-planner-corrupt-backup';
  var SCHEMA_VERSION = 1;

  var RECORD_ITEMS = {
    debt: '부채 상환',
    emergency: '비상금',
    housing: '주거자금',
    product: '상품 납입',
    pension: '연금 납입',
    income: '실수령 소득',
    essential: '필수 지출',
    optional: '선택 지출'
  };
  var RECORD_STATUS = ['잠정', '확정'];

  function clone(x) {
    return JSON.parse(JSON.stringify(x));
  }

  function todayStr(state) {
    if (state && state.demoToday) return state.demoToday;
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function log(state, who, what, version, extra) {
    state.changeLog = state.changeLog || [];
    var entry = { at: todayStr(state), who: who || '고객', what: what, version: version || state.activePlanId };
    if (extra) entry.detail = extra;
    state.changeLog.push(entry);
  }

  function findPlan(state, id) {
    return (state.plans || []).filter(function (p) { return p.id === id; })[0] || null;
  }

  /* ---------- 마이그레이션 ---------- */

  /** 예전 버전의 저장 데이터를 현재 형식으로 맞춘다. 모르는 버전이면 그대로 두고 빠진 칸만 채운다. */
  function migrate(state) {
    var s = clone(state);
    if (!s.schemaVersion) s.schemaVersion = 1;
    s.records = s.records || [];
    s.proposals = s.proposals || [];
    s.alerts = s.alerts || [];
    s.changeLog = s.changeLog || [];
    s.scheduledPayments = s.scheduledPayments || [];
    s.settings = s.settings || {};
    s.records.forEach(function (r) { if (!r.status) r.status = '확정'; }); // 상태가 없던 기록은 확정으로 본다
    if (!s.activePlanId && s.plans && s.plans.length) s.activePlanId = s.plans[s.plans.length - 1].id;
    return intake.migrateIntake(s); // 예전 저장본: 입력 완료 표시를 붙여 그대로 이어서 쓴다
  }

  /* ---------- 저장소 ---------- */

  function defaultStorage() {
    try {
      return typeof root.localStorage !== 'undefined' ? root.localStorage : null;
    } catch (e) {
      return null; // 접근 자체가 막힌 환경(사생활 보호 모드 등)
    }
  }

  /**
   * 저장소 래퍼. storage를 주지 않으면 브라우저 localStorage를 쓴다.
   * mode: 'storage'(브라우저에 저장됨) | 'memory'(이 탭에서만 유지)
   */
  function createStore(storage) {
    var backend = storage === undefined ? defaultStorage() : storage;
    var memory = null;
    var mode = backend ? 'storage' : 'memory';
    var lastError = null;

    function fail(e) {
      lastError = e && e.message ? e.message : String(e);
      mode = 'memory';
    }

    return {
      get mode() { return mode; },
      get lastError() { return lastError; },

      /**
       * 저장된 상태를 읽는다. { state, source:'saved'|'empty'|'memory', firstVisit, corrupt }
       * 저장값이 없으면 state=null(첫 실행 → 고객정보 입력 화면). 깨진 저장값은 지우지 않고 백업 키에 옮겨 둔다.
       */
      load: function () {
        if (mode === 'storage') {
          try {
            var raw = backend.getItem(STORAGE_KEY);
            if (raw) {
              var parsed = JSON.parse(raw);
              var checked = checkShape(parsed);
              if (!checked.ok) {
                try { if (!backend.getItem(BACKUP_KEY)) backend.setItem(BACKUP_KEY, raw); } catch (e2) { /* 무시 */ }
                return { state: memory ? clone(memory) : null, source: memory ? 'memory' : 'empty', firstVisit: !memory, corrupt: true };
              }
              if (checked.ok) {
                var cur = demo.getDemo().demoVersion;
                // 시연 데이터에서 시작한 저장본인데 시연 데이터가 새로 바뀌었으면 알려 준다(덮어쓰지는 않음)
                var stale = !!parsed.demoVersion && parsed.demoVersion < cur;
                return { state: migrate(parsed), source: 'saved', firstVisit: false, staleDemo: stale };
              }
            }
          } catch (e) {
            if (e instanceof SyntaxError) {
              // 읽기는 됐지만 JSON이 깨짐: 지우지 않고 백업해 둔다
              try { var r0 = backend.getItem(STORAGE_KEY); if (r0 && !backend.getItem(BACKUP_KEY)) backend.setItem(BACKUP_KEY, r0); } catch (e3) { /* 무시 */ }
              if (memory) return { state: clone(memory), source: 'memory', firstVisit: false };
              return { state: null, source: 'empty', firstVisit: true, corrupt: true };
            }
            fail(e);
          }
        }
        if (memory) return { state: clone(memory), source: 'memory', firstVisit: false };
        return { state: null, source: 'empty', firstVisit: true };
      },

      /**
       * { ok, mode, error } — ok는 이 기기 저장소에 실제로 썼을 때만 true.
       * 실패해도 이번 창(메모리)에는 남기지만 성공으로 알리지 않는다.
       */
      save: function (state) {
        memory = clone(state);
        if (mode === 'storage') {
          try {
            backend.setItem(STORAGE_KEY, JSON.stringify(state));
            return { ok: true, mode: mode };
          } catch (e) {
            fail(e);
          }
        }
        return { ok: false, mode: mode, error: lastError || '이 브라우저에는 저장할 수 없습니다.' };
      },

      /** 설계 예시(가상 고객)로 초기화 */
      reset: function () {
        var s = migrate(intake.buildState(intake.exampleValues(), 'example').state);
        this.save(s);
        return s;
      },

      /** 저장소를 지운다(초기화 확인 후) */
      clear: function () {
        memory = null;
        if (mode === 'storage') {
          try { backend.removeItem(STORAGE_KEY); } catch (e) { fail(e); }
        }
      }
    };
  }

  /* ---------- 내보내기·불러오기 ---------- */

  function exportJSON(state) {
    return JSON.stringify({ app: '재무플래너', schemaVersion: SCHEMA_VERSION, exportedAt: todayStr(state), state: state }, null, 2);
  }

  function checkShape(s) {
    var errors = [];
    if (!s || typeof s !== 'object') errors.push('파일 내용이 비어 있거나 형식이 다릅니다.');
    else {
      if (!s.customer || typeof s.customer !== 'object') errors.push('고객 정보가 없습니다.');
      if (!Array.isArray(s.plans) || !s.plans.length) errors.push('계획이 하나도 없습니다.');
      else s.plans.forEach(function (p, i) {
        if (!p || !p.id) errors.push((i + 1) + '번째 계획에 이름표(버전)가 없습니다.');
        else if (!dates.isValidYM(p.startMonth) || !dates.isValidYM(p.targetMonth)) errors.push('계획 「' + (p.name || p.id) + '」의 시작월·이사월 형식이 틀렸습니다.');
      });
      if (s.records && !Array.isArray(s.records)) errors.push('실행 기록 형식이 틀렸습니다.');
    }
    return { ok: errors.length === 0, errors: errors };
  }

  /** 내보낸 파일(또는 상태 JSON 자체)을 읽는다. { ok, state, errors } */
  function importJSON(text) {
    var data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      return { ok: false, state: null, errors: ['JSON 파일을 읽을 수 없습니다. 이 앱에서 내보낸 파일인지 확인해 주세요.'] };
    }
    var s = data && data.state ? data.state : data;
    var checked = checkShape(s);
    if (!checked.ok) return { ok: false, state: null, errors: checked.errors };
    return { ok: true, state: migrate(s), errors: [] };
  }

  /* ---------- 실행 기록 ---------- */

  function getRecord(state, month) {
    return (state.records || []).filter(function (r) { return r.month === month; })[0] || null;
  }

  /**
   * 같은 달·같은 항목은 값을 대체한다(두 번 더하지 않음, C3).
   * value가 '' / null / undefined면 그 항목을 지워 '기록 없음'으로, 0이면 '0원 실행'으로 저장.
   */
  function upsertRecord(state, month, item, value, opts) {
    opts = opts || {};
    if (!dates.isValidYM(month)) throw new Error('기록할 달을 연-월 형식으로 골라 주세요.');
    if (!RECORD_ITEMS[item]) throw new Error('알 수 없는 기록 항목입니다.');
    var s = clone(state);
    s.records = s.records || [];
    var rec = getRecord(s, month);
    var blank = value === '' || value === null || value === undefined;
    var n = Number(value);
    if (!blank && (!Number.isFinite(n) || n < 0)) throw new Error('금액은 0 이상의 숫자로 입력해 주세요.');
    if (!rec) {
      if (blank) return s;
      rec = { month: month, status: opts.status || '잠정' };
      s.records.push(rec);
      s.records.sort(function (a, b) { return a.month < b.month ? -1 : a.month > b.month ? 1 : 0; });
    }
    var before = rec[item];
    if (blank) delete rec[item];
    else rec[item] = n;
    if (opts.status) rec.status = opts.status;
    // 항목이 하나도 남지 않으면 그 달 기록을 지운다
    var hasItem = Object.keys(RECORD_ITEMS).some(function (k) { return rec[k] !== undefined; });
    if (!hasItem) s.records = s.records.filter(function (r) { return r !== rec; });
    log(s, opts.who || '고객', month + ' ' + RECORD_ITEMS[item] + ' 기록 ' + (blank ? '삭제' : before === undefined ? '입력' : '수정'), s.activePlanId,
      { item: item, before: before === undefined ? null : before, after: blank ? null : n });
    return s;
  }

  function setRecordStatus(state, month, status, who) {
    if (RECORD_STATUS.indexOf(status) < 0) throw new Error('기록 상태는 잠정 또는 확정만 고를 수 있습니다.');
    var s = clone(state);
    var rec = getRecord(s, month);
    if (!rec) return s;
    rec.status = status;
    log(s, who || '고객', month + ' 기록을 ' + status + '으로 표시');
    return s;
  }

  /* ---------- 계획 버전 ---------- */

  function nextPlanId(state, baseId) {
    var prefix = String(baseId).replace(/-v\d+$/, '');
    var max = 0;
    (state.plans || []).forEach(function (p) {
      var m = new RegExp('^' + prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '-v(\\d+)$').exec(p.id);
      if (m) max = Math.max(max, Number(m[1]));
    });
    return prefix + '-v' + (max + 1);
  }

  /**
   * 기존 계획을 바탕으로 새 버전을 만든다(이전 버전은 그대로 남음, C4).
   * changes: 계획 필드 덮어쓰기(essential, optional, extraRepayment, targetMonth, products, budgetAdjustments...)
   * goalChanges: 이 버전에만 적용할 목표 변경(depositTarget 등)
   * meta: { name, kind, memo, author, activate }
   */
  function createPlanVersion(state, fromPlanId, changes, goalChanges, meta) {
    meta = meta || {};
    var base = findPlan(state, fromPlanId);
    if (!base) throw new Error('바탕이 될 계획을 찾을 수 없습니다.');
    var s = clone(state);
    var id = nextPlanId(s, fromPlanId);
    var plan = clone(base);
    Object.keys(changes || {}).forEach(function (k) { plan[k] = clone(changes[k]); });
    if (goalChanges && Object.keys(goalChanges).length) plan.goal = Object.assign({}, base.goal, clone(goalChanges));
    plan.id = id;
    plan.parentId = base.id;
    plan.date = todayStr(s);
    plan.kind = meta.kind || base.kind;
    plan.name = meta.name || (base.name || '계획') + ' (수정)';
    plan.memo = meta.memo !== undefined ? meta.memo : base.memo;
    plan.author = meta.author || '설계사';
    delete plan.selectedBy;
    delete plan.selectedAt;
    s.plans.push(plan);
    log(s, plan.author, '새 계획 버전 작성: ' + plan.name, id);
    if (meta.activate) s = setActivePlan(s, id, meta.who || '고객');
    return { state: s, planId: id };
  }

  /** 실행 기준 계획을 바꾼다. 고객이 선택해야 실행 기준이 된다(명세 0절 7). */
  function setActivePlan(state, planId, who) {
    var s = clone(state);
    var p = findPlan(s, planId);
    if (!p) throw new Error('계획을 찾을 수 없습니다.');
    s.activePlanId = planId;
    p.selectedBy = who || '고객';
    p.selectedAt = todayStr(s);
    log(s, who || '고객', '실행 기준 계획을 「' + (p.name || planId) + '」으로 선택', planId);
    return s;
  }

  /* ---------- 제안·수정안 ---------- */

  function findProposal(state, id) {
    return (state.proposals || []).filter(function (p) { return p.id === id; })[0] || null;
  }

  function addProposal(state, proposal) {
    var s = clone(state);
    s.proposals = s.proposals || [];
    if (findProposal(s, proposal.id)) return s; // 같은 제안은 한 번만
    s.proposals.push(clone(proposal));
    log(s, proposal.author || '설계사', (proposal.type || '제안') + ' 작성: ' + (proposal.title || proposal.id));
    return s;
  }

  function presentProposal(state, id, who) {
    var s = clone(state);
    var p = findProposal(s, id);
    if (!p) throw new Error('제안을 찾을 수 없습니다.');
    p.status = '고객에게 제시됨';
    p.presentedAt = todayStr(s);
    log(s, who || '설계사', '고객에게 제시: ' + (p.title || id));
    if (p.type === '설계안') supersede(s, p.id);
    return s;
  }

  /**
   * 제안을 지금 실행 기준 계획에 맞춘다.
   * 제안을 만든 뒤 실행 기준이 바뀌었으면(예: A안을 먼저 적용) 제안이 '바탕 계획에 더한 것'만
   * 지금 실행 기준 위에 다시 얹는다. 기간 예산 조정은 이어 붙이고, 나머지 항목은 덮어쓴다.
   * @returns {{basePlanId, planChanges, goalChanges, rebased}}
   */
  function effectiveChanges(state, proposal, option) {
    var src = option || proposal;
    var active = state.activePlanId;
    var planChanges = clone(src.planChanges || {});
    var goalChanges = clone(src.goalChanges || {});
    if (!proposal.basePlanId || proposal.basePlanId === active) {
      return { basePlanId: active, planChanges: planChanges, goalChanges: goalChanges, rebased: false };
    }
    var base = findPlan(state, proposal.basePlanId);
    var act = findPlan(state, active);
    if (planChanges.budgetAdjustments) {
      var existing = JSON.stringify((base && base.budgetAdjustments) || []);
      var added = planChanges.budgetAdjustments.filter(function (a) { return existing.indexOf(JSON.stringify(a)) < 0; });
      planChanges.budgetAdjustments = ((act && act.budgetAdjustments) || []).concat(added);
    }
    if (act && act.goal) goalChanges = Object.assign({}, act.goal, goalChanges);
    return { basePlanId: active, planChanges: planChanges, goalChanges: goalChanges, rebased: true };
  }

  /**
   * 고객이 제안(또는 A/B/C 중 하나)을 적용한다 → 새 버전 생성 + 실행 기준 변경.
   * 이전 버전과 실행 기록은 그대로 남는다(C4).
   * opts: { optionKey, who }
   */
  function applyProposal(state, id, opts) {
    opts = opts || {};
    var p = findProposal(state, id);
    if (!p) throw new Error('제안을 찾을 수 없습니다.');
    if (p.status === '적용됨') throw new Error('이미 적용한 제안입니다.');
    var option = p;
    if (p.options && p.options.length) {
      option = p.options.filter(function (o) { return o.key === opts.optionKey; })[0];
      if (!option) throw new Error('적용할 안(A/B/C)을 골라 주세요.');
    }
    var who = opts.who || '고객';
    var name = p.options ? (option.key + '안 ' + option.name) : (p.kind || p.title || '수정안');
    var eff = effectiveChanges(state, p, p.options ? option : null);
    var r = createPlanVersion(state, eff.basePlanId, eff.planChanges, eff.goalChanges, {
      name: name,
      memo: option.summary || p.summary || '',
      author: p.author || '설계사',
      activate: true,
      who: who
    });
    var s = r.state;
    var sp = findProposal(s, id);
    sp.status = '적용됨';
    sp.appliedAt = todayStr(s);
    sp.appliedPlanId = r.planId;
    sp.appliedBy = who;
    if (eff.rebased) sp.rebasedFrom = p.basePlanId;
    if (p.options) {
      sp.chosenKey = option.key;
      supersede(s, p.id);
    }
    log(s, who, (p.type || '제안') + ' 적용: ' + name, r.planId);
    return { state: s, planId: r.planId };
  }

  /** 새 A/B/C 제안이 제시되거나 선택되면, 아직 고르지 않은 이전 A/B/C 제안은 '대체됨'으로 바꾼다(고객 화면에 하나만 남게). */
  function supersede(s, keepId) {
    (s.proposals || []).forEach(function (x) {
      if (x.id !== keepId && x.type === '설계안' && x.status === '고객에게 제시됨') {
        x.status = '대체됨';
        x.supersededBy = keepId;
      }
    });
  }

  function holdProposal(state, id, who) {
    var s = clone(state);
    var p = findProposal(s, id);
    if (!p) throw new Error('제안을 찾을 수 없습니다.');
    p.status = '보류';
    p.heldAt = todayStr(s);
    log(s, who || '고객', '보류: ' + (p.title || id));
    return s;
  }

  /* ---------- 설정 ---------- */

  /** label: 변경 이력에 남길 사람이 읽는 이름(예: '경보 기준') */
  function updateSettings(state, patch, who, label) {
    var s = clone(state);
    s.settings = Object.assign({}, s.settings, clone(patch));
    log(s, who || '설계사', (label || '설정') + ' 변경', s.activePlanId, clone(patch));
    return s;
  }

  /** 자동 적용 동의(고객만). consent: { enabled, monthlyLimit, essentialFloorRatio } */
  function setAutoApplyConsent(state, consent, who) {
    var s = clone(state);
    s.autoApplyConsent = Object.assign({ enabled: false, monthlyLimit: 10, essentialFloorRatio: 0.9 }, s.autoApplyConsent, clone(consent));
    s.autoApplyConsent.agreedAt = s.autoApplyConsent.enabled ? todayStr(s) : null;
    log(s, who || '고객', '자동 적용 동의 ' + (s.autoApplyConsent.enabled ? '켬' : '끔'));
    return s;
  }

  /* ---------- 고객 정보·예정 결제·위험성향 ---------- */

  /**
   * 고객 정보 변경(고객만 입력, 설계사는 조회). 바뀐 항목마다 이력을 남긴다.
   * @param {object} patch 바꿀 필드(중첩 객체는 통째로 교체)
   * @param {object} labels 필드 → 사람이 읽는 이름
   */
  function updateCustomer(state, patch, who, labels) {
    var s = clone(state);
    labels = labels || {};
    var changed = [];
    Object.keys(patch || {}).forEach(function (k) {
      var before = JSON.stringify(s.customer[k]);
      var after = JSON.stringify(patch[k]);
      if (before === after) return;
      s.customer[k] = clone(patch[k]);
      changed.push(k);
      log(s, who || '고객', '내 정보 변경: ' + (labels[k] || '기타 항목'), s.activePlanId,
        { field: k, before: before === undefined ? null : JSON.parse(before), after: clone(patch[k]) });
    });
    return { state: s, changed: changed };
  }

  function addScheduledPayment(state, p, who) {
    var name = String(p.name || '').trim();
    var amount = Number(p.amount);
    if (!name) throw new Error('결제 이름을 입력해 주세요.');
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('금액은 0보다 큰 숫자로 입력해 주세요.');
    if (p.spendMonth && !dates.isValidYM(p.spendMonth)) throw new Error('지출 달을 연-월 형식으로 골라 주세요.');
    var s = clone(state);
    s.scheduledPayments = s.scheduledPayments || [];
    s.scheduledPayments.push({ name: name, amount: amount, kind: p.kind === '필수' ? '필수' : '선택', spendMonth: p.spendMonth || null, note: '예측용 — 확인 전에는 기록에 더하지 않음' });
    log(s, who || '고객', '예정 결제 등록: ' + name);
    return s;
  }

  function removeScheduledPayment(state, index, who) {
    var s = clone(state);
    var removed = (s.scheduledPayments || []).splice(index, 1)[0];
    if (removed) log(s, who || '고객', '예정 결제 삭제: ' + removed.name);
    return s;
  }

  /** 앱 위험성향 설문 결과 저장(금융기관 결과와 따로) */
  function saveRiskSurvey(state, result, answers, who) {
    var s = clone(state);
    s.customer.risk = s.customer.risk || {};
    s.customer.risk.appSurvey = {
      type: result.type,
      score: result.score,
      date: todayStr(s),
      answers: clone(answers),
      purpose: '주거자금 마련(이사 보증금)',
      netAtThatTime: s.customer.netMonthly
    };
    log(s, who || '고객', '위험성향 설문 완료: ' + result.type);
    return s;
  }

  var api = {
    STORAGE_KEY: STORAGE_KEY,
    BACKUP_KEY: BACKUP_KEY,
    updateCustomer: updateCustomer,
    addScheduledPayment: addScheduledPayment,
    removeScheduledPayment: removeScheduledPayment,
    saveRiskSurvey: saveRiskSurvey,
    SCHEMA_VERSION: SCHEMA_VERSION,
    RECORD_ITEMS: RECORD_ITEMS,
    RECORD_STATUS: RECORD_STATUS,
    createStore: createStore,
    migrate: migrate,
    exportJSON: exportJSON,
    importJSON: importJSON,
    getRecord: getRecord,
    upsertRecord: upsertRecord,
    setRecordStatus: setRecordStatus,
    createPlanVersion: createPlanVersion,
    setActivePlan: setActivePlan,
    findPlan: findPlan,
    findProposal: findProposal,
    addProposal: addProposal,
    presentProposal: presentProposal,
    applyProposal: applyProposal,
    effectiveChanges: effectiveChanges,
    holdProposal: holdProposal,
    updateSettings: updateSettings,
    setAutoApplyConsent: setAutoApplyConsent,
    todayStr: todayStr
  };

  if (isNode) {
    module.exports = api;
  } else {
    root.Planner = root.Planner || {};
    root.Planner.store = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
