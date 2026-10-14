"use strict";

// Fixed categorical order; a stock keeps its color however the selection changes.
const SERIES_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"];
const OTHER_COLOR = "#98a2b3";

const els = {
  filters: $("filters"),
  inputDir: $("input-dir"),
  product: $("product"),
  lower: $("lower"),
  upper: $("upper"),
  date: $("date"),
  datePrev: $("date-prev"),
  dateNext: $("date-next"),
  formStatus: $("form-status"),
  serverStatus: $("server-status"),
  progress: $("scan-progress"),
  stockList: $("stock-list"),
  stocksAll: $("stocks-all"),
  stocksNone: $("stocks-none"),
  empty: $("compare-empty"),
  body: $("compare-body"),
  headlineTitle: $("headline-title"),
  headlineSub: $("headline-sub"),
  headlineBest: $("headline-best"),
  rankTitle: $("rank-title"),
  rankList: $("rank-list"),
  legend: $("trend-legend"),
  trendWrap: $("trend-wrap"),
  chart: $("trend-chart"),
  tip: $("trend-tip"),
  table: $("detail-table"),
};

const state = {
  defaults: null,
  token: 0,          // bumps on every reload, cancelling stale polls
  model: null,       // /api/compare response
  index: new Map(),  // "lower|upper" -> Map(stock_id -> Map(date -> rate))
  stockIds: [],
  selected: new Set(),
  lower: null,
  upper: null,
  date: null,
  wanted: {},        // selection requested by the URL, applied once after loading
};

const fmtPct = (value) => `${Number(value).toFixed(2)}%`;
const fmtBound = (value) => `${Number(value) % 1 ? Number(value).toFixed(1) : Number(value).toFixed(0)}%`;
const comboKey = (lower, upper) => `${lower}|${upper}`;

function setStatus(text, kind = "") {
  els.formStatus.textContent = text;
  els.formStatus.className = `status ${kind}`;
}

function stockColor(id) {
  const i = state.stockIds.indexOf(id);
  return i >= 0 && i < SERIES_COLORS.length ? SERIES_COLORS[i] : OTHER_COLOR;
}

function stockLabel(id) {
  return `${id} ${state.model.stocks[id] || ""}`.trim();
}

/* ---------- Loading ---------- */

async function reload() {
  const dir = els.inputDir.value.trim();
  const product = currentProduct();
  const token = ++state.token;
  setStatus("");
  els.body.hidden = true;
  els.empty.hidden = false;
  els.empty.textContent = "讀取報價中…";
  try {
    // Parsing a new directory can take a while: show progress until the scan settles.
    for (;;) {
      const scan = await api(`/api/scan?${query({ dir })}`);
      if (token !== state.token) return;
      els.progress.hidden = !scan.running;
      els.progress.querySelector(".bar").style.width = scan.total ? `${(scan.done / scan.total) * 100}%` : "0";
      els.progress.querySelector(".label").textContent = `解析 PDF 內容 ${scan.done} / ${scan.total}`;
      if (!scan.running) break;
      await new Promise((resolve) => setTimeout(resolve, 800));
    }
    const model = await api(`/api/compare?${query({ dir, product })}`);
    if (token !== state.token) return;
    setModel(model);
  } catch (error) {
    if (token !== state.token) return;
    els.progress.hidden = true;
    state.model = null;
    els.stockList.innerHTML = "";
    els.empty.textContent = error.message;
    setStatus(error.message, "error");
  }
}

function setModel(model) {
  state.model = model;
  state.stockIds = Object.keys(model.stocks);
  state.index = new Map();
  model.quotes.forEach(([stock, date, lower, upper, rate]) => {
    const key = comboKey(lower, upper);
    if (!state.index.has(key)) state.index.set(key, new Map());
    const byStock = state.index.get(key);
    if (!byStock.has(stock)) byStock.set(stock, new Map());
    byStock.get(stock).set(date, rate);
  });

  const wanted = state.wanted;
  state.wanted = {};
  const wantedStocks = wanted.stocks ? wanted.stocks.filter((id) => model.stocks[id]) : [];
  state.selected = new Set(wantedStocks.length ? wantedStocks : state.stockIds);

  if (!model.quotes.length) {
    els.empty.textContent = "此目錄沒有這個商品的報價。";
    els.lower.innerHTML = els.upper.innerHTML = els.date.innerHTML = "";
    renderStocks();
    return;
  }
  const [lower, upper] = pickCombo(wanted.lower, wanted.upper);
  state.lower = lower;
  state.upper = upper;
  state.date = wanted.date || null;
  render();
}

