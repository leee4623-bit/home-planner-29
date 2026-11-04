(function(){var module={exports:{}};
/*
 * 계좌 연동 연결부
 * ------------------------------------------------------------
 * 실제 은행 계좌 연결은 마이데이터·오픈뱅킹 등 허가받은 사업자와의 계약·인증이 필요하므로
 * 이 앱은 은행 아이디·비밀번호·공인인증서 등 인증정보를 받지 않습니다.
 *
 * 제공하는 것
 *  1) CsvProvider: 은행 앱에서 내려받은 거래내역 CSV를 가져오기
 *  2) DemoProvider: 시연용 가짜 거래내역 (명확히 '시연용'으로 표시)
 *  3) Provider 규약: 실제 연동 사업자를 붙일 때 같은 함수(fetchTransactions)를 구현하면 됩니다.
 *     인증은 사업자의 OAuth 동의 화면에서 이루어지고, 이 서버는 사업자가 발급한 토큰만 보관해야 합니다.
 *
 * 분류 원칙
 *  - 이체가 발견되었다는 이유만으로 목표 저축으로 확정하지 않습니다 → 'suggested'(제안)만 붙이고 고객이 확인.
 *  - 보낸 계좌와 받은 계좌가 모두 본인 등록 계좌이면 '본인 계좌 간 이체' 제안 → 소득·자산 증가로 세지 않음.
 */


function maskAccount(s) {
  const d = String(s || '').replace(/[^0-9]/g, '');
  if (d.length < 4) return d ? '****' : '';
  return '****' + d.slice(-4);
}

// CSV: 날짜,금액,적요,보낸계좌,받은계좌  (첫 줄 머리말, 금액은 입금 +/출금 −)
function parseCsv(text) {
  const lines = String(text || '').replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return { rows: [], errors: ['내용이 없습니다.'] };
  const head = splitLine(lines[0]).map((h) => h.trim());
  const idx = (names) => head.findIndex((h) => names.some((n) => h.indexOf(n) >= 0));
  const iDate = idx(['날짜', '거래일', 'date']), iAmt = idx(['금액', 'amount']), iDesc = idx(['적요', '내용', '메모', 'desc']);
  const iFrom = idx(['보낸', '출금계좌', 'from']), iTo = idx(['받은', '입금계좌', 'to']);
  const errors = [];
  if (iDate < 0 || iAmt < 0) return { rows: [], errors: ['첫 줄에 ‘날짜’와 ‘금액’ 열이 있어야 합니다.'] };
  const rows = [];
  lines.slice(1).forEach((l, n) => {
    const c = splitLine(l);
    const date = String(c[iDate] || '').trim().replace(/[./]/g, '-');
    const amount = Number(String(c[iAmt] || '').replace(/[,\s원]/g, ''));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !isFinite(amount)) { errors.push((n + 2) + '번째 줄: 날짜(YYYY-MM-DD) 또는 금액을 읽지 못했습니다.'); return; }
    rows.push({ date, amount, description: iDesc >= 0 ? String(c[iDesc] || '').slice(0, 80) : '', from: iFrom >= 0 ? maskAccount(c[iFrom]) : '', to: iTo >= 0 ? maskAccount(c[iTo]) : '' });
  });
  return { rows, errors };
}
function splitLine(l) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < l.length; i++) {
    const ch = l[i];
    if (ch === '"') { if (q && l[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
    else if (ch === ',' && !q) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur); return out;
}

// 분류 제안 (확정 아님)
function suggest(tx, accounts) {
  const own = new Map(accounts.map((a) => [a.masked, a]));
  const from = own.get(tx.from), to = own.get(tx.to);
  if (from && to) {
    // 본인 계좌 간 이체: 받는 계좌의 목적이 저축 목적이면 그 목적의 '납입 후보'
    if (/^(emergency|housing|product:|debt)/.test(to.purpose)) return { kind: 'ownTransfer', category: to.purpose, reason: '본인 ' + from.label + ' → ' + to.label + ' 이체 (목적 계좌)' };
    return { kind: 'ownTransfer', category: null, reason: '본인 계좌 간 이체 — 소득·자산 증가 아님' };
  }
  if (tx.amount > 0 && /급여|월급|salary/i.test(tx.description)) return { kind: 'income', category: 'income', reason: '적요에 급여 표시' };
  if (tx.amount < 0 && to && to.purpose.indexOf('debt') === 0) return { kind: 'payment', category: 'debt', reason: '대출 상환 계좌로 출금' };
  if (tx.amount < 0 && /대출|상환|loan/i.test(tx.description)) return { kind: 'payment', category: 'debt', reason: '적요에 상환 표시 — 받는 계좌 확인 필요' };
  if (tx.amount < 0) return { kind: 'spend', category: 'expense', reason: '출금 — 생활비로 추정(확인 필요)' };
  return { kind: 'unknown', category: null, reason: '분류 근거 없음' };
}

const DemoProvider = {
  id: 'demo',
  label: '시연용 가짜 거래내역',
  fetchTransactions(accounts, month) {
    const salary = accounts.find((a) => a.purpose === 'salary') || { masked: '****1001' };
    const housing = accounts.find((a) => a.purpose === 'housing') || { masked: '****2002' };
    const emergency = accounts.find((a) => a.purpose === 'emergency') || { masked: '****3003' };
    const d = (day) => month + '-' + String(day).padStart(2, '0');
    return [
      { date: d(10), amount: 2900000, description: '급여(시연)', from: '', to: salary.masked },
      { date: d(11), amount: -500000, description: '대출 자동이체 상환(시연)', from: salary.masked, to: '' },
      { date: d(12), amount: -300000, description: '주거자금 통장으로 이체(시연)', from: salary.masked, to: housing.masked },
      { date: d(12), amount: -100000, description: '비상금 통장으로 이체(시연)', from: salary.masked, to: emergency.masked },
      { date: d(15), amount: -420000, description: '카드 대금(시연)', from: salary.masked, to: '' }
    ];
  }
};

module.exports = { parseCsv, suggest, maskAccount, DemoProvider };

window.FP.Linking=module.exports;})();
