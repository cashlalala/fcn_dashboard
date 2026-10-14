# Cathay FCN 2330 Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a self-contained folder that parses Cathay FCN PDF quotes for 2330, exports Excel, and creates a clickable HTML rate-trend dashboard.

**Architecture:** A single Python generator owns PDF extraction, data normalization, Excel export, and static HTML rendering. Tests live beside the generator and validate the data model plus generated HTML behavior hooks. The HTML embeds its data as JSON and draws trends with local SVG/JavaScript, so it can be opened directly without a server.

**Tech Stack:** Python 3, `pdfplumber`, `pandas`, `openpyxl`, standard-library `unittest`, static HTML/CSS/JavaScript.

---

### Task 1: Dashboard Data Model Tests

**Files:**
- Create: `cathay_fcn_2330_dashboard/tests/test_generate_cathay_fcn_dashboard.py`
- Create later: `cathay_fcn_2330_dashboard/generate_cathay_fcn_dashboard.py`

- [x] **Step 1: Write failing tests**

Tests cover quote-line parsing, 2330-only FCN dashboard model generation, and HTML containing embedded JSON plus click-handler hooks.

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m unittest discover -s cathay_fcn_2330_dashboard/tests`

Expected: fail because `generate_cathay_fcn_dashboard.py` does not exist yet.

### Task 2: Generator Implementation

**Files:**
- Create: `cathay_fcn_2330_dashboard/generate_cathay_fcn_dashboard.py`

- [ ] **Step 1: Implement parser and dashboard model**

Functions:
- `parse_effective_period(text)`
- `parse_quote_line(line, quote_start_date, quote_end_date, source_file)`
- `build_dashboard_model(rows, stock_id="2330", product_type="固定配息率觸及型")`

- [ ] **Step 2: Implement exports**

Functions:
- `write_excel(rows, model, output_path)`
- `render_html(model)`
- `write_outputs(input_dir, output_dir, stock_id)`

### Task 3: Documentation

**Files:**
- Create: `cathay_fcn_2330_dashboard/README.md`

- [ ] **Step 1: Document usage**

Include commands for regenerating outputs, source PDF path, output file descriptions, and interpretation of bounds/date/rate fields.

### Task 4: Verification

**Files:**
- Output: `cathay_fcn_2330_dashboard/output/2330_fcn_dashboard.html`
- Output: `cathay_fcn_2330_dashboard/output/cathay_fcn_2330_rates.xlsx`

- [ ] **Step 1: Run tests**

Run: `python -m unittest discover -s cathay_fcn_2330_dashboard/tests`

- [ ] **Step 2: Generate outputs**

Run: `python cathay_fcn_2330_dashboard/generate_cathay_fcn_dashboard.py`

- [ ] **Step 3: Verify browser interaction**

Open the HTML locally, click a bounds row, and confirm the chart title and SVG trend update.
