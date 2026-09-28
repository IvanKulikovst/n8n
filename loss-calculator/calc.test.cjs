// Тесты расчётного ядра: node --test loss-calculator/
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('./calc.js');

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

test('округление как на бумаге', () => {
  assert.equal(C.roundTo(0.55, 1), 0.6);
  assert.equal(C.roundTo(1.045, 1), 1.0);
  assert.equal(C.roundTo(0.065, 2), 0.07);
  assert.equal(C.roundTo(0.495, 1), 0.5);
});

test('K(t): значения таблицы, интерполяция и границы', () => {
  const t = C.defaultRefs().kt;
  assert.equal(C.kt(45, 'def', t).k, 1.0);
  assert.equal(C.kt(20, 'off', t).k, 1.18);
  assert.equal(C.kt(42, 'def', t).k, 1.03); // 1,05 + (1,00 − 1,05) × 2/5
  assert.ok(C.kt(42, 'def', t).interp);
  assert.equal(C.kt(5, 'def', t).k, 1.72);
  assert.ok(C.kt(5, 'def', t).outside);
  assert.equal(C.kt(60, 'off', t).k, 0.95);
});

test('пример 2.5: проценты по видам (с исправлением P_СР для БТР)', () => {
  const refs = C.defaultRefs();
  const day = C.calcDay(C.exampleInput(refs), refs);
  const btr = day.groups.btvt.rows[0];
  assert.deepEqual(btr.p, { bp: 0.5, kr: 0.4, sr: 0.6, tr: 1.0 });
  near(btr.pSum, 2.5);
  const at = day.groups.at.rows[0];
  assert.deepEqual(at.p, { bp: 0.5, kr: 0.3, sr: 0.4, tr: 2.0 });
  near(at.pSum, 3.2);
  near(day.groups.btvt.factor, 0.55);
  near(day.groups.at.factor, 0.506);
});

test('пример 2.6: абсолютные единицы в режиме «как в методичке»', () => {
  const refs = C.defaultRefs();
  const day = C.calcDay(C.exampleInput(refs), refs);
  assert.deepEqual(day.groups.btvt.rows[0].n, { bp: 0.07, kr: 0.05, sr: 0.08, tr: 0.13 });
  near(day.groups.btvt.total, 0.33);
  assert.deepEqual(day.groups.at.rows[0].n, { bp: 0.5, kr: 0.3, sr: 0.4, tr: 1.9 });
  near(day.groups.at.total, 3.1);
  near(day.total, 3.43);
});

test('без округления единиц: 13 × 2,5 % + 96 × 3,2 %', () => {
  const refs = C.defaultRefs();
  const inp = C.exampleInput(refs);
  inp.roundN = 'none';
  const day = C.calcDay(inp, refs);
  near(day.total, 0.325 + 3.072, 1e-6);
});

test('K_м: 1,25 для БТВТ и 1,15 для АТ; без УТГ — 1', () => {
  const refs = C.defaultRefs();
  const inp = C.exampleInput(refs);
  let day = C.calcDay(inp, refs);
  assert.equal(day.groups.btvt.km, 1.25);
  assert.equal(day.groups.at.km, 1.15);
  inp.utg = false;
  day = C.calcDay(inp, refs);
  assert.equal(day.groups.btvt.km, 1);
  assert.equal(day.groups.at.km, 1);
});

test('оценка K_c: общая, по видам ремонта и с коэффициентом снижения', () => {
  const refs = C.defaultRefs();
  const inp = C.exampleInput(refs);
  inp.repair.qTotal = 3;
  let day = C.calcDay(inp, refs);
  let r = C.assessRepair(day, inp.repair);
  near(r.overall.kc, 3 / 3.43);
  near(r.overall.deficit, 0.43);
  inp.repair.factors.detach = { on: true, k: 0.8 };
  inp.repair.tr = 2;
  r = C.assessRepair(day, inp.repair);
  near(r.reduction.k, 0.8);
  near(r.overall.kc, 2.4 / 3.43);
  const tr = r.rows.find((x) => x.key === 'tr');
  near(tr.need, 0.13 + 1.9);
  near(tr.kc, 1.6 / 2.03);
  const evac = r.rows.find((x) => x.key === 'evac');
  near(evac.need, 0.07 + 0.05 + 0.5 + 0.3);
});

