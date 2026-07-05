// ===========================================================================
// build-finder.mjs — 飆股找尋器資料產生器
// 1) 算市值篩出「中小型股」(排除大型權值)
// 2) 逐檔用 twsthr 取:週大戶(>400/>1000張)、月收盤價、月股東人數(逐檔快取)
// 3) 產出 docs/finder.json(前端算「盤整打底 + 大戶吸籌」= 飆股候選)
//
// 用法: node scripts/build-finder.mjs
// ===========================================================================
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'docs', 'finder.json');
const CACHE = join(__dirname, 'thr_cache');
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) finder' };

const MCAP_MAX = 5e10;   // 市值上限 500 億(排除大型權值)
const MCAP_MIN = 3e8;    // 市值下限 3 億(排除過小/殭屍股)
const WEEKS_N = 26;      // 保留最近幾週大戶
const MONTHS_N = 12;     // 保留最近幾月收盤/人數

const isCommon = (c) => /^[1-9]\d{3}$/.test(c);
const num = (v) => { const n = parseFloat(String(v).replace(/[,\s]/g, '')); return Number.isNaN(n) ? null : n; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const iso = (ymd) => `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;

async function getJson(url) { const r = await fetch(url, { headers: UA }); return JSON.parse(await r.text()); }

// ---- 1) 股票池 + 市值 -----------------------------------------------------
async function buildUniverse() {
  const uni = new Map(); // code -> {name, market, close, shares}
  // 上市:收盤 + 名稱
  try {
    const tw = await getJson('https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL');
    for (const x of tw) { const c = String(x.Code).trim(); if (isCommon(c)) uni.set(c, { name: x.Name.trim(), market: 'TWSE', close: num(x.ClosingPrice), shares: null }); }
  } catch (e) { console.error('TWSE 收盤失敗', e.message); }
  // 上市:已發行股數
  try {
    const cap = await getJson('https://openapi.twse.com.tw/v1/opendata/t187ap03_L');
    for (const x of cap) { const c = String(x['公司代號']).trim(); const s = uni.get(c); if (s) s.shares = num(x['已發行普通股數或TDR原股發行股數']); }
  } catch (e) { console.error('TWSE 股數失敗', e.message); }
  // 上櫃:收盤 + 股本(Capitals)+ 名稱
  try {
    const tp = await getJson('https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes');
    for (const x of tp) {
      const c = String(x.SecuritiesCompanyCode).trim();
      if (isCommon(c) && !uni.has(c)) {
        const cap = num(x.Capitals);
        uni.set(c, { name: (x.CompanyName || '').trim(), market: 'TPEX', close: num(x.Close), shares: cap != null ? cap / 10 : null });
      }
    }
  } catch (e) { console.error('TPEX 失敗', e.message); }

  // 篩中小型
  const picked = [];
  for (const [code, v] of uni) {
    if (v.close == null || v.shares == null || v.close <= 0) continue;
    const mcap = v.close * v.shares;
    if (mcap >= MCAP_MIN && mcap < MCAP_MAX) picked.push({ code, ...v, mcap });
  }
  return picked;
}

// ---- 2) twsthr 逐檔(含快取)----------------------------------------------
const seriesByName = (h, name) => { const m = h.match(new RegExp("\\[([\\d.,\\s-]+)\\]\\s*,\\s*name:\\s*'" + name.replace(/[()]/g, '\\$&') + "'")); return m ? m[1].split(',').map((x) => num(x)) : null; };

async function fetchThr(code) {
  const cf = join(CACHE, code + '.html');
  let h;
  if (existsSync(cf)) { h = await readFile(cf, 'utf8'); }
  else {
    const r = await fetch(`https://norway.twsthr.info/StockHolders.aspx?stock=${code}`, { headers: UA });
    h = await r.text();
    if (h.length > 5000) await writeFile(cf, h, 'utf8');
    await sleep(700);
  }
  const allCats = [...h.matchAll(/categories:\s*\[([^\]]*)\]/g)].map((m) => m[1].split(',').map((s) => s.replace(/[^0-9-]/g, '')));
  const weekAxis = allCats.find((a) => a[0] && /^\d{8}$/.test(a[0]));
  const monthAxis = allCats.find((a) => a[0] && /^\d{4}-\d{2}$/.test(a[0]));
  const b400 = seriesByName(h, '大股東持有率(>400張)');
  const b1000 = seriesByName(h, '大股東持有率(>1000張)');
  const closeM = seriesByName(h, '月收盤價');
  const holdersM = seriesByName(h, '總股東人數');
  if (!weekAxis || !b400) return null;
  const wN = Math.min(WEEKS_N, weekAxis.length);
  const mN = monthAxis ? Math.min(MONTHS_N, monthAxis.length) : 0;
  return {
    wdates: weekAxis.slice(-wN).map(iso),
    big400: b400.slice(-wN),
    big1000: b1000 ? b1000.slice(-wN) : b400.slice(-wN).map(() => null),
    mdates: mN ? monthAxis.slice(-mN) : [],
    close: mN && closeM ? closeM.slice(-mN) : [],
    holders: mN && holdersM ? holdersM.slice(-mN) : [],
  };
}

