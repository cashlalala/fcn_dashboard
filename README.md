# 國泰 2330 FCN 報價整理工具

這個目錄是一個獨立整理包，用來讀取國泰證券 FCN/ELN PDF 報價，並針對 `2330 台積電` 產生：

- `output/2330_fcn_dashboard.html`（ELN 為 `2330_eln_dashboard.html`）：互動式 HTML，可點擊不同「履約價 / 上限價」查看年化配息率趨勢。
- `output/cathay_fcn_2330_rates.xlsx`：Excel 整理表，保留 pivot 與明細。

## 目錄內容

- `generate_cathay_fcn_dashboard.py`：主要產生器，負責 PDF 解析、資料整理、Excel 匯出與 HTML 產生。
- `tests/test_generate_cathay_fcn_dashboard.py`：解析與 HTML 結構測試。
- `output/`：產生後的 HTML 與 Excel。
- `PLAN.md`：實作規劃與驗證步驟。

## 使用方式

在 `d:\ws_stock` 執行：

```powershell
python cathay_fcn_2330_dashboard\generate_cathay_fcn_dashboard.py
```

預設讀取 PDF 來源：

```text
C:\Users\cash\OneDrive\國泰fcn報價
```

如果來源或輸出位置不同，可以指定參數：

```powershell
python cathay_fcn_2330_dashboard\generate_cathay_fcn_dashboard.py --input-dir "C:\Users\cash\OneDrive\國泰fcn報價" --output-dir "cathay_fcn_2330_dashboard\output" --stock-id 2330 --product fcn
```

## Web 介面

```powershell
python cathay_fcn_2330_dashboard\web_server.py
# 選用：--port 8765 --input-dir ... --output-dir ... --stock-id 2330 --product fcn --no-browser
```

啟動後會自動開啟 `http://127.0.0.1:8765/`（只監聽本機）：

- 左側參數會帶入預設值（被改過的欄位會以橘框標示），「瀏覽」可在對話框中切換目錄，「重設預設值」可還原。
- 「商品類型」可選 FCN（固定配息率觸及型）或 ELN（上限型），輸出為 `{股票}_fcn_dashboard.html` / `{股票}_eln_dashboard.html`；所選股票沒有該商品報價時會拒絕產生。
- PDF 檔案列表會依股票代號與商品類型即時高亮：綠色＝內容含該股的所選商品（會用於圖表）、橘色＝只有其他商品、灰色＝內容尚未解析完、暫以檔名比對。
- 高亮以 PDF 內容為準。首次解析會平行處理（約 10 秒），結果快取在 `.cache/pdf_rows.json`，之後只重新解析新增或變更的檔案。
- 右側分頁列出輸出目錄中已產生的儀表板，可直接切換；按「產生儀表板」後會自動切到新產生的那一頁，並提供 Excel 下載。

## HTML 操作

直接用瀏覽器打開：

```text
d:\ws_stock\cathay_fcn_2330_dashboard\output\2330_fcn_dashboard.html
```

左側是「履約價 / 上限價」清單。點擊任一組合後，右側會更新：

- 趨勢圖：顯示該組合在各報價日期的年化配息率。
- 最新值與區間：顯示最新日期、最新利率、歷史最低與最高。
- 明細表：列出該組合有資料的日期與利率。

沒有報價的日期不會補值，圖表只畫實際存在的資料點。

## 欄位說明

- `履約價(%)`：PDF 報價中的履約價百分比。
- `上限價(%)`：PDF 報價中的上限價百分比。
- `年化配息率(%)`：PDF 報價中的配息率，已整理成數字。
- `報價日期`：優先採用 PDF 內文的「有效期間」起始日，不使用檔名日期推估。

## 測試

```powershell
python -m unittest discover -s cathay_fcn_2330_dashboard\tests
```

測試涵蓋：

- PDF 表格列的百分比欄位解析。
- 只整理 `2330` 的 `固定配息率觸及型` FCN。
- HTML 是否內嵌資料並具備可點擊序列控制。