/* ---------- Selection helpers ---------- */

function combos() {
  return [...state.index.keys()].map((key) => key.split("|").map(Number));
}

function comboStocks(lower, upper) {
  return state.index.get(comboKey(lower, upper)) || new Map();
}

// Prefers the requested combo, then the one quoted for the most stocks.
function pickCombo(lower, upper) {
  const all = combos();
  const exact = all.find(([l, u]) => l === Number(lower) && u === Number(upper));
  if (exact) return exact;
  const sameLower = all.filter(([l]) => l === Number(lower));
  const pool = sameLower.length ? sameLower : all;
  const score = ([l, u]) => {
    const byStock = comboStocks(l, u);
    let quotes = 0;
    byStock.forEach((dates) => { quotes += dates.size; });
    return byStock.size * 1e6 + quotes;
  };
  return pool.reduce((best, combo) => {
    if (!best) return combo;
    // Within the same lower bound, stay closest to the previous upper bound.
    if (sameLower.length && upper != null) {
      return Math.abs(combo[1] - upper) < Math.abs(best[1] - upper) ? combo : best;
    }
    return score(combo) > score(best) ? combo : best;
  }, null);
}

// Dates on which at least one selected stock has a quote for the current combo.
function comboDates() {
  const dates = new Set();
  comboStocks(state.lower, state.upper).forEach((byDate, stock) => {
    if (state.selected.has(stock)) byDate.forEach((_, date) => dates.add(date));
  });
  return [...dates].sort();
}

function currentProduct() {
  const checked = els.product.querySelector("input:checked");
  return checked ? checked.value : (state.defaults ? state.defaults.product : "fcn");
}

/* ---------- Rendering ---------- */

function render() {
  if (!state.model || !state.model.quotes.length) { renderStocks(); return; }
  const dates = comboDates();
  if (!dates.includes(state.date)) state.date = dates[dates.length - 1] || null;
  renderControls(dates);
  renderStocks();
  syncUrl();
  if (!state.selected.size || !state.date) {
    els.body.hidden = true;
    els.empty.hidden = false;
    els.empty.textContent = state.selected.size ? "所選股票在這個下限 / 上限沒有報價。" : "請至少勾選一檔股票。";
    return;
  }
  els.body.hidden = false;
  els.empty.hidden = true;
  renderHeadline();
  renderRanking();
  renderTrend(dates);
  renderTable(dates);
}

function renderControls(dates) {
  const all = combos();
  const stocksFor = (pairs) => {
    const ids = new Set();
    pairs.forEach(([l, u]) => comboStocks(l, u).forEach((_, id) => ids.add(id)));
    return ids.size;
  };
  const lowers = [...new Set(all.map(([l]) => l))].sort((a, b) => a - b);
  els.lower.innerHTML = lowers.map((l) => {
    const n = stocksFor(all.filter(([x]) => x === l));
    return `<option value="${l}">${fmtBound(l)}（${n} 檔）</option>`;
  }).join("");
  els.lower.value = String(state.lower);

  const uppers = all.filter(([l]) => l === state.lower).map(([, u]) => u).sort((a, b) => a - b);
  els.upper.innerHTML = uppers.map((u) => {
    const n = comboStocks(state.lower, u).size;
    return `<option value="${u}">${fmtBound(u)}（${n} 檔）</option>`;
  }).join("");
  els.upper.value = String(state.upper);

  const byStock = comboStocks(state.lower, state.upper);
  els.date.innerHTML = [...dates].reverse().map((date) => {
    let n = 0;
    byStock.forEach((byDate, id) => { if (state.selected.has(id) && byDate.has(date)) n += 1; });
    return `<option value="${date}">${date}（${n} 檔）</option>`;
  }).join("");
  els.date.value = state.date || "";
  const i = dates.indexOf(state.date);
  els.datePrev.disabled = i <= 0;
  els.dateNext.disabled = i < 0 || i >= dates.length - 1;
}

