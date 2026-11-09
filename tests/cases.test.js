// 명세 7절 A·B 정답 테스트 + R(보고서 가상 고객) 정답 테스트. 기대값은 tests/cases.js에 있다.
const test = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../src/engine.js');
const demo = require('../data/demo.js');
const scenarios = require('../src/scenarios.js');
const dates = require('../src/dates.js');
const { CASES, runCase } = require('./cases.js');

for (const c of CASES) {
  test(`${c.id} ${c.title}`, () => {
    const r = runCase(c, { engine, demo, scenarios, dates });
    const failed = r.checks.filter((x) => !x.pass);
    assert.deepEqual(
      failed.map((x) => `${x.label}: 기대 ${x.expected}, 실제 ${x.actual}`),
      [],
      `${c.id} 실패`
    );
  });
}
