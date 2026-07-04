// 把指定個股的「週歷史大戶資料」(來源 twsthr)回補進 docs/data.json。
// twsthr 的 >400張/>1000張 是「週」序列,對齊其「週軸」(YYYYMMDD);股東人數為月頻,依月補到各週。
// 最後一週即官方 TDCC 當週,數值與官方吻合(接縫無跳動)。其他股票該歷史週補 null。
// 用法: node scripts/backfill_watchlist.mjs 5328 2374 3591 1714
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FILE = join(__dirname, '..', 'docs', 'data.json');
const WEEKS_N = 16;                // 回補最近幾週(約 4 個月)
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' };
const codes = process.argv.slice(2);
if (!codes.length) { console.error('用法: node backfill_watchlist.mjs <代號...>'); process.exit(1); }

const iso = (ymd) => `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
const seriesByName = (h, name) => { const m = h.match(new RegExp("\\[([\\d.,\\s-]+)\\]\\s*,\\s*name:\\s*'" + name.replace(/[()]/g, '\\$&') + "'")); return m ? m[1].split(',').map((x) => { const n = parseFloat(x.trim()); return Number.isNaN(n) ? null : n; }) : null; };

async function fetchThr(code) {
  const h = await (await fetch(`https://norway.twsthr.info/StockHolders.aspx?stock=${code}`, { headers: UA })).text();
  const allCats = [...h.matchAll(/categories:\s*\[([^\]]*)\]/g)].map((m) => m[1].split(',').map((s) => s.replace(/[^0-9-]/g, '')));
  const weekAxis = allCats.find((a) => a[0] && /^\d{8}$/.test(a[0]));        // 週軸 YYYYMMDD
  const monthAxis = allCats.find((a) => a[0] && /^\d{4}-\d{2}$/.test(a[0])); // 月軸 YYYY-MM
  const big400 = seriesByName(h, '大股東持有率(>400張)');
  const big1000 = seriesByName(h, '大股東持有率(>1000張)');
  const holdersM = seriesByName(h, '總股東人數');
  if (!weekAxis || !big400 || !big1000) return null;
  const N = Math.min(WEEKS_N, weekAxis.length);
  const weeks = weekAxis.slice(-N).map(iso);
  const b4 = big400.slice(-N), b1 = big1000.slice(-N);
  // 股東人數:依該週所屬月份,取月頻值(超出月軸則用最後一個月)
  const hold = weekAxis.slice(-N).map((ymd) => {
    if (!monthAxis || !holdersM) return null;
    const mon = `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}`;
    let i = monthAxis.indexOf(mon);
    if (i < 0) i = holdersM.length - 1;
    return holdersM[i] ?? null;
  });
  return { weeks, big400: b4, big1000: b1, holders: hold };
}

async function main() {
  const data = JSON.parse(await readFile(FILE, 'utf8'));
  const oldWeeks = data.weeks;
  const stocks = data.stocks;

  const fetched = new Map();
  const weekSet = new Set();
  for (const code of codes) {
    try {
      const t = await fetchThr(code);
      if (!t) { console.error(`${code}: 抓不到,略過`); continue; }
      t.weeks.forEach((w) => weekSet.add(w));
      fetched.set(code, t);
      console.error(`${code}: ${t.weeks.length} 週 (${t.weeks[0]} ~ ${t.weeks[t.weeks.length - 1]}),最新 400張=${t.big400.at(-1)} 1000張=${t.big1000.at(-1)}`);
    } catch (e) { console.error(`${code}: ${e.message}`); }
    await new Promise((r) => setTimeout(r, 800));
  }
  if (!weekSet.size) { console.error('無回補資料'); process.exit(1); }

  const newWeeks = [...new Set([...weekSet, ...oldWeeks])].sort();

  // 舊值查表
  const oldIndex = new Map();
  for (const [code, s] of Object.entries(stocks)) {
    const m = {}; oldWeeks.forEach((w, i) => { m[w] = { b4: s.big400[i], b1: s.big1000[i], h: s.holders[i] }; });
    oldIndex.set(code, m);
  }
  for (const [code, s] of Object.entries(stocks)) {
    const old = oldIndex.get(code);
    const fb = fetched.get(code);
    const fbMap = {};
    if (fb) fb.weeks.forEach((w, i) => { fbMap[w] = { b4: fb.big400[i], b1: fb.big1000[i], h: fb.holders[i] }; });
    const b400 = [], b1000 = [], hold = [];
    for (const w of newWeeks) {
      const o = old[w], f = fbMap[w];
      const pick = (o && o.b4 != null) ? o : f;  // 官方週別優先,否則 twsthr
      b400.push(pick ? pick.b4 ?? null : null);
      b1000.push(pick ? pick.b1 ?? null : null);
      hold.push(pick ? pick.h ?? null : null);
    }
    s.big400 = b400; s.big1000 = b1000; s.holders = hold;
  }

  data.weeks = newWeeks;
  if (!/twsthr/.test(data.note)) data.note += '(部分個股已用 twsthr 週歷史回補)';
  await writeFile(FILE, JSON.stringify(data), 'utf8');
  console.error(`完成:時間軸 ${newWeeks.length} 期 (${newWeeks[0]} ~ ${newWeeks.at(-1)}),回補 ${fetched.size} 檔`);
}
main().catch((e) => { console.error(e); process.exit(1); });