function renderStocks() {
  if (!state.model) return;
  const byStock = comboStocks(state.lower, state.upper);
  els.stockList.innerHTML = state.stockIds.map((id) => {
    const quoted = byStock.has(id);
    const checked = state.selected.has(id) ? " checked" : "";
    const count = quoted ? `${byStock.get(id).size} 個報價日` : "無此上下限";
    return `<li class="${quoted ? "" : "dim"}"><label class="check">
      <input type="checkbox" value="${escapeHtml(id)}"${checked}>
      <i class="sw" style="background:${stockColor(id)}"></i>
      <span class="stock-name">${escapeHtml(stockLabel(id))}</span>
      <span class="muted">${count}</span></label></li>`;
  }).join("") || '<li class="empty">沒有股票</li>';
}

// [{id, rate}] for the selected date, highest first; stocks without a quote that day last.
function rankingFor(date) {
  const byStock = comboStocks(state.lower, state.upper);
  const rows = state.stockIds.filter((id) => state.selected.has(id)).map((id) => {
    const byDate = byStock.get(id);
    return { id, rate: byDate && byDate.has(date) ? byDate.get(date) : null };
  });
  return rows.sort((a, b) => (b.rate ?? -Infinity) - (a.rate ?? -Infinity) || a.id.localeCompare(b.id));
}

function latestBefore(id, date) {
  const byDate = comboStocks(state.lower, state.upper).get(id);
  if (!byDate) return null;
  const earlier = [...byDate.keys()].filter((d) => d < date).sort();
  const last = earlier[earlier.length - 1];
  return last ? { date: last, rate: byDate.get(last) } : null;
}

function renderHeadline() {
  const product = state.defaults.products.find((p) => p.code === state.model.product);
  els.headlineTitle.textContent = `${product ? product.label : ""} 下限 ${fmtBound(state.lower)} / 上限 ${fmtBound(state.upper)}`;
  els.headlineSub.textContent = `報價日 ${state.date}・比較 ${state.selected.size} 檔股票`;
  const [best] = rankingFor(state.date);
  els.headlineBest.innerHTML = best && best.rate != null
    ? `<span class="muted">最高利率</span><strong>${fmtPct(best.rate)}</strong><span>${escapeHtml(stockLabel(best.id))}</span>`
    : "";
}

function renderRanking() {
  const rows = rankingFor(state.date);
  const quoted = rows.filter((r) => r.rate != null);
  const top = quoted.length ? quoted[0].rate : 0;
  const max = Math.max(...quoted.map((r) => r.rate), 1);
  els.rankTitle.textContent = `${state.date} 利率排名`;
  els.rankList.innerHTML = rows.map((r, i) => {
    const name = `<span class="rank-name"><i class="sw" style="background:${stockColor(r.id)}"></i>${escapeHtml(stockLabel(r.id))}</span>`;
    if (r.rate == null) {
      const prev = latestBefore(r.id, state.date);
      const note = prev ? `此日無報價（前次 ${prev.date}：${fmtPct(prev.rate)}）` : "此日無報價";
      return `<li class="rank-row missing">${name}<span class="rank-note">${escapeHtml(note)}</span></li>`;
    }
    const diff = i === 0 ? '<span class="rank-best">最高</span>' : `<span class="rank-diff">−${(top - r.rate).toFixed(2)}</span>`;
    return `<li class="rank-row">${name}
      <span class="rank-bar"><span style="width:${(r.rate / max) * 100}%;background:${stockColor(r.id)}"></span></span>
      <span class="rank-value">${fmtPct(r.rate)}</span>${diff}</li>`;
  }).join("");
}

function niceTicks(min, max, count = 5) {
  if (min === max) { min -= 1; max += 1; }
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  const ticks = [];
  for (let v = Math.floor(min / step) * step; v <= max + step * 1e-9; v += step) ticks.push(Number(v.toFixed(6)));
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}

