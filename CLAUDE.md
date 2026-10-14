# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Parses Cathay Securities (國泰證券) FCN/ELN quote PDFs and, for one stock, produces an interactive static HTML rate-trend dashboard plus an Excel workbook. Docs and UI text are in Traditional Chinese.

This directory is its own git repo nested inside `d:\ws_stock` (the parent repo ignores it). `output/` is generated and git-ignored.

## Commands

Run from this directory:

```powershell
pip install -r requirements.txt

# Generate output/{stock_id}_{product}_dashboard.html and output/cathay_fcn_{stock_id}_rates.xlsx
python generate_cathay_fcn_dashboard.py --stock-id 2330
# Optional: --input-dir <pdf folder> (default C:\Users\cash\OneDrive\國泰fcn報價), --output-dir <dir> (default ./output),
#           --product fcn|eln (default fcn)

# All tests
python -m unittest discover -s tests

# Single test
python -m unittest discover -s tests -k test_parse_quote_line_normalizes_percent_values
```

No linter or build step is configured.

## Architecture

Everything lives in `generate_cathay_fcn_dashboard.py`, a pipeline of plain functions passing `list[dict]` rows and a `model` dict:

1. **Extraction**: `extract_rows` reads every `*.pdf` in the input dir with `pdfplumber`, concatenates page text, and:
   - `parse_effective_period` takes the quote date from the PDF body's `有效期間：start ~ end` (falls back to `有效至` end date). The filename date is never used.
   - `parse_quote_line` matches each text line against `QUOTE_LINE_RE`, a whitespace-delimited column layout. If Cathay changes the PDF table columns, this regex is the thing to update.
2. **Model**: `build_dashboard_model(rows, stock_id, product_type="固定配息率觸及型")` filters to one stock and product type, groups by (`lower_bound_pct`, `upper_bound_pct`), takes the **max** coupon rate when a combination has several quotes on the same date, and emits `series[]` of `[date, rate]` points. Missing dates are not filled in.
3. **Excel**: `write_excel` builds pivots with `build_pivot` for both FCN (`固定配息率觸及型`) and ELN (`上限型`), plus Summary and raw detail sheets. `format_excel` then restyles them with openpyxl. Sheet names are prefixed with the stock id.
4. **Products**: `PRODUCTS` maps the short code (`fcn`/`eln`, used in `--product` and output file names) to the PDF product type and display label. `write_outputs` raises `NoQuotesError` without writing anything when the stock has no quotes for the chosen product.
5. **HTML**: `render_html(model)` returns one self-contained page. The model is embedded as JSON in `<script id="dashboard-data">` and charted with hand-written SVG/JS (no external libraries or server). The template is a Python f-string, so all literal JS/CSS braces must be doubled (`{{ }}`).

## Web UI

`web_server.py` is a stdlib `ThreadingHTTPServer` (127.0.0.1 only, Host header checked) that serves the static frontend in `web/` (no build step: `index.html` + `app.js` for generating dashboards, `compare.html` + `compare.js` for comparing coupon rates across stocks at one lower/upper bound and date, shared `common.js` and `style.css`) plus a JSON API: `/api/defaults`, `/api/browse`, `/api/scan`, `/api/outputs`, `/api/compare` (all stocks' max rate per stock/date/bounds via `build_compare_model`), `POST /api/generate`, and `/output?dir=&name=` for viewing generated `.html`/`.xlsx` in an iframe. `ScanJob` parses a directory's PDFs in a `ProcessPoolExecutor`. `PdfRowCache` persists rows to `.cache/pdf_rows.json`, keyed by path, mtime, and size. Generation reuses the cached rows through `write_outputs(..., rows=rows)`. Run it with `python web_server.py`.

The tests use stdlib `unittest` and add the project dir to `sys.path`. The HTML test checks for the `dashboard-data` script id, `renderSeries`, and `data-series-index`, so keep those identifiers when editing the template.
