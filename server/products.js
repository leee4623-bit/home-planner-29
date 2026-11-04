/*
 * 실제 금융상품 자료 — 금융감독원 「금융상품 한눈에」 오픈API
 * ------------------------------------------------------------
 * - 환경변수 FSS_API_KEY(인증키)가 있을 때만 조회합니다. 키는 서버에만 두고 화면·공개 코드에 넣지 않습니다.
 * - FSS_BASE_URL: 기본 https://finlife.fss.or.kr/finlifeapi (시험용으로만 바꿈)
 * - 하루 1번 자동 갱신 + 설계사 '상품 자료 갱신'(10분에 1번). 고객 재무정보 동기화(changes·SSE)와 분리된 기능입니다.
 * - 조회 실패 시 이전 자료를 지우지 않고 실패 사실과 마지막 성공 시각을 함께 보여 줍니다(가짜 상품으로 채우지 않음).
 */
'use strict';
const Products = require('../public/js/engine/products.js');

const ENDPOINTS = [
  { key: 'deposit', path: 'depositProductsSearch', groups: ['020000', '030300'] },
  { key: 'saving', path: 'savingProductsSearch', groups: ['020000', '030300'] },
  { key: 'loan', path: 'rentHouseLoanProductsSearch', groups: ['020000'] }
];
const now = () => new Date().toISOString();
let lastManual = 0;

async function fetchJson(url) {
  const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(tm); }
}

async function refresh(db, opts) {
  opts = opts || {};
  const key = opts.key || process.env.FSS_API_KEY;
  const baseUrl = (opts.baseUrl || process.env.FSS_BASE_URL || 'https://finlife.fss.or.kr/finlifeapi').replace(/\/$/, '');
  const out = {};
  for (const ep of ENDPOINTS) {
    const src = 'fss:' + ep.key;
    if (!key) { await meta(db, src, false, 'FSS_API_KEY가 설정되지 않아 조회하지 않았습니다.', null); out[ep.key] = { ok: false, error: 'noKey' }; continue; }
    try {
      const items = [];
      for (const grp of ep.groups) {
        for (let page = 1; page <= 20; page++) {
          const url = baseUrl + '/' + ep.path + '.json?auth=' + encodeURIComponent(key) + '&topFinGrpNo=' + grp + '&pageNo=' + page;
          const js = await fetchJson(url);
          const res = js && js.result;
          if (!res) throw new Error('응답 형식이 예상과 다릅니다(result 없음).');
          if (res.err_cd && res.err_cd !== '000') throw new Error('공시 API 오류 ' + res.err_cd + ': ' + (res.err_msg || ''));
          const opts2 = res.optionList || [];
          (res.baseList || []).forEach((b) => items.push({ b, o: opts2.filter((x) => x.fin_co_no === b.fin_co_no && x.fin_prdt_cd === b.fin_prdt_cd), grp }));
          if (!res.max_page_no || page >= Number(res.max_page_no)) break;
        }
      }
      const at = now();
      await db.tx(async (t) => {
        await t.run('DELETE FROM products WHERE source = ? AND category = ?', 'fss', ep.key);
        for (const it of items) {
          const ukey = ep.key + ':' + it.grp + ':' + it.b.fin_co_no + ':' + it.b.fin_prdt_cd;
          await t.run('INSERT OR IGNORE INTO products (source, category, ukey, company, name, data, fetched_at) VALUES (?,?,?,?,?,?,?)', 'fss', ep.key, ukey, String(it.b.kor_co_nm || ''), String(it.b.fin_prdt_nm || ''), JSON.stringify(it), at);
        }
      });
      await meta(db, src, true, null, items.length, at);
      out[ep.key] = { ok: true, count: items.length };
    } catch (e) {
      await meta(db, src, false, e.name === 'AbortError' ? '응답 시간 초과' : e.message, null);
      out[ep.key] = { ok: false, error: e.message };
    }
  }
  return out;
}
async function meta(db, src, ok, error, count, fetchedAt) {
  const prev = await db.get('SELECT fetched_at, count FROM product_meta WHERE source = ?', src);
  await db.run('INSERT INTO product_meta (source, fetched_at, ok, error, count, attempted_at) VALUES (?,?,?,?,?,?) ON CONFLICT(source) DO UPDATE SET fetched_at = excluded.fetched_at, ok = excluded.ok, error = excluded.error, count = excluded.count, attempted_at = excluded.attempted_at',
    src, ok ? fetchedAt : (prev ? prev.fetched_at : null), ok ? 1 : 0, error, ok ? count : (prev ? prev.count : 0), now());
}

