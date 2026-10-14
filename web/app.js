"use strict";

const $ = (id) => document.getElementById(id);
const els = {
  form: $("params"),
  inputDir: $("input-dir"),
  outputDir: $("output-dir"),
  stockId: $("stock-id"),
  stockOptions: $("stock-options"),
  product: $("product"),
  generate: $("generate"),
  reset: $("reset"),
  formStatus: $("form-status"),
  serverStatus: $("server-status"),
  fileList: $("file-list"),
  matchCount: $("match-count"),
  onlyMatched: $("only-matched"),
  progress: $("scan-progress"),
  tabs: $("tabs"),
  frame: $("dashboard-frame"),
  viewerEmpty: $("viewer-empty"),
  downloadExcel: $("download-excel"),
  openNew: $("open-new"),
  dirDialog: $("dir-dialog"),
  dirCurrent: $("dir-current"),
  dirList: $("dir-list"),
  dirInfo: $("dir-info"),
};

const state = {
  defaults: null,
  pdfs: [],          // [{name, size, mtime}] in the current input dir
  scan: null,        // /api/scan status for the current input dir
  scanToken: 0,      // bumps when the input dir changes, cancelling stale polls
  outputs: [],       // dashboards in the current output dir
  activeHtml: null,  // file name of the dashboard shown in the iframe
  freshHtml: null,   // the dashboard generated in this session most recently
  dialogTarget: null,
  dialogDir: "",
};

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[ch]);
}

