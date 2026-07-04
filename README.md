# 大戶籌碼 吃貨 / 倒貨 偵測器

用**集保股權分散表**觀察台股「大戶是否在低調吃貨,還是已在倒貨」。公開網頁、每週自動更新,手機/任何電腦皆可看。

## 判定邏輯
每檔股票看大戶(集保 **≥400張** 或 **≥1000張** 級距)持股比例與股東總人數的**週變化**:
- 🟢 **吃貨(籌碼集中)**:大戶持股比例上升 ＋ 股東人數下降
- 🔴 **倒貨(籌碼分散)**:大戶持股比例下降 ＋ 股東人數上升

> 門檻(400/1000張)、比較週數、市場、觀察模式皆可在網頁上調整。

## 資料來源
- **TDCC 集保戶股權分散表**(`opendata.tdcc.com.tw/getOD.ashx?id=1-5`)— 免費、一次全市場、**每週更新**。
- 股名/市場別:TWSE 與 TPEX OpenAPI。

## 重要限制
- **每週一筆**:官方免費只給「最新一週」,故本工具**每週累積快照**;需累積約 4–6 週,吃貨/倒貨趨勢才完整。第一週僅顯示大戶持股現況。
- 集保級距**未區分**外資託管 / 公司內部人 / 大額散戶(例:台積電千張大戶占比多為外資託管),所以看**變化**比看絕對值更有意義。

## 架構
Node(零依賴)+ 每週 GitHub Actions 抓 TDCC → 累積 `docs/data.json` → GitHub Pages 靜態網頁前端計算與呈現。

## 本機開發
```bash
node scripts/build-data.mjs   # 抓本週 TDCC,累積寫入 docs/data.json
node scripts/serve.mjs        # http://localhost:8090 預覽
```

## 部署(GitHub Pages)
1. push 到 GitHub repo。
2. Settings → Pages:來源 `main`(或 `master`)分支 `/docs`。
3. Settings → Actions → Workflow permissions:Read and write。
4. Actions 手動觸發一次,之後每週自動更新。

## 免責
僅供研究參考,**非投資建議**。
