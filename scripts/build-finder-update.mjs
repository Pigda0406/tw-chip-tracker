// ===========================================================================
// build-finder-update.mjs — 飆股找尋器「每週增量更新」(純官方資料)
// twsthr 只是一次性歷史種子;此後每週:
//   大戶(週) ← 官方 TDCC 股權分散;股價/市值 ← TWSE/TPEX
// 依 TDCC 週別去重,重複執行不會重複寫入。更新 docs/finder.json 既有股票池。
// ===========================================================================
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FILE = process.env.FINDER_FILE || join(__dirname, '..', 'docs', 'finder.json');
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) finder-update' };
const MAX_WEEKS = 30, MAX_MONTHS = 15;

const isCommon = (c) => /^[1-9]\d{3}$/.test(c);
const num = (v) => { const n = parseFloat(String(v).replace(/[,\s]/g, '')); return Number.isNaN(n) ? null : n; };
const int = (v) => { const n = parseInt(String(v).replace(/[,\s]/g, ''), 10); return Number.isNaN(n) ? 0 : n; };
async function fetchText(u) { for (let i = 0; i < 4; i++) { try { const r = await fetch(u, { headers: UA }); if (r.ok) return await r.text(); } catch {} await new Promise((r) => setTimeout(r, 1500 * (i + 1))); } throw new Error('fetch fail ' + u); }
async function fetchJson(u) { return JSON.parse(await fetchText(u)); }

// 官方 TDCC:大戶(≥400=L12-15、≥1000=L15)、股東人數(L17)
async function fetchTDCC() {
  const text = await fetchText('https://opendata.tdcc.com.tw/getOD.ashx?id=1-5');
  const lines = text.replace(/^﻿/, '').trim().split(/\r?\n/);
  const by = new Map(); let date = null;
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].split(','); if (p.length < 6) continue;
    const d = p[0].trim(), code = p[1].trim(), lvl = int(p[2]), people = int(p[3]), pct = num(p[5]) || 0;
    if (!isCommon(code)) continue; if (!date) date = d;
    let r = by.get(code); if (!r) { r = { big400: 0, big1000: 0, holders: 0 }; by.set(code, r); }
    if (lvl >= 12 && lvl <= 15) r.big400 += pct;
    if (lvl === 15) r.big1000 = pct;
    if (lvl === 17) r.holders = people;
  }
  const iso = date ? `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}` : null;
  return { date: iso, by };
}

// TWSE/TPEX:最新收盤 + 已發行股數 → 市值
async function fetchPriceCap() {
  const m = new Map();
  try { const tw = await fetchJson('https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL'); for (const x of tw) { const c = String(x.Code).trim(); if (isCommon(c)) m.set(c, { close: num(x.ClosingPrice), shares: null }); } } catch {}
  try { const cap = await fetchJson('https://openapi.twse.com.tw/v1/opendata/t187ap03_L'); for (const x of cap) { const c = String(x['公司代號']).trim(); const s = m.get(c); if (s) s.shares = num(x['已發行普通股數或TDR原股發行股數']); } } catch {}
  try { const tp = await fetchJson('https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes'); for (const x of tp) { const c = String(x.SecuritiesCompanyCode).trim(); if (isCommon(c) && !m.has(c)) { const cap = num(x.Capitals); m.set(c, { close: num(x.Close), shares: cap != null ? cap / 10 : null }); } } } catch {}
  return m;
}

// 月營收年增率(YoY):TWSE 上市 + TPEX 上櫃
async function fetchRevenue() {
  const m = new Map(); let ym = null;
  const add = (arr) => { for (const x of arr) { const c = String(x['公司代號']).trim(); if (!isCommon(c)) continue; if (!ym) ym = String(x['資料年月']); const yoy = num(x['營業收入-去年同月增減(%)']); m.set(c, yoy == null ? null : Math.round(yoy * 10) / 10); } };
  try { add(await fetchJson('https://openapi.twse.com.tw/v1/opendata/t187ap05_L')); } catch (e) { process.stderr.write('TWSE 營收失敗 ' + e.message + '\n'); }
  try { add(await fetchJson('https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap05_O')); } catch (e) { process.stderr.write('TPEX 營收失敗 ' + e.message + '\n'); }
  const rocToIso = (r) => r && r.length >= 5 ? `${parseInt(r.slice(0, r.length - 2), 10) + 1911}-${r.slice(-2)}` : null;
  return { ym: rocToIso(ym), map: m };
}

async function main() {
  const data = JSON.parse(await readFile(FILE, 'utf8'));
  const [tdcc, pc, rev] = await Promise.all([fetchTDCC(), fetchPriceCap(), fetchRevenue()]);
  if (!tdcc.date) throw new Error('TDCC 無資料');
  const weekExists = data.wdates.includes(tdcc.date);
  let changed = false;

  // 營收 YoY(每月更新;月份有變才算「變更」需寫檔)
  if (rev.ym && data.rev_month !== rev.ym) { data.rev_month = rev.ym; changed = true; }
  for (const [code, s] of Object.entries(data.stocks)) {
    const y = rev.map.get(code);
    if (y !== undefined) s.revYoY = y; else if (!('revYoY' in s)) s.revYoY = null;
  }

  if (!weekExists) {
    changed = true;
    const month = tdcc.date.slice(0, 7);
    const newMonth = month !== data.mdates.at(-1);
    data.wdates.push(tdcc.date);
    if (newMonth) data.mdates.push(month);
    const wi = data.wdates.length - 1;
    for (const [code, s] of Object.entries(data.stocks)) {
      while (s.big400.length < wi) { s.big400.push(null); s.big1000.push(null); }
      const t = tdcc.by.get(code);
      s.big400.push(t ? Math.round(t.big400 * 100) / 100 : null);
      s.big1000.push(t ? Math.round(t.big1000 * 100) / 100 : null);
      const p = pc.get(code);
      if (p && p.close != null) { s.price = p.close; if (p.shares) s.mcap = Math.round(p.close * p.shares / 1e8); }
      const closeVal = (p && p.close != null) ? p.close : (s.close.at(-1) ?? null);
      const holdVal = t ? t.holders : (s.holders.at(-1) ?? null);
      if (newMonth) { s.close.push(closeVal); s.holders.push(holdVal); }
      else { if (s.close.length) s.close[s.close.length - 1] = closeVal; if (s.holders.length) s.holders[s.holders.length - 1] = holdVal; }
    }
    if (data.wdates.length > MAX_WEEKS) { const drop = data.wdates.length - MAX_WEEKS; data.wdates.splice(0, drop); for (const s of Object.values(data.stocks)) { s.big400.splice(0, drop); s.big1000.splice(0, drop); } }
    if (data.mdates.length > MAX_MONTHS) { const drop = data.mdates.length - MAX_MONTHS; data.mdates.splice(0, drop); for (const s of Object.values(data.stocks)) { s.close.splice(0, drop); s.holders.splice(0, drop); } }
  }

  if (!changed) { process.stderr.write(`本週 ${tdcc.date} 已存在、營收月份未變,略過。\n`); return; }
  data.updated_at = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Taipei' }).replace(' ', 'T') + '+08:00';
  await writeFile(FILE, JSON.stringify(data), 'utf8');
  process.stderr.write(`完成:${weekExists ? '僅更新營收' : '新增週別 ' + tdcc.date}(營收月 ${data.rev_month}),共 ${Object.keys(data.stocks).length} 檔。\n`);
}
main().catch((e) => { console.error('更新失敗:', e); process.exit(1); });