async function api(path, options) {
  const response = await fetch(path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

const query = (params) => new URLSearchParams(params).toString();

function setStatus(text, kind = "") {
  els.formStatus.textContent = text;
  els.formStatus.className = `status ${kind}`;
}

function formatTime(seconds) {
  const d = new Date(seconds * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function markChanged() {
  if (!state.defaults) return;
  els.inputDir.classList.toggle("changed", els.inputDir.value.trim() !== state.defaults.input_dir);
  els.outputDir.classList.toggle("changed", els.outputDir.value.trim() !== state.defaults.output_dir);
  els.stockId.classList.toggle("changed", els.stockId.value.trim() !== state.defaults.stock_id);
  els.product.classList.toggle("changed", els.product.value !== state.defaults.product);
}

function selectedProductType() {
  const product = state.defaults.products.find((p) => p.code === els.product.value);
  return product ? product.product_type : null;
}

function productLabel(productType) {
  const product = state.defaults.products.find((p) => p.product_type === productType);
  return product ? product.label : productType;
}

/* ---------- PDF file list ---------- */

async function loadFiles() {
  const dir = els.inputDir.value.trim();
  const token = ++state.scanToken;
  state.pdfs = [];
  state.scan = null;
  els.progress.hidden = true;
  els.fileList.innerHTML = '<li class="empty">讀取中…</li>';
  try {
    const listing = await api(`/api/browse?${query({ dir })}`);
    if (token !== state.scanToken) return;
    state.pdfs = listing.pdfs;
    renderFiles();
    if (listing.pdfs.length) pollScan(dir, token);
  } catch (error) {
    if (token !== state.scanToken) return;
    els.fileList.innerHTML = `<li class="empty file-error">${escapeHtml(error.message)}</li>`;
    els.matchCount.textContent = "";
  }
}

async function pollScan(dir, token) {
  try {
    const scan = await api(`/api/scan?${query({ dir })}`);
    if (token !== state.scanToken) return;
    state.scan = scan;
    renderProgress();
    renderFiles();
    renderStockOptions();
    renderTabs();
    if (scan.running) setTimeout(() => pollScan(dir, token), 800);
  } catch (error) {
    if (token !== state.scanToken) return;
    els.progress.hidden = false;
    els.progress.querySelector(".label").textContent = `內容掃描失敗：${error.message}`;
  }
}

function renderProgress() {
  const { done, total, running } = state.scan;
  els.progress.hidden = !running;
  els.progress.querySelector(".bar").style.width = total ? `${(done / total) * 100}%` : "0";
  els.progress.querySelector(".label").textContent = `解析 PDF 內容 ${done} / ${total}（首次較慢，之後會使用快取）`;
}

// Returns "fcn" (has the selected product) | "other" | "guess" | null for one PDF against the typed stock id.
function matchLevel(pdf, stockId) {
  if (!stockId) return null;
  const info = state.scan && state.scan.files[pdf.name];
  if (info) {
    const stock = info.stocks[stockId];
    if (!stock) return null;
    return stock.products.includes(selectedProductType()) ? "fcn" : "other";
  }
  return pdf.name.includes(stockId) ? "guess" : null;
}

function renderFiles() {
  const stockId = els.stockId.value.trim();
  const onlyMatched = els.onlyMatched.checked;
  let matched = 0;
  const items = state.pdfs.map((pdf) => {
    const level = matchLevel(pdf, stockId);
    if (level) matched += 1;
    if (onlyMatched && stockId && !level) return "";
    const info = state.scan && state.scan.files[pdf.name];
    const meta = [];
    if (info) {
      if (info.quote_start_date) meta.push(`<span>${escapeHtml(info.quote_start_date)} ~ ${escapeHtml(info.quote_end_date || "")}</span>`);
      Object.entries(info.stocks).forEach(([id, stock]) => {
        const products = stock.products.map(productLabel).join("/");
        meta.push(`<span class="stock-tag${id === stockId ? " hit" : ""}">${escapeHtml(id)} ${escapeHtml(stock.name)} · ${escapeHtml(products)}</span>`);
      });
      if (!info.rows && !info.error) meta.push('<span class="file-error">沒有解析到報價列</span>');
      if (info.error) meta.push(`<span class="file-error">${escapeHtml(info.error)}</span>`);
    } else {
      meta.push("<span>等待解析…</span>");
    }
    const cls = level ? `match-${level}` : (stockId ? "dim" : "");
    return `<li class="${cls}"><div class="file-name">${escapeHtml(pdf.name)}</div><div class="file-meta">${meta.join("")}</div></li>`;
  }).join("");
  els.fileList.innerHTML = items || `<li class="empty">${state.pdfs.length ? "沒有符合的檔案" : "此目錄沒有 PDF 檔案"}</li>`;
  els.matchCount.textContent = stockId ? `符合 ${matched} / ${state.pdfs.length}` : `${state.pdfs.length} 個檔案`;
}

function stockNames() {
  const names = {};
  if (!state.scan) return names;
  Object.values(state.scan.files).forEach((info) => {
    Object.entries(info.stocks).forEach(([id, stock]) => { names[id] = stock.name; });
  });
  return names;
}

function renderStockOptions() {
  const names = stockNames();
  els.stockOptions.innerHTML = Object.keys(names).sort()
    .map((id) => `<option value="${escapeHtml(id)}">${escapeHtml(names[id])}</option>`).join("");
}

/* ---------- Dashboards viewer ---------- */

async function loadOutputs(preferHtml) {
  const dir = els.outputDir.value.trim();
  try {
    const data = await api(`/api/outputs?${query({ dir })}`);
    state.outputs = data.dashboards;
    state.outputDir = data.dir;
  } catch (error) {
    state.outputs = [];
    setStatus(error.message, "error");
  }
  const wanted = preferHtml || state.activeHtml || decodeURIComponent(location.hash.slice(1));
  const target = state.outputs.find((d) => d.html === wanted) || state.outputs[0];
  selectDashboard(target ? target.html : null);
}

function renderTabs() {
  const names = stockNames();
  els.tabs.innerHTML = state.outputs.map((d) => {
    const classes = ["tab"];
    if (d.html === state.activeHtml) classes.push("active");
    if (d.html === state.freshHtml) classes.push("fresh");
    const name = names[d.stock_id] ? ` ${escapeHtml(names[d.stock_id])}` : "";
    const when = d.html === state.freshHtml ? "剛剛產生" : formatTime(d.mtime);
    return `<button type="button" class="${classes.join(" ")}" data-html="${escapeHtml(d.html)}">${escapeHtml(d.stock_id)}${name} ${escapeHtml(d.product_label)}<small>${when}</small></button>`;
  }).join("");
}

function selectDashboard(html) {
  state.activeHtml = html;
  renderTabs();
  const dashboard = state.outputs.find((d) => d.html === html);
  els.frame.hidden = !dashboard;
  els.viewerEmpty.hidden = Boolean(dashboard);
  els.openNew.hidden = !dashboard;
  els.downloadExcel.hidden = !(dashboard && dashboard.excel);
  if (!dashboard) {
    els.frame.removeAttribute("src");
    return;
  }
  const dir = state.outputDir;
  const src = `/output?${query({ dir, name: dashboard.html, v: dashboard.mtime })}`;
  if (els.frame.getAttribute("src") !== src) els.frame.src = src;
  els.openNew.href = src;
  if (dashboard.excel) els.downloadExcel.href = `/output?${query({ dir, name: dashboard.excel, v: dashboard.mtime })}`;
  history.replaceState(null, "", `#${encodeURIComponent(html)}`);
}

/* ---------- Generate ---------- */

async function generate(event) {
  event.preventDefault();
  const payload = {
    input_dir: els.inputDir.value.trim(),
    output_dir: els.outputDir.value.trim(),
    stock_id: els.stockId.value.trim(),
    product: els.product.value,
  };
  els.generate.disabled = true;
  const pending = state.scan && state.scan.running;
  setStatus(pending ? "等待 PDF 解析完成後產生…" : "產生中…");
  try {
    const result = await api("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    state.freshHtml = result.html;
    const label = els.product.selectedOptions[0].textContent;
    setStatus(`已產生 ${payload.stock_id} ${label}：${result.series} 組上下限、${result.dates} 個報價日，共讀取 ${result.rows} 列`, "ok");
    await loadOutputs(result.html);
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    els.generate.disabled = false;
  }
}

/* ---------- Directory picker ---------- */

async function openDirDialog(targetId) {
  state.dialogTarget = $(targetId);
  els.dirDialog.returnValue = "";
  els.dirDialog.showModal();
  await browseDialog(state.dialogTarget.value.trim());
}

async function browseDialog(dir) {
  els.dirInfo.textContent = "讀取中…";
  let listing;
  try {
    listing = await api(`/api/browse?${query({ dir })}`);
  } catch (error) {
    // Unknown path: fall back to the drive list instead of leaving the dialog empty.
    listing = await api("/api/browse?dir=");
    els.dirInfo.textContent = error.message;
  }
  state.dialogDir = listing.dir;
  els.dirCurrent.textContent = listing.dir || "（磁碟機）";
  const rows = [];
  if (listing.parent !== null) rows.push(`<li class="up" data-path="${escapeHtml(listing.parent)}">⬆ 上一層</li>`);
  listing.dirs.forEach((d) => rows.push(`<li data-path="${escapeHtml(d.path)}">📁 ${escapeHtml(d.name)}</li>`));
  els.dirList.innerHTML = rows.join("") || '<li class="up">（沒有子目錄）</li>';
  els.dirList.scrollTop = 0;
  if (listing.dir) els.dirInfo.textContent = `${listing.dirs.length} 個子目錄、${listing.pdfs.length} 個 PDF`;
  $("dir-choose").disabled = !listing.dir;
}

/* ---------- Wiring ---------- */

function applyDefaults() {
  els.inputDir.value = state.defaults.input_dir;
  els.outputDir.value = state.defaults.output_dir;
  els.stockId.value = state.defaults.stock_id;
  els.product.value = state.defaults.product;
  markChanged();
}

function bindPathInput(input, onChange) {
  let last = input.value;
  const commit = () => {
    if (input.value.trim() === last) return;
    last = input.value.trim();
    onChange();
  };
  input.addEventListener("change", commit);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") { event.preventDefault(); commit(); }
  });
  return (value) => { input.value = value; commit(); };
}

async function init() {
  try {
    state.defaults = await api("/api/defaults");
  } catch (error) {
    els.serverStatus.textContent = `無法連線本機伺服器：${error.message}`;
    return;
  }
  els.serverStatus.textContent = "本機伺服器已連線";
  els.product.innerHTML = state.defaults.products
    .map((p) => `<option value="${escapeHtml(p.code)}">${escapeHtml(p.label)}（${escapeHtml(p.product_type)}）</option>`).join("");
  applyDefaults();

  const setInputDir = bindPathInput(els.inputDir, loadFiles);
  const setOutputDir = bindPathInput(els.outputDir, () => loadOutputs());
  const setters = { "input-dir": setInputDir, "output-dir": setOutputDir };

  els.form.addEventListener("submit", generate);
  els.form.addEventListener("input", markChanged);
  els.stockId.addEventListener("input", renderFiles);
  els.product.addEventListener("change", () => { markChanged(); renderFiles(); });
  els.onlyMatched.addEventListener("change", renderFiles);
  els.reset.addEventListener("click", () => {
    setInputDir(state.defaults.input_dir);
    setOutputDir(state.defaults.output_dir);
    els.stockId.value = state.defaults.stock_id;
    els.product.value = state.defaults.product;
    markChanged();
    renderFiles();
  });

  els.tabs.addEventListener("click", (event) => {
    const tab = event.target.closest(".tab");
    if (tab) selectDashboard(tab.dataset.html);
  });

  document.querySelectorAll("[data-browse]").forEach((button) => {
    button.addEventListener("click", () => openDirDialog(button.dataset.browse));
  });
  els.dirList.addEventListener("click", (event) => {
    const item = event.target.closest("li[data-path]");
    if (item) browseDialog(item.dataset.path);
  });
  els.dirDialog.addEventListener("close", () => {
    if (els.dirDialog.returnValue === "choose" && state.dialogDir) {
      setters[state.dialogTarget.id](state.dialogDir);
      markChanged();
    }
  });

  loadFiles();
  loadOutputs();
}

init();