function renderTrend(dates) {
  const ids = state.stockIds.filter((id) => state.selected.has(id) && comboStocks(state.lower, state.upper).has(id));
  const byStock = comboStocks(state.lower, state.upper);
  els.legend.innerHTML = ids.map((id) =>
    `<span><i class="sw" style="background:${stockColor(id)}"></i>${escapeHtml(stockLabel(id))}</span>`).join("");

  const width = Math.max(320, els.trendWrap.clientWidth);
  const height = 300;
  const directLabels = ids.length <= 4;
  const pad = { top: 16, right: directLabels ? 96 : 20, bottom: 36, left: 52 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const rates = [];
  ids.forEach((id) => byStock.get(id).forEach((rate, date) => { if (dates.includes(date)) rates.push(rate); }));
  const ticks = niceTicks(Math.min(...rates), Math.max(...rates));
  const yMin = ticks[0];
  const yMax = ticks[ticks.length - 1];
  const x = (i) => pad.left + (dates.length === 1 ? plotW / 2 : (i / (dates.length - 1)) * plotW);
  const y = (v) => pad.top + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

  const parts = [];
  ticks.forEach((t) => {
    parts.push(`<line class="grid" x1="${pad.left}" x2="${pad.left + plotW}" y1="${y(t)}" y2="${y(t)}"/>`);
    parts.push(`<text class="tick" x="${pad.left - 8}" y="${y(t) + 4}" text-anchor="end">${t}%</text>`);
  });
  parts.push(`<line class="axis" x1="${pad.left}" x2="${pad.left + plotW}" y1="${pad.top + plotH}" y2="${pad.top + plotH}"/>`);
  const every = Math.max(1, Math.ceil(dates.length / Math.max(1, Math.floor(plotW / 78))));
  dates.forEach((date, i) => {
    if (i % every && i !== dates.length - 1) return;
    parts.push(`<text class="tick" x="${x(i)}" y="${pad.top + plotH + 20}" text-anchor="middle">${date.slice(5)}</text>`);
  });
  const si = dates.indexOf(state.date);
  if (si >= 0) parts.push(`<line class="selected-date" x1="${x(si)}" x2="${x(si)}" y1="${pad.top}" y2="${pad.top + plotH}"/>`);

  const labels = [];
  ids.forEach((id) => {
    const color = stockColor(id);
    const pts = dates.map((date, i) => (byStock.get(id).has(date) ? [x(i), y(byStock.get(id).get(date))] : null)).filter(Boolean);
    if (pts.length > 1) {
      parts.push(`<polyline class="series-line" stroke="${color}" points="${pts.map((p) => p.join(",")).join(" ")}"/>`);
    }
    pts.forEach(([px, py]) => parts.push(`<circle class="series-dot" cx="${px}" cy="${py}" r="4" fill="${color}"/>`));
    // Only lines that reach the last date get a label at the right edge; the legend covers the rest.
    if (directLabels && byStock.get(id).has(dates[dates.length - 1])) labels.push({ y: pts[pts.length - 1][1], id });
  });
  // Direct labels at each line's last point, nudged apart so they never overlap.
  labels.sort((a, b) => a.y - b.y).forEach((label, i, all) => {
    if (i && label.y - all[i - 1].y < 14) label.y = all[i - 1].y + 14;
    parts.push(`<text class="direct-label" x="${pad.left + plotW + 10}" y="${label.y + 4}">${escapeHtml(stockLabel(label.id))}</text>`);
  });
  parts.push(`<line id="crosshair" class="crosshair" y1="${pad.top}" y2="${pad.top + plotH}" visibility="hidden"/>`);
  parts.push(`<rect id="hit-area" x="${pad.left - 10}" y="${pad.top}" width="${plotW + 20}" height="${plotH}" fill="transparent"/>`);

  els.chart.setAttribute("viewBox", `0 0 ${width} ${height}`);
  els.chart.setAttribute("width", width);
  els.chart.setAttribute("height", height);
  els.chart.innerHTML = parts.join("");

  const nearest = (event) => {
    const box = els.chart.getBoundingClientRect();
    const px = ((event.clientX - box.left) / box.width) * width;
    let best = 0;
    dates.forEach((_, i) => { if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i; });
    return best;
  };
  const hit = $("hit-area");
  const crosshair = $("crosshair");
  hit.addEventListener("mousemove", (event) => {
    const i = nearest(event);
    crosshair.setAttribute("x1", x(i));
    crosshair.setAttribute("x2", x(i));
    crosshair.setAttribute("visibility", "visible");
    const rows = ids.map((id) => ({ id, rate: byStock.get(id).get(dates[i]) }))
      .filter((r) => r.rate != null).sort((a, b) => b.rate - a.rate);
    els.tip.innerHTML = `<strong>${dates[i]}</strong>` + (rows.map((r) =>
      `<div><i class="sw" style="background:${stockColor(r.id)}"></i>${escapeHtml(stockLabel(r.id))}<b>${fmtPct(r.rate)}</b></div>`).join("")
      || "<div class=\"muted\">無報價</div>");
    els.tip.hidden = false;
    const box = els.trendWrap.getBoundingClientRect();
    const left = (x(i) / width) * els.chart.getBoundingClientRect().width;
    const flip = left > box.width - 220;
    els.tip.style.left = flip ? "auto" : `${left + 14}px`;
    els.tip.style.right = flip ? `${box.width - left + 14}px` : "auto";
  });
  hit.addEventListener("mouseleave", () => {
    crosshair.setAttribute("visibility", "hidden");
    els.tip.hidden = true;
  });
  hit.addEventListener("click", (event) => selectDate(dates[nearest(event)]));
}

function renderTable(dates) {
  const ids = state.stockIds.filter((id) => state.selected.has(id));
  const byStock = comboStocks(state.lower, state.upper);
  const head = `<thead><tr><th>報價日</th>${ids.map((id) =>
    `<th><i class="sw" style="background:${stockColor(id)}"></i>${escapeHtml(stockLabel(id))}</th>`).join("")}</tr></thead>`;
  const body = [...dates].reverse().map((date) => {
    const rates = ids.map((id) => (byStock.has(id) ? byStock.get(id).get(date) : undefined));
    const top = Math.max(...rates.filter((r) => r != null));
    const cells = rates.map((r) => (r == null ? '<td class="na">—</td>'
      : `<td class="${r === top ? "best" : ""}">${fmtPct(r)}</td>`)).join("");
    return `<tr data-date="${date}" class="${date === state.date ? "selected" : ""}"><th>${date}</th>${cells}</tr>`;
  }).join("");
  els.table.innerHTML = head + `<tbody>${body}</tbody>`;
}

/* ---------- State changes ---------- */

function selectDate(date) {
  state.date = date;
  render();
}

function syncUrl() {
  const params = {
    dir: els.inputDir.value.trim(),
    product: currentProduct(),
    lower: state.lower,
    upper: state.upper,
    date: state.date || "",
  };
  if (state.selected.size !== state.stockIds.length) params.stocks = [...state.selected].join(",");
  history.replaceState(null, "", `?${query(params)}`);
}

let resizeTimer = 0;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (state.model && !els.body.hidden) renderTrend(comboDates()); }, 150);
});