async function main() {
  await mkdir(CACHE, { recursive: true });
  let universe = await buildUniverse();
  console.error(`中小型股池:${universe.length} 檔(市值 ${MCAP_MIN / 1e8}~${MCAP_MAX / 1e8} 億)`);
  const LIMIT = parseInt(process.env.LIMIT || '0', 10);
  if (LIMIT > 0) { universe = universe.slice(0, LIMIT); console.error(`(測試模式:只取前 ${LIMIT} 檔)`); }

  const stocks = {};
  let globalW = [], globalM = [], done = 0, ok = 0;
  for (const u of universe) {
    try {
      const t = await fetchThr(u.code);
      done++;
      if (t) {
        ok++;
        if (t.wdates.length > globalW.length) globalW = t.wdates;
        if (t.mdates.length > globalM.length) globalM = t.mdates;
        stocks[u.code] = { name: u.name, market: u.market, mcap: Math.round(u.mcap / 1e8), t };
      }
    } catch (e) { /* skip */ }
    if (done % 50 === 0) console.error(`...${done}/${universe.length}(成功 ${ok})`);
  }

  // 對齊到全域週/月軸(依日期,缺補 null)
  const alignW = (dates, vals) => { const m = {}; dates.forEach((d, i) => m[d] = vals[i]); return globalW.map((d) => (d in m ? m[d] : null)); };
  const alignM = (dates, vals) => { const m = {}; dates.forEach((d, i) => m[d] = vals[i]); return globalM.map((d) => (d in m ? m[d] : null)); };
  const out = { updated_at: new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Taipei' }).replace(' ', 'T') + '+08:00', wdates: globalW, mdates: globalM, note: '飆股候選:盤整打底+大戶吸籌。大戶=集保≥400/≥1000張占比。資料來源 TDCC/twsthr,僅供參考、非投資建議。', stocks: {} };
  for (const [code, s] of Object.entries(stocks)) {
    out.stocks[code] = {
      name: s.name, market: s.market, mcap: s.mcap,
      big400: alignW(s.t.wdates, s.t.big400),
      big1000: alignW(s.t.wdates, s.t.big1000),
      close: alignM(s.t.mdates, s.t.close),
      holders: alignM(s.t.mdates, s.t.holders),
    };
  }
  await writeFile(OUT, JSON.stringify(out), 'utf8');
  console.error(`完成:${Object.keys(out.stocks).length} 檔 → ${OUT}(週軸 ${globalW.length}、月軸 ${globalM.length})`);
}
main().catch((e) => { console.error(e); process.exit(1); });
