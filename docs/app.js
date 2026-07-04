'use strict';

const state = {
  data: null,
  level: 'big400',   // big400 | big1000
  mode: 'accumulate',// accumulate | distribute | all
  span: 1,           // 比較 N 週前
  markets: { TWSE: true, TPEX: true },
  sortKey: 'dBig',
  sortDir: -1,
};

const COLS = [
  { key: 'code', label: '代號', num: false },
  { key: 'name', label: '名稱', num: false },
  { key: 'market', label: '市場', num: false },
  { key: 'big', label: '大戶%', num: true },
  { key: 'dBig', label: 'Δ大戶(pp)', num: true },
  { key: 'holders', label: '股東人數', num: true },
  { key: 'dHold', label: 'Δ人數%', num: true },
  { key: 'sig', label: '訊號', num: false },
];

const fmtInt = (n) => n == null ? '—' : n.toLocaleString('en-US');
const fmtPP = (n) => n == null ? '—' : (n > 0 ? '+' : '') + n.toFixed(2);
const fmtPct = (n) => n == null ? '—' : (n > 0 ? '+' : '') + n.toFixed(1) + '%';
const lastIdx = (arr) => { for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null) return i; return -1; };

async function load() {
  try {
    const r = await fetch('data.json?_=' + Date.now());
    state.data = await r.json();
  } catch (e) {
    document.getElementById('meta').textContent = '無法載入資料(data.json)。' + e;
    return;
  }
  setup();
  render();
}

function setup() {
  const d = state.data;
  const W = d.weeks.length;
  document.getElementById('meta').innerHTML =
    `更新時間:<strong>${d.updated_at}</strong>　|　週別(共 ${W} 週):${d.weeks.join('、')}`;

  const span = document.getElementById('span');
  const maxSpan = Math.max(1, W - 1);
  for (let i = 1; i <= maxSpan; i++) span.add(new Option(i + ' 週前', i, false, i === state.span));
  if (W < 2) { span.disabled = true; }

  const banner = document.getElementById('banner');
  if (W < 2) {
    banner.hidden = false;
    banner.innerHTML = '⏳ 目前只有第一週快照,<strong>下週起</strong>才會有「吃貨/倒貨」變化訊號。現在先顯示各股大戶持股比例現況(依大戶%排序)。';
    state.mode = 'all'; document.getElementById('mode').value = 'all'; document.getElementById('mode').disabled = true;
    state.sortKey = 'big';
  } else {
    banner.hidden = true;
  }

  const bind = (id, fn) => document.getElementById(id).addEventListener('change', fn);
  bind('level', (e) => { state.level = e.target.value; render(); });
  bind('mode', (e) => {
    state.mode = e.target.value;
    state.sortKey = state.mode === 'distribute' ? 'dBig' : (state.mode === 'accumulate' ? 'dBig' : 'big');
    state.sortDir = state.mode === 'distribute' ? 1 : -1;
    render();
  });
  bind('span', (e) => { state.span = +e.target.value; render(); });
  bind('mTWSE', (e) => { state.markets.TWSE = e.target.checked; render(); });
  bind('mTPEX', (e) => { state.markets.TPEX = e.target.checked; render(); });
}

function compute() {
  const d = state.data;
  const rows = [];
  for (const code in d.stocks) {
    const s = d.stocks[code];
    if (!state.markets[s.market]) continue;
    const series = s[state.level];
    const li = lastIdx(series);
    if (li < 0) continue;
    const big = series[li];
    const ci = Math.max(0, li - state.span);
    const prevBig = series[ci];
    const dBig = (ci < li && prevBig != null) ? Math.round((big - prevBig) * 100) / 100 : null;

    const hLi = lastIdx(s.holders);
    const holders = hLi >= 0 ? s.holders[hLi] : null;
    const hci = Math.max(0, hLi - state.span);
    const prevH = hLi >= 0 ? s.holders[hci] : null;
    const dHold = (hci < hLi && prevH) ? Math.round((holders - prevH) / prevH * 1000) / 10 : null;

    let sig = 'flat';
    if (dBig != null && dHold != null) {
      if (dBig > 0 && dHold < 0) sig = 'buy';
      else if (dBig < 0 && dHold > 0) sig = 'sell';
    }
    if (state.mode === 'accumulate' && sig !== 'buy') continue;
    if (state.mode === 'distribute' && sig !== 'sell') continue;

    rows.push({ code, name: s.name, market: s.market, big, dBig, holders, dHold, sig });
  }
  return rows;
}

function render() {
  const rows = compute();
  const { sortKey, sortDir } = state;
  rows.sort((a, b) => {
    let av = a[sortKey], bv = b[sortKey];
    if (typeof av === 'string') return String(av).localeCompare(String(bv)) * sortDir;
    if (av == null) av = -Infinity; if (bv == null) bv = -Infinity;
    return (av - bv) * sortDir;
  });

  const head = document.getElementById('headRow');
  head.innerHTML = COLS.map((c) => {
    const arrow = c.key === sortKey ? `<span class="arrow">${sortDir < 0 ? '▼' : '▲'}</span>` : '';
    return `<th data-key="${c.key}">${c.label} ${arrow}</th>`;
  }).join('');
  head.querySelectorAll('th').forEach((th) => {
    th.onclick = () => {
      const k = th.dataset.key;
      if (state.sortKey === k) state.sortDir *= -1;
      else { state.sortKey = k; state.sortDir = COLS.find((c) => c.key === k).num ? -1 : 1; }
      render();
    };
  });

  const sigTag = { buy: '<span class="sig sig-buy">吃貨</span>', sell: '<span class="sig sig-sell">倒貨</span>', flat: '<span class="sig sig-flat">—</span>' };
  const body = document.getElementById('body');
  body.innerHTML = rows.map((r) => {
    const dBigCls = r.dBig > 0 ? 'up' : (r.dBig < 0 ? 'down' : '');
    const dHoldCls = r.dHold < 0 ? 'up' : (r.dHold > 0 ? 'down' : ''); // 人數減=集中(偏多)→紅
    return `<tr data-code="${r.code}">
      <td class="code">${r.code}</td>
      <td>${r.name}</td>
      <td><span class="tag">${r.market === 'TWSE' ? '上市' : '上櫃'}</span></td>
      <td>${r.big == null ? '—' : r.big.toFixed(2)}</td>
      <td class="${dBigCls}">${fmtPP(r.dBig)}</td>
      <td>${fmtInt(r.holders)}</td>
      <td class="${dHoldCls}">${fmtPct(r.dHold)}</td>
      <td>${sigTag[r.sig]}</td>
    </tr>`;
  }).join('');
  body.querySelectorAll('tr').forEach((tr) => {
    tr.onclick = () => window.open(`https://tw.stock.yahoo.com/quote/${tr.dataset.code}`, '_blank');
  });

  document.getElementById('count').textContent = `符合 ${rows.length} 檔`;
  document.getElementById('empty').hidden = rows.length > 0;
}

load();
