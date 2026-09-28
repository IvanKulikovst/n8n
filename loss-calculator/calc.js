/*
 * Расчётное ядро методики прогнозирования потерь БТВТ и АТ (глава 2).
 * Чистые функции без обращения к DOM: работает в браузере (window.LossCalc)
 * и в Node.js (require('./calc.js')).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LossCalc = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const KINDS = [
    { key: 'bp', short: 'БП', name: 'Безвозвратные потери' },
    { key: 'kr', short: 'КР', name: 'Капитальный ремонт' },
    { key: 'sr', short: 'СР', name: 'Средний ремонт' },
    { key: 'tr', short: 'ТР', name: 'Текущий ремонт' },
  ];
  const KIND_KEYS = KINDS.map((k) => k.key);
  const GROUP_KEYS = ['btvt', 'at'];
  const GROUP_NAMES = { btvt: 'БТВТ', at: 'АТ' };
  const GROUP_TITLES = { btvt: 'Бронетанковая техника (БТВТ)', at: 'Автомобильная техника (АТ)' };
  const ACTIONS = { def: 'Оборонительные', off: 'Наступательные' };
  const ECHELONS = { e1: 'В 1-м эшелоне', other: 'На других направлениях', e2: 'Во 2-м эшелоне' };
  const LINES = { prep: 'Подготовленный рубеж', unprep: 'Неподготовленный рубеж' };
  const ROUND_N_MODES = {
    none: 'не округлять',
    '0.01': 'до 0,01 ед.',
    '0.1': 'до 0,1 ед.',
    method: 'как в методичке (БТВТ — 0,01, АТ — 0,1)',
  };
  // Факторы п. 2.7, снижающие фактические возможности ремонта
  const REDUCTION_FACTORS = [
    { key: 'detach', name: 'Отрыв ремонтных подразделений от выполнения непосредственных задач' },
    { key: 'separate', name: 'Размещение подразделений технического обеспечения отдельно от основных сил' },
    { key: 'guard', name: 'Отсутствие подразделений охраны и обороны сил технического обеспечения' },
    { key: 'other', name: 'Привлечение личного состава к другим работам' },
  ];

  function defaultRefs() {
    return {
      // Таблица 1 — нормы среднесуточных потерь, % (total = «Всего» = БП + КР + СР)
      norms: {
        btvt: [
          { name: 'Танки', total: 5.4, bp: 2.0, kr: 1.2, sr: 2.2, tr: 2.8 },
          { name: 'БМП', total: 4.2, bp: 1.6, kr: 1.0, sr: 1.6, tr: 2.6 },
          { name: 'БТР', total: 2.6, bp: 0.9, kr: 0.7, sr: 1.0, tr: 1.9 },
          { name: 'Разведывательные машины', total: 3.6, bp: 1.3, kr: 1.0, sr: 1.3, tr: 2.4 },
          { name: 'КШМ', total: 3.6, bp: 1.3, kr: 1.0, sr: 1.3, tr: 2.4 },
          { name: 'Тягачи танковые', total: 1.21, bp: 0.44, kr: 0.33, sr: 1.1, tr: 1.5 },
        ],
        at: [
          { name: 'Автомобили общего назначения', total: 2.3, bp: 0.9, kr: 0.6, sr: 0.8, tr: 4.0 },
          { name: 'Автомобили специальные', total: 3.0, bp: 1.2, kr: 0.8, sr: 1.0, tr: 4.5 },
          { name: 'Грузовые автомобили', total: 3.6, bp: 1.3, kr: 1.1, sr: 1.2, tr: 5.0 },
          { name: 'Автомобили под монтаж вооружения', total: 4.1, bp: 1.6, kr: 1.2, sr: 1.3, tr: 6.5 },
        ],
      },
      // Таблица 2 — K(t): [сутки, оборона, наступление]
      kt: [
        [10, 1.72, 1.44], [15, 1.6, 1.32], [20, 1.4, 1.18], [25, 1.26, 1.05], [30, 1.16, 1.0],
        [35, 1.1, 1.0], [40, 1.05, 1.0], [45, 1.0, 1.0], [50, 0.95, 0.95],
      ],
      // Таблица 3 — K_зс: [мин, макс]
      kzs: {
        def: { e1: [1.25, 1.35], other: [0.8, 0.9], e2: [0.3, 0.4] },
        off: { e1: [1.35, 1.45], other: [0.85, 0.95], e2: [0.35, 0.45] },
      },
      // Таблица 4 — K_рб
      krb: [
        { name: 'Бронетанковое вооружение и техника', prep: 1.1, unprep: 1.3 },
        { name: 'Артиллерийское вооружение', prep: 1.0, unprep: 1.5 },
        { name: 'Средства боевого обеспечения', prep: 1.0, unprep: 1.2 },
        { name: 'Средства МТО', prep: 1.0, unprep: 1.2 },
      ],
      // П. 2.3.4 — K_м для УТГ
      km: { btvt: 1.25, at: 1.15 },
      krbDefault: { btvt: 0, at: 3 },
    };
  }

  function newRow(refs, g, typeIdx, count) {
    const n = refs.norms[g][typeIdx] || refs.norms[g][0];
    return { type: typeIdx, count: count || 0, bp: n.bp, kr: n.kr, sr: n.sr, tr: n.tr };
  }

  function defaultInput(refs) {
    refs = refs || defaultRefs();
    return {
      action: 'def',
      days: 45,
      echelon: 'e1',
      kzs: refs.kzs.def.e1[1],
      line: 'prep',
      utg: true,
      roundPct: true,
      roundN: 'none',
      groups: {
        btvt: { krbRow: refs.krbDefault.btvt, rows: [newRow(refs, 'btvt', 0, 0)] },
        at: { krbRow: refs.krbDefault.at, rows: [newRow(refs, 'at', 0, 0)] },
      },
      repair: {
        qTotal: null, tr: null, sr: null, kr: null, evac: null,
        factors: {
          detach: { on: false, k: 0.9 }, separate: { on: false, k: 0.9 },
          guard: { on: false, k: 0.9 }, other: { on: false, k: 0.9 },
        },
      },
      sim: { base: 'initial', trDays: 1, srDays: 3, krDays: 0 },
    };
  }

  // Пример п. 2.5: УТГ, оборона, 45 сут., 2-й эшелон, подготовленный рубеж
  function exampleInput(refs) {
    refs = refs || defaultRefs();
    const inp = defaultInput(refs);
    Object.assign(inp, { action: 'def', days: 45, echelon: 'e2', kzs: 0.4, line: 'prep', utg: true, roundPct: true, roundN: 'method' });
    inp.groups.btvt = { krbRow: 0, rows: [newRow(refs, 'btvt', 2, 13)] };
    inp.groups.at = { krbRow: 0, rows: [newRow(refs, 'at', 0, 96)] }; // в примере K_рб = 1,1 и для АТ
    return inp;
  }

  // Округление «как на бумаге» (0,55 → 0,6), без ошибок двоичного представления
  function roundTo(x, decimals) {
    const m = Math.pow(10, decimals);
    return Math.round(Number((x * m).toPrecision(12))) / m;
  }

  function nDecimals(mode, g) {
    if (mode === '0.01') return 2;
    if (mode === '0.1') return 1;
    if (mode === 'method') return g === 'btvt' ? 2 : 1;
    return null;
  }

  const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

  // K(t) по таблице 2 с линейной интерполяцией между строками
  function kt(days, action, table) {
    const col = action === 'off' ? 2 : 1;
    const t = table.slice().sort((a, b) => a[0] - b[0]);
    const first = t[0];
    const last = t[t.length - 1];
    if (days <= first[0]) {
      return { k: first[col], exact: days === first[0], outside: days < first[0], note: days < first[0] ? `меньше ${first[0]} сут. — взято значение для ${first[0]} сут.` : 'по табл. 2' };
    }
    if (days >= last[0]) {
      return { k: last[col], exact: days === last[0], outside: days > last[0], note: days > last[0] ? `больше ${last[0]} сут. — взято значение для ${last[0]} сут.` : 'по табл. 2' };
    }
    for (let i = 0; i < t.length - 1; i++) {
      const a = t[i];
      const b = t[i + 1];
      if (days === a[0]) return { k: a[col], exact: true, outside: false, note: 'по табл. 2' };
      if (days > a[0] && days < b[0]) {
        const k = roundTo(a[col] + (b[col] - a[col]) * (days - a[0]) / (b[0] - a[0]), 3);
        return { k, exact: false, outside: false, note: `интерполяция между ${a[0]} и ${b[0]} сут.`, interp: { d0: a[0], d1: b[0], k0: a[col], k1: b[col] } };
      }
    }
    return { k: 1, exact: false, outside: true, note: '' };
  }

  // Расчёт за сутки (п. 2.4–2.6)
  function calcDay(input, refs) {
    const ktRes = kt(input.days, input.action, refs.kt);
    const kzs = input.kzs;
    const groups = {};
    const sumKinds = { bp: 0, kr: 0, sr: 0, tr: 0 };
    let total = 0;
    for (const g of GROUP_KEYS) {
      const gi = input.groups[g];
      const krbRow = refs.krb[gi.krbRow] || refs.krb[0];
      const krb = krbRow[input.line];
      const km = input.utg ? refs.km[g] : 1;
      const factor = ktRes.k * kzs * krb * km;
      const dec = nDecimals(input.roundN, g);
      const sumN = { bp: 0, kr: 0, sr: 0, tr: 0 };
      let count = 0;
      const rows = gi.rows.map((r) => {
        const pRaw = {};
        const p = {};
        const nRaw = {};
        const n = {};
        let pSum = 0;
        let nSum = 0;
        for (const k of KIND_KEYS) {
          pRaw[k] = r[k] * factor;
          p[k] = input.roundPct ? roundTo(pRaw[k], 1) : pRaw[k];
          nRaw[k] = r.count * p[k] / 100;
          n[k] = dec == null ? nRaw[k] : roundTo(nRaw[k], dec);
          pSum += p[k];
          nSum += n[k];
          sumN[k] += n[k];
        }
        count += r.count;
        const norm = refs.norms[g][r.type];
        return { name: norm ? norm.name : '—', type: r.type, count: r.count, norms: { bp: r.bp, kr: r.kr, sr: r.sr, tr: r.tr }, pRaw, p, pSum, nRaw, n, nSum };
      });
      let gTotal = KIND_KEYS.reduce((s, k) => s + sumN[k], 0);
      if (dec != null) gTotal = roundTo(gTotal, dec);
      for (const k of KIND_KEYS) sumKinds[k] += sumN[k];
      total += gTotal;
      groups[g] = { krb, krbName: krbRow.name, km, factor, dec, rows, sumN, total: gTotal, count };
    }
    return { kt: ktRes, kzs, groups, sumKinds, total: roundTo(total, 6) };
  }

  function reductionK(repair) {
    let k = 1;
    const used = [];
    for (const f of REDUCTION_FACTORS) {
      const s = repair.factors && repair.factors[f.key];
      if (s && s.on && isNum(s.k)) {
        k *= s.k;
        used.push({ name: f.name, k: s.k });
      }
    }
    return { k, used };
  }

  // Оценка соответствия ремонтных возможностей потребностям (п. 2.7)
  function assessRepair(day, repair) {
    const red = reductionK(repair);
    const sk = day.sumKinds;
    const need = { tr: sk.tr, sr: sk.sr, kr: sk.kr, evac: sk.bp + sk.kr };
    const labels = { tr: 'Текущий ремонт (ТР)', sr: 'Средний ремонт (СР)', kr: 'Капитальный ремонт (КР)', evac: 'Эвакуация (БП + КР)' };
    const rows = ['tr', 'sr', 'kr', 'evac'].map((key) => {
      const q = isNum(repair[key]) ? repair[key] : null;
      const qEff = q == null ? null : q * red.k;
      const kc = qEff == null || need[key] <= 0 ? null : qEff / need[key];
      return { key, label: labels[key], need: need[key], q, qEff, kc, deficit: qEff == null ? null : Math.max(0, need[key] - qEff) };
    });
    let qTotal = isNum(repair.qTotal) ? repair.qTotal : null;
    let qTotalFromKinds = false;
    if (qTotal == null && ['tr', 'sr', 'kr'].some((k) => isNum(repair[k]))) {
      qTotal = ['tr', 'sr', 'kr'].reduce((s, k) => s + (isNum(repair[k]) ? repair[k] : 0), 0);
      qTotalFromKinds = true;
    }
    const qEff = qTotal == null ? null : qTotal * red.k;
    const kc = qEff == null || day.total <= 0 ? null : qEff / day.total;
    return {
      reduction: red,
      rows,
      overall: { need: day.total, q: qTotal, qTotalFromKinds, qEff, kc, deficit: qEff == null ? null : Math.max(0, day.total - qEff) },
    };
  }

  /*
   * Расчёт на весь период операции (сутки 1..days).
   * Каждые сутки выход в ремонт считается от списочного состава (как в методике)
   * или от текущего наличия исправной техники, но не больше исправного остатка.
   * БП выбывают навсегда; КР эвакуируются в тыл (возвращаются через krDays, 0 — не возвращаются);
   * ТР и СР ставятся в очередь ремонта и возвращаются в строй не раньше чем через trDays/srDays
   * с учётом суточной производительности Q_ТР/Q_СР (если задана) и коэффициента снижения.
   */
  function simulate(input, refs, day) {
    day = day || calcDay(input, refs);
    const days = Math.max(1, Math.round(input.days));
    const sim = input.sim || {};
    const base = sim.base === 'current' ? 'current' : 'initial';
    const delay = { tr: Math.max(1, Math.round(sim.trDays || 1)), sr: Math.max(1, Math.round(sim.srDays || 1)) };
    const krDays = Math.max(0, Math.round(sim.krDays || 0));
    const red = reductionK(input.repair || {});
    const cap = {
      tr: isNum(input.repair && input.repair.tr) ? input.repair.tr * red.k : Infinity,
      sr: isNum(input.repair && input.repair.sr) ? input.repair.sr * red.k : Infinity,
    };
    const units = [];
    for (const g of GROUP_KEYS) {
      day.groups[g].rows.forEach((r) => {
        if (r.count > 0) units.push({ g, name: r.name, count: r.count, p: r.p, inService: r.count, lost: 0, krOut: 0 });
      });
    }
    const queue = { tr: [], sr: [] };
    const krQueue = [];
    const cum = { bp: 0, kr: 0, sr: 0, tr: 0, repaired: 0, krReturned: 0 };
    const initial = { btvt: 0, at: 0, all: 0 };
    units.forEach((u) => { initial[u.g] += u.count; initial.all += u.count; });

    const series = [];
    const snapshot = (d, fail, repairedToday) => {
      const inS = { btvt: 0, at: 0, all: 0 };
      units.forEach((u) => { inS[u.g] += u.inService; inS.all += u.inService; });
      const backlog = {
        tr: queue.tr.reduce((s, it) => s + it.amount, 0),
        sr: queue.sr.reduce((s, it) => s + it.amount, 0),
        kr: krQueue.reduce((s, it) => s + it.amount, 0),
      };
      const pct = (g) => (initial[g] > 0 ? inS[g] / initial[g] * 100 : null);
      series.push({
        day: d,
        inService: inS,
        pct: { btvt: pct('btvt'), at: pct('at'), all: pct('all') },
        fail,
        repaired: repairedToday,
        backlog,
        cumBp: cum.bp,
        cumKrOut: units.reduce((s, u) => s + u.krOut, 0) + backlog.kr,
      });
    };
    snapshot(0, { bp: 0, kr: 0, sr: 0, tr: 0 }, 0);

    for (let d = 1; d <= days; d++) {
      const fail = { bp: 0, kr: 0, sr: 0, tr: 0 };
      for (const u of units) {
        const b = base === 'current' ? u.inService : u.count;
        const want = KIND_KEYS.reduce((s, k) => s + b * u.p[k] / 100, 0);
        const scale = want > u.inService ? (want > 0 ? u.inService / want : 0) : 1;
        for (const k of KIND_KEYS) {
          const amt = b * u.p[k] / 100 * scale;
          if (amt <= 0) continue;
          u.inService -= amt;
          fail[k] += amt;
          cum[k] += amt;
          if (k === 'bp') u.lost += amt;
          else if (k === 'kr') {
            if (krDays > 0) krQueue.push({ u, amount: amt, ready: d + krDays });
            else u.krOut += amt;
          } else queue[k].push({ u, amount: amt, ready: d + delay[k] });
        }
        if (u.inService < 1e-12) u.inService = 0;
      }
      let repairedToday = 0;
      for (const k of ['tr', 'sr']) {
        let left = cap[k];
        for (const it of queue[k]) {
          if (left <= 1e-12) break;
          if (it.ready > d) continue;
          const take = Math.min(it.amount, left);
          it.amount -= take;
          left -= take;
          it.u.inService += take;
          repairedToday += take;
        }
        queue[k] = queue[k].filter((it) => it.amount > 1e-12);
      }
      for (let i = krQueue.length - 1; i >= 0; i--) {
        const it = krQueue[i];
        if (it.ready <= d) {
          it.u.inService += it.amount;
          cum.krReturned += it.amount;
          repairedToday += it.amount;
          krQueue.splice(i, 1);
        }
      }
      cum.repaired += repairedToday;
      snapshot(d, fail, repairedToday);
    }

    const last = series[series.length - 1];
    let min = { pct: 100, day: 0 };
    series.forEach((s) => { if (s.pct.all != null && s.pct.all < min.pct) min = { pct: s.pct.all, day: s.day }; });
    return {
      days,
      base,
      series,
      initial,
      units: units.map((u) => ({ g: u.g, name: u.name, count: u.count, inService: u.inService, lost: u.lost, krOut: u.krOut })),
      totals: {
        bp: cum.bp, kr: cum.kr, sr: cum.sr, tr: cum.tr,
        repaired: cum.repaired,
        krReturned: cum.krReturned,
        finalInService: last.inService,
        finalPct: last.pct,
        backlog: last.backlog,
        evac: cum.bp + cum.kr,
        minReadiness: initial.all > 0 ? min : null,
      },
    };
  }

  // Проверка введённых данных и справочников
  function validate(input, refs) {
    const out = [];
    const add = (level, text) => out.push({ level, text });
    if (!isNum(input.days) || input.days <= 0) add('error', 'Продолжительность операции должна быть положительным числом.');
    else {
      if (!Number.isInteger(input.days)) add('warn', 'Продолжительность операции не целая — для расчёта на период берётся округлённое значение.');
      const r = kt(input.days, input.action, refs.kt);
      if (r.outside) add('warn', `K(t): продолжительность ${input.days} сут. вне табл. 2 — ${r.note}.`);
    }
    const range = refs.kzs[input.action] && refs.kzs[input.action][input.echelon];
    if (!isNum(input.kzs) || input.kzs <= 0) add('error', 'K_зс должен быть положительным числом.');
    else if (range && (input.kzs < range[0] - 1e-9 || input.kzs > range[1] + 1e-9)) {
      add('warn', `K_зс = ${fmt(input.kzs)} вне диапазона табл. 3 (${fmt(range[0])}–${fmt(range[1])}) для выбранных условий.`);
    }
    let anyCount = false;
    for (const g of GROUP_KEYS) {
      input.groups[g].rows.forEach((r, i) => {
        const nm = (refs.norms[g][r.type] || {}).name || `строка ${i + 1}`;
        if (!isNum(r.count) || r.count < 0) add('error', `${GROUP_NAMES[g]}, «${nm}»: списочный состав должен быть неотрицательным числом.`);
        else if (!Number.isInteger(r.count)) add('warn', `${GROUP_NAMES[g]}, «${nm}»: списочный состав не целый.`);
        else if (r.count === 0) add('info', `${GROUP_NAMES[g]}, «${nm}»: не указан списочный состав.`);
        if (r.count > 0) anyCount = true;
        for (const k of KINDS) {
          if (!isNum(r[k.key]) || r[k.key] < 0) add('error', `${GROUP_NAMES[g]}, «${nm}»: норма ${k.short} должна быть неотрицательным числом.`);
        }
        const ref = refs.norms[g][r.type];
        if (ref && KIND_KEYS.some((k) => Math.abs(ref[k] - r[k]) > 1e-9)) {
          add('info', `${GROUP_NAMES[g]}, «${nm}»: нормы изменены вручную и отличаются от табл. 1.`);
        }
      });
    }
    if (!anyCount) add('info', 'Укажите списочный состав хотя бы для одного вида техники.');
    for (const g of GROUP_KEYS) {
      refs.norms[g].forEach((n) => {
        const s = n.bp + n.kr + n.sr;
        if (Math.abs(s - n.total) > 0.005) {
          add('warn', `Табл. 1, «${n.name}»: «Всего» ${fmt(n.total)} ≠ БП + КР + СР = ${fmt(s)}. Проверьте норму по первоисточнику.`);
        }
      });
    }
    for (const f of REDUCTION_FACTORS) {
      const s = input.repair.factors[f.key];
      if (s && s.on && (!isNum(s.k) || s.k <= 0 || s.k > 1)) add('warn', `Коэффициент снижения «${f.name}» должен быть в пределах (0; 1].`);
    }
    for (const key of ['qTotal', 'tr', 'sr', 'kr', 'evac']) {
      const v = input.repair[key];
      if (v != null && (!isNum(v) || v < 0)) add('error', 'Возможности по ремонту Q должны быть неотрицательными числами.');
    }
    const sim = input.sim;
    if (sim && (sim.trDays < 1 || sim.srDays < 1)) add('warn', 'Срок ремонта ТР/СР меньше 1 сут. — взято 1 сут.');
    return out;
  }

  // ----- Форматирование -----
  function fmt(x, d) {
    if (!isNum(x)) return '—';
    if (d == null) {
      // до 4 знаков без хвостовых нулей, но не меньше одного знака (1 → 1,0)
      let s = roundTo(x, 4).toFixed(4).replace(/0+$/, '');
      if (s.endsWith('.')) s += '0';
      return s.replace('.', ',');
    }
    return roundTo(x, d).toFixed(d).replace('.', ',');
  }

  // Короткое представление: без лишних нулей (0,065; 1,92)
  function fmtShort(x) {
    if (!isNum(x)) return '—';
    let s = roundTo(x, 4).toFixed(4).replace(/0+$/, '');
    if (s.endsWith('.')) s = s.slice(0, -1);
    return s.replace('.', ',');
  }

  // ----- Ход решения -----
  function solution(input, refs, day, repair, sim) {
    day = day || calcDay(input, refs);
    repair = repair || assessRepair(day, input.repair);
    const L = [];
    const h = (t) => L.push({ t: 'h', s: t });
    const sub = (t) => L.push({ t: 's', s: t });
    const p = (t) => L.push({ t: 'p', s: t });
    const f = (t) => L.push({ t: 'f', s: t });
    const pf = (x) => (input.roundPct ? fmt(x, 1) : fmtShort(x));
    const approx = (raw, val, d) => (Math.abs(raw - val) > 1e-9 ? `${fmtShort(raw)} ≈ ${fmt(val, d)}` : fmtShort(raw));

    h('1. Исходные данные');
    p(`Характер действий: ${ACTIONS[input.action].toLowerCase()}.`);
    p(`Продолжительность операции: ${input.days} сут.`);
    p(`Место в оперативном построении: ${ECHELONS[input.echelon].toLowerCase()}.`);
    p(`Разновидность боя: ${LINES[input.line].toLowerCase()}.`);
    p(`Масштаб соединения: ${input.utg ? 'усиленная тактическая группа (УТГ)' : 'без коэффициента масштаба'}.`);
    for (const g of GROUP_KEYS) {
      const rows = day.groups[g].rows.filter((r) => r.count > 0);
      if (rows.length) p(`Списочный состав ${GROUP_NAMES[g]}: ${rows.map((r) => `${r.name} — ${r.count} ед.`).join('; ')}`);
    }

    h('2. Поправочные коэффициенты');
    const k = day.kt;
    if (k.interp) {
      f(`K(t) = ${fmt(k.interp.k0)} + (${fmt(k.interp.k1)} − ${fmt(k.interp.k0)}) × (${input.days} − ${k.interp.d0}) / (${k.interp.d1} − ${k.interp.d0}) = ${fmt(k.k)} (табл. 2, ${k.note})`);
    } else {
      p(`K(t) = ${fmt(k.k)} (табл. 2, ${k.outside ? k.note : `${input.days} сут.`}, ${ACTIONS[input.action].toLowerCase()} действия).`);
    }
    const range = refs.kzs[input.action][input.echelon];
    p(`K_зс = ${fmt(input.kzs)} (табл. 3, ${ECHELONS[input.echelon].toLowerCase()}, диапазон ${fmt(range[0])}–${fmt(range[1])}).`);
    for (const g of GROUP_KEYS) {
      const G = day.groups[g];
      p(`${GROUP_NAMES[g]}: K_рб = ${fmt(G.krb)} (табл. 4, «${G.krbName}», ${LINES[input.line].toLowerCase()}); K_м = ${fmt(G.km)}${input.utg ? ' (п. 2.3.4, УТГ)' : ''}.`);
    }

    h('3. Прогнозируемые потери за сутки, %');
    p('P_ут = P_ср × K(t) × K_зс × K_рб × K_м');
    for (const g of GROUP_KEYS) {
      const G = day.groups[g];
      G.rows.filter((r) => r.count > 0).forEach((r) => {
        sub(`${GROUP_NAMES[g]} — ${r.name} (нормы табл. 1: ${KINDS.map((kk) => `${kk.short} ${fmt(r.norms[kk.key])} %`).join(', ')})`);
        for (const kk of KINDS) {
          f(`P_${kk.short} = ${fmt(r.norms[kk.key])} × ${fmt(k.k)} × ${fmt(input.kzs)} × ${fmt(G.krb)} × ${fmt(G.km)} = ${input.roundPct ? approx(r.pRaw[kk.key], r.p[kk.key], 1) : fmtShort(r.pRaw[kk.key])} %`);
        }
        f(`Совокупный выход: ${KINDS.map((kk) => pf(r.p[kk.key])).join(' + ')} = ${pf(r.pSum)} %`);
      });
    }

    h('4. Перевод в абсолютные единицы');
    p('N_абс = N_сп × P / 100');
    const groupTotals = [];
    for (const g of GROUP_KEYS) {
      const G = day.groups[g];
      const rows = G.rows.filter((r) => r.count > 0);
      if (!rows.length) continue;
      rows.forEach((r) => {
        sub(`${GROUP_NAMES[g]} — ${r.name} (${r.count} ед.)`);
        for (const kk of KINDS) {
          const raw = r.nRaw[kk.key];
          const val = r.n[kk.key];
          f(`N_${kk.short} = ${r.count} × ${pf(r.p[kk.key])} / 100 = ${G.dec == null ? fmtShort(raw) : approx(raw, val, G.dec)} ед.`);
        }
      });
      const parts = rows.length > 1
        ? rows.map((r) => fmtShort(r.nSum))
        : KINDS.map((kk) => fmtShort(rows[0].n[kk.key]));
      f(`Совокупный выход ${GROUP_NAMES[g]}: ${parts.join(' + ')} = ${fmtShort(G.total)} ед. в сутки`);
      groupTotals.push(G);
    }
    if (groupTotals.length) {
      f(`N_ВВСТ = ${GROUP_KEYS.filter((g) => day.groups[g].rows.some((r) => r.count > 0)).map((g) => `N_${GROUP_NAMES[g]}`).join(' + ')} = ${groupTotals.map((G) => fmtShort(G.total)).join(' + ')} = ${fmtShort(day.total)} ед. в сутки`);
      f(`В том числе: ${KINDS.map((kk) => `${kk.short} — ${fmtShort(day.sumKinds[kk.key])}`).join('; ')} ед.`);
    }

    h('5. Оценка соответствия ремонтных возможностей потребностям');
    const red = repair.reduction;
    if (red.used.length) {
      f(`K_сн = ${red.used.length > 1 ? `${red.used.map((u) => fmt(u.k)).join(' × ')} = ` : ''}${fmtShort(red.k)} (учтены факторы п. 2.7: ${red.used.map((u) => u.name.toLowerCase()).join('; ')})`);
    }
    const o = repair.overall;
    if (o.q == null) p('Возможности по ремонту Q не заданы.');
    else {
      const qStr = red.used.length ? `${fmtShort(o.q)} × ${fmtShort(red.k)}` : fmtShort(o.q);
      f(`K_c = Q / N_ВВСТ = ${qStr} / ${fmtShort(o.need)} = ${fmt(o.kc, 2)}${o.qTotalFromKinds ? ' (Q = Q_ТР + Q_СР + Q_КР)' : ''}`);
      p(o.kc >= 1 ? 'K_c ≥ 1 — возможностей достаточно.' : `K_c < 1 — дефицит ремонтных мощностей ${fmt(o.deficit, 2)} ед./сут., требуется дополнительное усиление.`);
    }
    repair.rows.filter((r) => r.q != null).forEach((r) => {
      const qStr = red.used.length ? `${fmtShort(r.q)} × ${fmtShort(red.k)}` : fmtShort(r.q);
      f(`${r.label}: K_c = ${qStr} / ${fmtShort(r.need)} = ${r.kc == null ? '—' : fmt(r.kc, 2)}${r.kc != null && r.kc < 1 ? ` — дефицит ${fmt(r.deficit, 2)} ед./сут.` : ''}`);
    });

    if (sim) {
      h(`6. Прогноз на период операции (${sim.days} сут.)`);
      const t = sim.totals;
      p(`Безвозвратные потери за операцию: ${fmt(t.bp, 1)} ед.; выход в КР: ${fmt(t.kr, 1)} ед.; в СР: ${fmt(t.sr, 1)} ед.; в ТР: ${fmt(t.tr, 1)} ед.`);
      p(`Требуется эвакуировать (БП + КР): ${fmt(t.evac, 1)} ед.; возвращено в строй после ремонта: ${fmt(t.repaired, 1)} ед.`);
      p(`Исправной техники к концу операции: ${fmt(t.finalInService.all, 1)} из ${sim.initial.all} ед. (${fmt(t.finalPct.all, 1)} %); в ремонте остаётся ТР ${fmt(t.backlog.tr, 1)}, СР ${fmt(t.backlog.sr, 1)} ед.`);
    }
    return L;
  }

  function solutionText(lines) {
    return lines.map((l) => (l.t === 'h' ? `\n${l.s}` : l.t === 's' ? `${l.s}:` : l.t === 'f' ? `  ${l.s}` : l.s)).join('\n').trim();
  }

  // ----- CSV (разделитель «;», десятичная запятая — открывается в Excel) -----
  function csvCell(v) {
    if (v == null) return '';
    const s = typeof v === 'number' ? fmtShort(v) : String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function toCSV(input, refs, day, repair, sim) {
    const out = [];
    const row = (...cells) => out.push(cells.map(csvCell).join(';'));
    const blanks = (n) => Array(n).fill('');
    row('Расчёт прогнозируемых потерь БТВТ и АТ');
    row('Характер действий', ACTIONS[input.action]);
    row('Продолжительность, сут.', input.days);
    row('Элемент построения', ECHELONS[input.echelon]);
    row('Разновидность боя', LINES[input.line]);
    row('K(t)', day.kt.k, 'K_зс', input.kzs);
    row('');
    row('Группа', 'Вид ВВСТ', 'N_сп', 'K_рб', 'K_м', ...KINDS.map((k) => `P_ср ${k.short}, %`), ...KINDS.map((k) => `${k.short}, %`), ...KINDS.map((k) => `${k.short}, ед.`), 'Всего, ед.');
    for (const g of GROUP_KEYS) {
      const G = day.groups[g];
      G.rows.forEach((r) => row(GROUP_NAMES[g], r.name, r.count, G.krb, G.km, ...KIND_KEYS.map((k) => r.norms[k]), ...KIND_KEYS.map((k) => r.p[k]), ...KIND_KEYS.map((k) => r.n[k]), r.nSum));
      row(GROUP_NAMES[g], 'Итого', G.count, ...blanks(10), ...KIND_KEYS.map((k) => G.sumN[k]), G.total);
    }
    row('', 'N_ВВСТ, ед./сут.', ...blanks(11), ...KIND_KEYS.map((k) => day.sumKinds[k]), day.total);
    row('');
    row('Оценка ремонтных возможностей', 'Потребность, ед./сут.', 'Q, ед./сут.', 'Q с учётом снижения', 'K_c', 'Дефицит');
    repair.rows.forEach((r) => row(r.label, r.need, r.q, r.qEff, r.kc, r.deficit));
    row('Всего (N_ВВСТ)', repair.overall.need, repair.overall.q, repair.overall.qEff, repair.overall.kc, repair.overall.deficit);
    if (sim) {
      row('');
      row('Сутки', 'Исправно БТВТ, ед.', 'Исправно АТ, ед.', 'Исправно всего, %', 'Выход БП', 'Выход КР', 'Выход СР', 'Выход ТР', 'Возвращено из ремонта', 'Очередь ТР', 'Очередь СР', 'БП нарастающим итогом');
      sim.series.forEach((s) => row(s.day, s.inService.btvt, s.inService.at, s.pct.all, s.fail.bp, s.fail.kr, s.fail.sr, s.fail.tr, s.repaired, s.backlog.tr, s.backlog.sr, s.cumBp));
    }
    return '﻿' + out.join('\r\n');
  }

  // Краткие итоги варианта — для сравнения сохранённых вариантов
  function summarize(input, refs) {
    const day = calcDay(input, refs);
    const repair = assessRepair(day, input.repair);
    const sim = simulate(input, refs, day);
    return {
      total: day.total,
      btvt: day.groups.btvt.total,
      at: day.groups.at.total,
      kc: repair.overall.kc,
      bpOp: sim.totals.bp,
      finalPct: sim.totals.finalPct.all,
      minReadiness: sim.totals.minReadiness,
    };
  }

  return {
    KINDS, KIND_KEYS, GROUP_KEYS, GROUP_NAMES, GROUP_TITLES, ACTIONS, ECHELONS, LINES, ROUND_N_MODES, REDUCTION_FACTORS,
    defaultRefs, defaultInput, exampleInput, newRow, roundTo, kt, calcDay, assessRepair, reductionK, simulate, validate,
    solution, solutionText, toCSV, summarize, fmt, fmtShort,
  };
});
