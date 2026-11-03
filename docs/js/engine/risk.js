/*
 * 위험성향 채점 (앱 자체 참고용 기준) — 결정적 계산: 같은 답변·같은 설정 버전이면 항상 같은 결과
 * 대화(자유 질문)는 점수에 쓰지 않습니다. 선택지 답변만 사용합니다.
 */
(function (root) {
  'use strict';
  var CFG = root.FP && root.FP.RiskConfig ? root.FP.RiskConfig : require('../data/riskConfig.js');

  function optOf(q, id) { for (var i = 0; i < q.options.length; i++) if (q.options[i].id === id) return q.options[i]; return null; }
  function typeOf(score) { for (var i = 0; i < CFG.TYPES.length; i++) if (score <= CFG.TYPES[i].max) return CFG.TYPES[i]; return CFG.TYPES[CFG.TYPES.length - 1]; }
  function typeById(id) { return CFG.TYPES.filter(function (t) { return t.id === id; })[0]; }

  /*
   * score(answers) → 결과
   * answers: { q1:'a', ... } (선택지 id). 없는 문항은 ‘미응답’
   */
  function score(answers, cfg) {
    cfg = cfg || CFG; answers = answers || {};
    var missing = [], invalid = [], tags = {}, known = {}, sums = {}, counts = {}, key = [];
    Object.keys(cfg.WEIGHTS).forEach(function (d) { known[d] = 0; sums[d] = 0; counts[d] = 0; });
    cfg.QUESTIONS.forEach(function (q) {
      var a = answers[q.id];
      if (a === undefined || a === null || a === '') { missing.push(q.id); return; }
      var o = optOf(q, a); if (!o) { invalid.push(q.id); return; }
      if (o.tag) tags[o.tag] = true;
      if (o.score === null) return; // 잘 모르겠음 → 근거에서 제외
      sums[q.dim] += o.score; counts[q.dim]++;
      if (!o.knownZero) known[q.dim]++; else known[q.dim]++;
    });
    var dims = {}, insufficient = [];
    Object.keys(cfg.WEIGHTS).forEach(function (d) {
      dims[d] = counts[d] ? Math.round(sums[d] / counts[d] / 4 * 1000) / 10 : null;
      if (known[d] < cfg.MIN_KNOWN[d]) insufficient.push(d);
    });
    var complete = !missing.length && !invalid.length && !insufficient.length;
    var out = { version: cfg.VERSION, label: cfg.LABEL, complete: complete, missing: missing, invalid: invalid, insufficient: insufficient, dims: dims, tags: tags };
    if (!complete) { out.status = 'incomplete'; return out; }

    var total = 0; Object.keys(cfg.WEIGHTS).forEach(function (d) { total += dims[d] * cfg.WEIGHTS[d] / 100; });
    total = Math.round(total * 10) / 10;
    var raw = typeOf(total), maxOverall = 5, applied = [], core = 5;
    cfg.RULES.forEach(function (r) {
      if (!r.when(out, answers)) return;
      if (r.scope === 'overall') { if (r.maxType < maxOverall) maxOverall = r.maxType; if (r.maxType < raw.id) applied.push({ id: r.id, reason: r.reason, maxType: typeById(r.maxType).name }); }
      else if (r.scope === 'housingCore') { core = Math.min(core, r.maxType); }
    });
    var final = typeById(Math.min(raw.id, maxOverall));
    var flags = [];
    if (dims.will !== null && dims.cap !== null && dims.will - dims.cap >= cfg.CONFLICT_GAP) flags.push({ id: 'willVsCap', reason: '손실 감수 의향(' + dims.will + '점)이 실제 재무 여력(' + dims.cap + '점)보다 ' + Math.round(dims.will - dims.cap) + '점 높습니다. 의향만으로 위험을 늘리지 않도록 추가 확인이 필요합니다.' });
    cfg.CONTRADICTIONS.forEach(function (c) { if (c.when(answers)) flags.push({ id: c.id, reason: c.reason }); });
    // 판단에 영향을 준 주요 답변: 제한 규칙을 건 답 + 각 차원의 극단값
    cfg.QUESTIONS.forEach(function (q) {
      var o = optOf(q, answers[q.id]);
      if (o && (o.tag || o.score === 0 || o.score === 4 || o.unknown)) key.push({ q: q.id, topic: q.topic, answer: o.text, dim: q.dim });
    });
    out.status = flags.length ? 'needsReview' : 'ok';
    out.total = total; out.rawType = raw.name; out.rawTypeId = raw.id; out.type = final.name; out.typeId = final.id; out.typeDesc = final.desc;
    out.restrictions = applied; out.housingCoreMax = typeById(core).name; out.flags = flags; out.keyAnswers = key;
    out.gap = dims.will !== null && dims.cap !== null ? Math.round((dims.will - dims.cap) * 10) / 10 : null;
    return out;
  }

  // 설문 답변과 재무 자료가 다른지 확인(덮어쓰지 않고 표시만)
  function crossCheck(answers, ind) {
    var out = [];
    var q6 = optOf(CFG.QUESTIONS[5], answers.q6);
    if (q6 && q6.months !== undefined && ind && ind.emergencyMonths !== null && ind.emergencyMonths !== undefined) {
      var m = ind.emergencyMonths, band = m < 1 ? 0 : m < 3 ? 1 : m < 6 ? 3 : 6;
      if (band !== q6.months) out.push('비상금 문항은 ‘' + q6.text + '’이지만, 계획 자료의 비상금은 필수생활비 ' + (Math.round(m * 10) / 10) + '개월 치입니다.');
    }
    return out;
  }

  // 기존 결과 대비 재진단이 필요한지 (나이·소득만으로 성향을 추정하지 않음 — 변화 여부만 봄)
  function resurveyReasons(latest, current, today) {
    if (!latest) return ['저장된 위험성향 결과가 없습니다.'];
    var r = [], s = latest.snapshot || {};
    var R = CFG.RESURVEY;
    if (s.netMonthly && current.netMonthly && Math.abs(current.netMonthly - s.netMonthly) / s.netMonthly * 100 >= R.incomeChangePct) r.push('월 실수령이 진단 당시 ' + Math.round(s.netMonthly / 10000) + '만원 → 현재 ' + Math.round(current.netMonthly / 10000) + '만원으로 달라졌습니다.');
    if (s.totalDebt !== undefined && current.totalDebt !== undefined && Math.abs(current.totalDebt - s.totalDebt) >= Math.max(1, s.totalDebt) * R.debtChangePct / 100) r.push('부채가 진단 당시 ' + Math.round(s.totalDebt / 10000) + '만원 → 현재 ' + Math.round(current.totalDebt / 10000) + '만원으로 달라졌습니다.');
    if (s.purpose && current.purpose && s.purpose !== current.purpose) r.push('투자 목적이 ‘' + s.purpose + '’에서 ‘' + current.purpose + '’로 바뀌었습니다.');
    if (latest.diagnosedAt) {
      var d = new Date(latest.diagnosedAt), t = today || new Date();
      var months = (t.getFullYear() - d.getFullYear()) * 12 + (t.getMonth() - d.getMonth());
      if (months >= R.maxAgeMonths) r.push('진단한 지 ' + months + '개월이 지났습니다(앱 기준 ' + R.maxAgeMonths + '개월).');
    }
    return r;
  }

  var Risk = { score: score, crossCheck: crossCheck, resurveyReasons: resurveyReasons, typeById: typeById, CFG: CFG };
  if (typeof module !== 'undefined' && module.exports) module.exports = Risk;
  else { root.FP = root.FP || {}; root.FP.Risk = Risk; }
})(this);
