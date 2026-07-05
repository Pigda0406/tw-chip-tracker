'use strict';

const state = {
  data: null, level: 'big400',
  acc: 13, base: 6, maxRange: 35, minAcc: 1.5, maxPos: 101, minRev: -9999,
  markets: { TWSE: true, TPEX: true },
  sortKey: 'dBig', sortDir: -1,
};

const COLS = [
  { key: 'code', label: '代號', num: false },
  { key: 'name', label: '名稱', num: false },
  { key: 'market', label: '市場', num: false },
  { key: 'mcap', label: '市值(億)', num: true },
  { key: 'price', label: '現價', num: true },
  { key: 'big', label: '大戶%', num: true },
  { key: 'dBig', label: 'Δ大戶(pp)', num: true },
  { key: 'rising', label: '連升週', num: true },
  { key: 'rangePct', label: '盤整振幅%', num: true },
  { key: 'pos', label: '位階%', num: true },
  { key: 'dHold', label: '股東Δ%', num: true },
  { key: 'revYoY', label: '營收YoY%', num: true },
];

const lastVals = (arr, k) => arr.filter((x) => x != null).slice(-k);
const lastIdx = (arr) => { for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null) return i; return -1; };

async function load() {
  try { state.data = await (await fetch('finder.json?_=' + Date.now())).json(); }
  catch (e) { document.getElementById('meta').innerHTML = '無法載入 finder.json。' + e; return; }
  setup(); render();
}

function setup() {
  const d = state.data;
  document.getElementById('meta').innerHTML =
    `更新:<strong>${d.updated_at}</strong>　|　大戶週資料至 ${d.wdates.at(-1)}、營收月 ${d.rev_month || '—'}　<a href="index.html" style="color:var(--accent)">↩ 回大戶籌碼</a>`;
  const bind = (id, key, isNum) => { const el = document.getElementById(id); el.value = state[key]; el.addEventListener('change', () => { state[key] = isNum ? +el.value : el.value; render(); }); };
  bind('level', 'level', false); bind('acc', 'acc', true); bind('base', 'base', true);
  bind('range', 'maxRange', true); bind('minacc', 'minAcc', true); bind('maxpos', 'maxPos', true); bind('minrev', 'minRev', true);
  document.getElementById('mTWSE').addEventListener('change', (e) => { state.markets.TWSE = e.target.checked; render(); });
  document.getElementById('mTPEX').addEventListener('change', (e) => { state.markets.TPEX = e.target.checked; render(); });
}

function compute() {
  const d = state.data, rows = [];
  for (const code in d.stocks) {
    const s = d.stocks[code];
    if (!state.markets[s.market]) continue;
    const big = s[state.level];
    const bi = lastIdx(big);
    if (bi < 0) continue;
    const bigNow = big[bi];
    const thenI = bi - state.acc;
    const bigThen = thenI >= 0 ? big[thenI] : null;
    if (bigThen == null) continue;
    const dBig = Math.round((bigNow - bigThen) * 100) / 100;
    // 連升週數(近 acc 週內遞增次數)
    let rising = 0; for (let i = bi - state.acc + 1; i <= bi; i++) { if (i > 0 && big[i] != null && big[i - 1] != null && big[i] > big[i - 1]) rising++; }

    // 盤整:近 base 月收盤
    const closes = lastVals(s.close, state.base);
    if (closes.length < 2) continue;
    const hi = Math.max(...closes), lo = Math.min(...closes);
    const price = closes.at(-1);
    const rangePct = lo > 0 ? Math.round((hi - lo) / lo * 1000) / 10 : 999;
    const pos = hi > lo ? Math.round((price - lo) / (hi - lo) * 100) : 0;

    // 股東人數變化(近 base 月)
    const hs = lastVals(s.holders, state.base);
    const dHold = hs.length >= 2 && hs[0] > 0 ? Math.round((hs.at(-1) - hs[0]) / hs[0] * 1000) / 10 : null;

    const revYoY = s.revYoY ?? null;

    // 篩選:大戶吸籌 + 盤整 + 未突破 + 營收
    if (dBig < state.minAcc) continue;
    if (rangePct > state.maxRange) continue;
    if (price > hi * 1.05) continue;   // 已明顯突破 → 排除(要起漲前)
    if (pos > state.maxPos) continue;  // 位階上限(只看還在底部區的)
    if (state.minRev > -9999 && (revYoY == null || revYoY < state.minRev)) continue;

    rows.push({ code, name: s.name, market: s.market, mcap: s.mcap, price, big: bigNow, dBig, rising, rangePct, pos, dHold, revYoY });
  }
  return rows;
}

function render() {
  const rows = compute();
  const { sortKey, sortDir } = state;
  rows.sort((a, b) => { let av = a[sortKey], bv = b[sortKey]; if (typeof av === 'string') return String(av).localeCompare(String(bv)) * sortDir; if (av == null) av = -Infinity; if (bv == null) bv = -Infinity; return (av - bv) * sortDir; });

  document.getElementById('headRow').innerHTML = COLS.map((c) => `<th data-key="${c.key}">${c.label} ${c.key === sortKey ? `<span class="arrow">${sortDir < 0 ? '▼' : '▲'}</span>` : ''}</th>`).join('');
  document.querySelectorAll('#headRow th').forEach((th) => th.onclick = () => { const k = th.dataset.key; if (state.sortKey === k) state.sortDir *= -1; else { state.sortKey = k; state.sortDir = COLS.find((c) => c.key === k).num ? -1 : 1; } render(); });

  document.getElementById('body').innerHTML = rows.map((r) => {
    const dHoldCls = r.dHold < 0 ? 'up' : (r.dHold > 0 ? 'down' : '');
    return `<tr data-code="${r.code}">
      <td class="code">${r.code}</td><td>${r.name}</td>
      <td><span class="tag">${r.market === 'TWSE' ? '上市' : '上櫃'}</span></td>
      <td>${r.mcap}</td><td>${r.price}</td>
      <td>${r.big.toFixed(2)}</td>
      <td class="up">+${r.dBig.toFixed(2)}</td>
      <td>${r.rising}</td>
      <td>${r.rangePct.toFixed(1)}</td>
      <td>${r.pos}</td>
      <td class="${dHoldCls}">${r.dHold == null ? '—' : (r.dHold > 0 ? '+' : '') + r.dHold.toFixed(1) + '%'}</td>
      <td class="${r.revYoY == null ? '' : (r.revYoY > 0 ? 'up' : 'down')}">${r.revYoY == null ? '—' : (r.revYoY > 0 ? '+' : '') + r.revYoY.toFixed(1) + '%'}</td>
    </tr>`;
  }).join('');
  document.querySelectorAll('#body tr').forEach((tr) => tr.onclick = () => window.open(`https://tw.stock.yahoo.com/quote/${tr.dataset.code}`, '_blank'));

  document.getElementById('count').textContent = `符合 ${rows.length} 檔`;
  document.getElementById('empty').hidden = rows.length > 0;
}

load();