async function list(db) {
  const metas = {};
  (await db.all('SELECT * FROM product_meta')).forEach((m) => { metas[m.source] = { fetchedAt: m.fetched_at, ok: !!Number(m.ok), error: m.error, count: Number(m.count || 0), attemptedAt: m.attempted_at }; });
  const rows = await db.all("SELECT category, data, fetched_at FROM products WHERE source = 'fss' ORDER BY company, name");
  const products = rows.map((r) => { const x = JSON.parse(r.data); return Products.fromFss(r.category, x.b, x.o, x.grp, r.fetched_at); });
  ENDPOINTS.forEach((ep) => { const m = metas['fss:' + ep.key]; if (m) m.stale = Products.stale(m, 7); });
  return { products: products.concat(Products.policyProducts()), meta: metas, keyConfigured: !!process.env.FSS_API_KEY, investment: { connected: false, text: '투자상품은 연결된 공식 공시 자료가 없어 표시하지 않습니다. 수익률·원금손실 위험을 공식 공시로 확인할 수 있을 때만 추가합니다.' } };
}

function extend(add, db, h) {
  const { need, clientOf, pub } = h;
  add('GET', '/api/products', async () => list(db));
  add('POST', '/api/products/refresh', async (q) => {
    need(q.user.role === 'planner', 403, '상품 자료 갱신은 설계사가 합니다.');
    need(Date.now() - lastManual > 10 * 60 * 1000, 429, '상품 자료는 10분에 한 번 갱신할 수 있습니다.');
    lastManual = Date.now();
    return { result: await refresh(db), list: await list(db) };
  });
  // 고객이 '이 상품을 계획에 반영해보기' 결과를 확인하고 설계사에게 검토 요청(가입 처리 아님)
  add('POST', '/api/clients/:id/product-requests', async (q) => {
    const cid = Number(q.p.id); await clientOf(q.user, cid);
    need(q.user.role === 'client', 403, '검토 요청은 고객이 합니다. 설계사는 계획 새 버전으로 저장합니다.');
    need(q.body.confirm === true, 400, '비교 결과를 확인해 주세요.');
    const p = q.body.product || {}, s = q.body.simulation || {};
    need(typeof p.id === 'string' && p.id.length < 120 && typeof p.name === 'string', 400, '상품 정보가 없습니다.');
    const ex = await db.get("SELECT id FROM product_requests WHERE client_id = ? AND product = ? AND status = 'requested'", cid, JSON.stringify({ id: p.id, name: p.name, company: p.company }));
    if (ex) return { id: Number(ex.id), already: true };
    const ins = await db.run('INSERT INTO product_requests (client_id, product, simulation, status, created_by, created_at) VALUES (?,?,?,?,?,?)', cid, JSON.stringify({ id: p.id, name: String(p.name).slice(0, 80), company: String(p.company || '').slice(0, 80) }), JSON.stringify(s).slice(0, 20000), 'requested', q.user.id, now());
    pub(await require('./changes').log(db, { clientId: cid, user: q.user, entity: 'product_request', text: '상품 반영 검토 요청: ' + String(p.company || '') + ' ' + p.name, items: [{ path: 'product', label: '검토 요청 상품', from: '', to: String(p.name).slice(0, 40) }] }));
    return { id: ins.id };
  });
  add('GET', '/api/clients/:id/product-requests', async (q) => {
    const cid = Number(q.p.id); await clientOf(q.user, cid);
    return { requests: (await db.all('SELECT * FROM product_requests WHERE client_id = ? ORDER BY id DESC', cid)).map((r) => ({ id: Number(r.id), product: JSON.parse(r.product), simulation: JSON.parse(r.simulation), status: r.status, createdAt: r.created_at })) };
  });
}

module.exports = { refresh, list, extend, ENDPOINTS };