async function init() {
  try {
    state.defaults = await api("/api/defaults");
  } catch (error) {
    els.serverStatus.textContent = `無法連線本機伺服器：${error.message}`;
    return;
  }
  els.serverStatus.textContent = "本機伺服器已連線";

  const params = new URLSearchParams(location.search);
  const product = params.get("product") || state.defaults.product;
  els.product.innerHTML = state.defaults.products.map((p) => `<label class="segment">
      <input type="radio" name="product" value="${escapeHtml(p.code)}"${p.code === product ? " checked" : ""}>
      <span>${escapeHtml(p.label)}<small>${escapeHtml(p.product_type)}</small></span></label>`).join("");
  if (!els.product.querySelector("input:checked")) els.product.querySelector("input").checked = true;
  els.inputDir.value = params.get("dir") || state.defaults.input_dir;
  state.wanted = {
    lower: params.get("lower"),
    upper: params.get("upper"),
    date: params.get("date"),
    stocks: params.get("stocks") ? params.get("stocks").split(",") : null,
  };

  els.filters.addEventListener("submit", (event) => { event.preventDefault(); reload(); });
  els.product.addEventListener("change", () => {
    // Keep the same bounds and date when switching product, if they exist there.
    state.wanted = { lower: state.lower, upper: state.upper, date: state.date };
    reload();
  });
  els.lower.addEventListener("change", () => {
    [state.lower, state.upper] = pickCombo(els.lower.value, state.upper);
    render();
  });
  els.upper.addEventListener("change", () => {
    state.upper = Number(els.upper.value);
    render();
  });
  els.date.addEventListener("change", () => selectDate(els.date.value));
  const step = (delta) => {
    const dates = comboDates();
    const next = dates[dates.indexOf(state.date) + delta];
    if (next) selectDate(next);
  };
  els.datePrev.addEventListener("click", () => step(-1));
  els.dateNext.addEventListener("click", () => step(1));
  els.stockList.addEventListener("change", (event) => {
    const box = event.target.closest("input[type=checkbox]");
    if (!box) return;
    if (box.checked) state.selected.add(box.value); else state.selected.delete(box.value);
    render();
  });
  els.stocksAll.addEventListener("click", () => { state.selected = new Set(state.stockIds); render(); });
  els.stocksNone.addEventListener("click", () => { state.selected = new Set(); render(); });
  els.table.addEventListener("click", (event) => {
    const row = event.target.closest("tr[data-date]");
    if (row) selectDate(row.dataset.date);
  });

  reload();
}

init();
