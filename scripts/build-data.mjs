// ===========================================================================
// build-data.mjs — 大戶籌碼吃貨/倒貨偵測器 資料產生器
// 每週抓 TDCC 集保股權分散表(全市場,免費)→ 算大戶(≥400張/≥1000張)持股比例、
// 股東人數 → 累積成每檔的「週序列」→ 寫入 docs/data.json(前端算趨勢與吃貨/倒貨)。
//
// 執行:  node scripts/build-data.mjs
// 需求:  Node 18+(內建 fetch),零 npm 依賴
// ===========================================================================
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'docs');
const OUT_FILE = join(OUT_DIR, 'data.json');

const MAX_WEEKS = 16;          // 最多保留週數
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) tw-chip-tracker' };
const isCommon = (c) => /^[1-9]\d{3}$/.test(c);          // 只留普通個股
const toNum = (v) => { const n = parseFloat(String(v).replace(/[,\s]/g, '')); return Number.isNaN(n) ? 0 : n; };
const toInt = (v) => { const n = parseInt(String(v).replace(/[,\s]/g, ''), 10); return Number.isNaN(n) ? 0 : n; };

async function fetchText(url) {
  for (let i = 0; i < 4; i++) {
    try { const r = await fetch(url, { headers: UA }); if (r.ok) return await r.text(); } catch {}
    await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
  }
  throw new Error('抓取失敗: ' + url);
}
async function fetchJson(url) { return JSON.parse(await fetchText(url)); }

// ---- 代號 → {name, market} ------------------------------------------------
async function fetchNames() {
  const map = new Map();
  try {
    const tw = await fetchJson('https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL');
    for (const x of tw) { const c = String(x.Code).trim(); if (isCommon(c)) map.set(c, { name: x.Name.trim(), market: 'TWSE' }); }
  } catch (e) { process.stderr.write('TWSE 名稱抓取失敗: ' + e.message + '\n'); }
  try {
    const tp = await fetchJson('https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes');
    for (const x of tp) { const c = String(x.SecuritiesCompanyCode).trim(); if (isCommon(c) && !map.has(c)) map.set(c, { name: (x.CompanyName || '').trim(), market: 'TPEX' }); }
  } catch (e) { process.stderr.write('TPEX 名稱抓取失敗: ' + e.message + '\n'); }
  return map;
}

// ---- TDCC 集保股權分散表(最新一週,全市場)-------------------------------
// CSV 欄:資料日期,證券代號,持股分級,人數,股數,占集保庫存數比例%
// 級距(股):12=400,001-600,000 13=600,001-800,000 14=800,001-1,000,000 15=1,000,001以上
//   → ≥400張 = L12+L13+L14+L15 ; ≥1000張(千張)= L15 ; 17=合計(取總股東人數)
async function fetchTDCC() {
  const text = await fetchText('https://opendata.tdcc.com.tw/getOD.ashx?id=1-5');
  const lines = text.replace(/^﻿/, '').trim().split(/\r?\n/);
  const byCode = new Map();       // code -> {big400, big1000, holders}
  let dataDate = null;
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].split(',');
    if (p.length < 6) continue;
    const date = p[0].trim(); const code = p[1].trim(); const lvl = toInt(p[2]);
    const people = toInt(p[3]); const pct = toNum(p[5]);
    if (!isCommon(code)) continue;
    if (!dataDate) dataDate = date;
    let rec = byCode.get(code); if (!rec) { rec = { big400: 0, big1000: 0, holders: 0 }; byCode.set(code, rec); }
    if (lvl >= 12 && lvl <= 15) rec.big400 += pct;
    if (lvl === 15) rec.big1000 = pct;
    if (lvl === 17) rec.holders = people;
  }
  const iso = dataDate ? `${dataDate.slice(0, 4)}-${dataDate.slice(4, 6)}-${dataDate.slice(6, 8)}` : null;
  return { date: iso, byCode };
}

// ---- 累積寫入 -------------------------------------------------------------
async function main() {
  const [names, tdcc] = await Promise.all([fetchNames(), fetchTDCC()]);
  if (!tdcc.date || tdcc.byCode.size === 0) throw new Error('TDCC 無資料');
  process.stderr.write(`TDCC 週別 ${tdcc.date},個股 ${tdcc.byCode.size} 檔;名稱對照 ${names.size} 檔\n`);

  // 讀既有 data.json(累積用)
  let prev = { weeks: [], stocks: {} };
  try { prev = JSON.parse(await readFile(OUT_FILE, 'utf8')); } catch {}
  const weeks = prev.weeks || [];
  const stocks = prev.stocks || {};

  if (weeks.includes(tdcc.date)) { process.stderr.write(`本週 ${tdcc.date} 已存在,無需更新。\n`); return; }

  // 新增一週:先把新週期加到時間軸,所有既有股票該格先補 null
  weeks.push(tdcc.date);
  const wi = weeks.length - 1;
  for (const s of Object.values(stocks)) {
    while (s.big400.length < wi) { s.big400.push(null); s.big1000.push(null); s.holders.push(null); }
  }
  // 填入本週各股數值(只收上市/上櫃,排除興櫃等無市場別者)
  for (const [code, v] of tdcc.byCode) {
    const nm = names.get(code);
    if (!nm && !stocks[code]) continue; // 非上市櫃且非既有 → 略過
    let s = stocks[code];
    if (!s) { s = stocks[code] = { name: '', market: '', big400: Array(wi).fill(null), big1000: Array(wi).fill(null), holders: Array(wi).fill(null) }; }
    s.name = (nm && nm.name) || s.name || code;
    s.market = (nm && nm.market) || s.market || '';
    s.big400[wi] = Math.round(v.big400 * 100) / 100;
    s.big1000[wi] = Math.round(v.big1000 * 100) / 100;
    s.holders[wi] = v.holders;
  }
  // 本週沒出現的既有股票補 null
  for (const s of Object.values(stocks)) {
    while (s.big400.length <= wi) { s.big400.push(null); s.big1000.push(null); s.holders.push(null); }
  }

  // 只保留最近 MAX_WEEKS 週
  if (weeks.length > MAX_WEEKS) {
    const drop = weeks.length - MAX_WEEKS;
    weeks.splice(0, drop);
    for (const s of Object.values(stocks)) { s.big400.splice(0, drop); s.big1000.splice(0, drop); s.holders.splice(0, drop); }
  }

  const out = {
    updated_at: new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Taipei' }).replace(' ', 'T') + '+08:00',
    weeks,
    note: '大戶=集保持股級距 ≥400張(或≥1000張)占比合計;股東人數為集保合計。看「週變化」判斷吃貨/倒貨。資料來源 TDCC,僅供參考、非投資建議。',
    stocks,
  };
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(OUT_FILE, JSON.stringify(out), 'utf8');
  process.stderr.write(`完成:${weeks.length} 週 (${weeks.join(', ')}),共 ${Object.keys(stocks).length} 檔 → ${OUT_FILE}\n`);
}
main().catch((e) => { console.error('執行失敗:', e); process.exit(1); });