test('Q общее складывается из Q по видам, если не задано', () => {
  const refs = C.defaultRefs();
  const inp = C.exampleInput(refs);
  Object.assign(inp.repair, { tr: 2, sr: 1, kr: 0.5 });
  const r = C.assessRepair(C.calcDay(inp, refs), inp.repair);
  assert.equal(r.overall.q, 3.5);
  assert.ok(r.overall.qTotalFromKinds);
});

test('расчёт на период: баланс техники сохраняется', () => {
  const refs = C.defaultRefs();
  const inp = C.exampleInput(refs);
  inp.days = 30;
  inp.sim = { base: 'initial', trDays: 1, srDays: 3, krDays: 0 };
  inp.repair.tr = 0.5;
  inp.repair.sr = 0.2;
  const sim = C.simulate(inp, refs);
  assert.equal(sim.series.length, 31);
  const t = sim.totals;
  const krOut = sim.units.reduce((s, u) => s + u.krOut, 0);
  near(t.finalInService.all + t.bp + krOut + t.backlog.tr + t.backlog.sr + t.backlog.kr, 109, 1e-6);
  const day = C.calcDay(inp, refs);
  const bpPerDay = day.groups.btvt.rows[0].count * day.groups.btvt.rows[0].p.bp / 100 + day.groups.at.rows[0].count * day.groups.at.rows[0].p.bp / 100;
  near(t.bp, 30 * bpPerDay, 1e-6);
  assert.ok(t.backlog.tr > 0, 'при ограниченной мощности ТР остаётся очередь');
});

test('расчёт на период: без ограничения мощности ТР возвращается на следующие сутки', () => {
  const refs = C.defaultRefs();
  const inp = C.exampleInput(refs);
  inp.days = 5;
  const sim = C.simulate(inp, refs);
  near(sim.series[1].repaired, 0);
  assert.ok(sim.series[2].repaired > 0);
  // в ремонте остаётся только ТР последних суток
  near(sim.totals.backlog.tr, sim.series[5].fail.tr);
});

test('расчёт на период: потери не превышают наличие', () => {
  const refs = C.defaultRefs();
  const inp = C.exampleInput(refs);
  inp.days = 50;
  inp.echelon = 'e1';
  inp.kzs = 1.35;
  inp.line = 'unprep';
  inp.sim.krDays = 0;
  inp.repair.tr = 0;
  inp.repair.sr = 0;
  const sim = C.simulate(inp, refs);
  sim.series.forEach((s) => assert.ok(s.inService.all >= -1e-9));
});

test('проверка данных: K_зс вне диапазона и ошибка табл. 1 для тягачей', () => {
  const refs = C.defaultRefs();
  const inp = C.exampleInput(refs);
  inp.kzs = 0.6;
  const w = C.validate(inp, refs).map((x) => x.text).join('\n');
  assert.match(w, /K_зс = 0,6 вне диапазона/);
  assert.match(w, /Тягачи танковые/);
  refs.norms.btvt[5].sr = 0.44;
  assert.doesNotMatch(C.validate(inp, refs).map((x) => x.text).join('\n'), /Тягачи/);
});

test('ход решения совпадает с методичкой', () => {
  const refs = C.defaultRefs();
  const inp = C.exampleInput(refs);
  const txt = C.solutionText(C.solution(inp, refs));
  assert.match(txt, /P_БП = 0,9 × 1,0 × 0,4 × 1,1 × 1,25 = 0,495 ≈ 0,5 %/);
  assert.match(txt, /P_СР = 1,0 × 1,0 × 0,4 × 1,1 × 1,25 = 0,55 ≈ 0,6 %/);
  assert.match(txt, /N_ВВСТ = N_БТВТ \+ N_АТ = 0,33 \+ 3,1 = 3,43 ед\. в сутки/);
});

test('CSV: разделитель «;», десятичная запятая, BOM', () => {
  const refs = C.defaultRefs();
  const inp = C.exampleInput(refs);
  const day = C.calcDay(inp, refs);
  const csv = C.toCSV(inp, refs, day, C.assessRepair(day, inp.repair), C.simulate(inp, refs, day));
  assert.ok(csv.startsWith('﻿'));
  assert.match(csv, /БТВТ;БТР;13;1,1;1,25;0,9;0,7;1;1,9;0,5;0,4;0,6;1;0,07;0,05;0,08;0,13;0,33/);
  const header = csv.split('\r\n').find((l) => l.startsWith('Группа'));
  const total = csv.split('\r\n').find((l) => l.includes('N_ВВСТ'));
  assert.equal(header.split(';').length, total.split(';').length);
});
