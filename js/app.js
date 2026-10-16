const DELIMS = { comma: ",", semicolon: ";", tab: "\t", pipe: "|" };
const BASE_ROW_H = 48;

const empty = document.getElementById("empty");
const workspace = document.getElementById("workspace");
const statusBar = document.getElementById("status");
const statusText = document.getElementById("status-text");
const statusKeys = document.getElementById("status-keys");
const progress = document.getElementById("progress");
const errorBox = document.getElementById("error");
const fileInput = document.getElementById("file-input");
const fileNameEl = document.getElementById("file-name");
const fileMeta = document.getElementById("file-meta");
const delimHint = document.getElementById("delim-hint");
const delimiterSelect = document.getElementById("delimiter");
const headerToggle = document.getElementById("header-toggle");
const riskToggle = document.getElementById("risk-toggle");
const spaceToggle = document.getElementById("space-toggle");
const monoToggle = document.getElementById("mono-toggle");
const searchInput = document.getElementById("search");
const replaceInput = document.getElementById("replace");
const findCount = document.getElementById("find-count");
const findDialog = document.getElementById("find-dialog");
const zoomRange = document.getElementById("zoom-range");
const zoomLabel = document.getElementById("zoom-label");
const chips = document.getElementById("chips");
const warnings = document.getElementById("warnings");
const sheet = document.getElementById("sheet");
const headScroll = document.getElementById("head-scroll");
const headLine = document.getElementById("head-line");
const scroller = document.getElementById("scroller");
const viewport = document.getElementById("viewport");
const gridEmpty = document.getElementById("grid-empty");
const inspectorBody = document.getElementById("inspector-body");
const recentWrap = document.getElementById("recent");
const recentList = document.getElementById("recent-list");
const drop = document.getElementById("drop");
const toastEl = document.getElementById("toast");
const live = document.getElementById("live");
const installBtn = document.getElementById("install-btn");
const formulaInput = document.getElementById("formula-input");
const formulaCancel = document.getElementById("formula-cancel");
const formulaCommit = document.getElementById("formula-commit");
const cellRef = document.getElementById("cell-ref");
const cellLabel = document.getElementById("cell-label");

const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const modLabel = mac ? "⌘" : "Ctrl+";

let prefs = loadPrefs();
let generation = 0;
let toastTimer = 0;
let searchTimer = 0;
let scrollRaf = 0;
let deferredPrompt = null;
let dbPromise = null;
let editOrigin = null;

const state = {
  fileName: "",
  text: "",
  originalBuffer: null,
  encoding: "UTF-8",
  byteLength: 0,
  delimiter: ",",
  delimiterChoice: "auto",
  rows: [],
  rowLens: new Uint32Array(),
  flags: new Uint8Array(),
  colCount: 0,
  minCols: 0,
  maxCols: 0,
  unclosedQuote: false,
  hasHeader: prefs.hasHeader,
  markRisks: prefs.markRisks,
  showSpaces: prefs.showSpaces,
  mono: prefs.mono,
  widths: [],
  gutter: 56,
  sort: null,
  query: "",
  riskFilter: 0,
  selected: null,
  anchor: null,
  selection: new Set(),
  highlightCol: null,
  dirty: false,
  zoom: 1,
  indices: [],
  riskCounts: new Map(),
  colRisk: new Uint8Array(),
};

function loadPrefs() {
  const defaults = { hasHeader: true, markRisks: true, showSpaces: false, mono: false };
  try {
    const saved = JSON.parse(localStorage.getItem("excelsior-prefs") || "{}");
    return { ...defaults, ...saved };
  } catch {
    return defaults;
  }
}

function savePrefs() {
  prefs = {
    hasHeader: prefs.hasHeader,
    markRisks: state.markRisks,
    showSpaces: state.showSpaces,
    mono: state.mono,
  };
  try {
    localStorage.setItem("excelsior-prefs", JSON.stringify(prefs));
  } catch {
    /* private mode */
  }
}

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open("excelsior", 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("recent")) db.createObjectStore("recent", { keyPath: "id" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  return dbPromise;
}

async function rememberFile() {
  const record = {
    id: state.fileName,
    name: state.fileName,
    text: state.text,
    encoding: state.encoding,
    bytes: state.byteLength,
    savedAt: Date.now(),
  };
  if (!record.name || record.text.length > 1500000 || record.name.startsWith("Example —")) return;
  try {
    const db = await openDb();
    await transact(db, "readwrite", (store) => {
      store.put(record);
    });
    const all = await listRecent();
    const extra = all.slice(5);
    if (extra.length) {
      await transact(db, "readwrite", (store) => {
        for (const item of extra) store.delete(item.id);
      });
    }
    renderRecent(all.slice(0, 5));
  } catch {
    /* storage unavailable */
  }
}

function transact(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("recent", mode);
    fn(tx.objectStore("recent"));
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function listRecent() {
  try {
    const db = await openDb();
    const items = await new Promise((resolve, reject) => {
      const tx = db.transaction("recent", "readonly");
      const request = tx.objectStore("recent").getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
    items.sort((a, b) => b.savedAt - a.savedAt);
    return items;
  } catch {
    return [];
  }
}

async function renderRecent(items) {
  const list = items || (await listRecent());
  recentList.replaceChildren();
  if (!list.length) {
    recentWrap.hidden = true;
    return;
  }
  recentWrap.hidden = false;
  const dateFormat = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" });
  for (const item of list.slice(0, 5)) {
    const li = document.createElement("li");
    const open = document.createElement("button");
    open.type = "button";
    open.className = "link";
    open.textContent = item.name;
    open.addEventListener("click", () => {
      state.originalBuffer = null;
      state.encoding = item.encoding || "UTF-8";
      state.byteLength = item.bytes || new TextEncoder().encode(item.text).length;
      state.delimiterChoice = "auto";
      openText(item.name, item.text, { newFile: true, remember: true });
    });
    const when = document.createElement("span");
    when.className = "when";
    when.textContent = dateFormat.format(item.savedAt);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove";
    remove.textContent = "Remove";
    remove.addEventListener("click", async () => {
      try {
        const db = await openDb();
        await transact(db, "readwrite", (store) => store.delete(item.id));
      } catch {
        /* ignore */
      }
      renderRecent();
    });
    li.append(open, when, remove);
    recentList.appendChild(li);
  }
}

let worker = null;
const pending = new Map();
let requestId = 0;

try {
  worker = new Worker("js/worker.js");
  worker.onmessage = (event) => {
    const { id, ok, error, ...rest } = event.data;
    const job = pending.get(id);
    if (!job) return;
    pending.delete(id);
    if (ok) job.resolve(rest);
    else job.reject(new Error(error || "Could not read this file."));
  };
  worker.onerror = () => {
    worker = null;
    for (const job of pending.values()) job.reject(new Error("The reader stopped. Try opening the file again."));
    pending.clear();
  };
} catch {
  worker = null;
}

function parseText(text, delimiter) {
  if (worker) {
    const id = ++requestId;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      worker.postMessage({ id, text, delimiter });
    });
  }
  const chosen = !delimiter || delimiter === "auto" ? ExcelsiorCSV.detectDelimiter(text) : delimiter;
  const parsed = ExcelsiorCSV.parseCSV(text, chosen);
  const table = ExcelsiorCSV.toTable(parsed.rows);
  const flags = ExcelsiorCSV.riskFlags(table.rows, table.colCount);
  return Promise.resolve({
    delimiter: chosen,
    rows: table.rows,
    rowLens: table.rowLens,
    flags,
    colCount: table.colCount,
    minCols: table.minCols,
    maxCols: table.maxCols,
    unclosedQuote: parsed.unclosedQuote,
  });
}

function setBusy(busy) {
  progress.hidden = !busy;
}

function showError(message) {
  errorBox.hidden = !message;
  errorBox.textContent = message || "";
  if (message) live.textContent = message;
}

function chooseFile() {
  fileInput.click();
}

async function onFile(file) {
  setBusy(true);
  showError("");
  try {
    const buffer = await file.arrayBuffer();
    const decoded = ExcelsiorCSV.decodeBytes(new Uint8Array(buffer));
    if (decoded.binary) {
      showError("Excelsior can’t read this file as text. Choose a CSV.");
      setBusy(false);
      return;
    }
    state.originalBuffer = buffer;
    state.encoding = decoded.encoding;
    state.byteLength = buffer.byteLength;
    state.delimiterChoice = "auto";
    await openText(file.name, decoded.text, { newFile: true, remember: true });
  } catch (error) {
    showError(error.message || "Could not open that file.");
    setBusy(false);
  }
}

async function openText(name, text, { newFile = false, remember = false } = {}) {
  const gen = ++generation;
  state.fileName = name;
  state.text = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  if (!state.byteLength) state.byteLength = new TextEncoder().encode(state.text).length;
  setBusy(true);
  showError("");
  try {
    const delimiter = state.delimiterChoice === "auto" ? "auto" : DELIMS[state.delimiterChoice];
    const result = await parseText(state.text, delimiter);
    if (gen !== generation) return;
    applyResult(result, { newFile });
    showWorkspace();
    if (remember) rememberFile();
    const records = dataCount();
    live.textContent = `Opened ${name}. ${records.toLocaleString("en-US")} records. Values were not reformatted.`;
  } catch (error) {
    if (gen !== generation) return;
    showError(error.message || "Could not read this file.");
  } finally {
    if (gen === generation) setBusy(false);
  }
}

function applyResult(result, { newFile = false } = {}) {
  state.rows = result.rows;
  state.rowLens = result.rowLens;
  state.flags = result.flags;
  state.colCount = result.colCount;
  state.minCols = result.minCols;
  state.maxCols = result.maxCols;
  state.unclosedQuote = result.unclosedQuote;
  state.delimiter = result.delimiter;
  if (newFile) {
    state.sort = null;
    state.query = "";
    state.riskFilter = 0;
    state.selected = null;
    state.anchor = null;
    state.selection = new Set();
    state.highlightCol = null;
    state.dirty = false;
    searchInput.value = "";
    replaceInput.value = "";
    state.hasHeader = result.rows.length > 1 ? prefs.hasHeader : false;
  }
  if (state.sort && state.sort.col >= state.colCount) state.sort = null;
  if (state.highlightCol != null && state.highlightCol >= state.colCount) state.highlightCol = null;
  if (
    state.selected &&
    (state.selected.col >= state.colCount || state.selected.row >= state.rows.length)
  ) {
    state.selected = null;
  }
  state.widths = measureWidths();
  state.gutter = measureGutter();
  analyze();
  rebuildIndices();
  syncControls();
  renderAll();
  scroller.scrollTop = 0;
  scroller.scrollLeft = 0;
  document.title = `${state.fileName} — Excelsior`;
}

function dataCount() {
  if (!state.rows.length) return 0;
  return state.hasHeader ? state.rows.length - 1 : state.rows.length;
}

function headerName(col) {
  if (state.hasHeader && state.rows[0] && col < state.rowLens[0]) {
    const name = state.rows[0][col];
    if (name && name.trim()) return name;
  }
  return "";
}

function colName(col) {
  return headerName(col) || columnLetter(col);
}

function analyze() {
  const counts = new Map();
  const colRisk = new Uint8Array(state.colCount);
  const start = state.hasHeader ? 1 : 0;
  for (let r = start; r < state.rows.length; r++) {
    const base = r * state.colCount;
    for (let c = 0; c < state.colCount; c++) {
      const flag = state.flags[base + c];
      if (!flag) continue;
      colRisk[c] |= flag;
      for (const info of ExcelsiorCSV.RISK_INFO) {
        if (flag & info.bit) counts.set(info.bit, (counts.get(info.bit) || 0) + 1);
      }
    }
  }
  state.riskCounts = counts;
  state.colRisk = colRisk;
}

function rebuildIndices() {
  const query = state.query.trim().toLowerCase();
  const start = state.hasHeader ? 1 : 0;
  const indices = [];
  const bit = state.riskFilter;
  for (let r = start; r < state.rows.length; r++) {
    if (bit) {
      let hit = false;
      const base = r * state.colCount;
      for (let c = 0; c < state.colCount; c++) {
        if (state.flags[base + c] & bit) {
          hit = true;
          break;
        }
      }
      if (!hit) continue;
    }
    if (query && !rowMatchesQuery(r, query)) continue;
    indices.push(r);
  }
  if (state.sort) {
    const { col, dir } = state.sort;
    const sign = dir === "asc" ? 1 : -1;
    indices.sort(
      (a, b) =>
        sign *
        state.rows[a][col].localeCompare(state.rows[b][col], undefined, {
          numeric: false,
          sensitivity: "variant",
        }),
    );
  }
  state.indices = indices;
}

function measure(text) {
  try {
    if (!measure.ctx) measure.ctx = document.createElement("canvas").getContext("2d");
    measure.ctx.font = '500 13.5px Roboto, "Segoe UI", sans-serif';
    return measure.ctx.measureText(text || "").width;
  } catch {
    return (text || "").length * 8;
  }
}

function measureWidths() {
  const widths = [];
  const sample = Math.min(state.rows.length, 80);
  const first = state.hasHeader ? 1 : 0;
  for (let c = 0; c < state.colCount; c++) {
    let width = measure(colName(c).toUpperCase()) + 48;
    for (let r = first; r < sample; r++) {
      width = Math.max(width, measure(state.rows[r][c]) + 28);
    }
    widths.push(Math.round(Math.min(380, Math.max(96, width))));
  }
  return widths;
}

function measureGutter() {
  return Math.max(56, Math.round(measure(String(state.rows.length)) + 28));
}

function rowHeight() {
  return Math.max(18, Math.round(BASE_ROW_H * state.zoom));
}

function scaled(width) {
  return Math.max(24, Math.round(width * state.zoom));
}

function syncZoomControl() {
  const percent = Math.round(state.zoom * 100);
  zoomRange.value = String(percent);
  zoomLabel.textContent = `${percent}%`;
}

function setZoom(value) {
  state.zoom = Math.min(1.5, Math.max(0.4, Math.round(value * 10) / 10));
  syncZoomControl();
  applyTemplate();
  if (state.rows.length) renderWindow();
}

function fitColumns() {
  const available = Math.max(0, scroller.clientWidth - 2);
  const natural = state.gutter + state.widths.reduce((sum, width) => sum + width, 0);
  if (!natural || natural <= available) {
    setZoom(1);
    return;
  }
  setZoom(Math.floor((available / natural) * 10) / 10);
}

function applyTemplate() {
  const gutter = scaled(state.gutter);
  const widths = state.widths.map(scaled);
  const total = gutter + widths.reduce((sum, width) => sum + width, 0);
  const columns = widths.map((width) => `${width}px`).join(" ");
  sheet.style.setProperty("--template", `${gutter}px ${columns}`.trim());
  sheet.style.setProperty("--grid-width", `${Math.max(total, 1)}px`);
  sheet.style.setProperty("--row-h", `${rowHeight()}px`);
  sheet.style.setProperty("--zoom", String(state.zoom));
}

function syncScrollbar() {
  headScroll.style.paddingRight = `${scroller.offsetWidth - scroller.clientWidth}px`;
  const more = scroller.scrollWidth > scroller.clientWidth + 2 && scroller.scrollLeft + scroller.clientWidth < scroller.scrollWidth - 2;
  sheet.classList.toggle("can-scroll-x", more);
}

function syncControls() {
  headerToggle.checked = state.hasHeader;
  riskToggle.checked = state.markRisks;
  spaceToggle.checked = state.showSpaces;
  monoToggle.checked = state.mono;
  delimiterSelect.value = state.delimiterChoice;
  sheet.classList.toggle("mono", state.mono);
  delimHint.textContent = state.delimiterChoice === "auto" ? `Detected ${ExcelsiorCSV.delimiterLabel(state.delimiter)}` : "";
  fileNameEl.textContent = state.fileName;
  fileNameEl.title = state.fileName;
  fileNameEl.classList.toggle("is-dirty", state.dirty);
  const edited = state.dirty ? " · Edited" : "";
  fileMeta.textContent = `${state.encoding} · ${ExcelsiorCSV.delimiterLabel(state.delimiter)} · ${formatBytes(state.byteLength)}${edited}`;
}

function renderAll() {
  renderWarnings();
  renderChips();
  renderHeader();
  renderWindow();
  renderInspector();
  renderStatus();
  fillEditor();
}

function renderWarnings() {
  warnings.replaceChildren();
  const notes = [];
  if (state.unclosedQuote) {
    notes.push("A quotation mark was never closed. The rest of the file was kept as part of that field.");
  }
  if (state.rows.length && state.minCols !== state.maxCols) {
    notes.push("Some records have fewer fields than others. Blank cells at the end of those rows were not in the file.");
  }
  for (const note of notes) {
    const p = document.createElement("p");
    p.className = "warning";
    p.textContent = note;
    warnings.appendChild(p);
  }
}

function renderChips() {
  chips.replaceChildren();
  if (!state.riskCounts.size) {
    const note = document.createElement("p");
    note.className = "hint";
    note.textContent = state.rows.length
      ? "Nothing here matches the usual Excel rewrite rules."
      : "";
    if (note.textContent) chips.appendChild(note);
    return;
  }
  for (const info of ExcelsiorCSV.RISK_INFO) {
    const count = state.riskCounts.get(info.bit) || 0;
    if (!count) continue;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "chip";
    button.setAttribute("aria-pressed", state.riskFilter === info.bit ? "true" : "false");
    const label = document.createElement("span");
    label.textContent = info.short;
    const num = document.createElement("span");
    num.className = "count";
    num.textContent = count.toLocaleString("en-US");
    button.append(label, num);
    button.addEventListener("click", () => {
      state.riskFilter = state.riskFilter === info.bit ? 0 : info.bit;
      rebuildIndices();
      scroller.scrollTop = 0;
      renderChips();
      renderWindow();
      renderStatus();
    });
    chips.appendChild(button);
  }
}

function renderHeader() {
  headLine.replaceChildren();
  if (!state.colCount) {
    applyTemplate();
    return;
  }
  const gutter = document.createElement("div");
  gutter.className = "gutter";
  gutter.textContent = "Row";
  headLine.appendChild(gutter);
  for (let c = 0; c < state.colCount; c++) {
    const cell = document.createElement("div");
    cell.className = "hcell";
    cell.classList.toggle("col-hot", state.highlightCol === c);
    cell.setAttribute("role", "columnheader");
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.col = String(c);
    button.setAttribute("aria-pressed", state.highlightCol === c ? "true" : "false");
    button.title = "Highlight this column. Find, replace, and copy then use only this column.";
    const letter = document.createElement("span");
    letter.className = "hletter";
    letter.textContent = columnLetter(c);
    const name = document.createElement("span");
    name.className = "hname";
    const header = headerName(c);
    name.textContent = header;
    name.hidden = !header;
    button.append(letter, name);
    if (state.markRisks && state.colRisk[c]) {
      const dot = document.createElement("i");
      dot.className = "rdot";
      dot.title = "This column has values Excel may change";
      button.appendChild(dot);
    }
    const handle = document.createElement("span");
    handle.className = "resize";
    handle.dataset.col = String(c);
    handle.title = "Drag to resize. Double-click to fit.";
    cell.append(button, handle);
    headLine.appendChild(cell);
  }
  applyTemplate();
  syncScrollbar();
}

function renderWindow() {
  const total = state.indices.length;
  const rowH = rowHeight();
  const start = Math.max(0, Math.floor(scroller.scrollTop / rowH) - 8);
  const end = Math.min(total, start + Math.ceil(scroller.clientHeight / rowH) + 16);
  viewport.style.paddingTop = `${start * rowH}px`;
  viewport.style.paddingBottom = `${Math.max(0, total - end) * rowH}px`;

  const needed = Math.max(0, end - start);
  while (viewport.children.length < needed) {
    const line = document.createElement("div");
    line.className = "line data";
    line.setAttribute("role", "row");
    viewport.appendChild(line);
  }
  while (viewport.children.length > needed) viewport.lastChild.remove();

  for (let i = 0; i < needed; i++) fillLine(viewport.children[i], state.indices[start + i]);

  scroller.setAttribute("aria-rowcount", String(total));
  scroller.setAttribute("aria-colcount", String(state.colCount + 1));
  gridEmpty.hidden = total !== 0;
  if (!state.rows.length) gridEmpty.textContent = "This file has no records.";
  else if (!total) gridEmpty.textContent = "Nothing in this file matches.";
  syncScrollbar();
}

function fillLine(line, index) {
  if (line.childElementCount !== state.colCount + 1) {
    line.replaceChildren();
    const gutter = document.createElement("div");
    gutter.className = "gutter";
    line.appendChild(gutter);
    for (let c = 0; c < state.colCount; c++) {
      const cell = document.createElement("div");
      cell.className = "cell";
      cell.dataset.col = String(c);
      cell.setAttribute("role", "gridcell");
      line.appendChild(cell);
    }
  }
  line.dataset.index = String(index);
  line.setAttribute("aria-rowindex", String(index + 1));
  line.classList.toggle("alt", index % 2 === 1);
  line.children[0].textContent = String(index + 1);
  const base = index * state.colCount;
  for (let c = 0; c < state.colCount; c++) {
    const cell = line.children[c + 1];
    const value = state.rows[index][c] || "";
    const absent = c >= state.rowLens[index];
    const flag = absent ? 0 : state.flags[base + c] || 0;
    const scopedQuery = state.highlightCol == null || state.highlightCol === c ? state.query : "";
    cell.innerHTML = absent ? "" : cellHtml(value, scopedQuery);
    cell.classList.toggle("risk", state.markRisks && flag !== 0);
    const active = !!(state.selected && state.selected.row === index && state.selected.col === c);
    cell.classList.toggle("col-hot", state.highlightCol === c);
    cell.classList.toggle("in-range", !active && cellInSelection(index, c));
    cell.classList.toggle("selected", active);
    cell.classList.toggle("absent", absent);
    if (!absent && value.length > 40) cell.title = value;
    else cell.removeAttribute("title");
    if (flag) cell.dataset.risk = String(flag);
    else delete cell.dataset.risk;
  }
}

function cellHtml(value, query) {
  const q = query.trim().toLowerCase();
  const lower = q ? value.toLowerCase() : "";
  const lead = /^[ \t]*/.exec(value)[0].length;
  const trail = /[ \t]*$/.exec(value)[0].length;
  const trailStart = value.length - trail;
  let html = "";
  let i = 0;
  while (i < value.length) {
    const matched = q && lower.startsWith(q, i);
    const end = matched ? Math.min(value.length, i + q.length) : i + 1;
    let inner = "";
    for (let j = i; j < end; j++) {
      const ch = value[j];
      const edge = j < lead || j >= trailStart;
      if (ch === " " && (state.showSpaces || edge)) inner += '<span class="sp">·</span>';
      else if (ch === "\t" && (state.showSpaces || edge)) inner += '<span class="sp">→</span>';
      else if (ch === "\n") inner += '<span class="sp">⏎</span>';
      else if (ch === "\r") inner += '<span class="sp">␍</span>';
      else inner += escapeHtml(ch);
    }
    html += matched ? `<mark>${inner}</mark>` : inner;
    i = end;
  }
  return html;
}

function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
}

function renderInspector() {
  inspectorBody.replaceChildren();
  if (!state.selected || !state.rows.length) {
    const p = document.createElement("p");
    p.className = "inspector-empty";
    p.textContent = "Select a field. Excelsior will show it exactly as stored, and say if Excel is likely to change it.";
    inspectorBody.appendChild(p);
    return;
  }

  const { row, col } = state.selected;
  const absent = col >= state.rowLens[row];
  const value = absent ? "" : state.rows[row][col] || "";
  const flag = absent ? 0 : state.flags[row * state.colCount + col] || 0;

  const rec = document.createElement("h2");
  rec.className = "rec";
  rec.textContent = `Record ${row + 1}`;
  const label = document.createElement("p");
  label.className = "col-label";
  label.textContent = headerName(col) ? `${columnLetter(col)} · ${headerName(col)}` : columnLetter(col);
  inspectorBody.append(rec, label);

  if (absent) {
    const note = document.createElement("p");
    note.className = "inspector-empty";
    note.textContent = "This record has no field in this column. The blank cell was not in the file.";
    inspectorBody.appendChild(note);
    return;
  }

  const pre = document.createElement("pre");
  pre.className = "exact";
  pre.textContent = visualize(value);
  inspectorBody.appendChild(pre);

  if (/[ \t\n\r]/.test(value)) {
    const note = document.createElement("p");
    note.className = "space-note";
    note.textContent = "Spaces are shown as · so they stay visible. Copying uses the real field.";
    inspectorBody.appendChild(note);
  }

  const meta = document.createElement("p");
  meta.className = "meta-line";
  const parts = [`${value.length} character${value.length === 1 ? "" : "s"}`];
  if (!value.length) parts[0] = "Empty field, 0 characters";
  if (value.includes("\n")) parts.push("includes a line break");
  meta.textContent = parts.join(" · ");
  inspectorBody.appendChild(meta);

  const actions = document.createElement("div");
  actions.className = "inspector-actions";
  actions.append(
    actionButton("Copy field", () => copyText(value, "Copied as written")),
    actionButton("Copy row", () => copyText(state.rows[row].slice(0, state.rowLens[row]).join("\t"), "Copied the row as written")),
    actionButton("Copy for Excel", () => copyText(`'${value}`, "Copied with an apostrophe so Excel keeps it as text"), "Prefixes an apostrophe so Excel stores this as text. The apostrophe is not part of the file."),
  );
  inspectorBody.appendChild(actions);

  if (value.includes("\n")) {
    const note = document.createElement("p");
    note.className = "safe-note";
    note.textContent = "This field contains a line break. A text editor will keep it intact.";
    inspectorBody.appendChild(note);
  }

  const risks = ExcelsiorCSV.RISK_INFO.filter((info) => flag & info.bit);
  if (!risks.length) {
    const calm = document.createElement("p");
    calm.className = "calm";
    calm.textContent = "No known Excel rewrite rule matches this field.";
    inspectorBody.appendChild(calm);
    return;
  }

  const list = document.createElement("ul");
  list.className = "risk-list";
  for (const info of risks) {
    const item = document.createElement("li");
    const title = document.createElement("strong");
    title.textContent = info.short;
    item.appendChild(title);
    item.appendChild(document.createTextNode(ExcelsiorCSV.detailFor(info, value)));
    list.appendChild(item);
  }
  inspectorBody.appendChild(list);
}

function actionButton(label, onClick, title) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn";
  button.textContent = label;
  if (title) button.title = title;
  button.addEventListener("click", onClick);
  return button;
}

function visualize(value) {
  if (!value) return value;
  return value.replace(/ /g, "·").replace(/\t/g, "→").replace(/\r/g, "␍").replace(/\n/g, "⏎\n");
}

function renderStatus() {
  const total = dataCount();
  const showing = state.indices.length;
  const bits = [`${showing.toLocaleString("en-US")} of ${total.toLocaleString("en-US")} records`];
  bits.push(`${state.colCount.toLocaleString("en-US")} columns`);
  bits.push("Text only, nothing reformatted");
  if (state.selection && state.selection.size > 1) {
    bits.push(`${state.selection.size.toLocaleString("en-US")} cells highlighted`);
  }
  if (state.highlightCol != null) bits.push(`Column ${columnLetter(state.highlightCol)} highlighted`);
  if (state.sort) {
    bits.push(`Sorted ${state.sort.dir === "asc" ? "A–Z" : "Z–A"} by ${colName(state.sort.col)}`);
  }
  statusText.textContent = bits.join(" · ");
  statusKeys.textContent = `${modLabel}F finds · Ctrl+H replaces · ${modLabel}S saves`;
  updateFindCount();
}

function showWorkspace() {
  empty.hidden = true;
  workspace.hidden = false;
  statusBar.hidden = false;
  requestAnimationFrame(renderWindow);
}

function closeFile() {
  if (state.dirty && !window.confirm("This file has edits that have not been saved. Close it anyway?")) return;
  generation += 1;
  state.rows = [];
  state.fileName = "";
  state.text = "";
  state.originalBuffer = null;
  state.selected = null;
  state.anchor = null;
  state.selection = new Set();
  state.highlightCol = null;
  state.dirty = false;
  closeFind();
  empty.hidden = false;
  workspace.hidden = true;
  statusBar.hidden = true;
  document.title = "Excelsior — CSV, as written";
  showError("");
  renderRecent();
}

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function saveOriginal() {
  if (!state.fileName) return;
  if (state.originalBuffer) {
    downloadBlob(state.fileName, new Blob([state.originalBuffer], { type: "text/csv" }));
    return;
  }
  downloadBlob(state.fileName, new Blob([state.text], { type: "text/csv;charset=utf-8" }));
}

function columnLetter(index) {
  let n = index + 1;
  let letters = "";
  while (n > 0) {
    n -= 1;
    letters = String.fromCharCode(65 + (n % 26)) + letters;
    n = Math.floor(n / 26);
  }
  return letters;
}

function cellStored(row, col) {
  if (!state.rows[row] || col >= state.rowLens[row]) return "";
  return state.rows[row][col] ?? "";
}

function rowsForSave() {
  const rows = new Array(state.rows.length);
  for (let r = 0; r < state.rows.length; r++) rows[r] = state.rows[r].slice(0, state.rowLens[r]);
  return rows;
}

function applyCellEdit(row, col, value, refresh = true) {
  const present = col < state.rowLens[row];
  const prev = present ? (state.rows[row][col] ?? "") : "";
  if (present && value === prev) return false;
  if (!present && value === "") return false;
  if (!present) state.rowLens[row] = col + 1;
  state.rows[row][col] = value;
  state.flags[row * state.colCount + col] = ExcelsiorCSV.classify(value);
  state.dirty = true;
  state.encoding = "UTF-8";
  state.text = ExcelsiorCSV.serializeCSV(rowsForSave(), state.delimiter);
  state.byteLength = new TextEncoder().encode(state.text).length;
  const width = Math.round(Math.min(640, Math.max(state.widths[col] || 96, measure(value) + 28)));
  if (width !== state.widths[col]) {
    state.widths[col] = width;
    applyTemplate();
  }
  if (!refresh) return true;
  refreshAfterEdit(row);
  return true;
}

function trimSpaces() {
  if (!state.rows.length) return;
  commitEditor();
  let count = 0;
  for (let row = 0; row < state.rows.length; row++) {
    const len = state.rowLens[row] || 0;
    for (let col = 0; col < len; col++) {
      const value = state.rows[row][col] ?? "";
      const next = value.trim();
      if (next === value) continue;
      state.rows[row][col] = next;
      state.flags[row * state.colCount + col] = ExcelsiorCSV.classify(next);
      count++;
    }
  }
  if (!count) {
    toast("No leading or trailing spaces.");
    return;
  }
  editOrigin = null;
  state.dirty = true;
  state.encoding = "UTF-8";
  state.text = ExcelsiorCSV.serializeCSV(rowsForSave(), state.delimiter);
  state.byteLength = new TextEncoder().encode(state.text).length;
  refreshAfterEdit(0);
  toast(count === 1 ? "Trimmed 1 field." : `Trimmed ${count.toLocaleString("en-US")} fields.`);
}

function refreshAfterEdit(row) {
  analyze();
  rebuildIndices();
  renderChips();
  if (row === 0 && state.hasHeader) renderHeader();
  if (state.selected) cellLabel.textContent = colName(state.selected.col);
  renderWindow();
  renderInspector();
  renderStatus();
  syncControls();
  fillEditor(true);
  rememberFile();
}

function rowMatchesQuery(row, query) {
  const len = state.rowLens[row] || 0;
  const start = state.highlightCol == null ? 0 : state.highlightCol;
  const end = state.highlightCol == null ? len : Math.min(len, state.highlightCol + 1);
  for (let col = start; col < end; col++) {
    if ((state.rows[row][col] || "").toLowerCase().includes(query)) return true;
  }
  return false;
}

function cellsMatching(query) {
  const q = query.trim().toLowerCase();
  const hits = [];
  if (!q) return hits;
  for (const row of state.indices) {
    const len = state.rowLens[row] || 0;
    const start = state.highlightCol == null ? 0 : state.highlightCol;
    const end = state.highlightCol == null ? len : Math.min(len, state.highlightCol + 1);
    for (let col = start; col < end; col++) {
      if ((state.rows[row][col] || "").toLowerCase().includes(q)) hits.push({ row, col });
    }
  }
  return hits;
}

function replaceInValue(value, query, replacement) {
  const q = query.trim().toLowerCase();
  if (!q) return value;
  const lower = value.toLowerCase();
  let out = "";
  let i = 0;
  while (i < value.length) {
    const at = lower.indexOf(q, i);
    if (at === -1) {
      out += value.slice(i);
      break;
    }
    out += value.slice(i, at) + replacement;
    i = at + query.trim().length;
  }
  return out;
}

function syncQuery() {
  clearTimeout(searchTimer);
  if (state.query === searchInput.value) {
    updateFindCount();
    return;
  }
  state.query = searchInput.value;
  rebuildIndices();
  scroller.scrollTop = 0;
  renderWindow();
  renderStatus();
}

function updateFindCount() {
  const query = state.query.trim();
  if (!query) {
    findCount.textContent = "";
    return;
  }
  const count = cellsMatching(state.query).length;
  const where = state.highlightCol == null ? "" : ` in column ${columnLetter(state.highlightCol)}`;
  findCount.textContent = (count === 1 ? "1 match" : `${count.toLocaleString("en-US")} matches`) + where;
}

function openFind(target) {
  if (workspace.hidden) return;
  findDialog.hidden = false;
  syncQuery();
  const field = target === "replace" ? replaceInput : searchInput;
  field.focus();
  field.select();
}

function closeFind() {
  findDialog.hidden = true;
  if (!state.query) return;
  state.query = "";
  if (!state.rows.length) return;
  rebuildIndices();
  scroller.scrollTop = 0;
  renderWindow();
  renderStatus();
}

function focusFind() {
  openFind("find");
}

function focusReplace() {
  openFind("replace");
}

function findNext(direction) {
  syncQuery();
  if (!state.query.trim()) {
    toast("Enter text to find");
    focusFind();
    return;
  }
  const hits = cellsMatching(state.query);
  if (!hits.length) {
    toast("No matches");
    return;
  }
  const current = hits.findIndex(
    (hit) => state.selected && hit.row === state.selected.row && hit.col === state.selected.col,
  );
  if (hits.length === 1 && current === 0) {
    selectCell(hits[0].row, hits[0].col, true);
    toast("1 match");
    return;
  }
  const start = current === -1 ? (direction > 0 ? -1 : 0) : current;
  const next = (start + direction + hits.length) % hits.length;
  selectCell(hits[next].row, hits[next].col, true);
}

function replaceOne() {
  commitEditor();
  syncQuery();
  if (!state.query.trim()) {
    toast("Enter text to find");
    focusFind();
    return;
  }
  const hits = cellsMatching(state.query);
  if (!hits.length) {
    toast("No matches");
    return;
  }
  let index = hits.findIndex(
    (hit) => state.selected && hit.row === state.selected.row && hit.col === state.selected.col,
  );
  if (index === -1) index = 0;
  const hit = hits[index];
  const next = replaceInValue(cellStored(hit.row, hit.col), state.query, replaceInput.value);
  applyCellEdit(hit.row, hit.col, next);
  const after = cellsMatching(state.query);
  const follow =
    after.find((item) => item.row > hit.row || (item.row === hit.row && item.col > hit.col)) || after[0];
  if (follow) selectCell(follow.row, follow.col, true);
  else toast("Replaced the last match");
}

function replaceAll() {
  commitEditor();
  syncQuery();
  if (!state.query.trim()) {
    toast("Enter text to find");
    focusFind();
    return;
  }
  const hits = cellsMatching(state.query);
  if (!hits.length) {
    toast("No matches");
    return;
  }
  const replacement = replaceInput.value;
  let count = 0;
  for (const hit of hits) {
    const next = replaceInValue(cellStored(hit.row, hit.col), state.query, replacement);
    if (applyCellEdit(hit.row, hit.col, next, false)) count++;
  }
  refreshAfterEdit(0);
  const left = cellsMatching(state.query).length;
  toast(left ? `Replaced ${count} fields. ${left} still match.` : `Replaced ${count} fields.`);
}

function fitEditor() {
  formulaInput.style.height = "auto";
  formulaInput.style.height = `${Math.min(160, Math.max(40, formulaInput.scrollHeight))}px`;
}

function draftDiffers() {
  if (formulaInput.disabled || !state.selected) return false;
  if (editOrigin && editOrigin.row === state.selected.row && editOrigin.col === state.selected.col) {
    return formulaInput.value !== editOrigin.value;
  }
  return formulaInput.value !== cellStored(state.selected.row, state.selected.col);
}

function rememberOrigin() {
  if (!state.selected) return;
  const { row, col } = state.selected;
  if (editOrigin && editOrigin.row === row && editOrigin.col === col) return;
  editOrigin = {
    row,
    col,
    value: cellStored(row, col),
    rowLen: state.rowLens[row],
    dirty: state.dirty,
  };
}

function paintLiveCell(row, col) {
  const line = viewport.querySelector(`.line[data-index="${row}"]`);
  if (!line) return;
  const cell = line.children[col + 1];
  if (!cell) return;
  const absent = col >= state.rowLens[row];
  const value = absent ? "" : state.rows[row][col] || "";
  const flag = absent ? 0 : state.flags[row * state.colCount + col] || 0;
  cell.innerHTML = absent ? "" : cellHtml(value, state.query);
  cell.classList.toggle("risk", state.markRisks && flag !== 0);
  const active = !!(state.selected && state.selected.row === row && state.selected.col === col);
  cell.classList.toggle("absent", absent);
  cell.classList.toggle("col-hot", state.highlightCol === col);
  cell.classList.toggle("in-range", !active && cellInSelection(row, col));
  cell.classList.toggle("selected", active);
  if (!absent && value.length > 40) cell.title = value;
  else cell.removeAttribute("title");
}

function paintHeaderName(col) {
  const name = headLine.querySelector(`button[data-col="${col}"] .hname`);
  if (name) {
    const header = headerName(col);
    name.textContent = header;
    name.hidden = !header;
  }
  if (state.selected && state.selected.row === 0 && state.selected.col === col) cellLabel.textContent = colName(col);
}

function previewEdit() {
  if (formulaInput.disabled || !state.selected) return;
  rememberOrigin();
  const { row, col } = state.selected;
  if (!state.rows[row] || !editOrigin) return;
  const value = formulaInput.value;
  const present = col < state.rowLens[row];
  if (!present && value !== "") state.rowLens[row] = col + 1;
  if (col < state.rows[row].length) state.rows[row][col] = value;
  if (col < state.colCount) state.flags[row * state.colCount + col] = ExcelsiorCSV.classify(col < state.rowLens[row] ? value : "");
  const changed = value !== editOrigin.value || state.rowLens[row] !== editOrigin.rowLen;
  state.dirty = changed ? true : editOrigin.dirty;
  fileNameEl.classList.toggle("is-dirty", state.dirty);
  const width = Math.round(Math.min(640, Math.max(state.widths[col] || 96, measure(value) + 28)));
  if (width !== state.widths[col]) {
    state.widths[col] = width;
    applyTemplate();
  }
  if (row === 0 && state.hasHeader) paintHeaderName(col);
  paintLiveCell(row, col);
  renderInspector();
  updateFormulaButtons();
}

function restoreOrigin() {
  if (!editOrigin || !state.rows[editOrigin.row]) {
    editOrigin = null;
    return;
  }
  const { row, col, value, rowLen } = editOrigin;
  state.rowLens[row] = rowLen;
  if (col < state.rows[row].length) state.rows[row][col] = value;
  if (col < state.colCount) state.flags[row * state.colCount + col] = ExcelsiorCSV.classify(col < rowLen ? value : "");
  state.dirty = editOrigin.dirty;
  fileNameEl.classList.toggle("is-dirty", state.dirty);
  editOrigin = null;
  if (row === 0 && state.hasHeader) paintHeaderName(col);
  paintLiveCell(row, col);
}

function finalizeEdit() {
  if (!editOrigin) return;
  const { row, value, rowLen } = editOrigin;
  const current = cellStored(row, editOrigin.col);
  const changed = current !== value || state.rowLens[row] !== rowLen;
  editOrigin = null;
  if (!changed) return;
  state.dirty = true;
  state.encoding = "UTF-8";
  state.text = ExcelsiorCSV.serializeCSV(rowsForSave(), state.delimiter);
  state.byteLength = new TextEncoder().encode(state.text).length;
  analyze();
  rebuildIndices();
  if (row === 0 && state.hasHeader) renderHeader();
  renderWindow();
  renderInspector();
  renderStatus();
  syncControls();
  rememberFile();
}

function updateFormulaButtons() {
  const active = document.activeElement === formulaInput && !formulaInput.disabled;
  formulaCancel.disabled = !(active || draftDiffers());
  formulaCommit.disabled = !draftDiffers();
}

function fillEditor(force = false) {
  const sameCell =
    state.selected &&
    formulaInput.dataset.row === String(state.selected.row) &&
    formulaInput.dataset.col === String(state.selected.col);
  if (!force && document.activeElement === formulaInput && sameCell) {
    cellLabel.textContent = colName(state.selected.col);
    updateFormulaButtons();
    return;
  }
  if (!state.selected || !state.rows.length || !state.colCount) {
    formulaInput.value = "";
    formulaInput.disabled = true;
    formulaInput.placeholder = state.highlightCol == null ? "Select a cell" : "Column highlighted";
    delete formulaInput.dataset.row;
    delete formulaInput.dataset.col;
    if (state.highlightCol == null) {
      cellRef.textContent = "—";
      cellLabel.textContent = "";
    } else {
      cellRef.textContent = columnLetter(state.highlightCol);
      cellLabel.textContent = colName(state.highlightCol);
    }
    fitEditor();
    updateFormulaButtons();
    return;
  }
  const { row, col } = state.selected;
  formulaInput.disabled = false;
  formulaInput.placeholder = "Edit this field";
  formulaInput.value = cellStored(row, col);
  formulaInput.dataset.row = String(row);
  formulaInput.dataset.col = String(col);
  cellRef.textContent = `${columnLetter(col)}${row + 1}`;
  cellLabel.textContent = colName(col);
  nameBoxTitle();
  fitEditor();
  updateFormulaButtons();
}

function nameBoxTitle() {
  const box = document.getElementById("name-box");
  if (!state.selected) {
    box.title = "Selected cell";
    return;
  }
  box.title = `${cellRef.textContent} · ${colName(state.selected.col)}`;
}

function commitEditor() {
  if (formulaInput.disabled || formulaInput.dataset.row == null) return;
  previewEdit();
  finalizeEdit();
  updateFormulaButtons();
}

function cancelEditor() {
  restoreOrigin();
  if (state.selected) formulaInput.value = cellStored(state.selected.row, state.selected.col);
  else formulaInput.value = "";
  fitEditor();
  updateFormulaButtons();
  scroller.focus();
}

function focusEditor(selectAll) {
  if (formulaInput.disabled) return;
  formulaInput.focus();
  const end = formulaInput.value.length;
  formulaInput.setSelectionRange(selectAll ? 0 : end, end);
  updateFormulaButtons();
}

function insertEditorNewline() {
  const start = formulaInput.selectionStart ?? formulaInput.value.length;
  const end = formulaInput.selectionEnd ?? start;
  formulaInput.value = `${formulaInput.value.slice(0, start)}\n${formulaInput.value.slice(end)}`;
  formulaInput.selectionStart = formulaInput.selectionEnd = start + 1;
  fitEditor();
  previewEdit();
}

function saveEdited() {
  if (!state.fileName || !state.rows.length) return;
  commitEditor();
  const text = ExcelsiorCSV.serializeCSV(rowsForSave(), state.delimiter);
  state.text = text;
  state.byteLength = new TextEncoder().encode(text).length;
  downloadBlob(state.fileName, new Blob([text], { type: "text/csv;charset=utf-8" }));
  state.dirty = false;
  syncControls();
  toast("Saved the edited CSV");
}

function saveView() {
  if (!state.fileName) return;
  const rows = [];
  if (state.hasHeader && state.rows[0]) rows.push(state.rows[0].slice(0, state.rowLens[0]));
  for (const index of state.indices) rows.push(state.rows[index].slice(0, state.rowLens[index]));
  const text = ExcelsiorCSV.serializeCSV(rows, state.delimiter);
  const name = state.fileName.replace(/\.csv$/i, "") + "-view.csv";
  downloadBlob(name, new Blob([text], { type: "text/csv;charset=utf-8" }));
}

function columnCopyText(col) {
  const lines = [];
  if (state.hasHeader && state.rows[0]) lines.push(col < state.rowLens[0] ? state.rows[0][col] ?? "" : "");
  for (const row of state.indices) lines.push(col < state.rowLens[row] ? state.rows[row][col] ?? "" : "");
  return lines.join("\n");
}

function selectColumn(col) {
  state.highlightCol = state.highlightCol === col ? null : col;
  renderHeader();
  if (state.query) {
    rebuildIndices();
    scroller.scrollTop = 0;
  }
  renderWindow();
  renderInspector();
  renderStatus();
  fillEditor();
}

async function copyText(text, message) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.left = "-9999px";
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
  toast(message);
}

function toast(message) {
  toastEl.textContent = message;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.hidden = true;
  }, 2200);
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function scheduleWindow() {
  if (scrollRaf) return;
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = 0;
    headScroll.scrollLeft = scroller.scrollLeft;
    renderWindow();
  });
}

function selectionKey(row, col) {
  return `${row}:${col}`;
}

function cellInSelection(row, col) {
  return !!(state.selection && state.selection.has(selectionKey(row, col)));
}

function rangeKeys(from, to) {
  const keys = new Set();
  if (!from || !to) return keys;
  let posA = state.indices.indexOf(from.row);
  let posB = state.indices.indexOf(to.row);
  if (posA === -1 || posB === -1) {
    keys.add(selectionKey(to.row, to.col));
    return keys;
  }
  const r1 = Math.min(posA, posB);
  const r2 = Math.max(posA, posB);
  const c1 = Math.min(from.col, to.col);
  const c2 = Math.max(from.col, to.col);
  for (let pos = r1; pos <= r2; pos++) {
    const row = state.indices[pos];
    for (let col = c1; col <= c2; col++) keys.add(selectionKey(row, col));
  }
  return keys;
}

function clearColumnHighlight() {
  if (state.highlightCol == null) return;
  state.highlightCol = null;
  renderHeader();
  if (state.query) {
    rebuildIndices();
    renderStatus();
  }
}

function selectCell(row, col, scroll, keepSelection = false) {
  state.selected = { row, col };
  if (!keepSelection) {
    state.anchor = { row, col };
    state.selection = new Set([selectionKey(row, col)]);
  }
  if (scroll) scrollCellIntoView();
  renderWindow();
  renderInspector();
  renderStatus();
  fillEditor();
}

function extendSelection(row, col, scroll, add) {
  clearColumnHighlight();
  const anchor = state.anchor || state.selected || { row, col };
  state.anchor = anchor;
  const keys = rangeKeys(anchor, { row, col });
  if (add && state.selection) {
    for (const key of keys) state.selection.add(key);
  } else {
    state.selection = keys;
  }
  selectCell(row, col, scroll, true);
}

function toggleCellSelection(row, col) {
  clearColumnHighlight();
  if (!state.selection) state.selection = new Set();
  const key = selectionKey(row, col);
  if (state.selection.has(key) && state.selection.size > 1) {
    state.selection.delete(key);
    const [next] = [...state.selection].slice(-1);
    const [nextRow, nextCol] = next.split(":").map(Number);
    state.anchor = { row: nextRow, col: nextCol };
    selectCell(nextRow, nextCol, false, true);
    return;
  }
  state.selection.add(key);
  state.anchor = { row, col };
  selectCell(row, col, false, true);
}

function selectionCopyText() {
  const cells = [];
  for (const key of state.selection) {
    const [row, col] = key.split(":").map(Number);
    cells.push({ row, col });
  }
  cells.sort((a, b) => {
    const pos = state.indices.indexOf(a.row) - state.indices.indexOf(b.row);
    return pos || a.col - b.col;
  });
  const lines = [];
  let current = null;
  let parts = [];
  for (const cell of cells) {
    if (current !== cell.row) {
      if (current !== null) lines.push(parts.join("\t"));
      current = cell.row;
      parts = [];
    }
    parts.push(cellStored(cell.row, cell.col));
  }
  if (parts.length) lines.push(parts.join("\t"));
  return lines.join("\n");
}

function scrollCellIntoView() {
  if (!state.selected) return;
  const pos = state.indices.indexOf(state.selected.row);
  if (pos === -1) return;
  const rowH = rowHeight();
  const top = pos * rowH;
  const bottom = top + rowH;
  if (top < scroller.scrollTop) scroller.scrollTop = top;
  else if (bottom > scroller.scrollTop + scroller.clientHeight) {
    scroller.scrollTop = bottom - scroller.clientHeight;
  }
  const left = scaled(state.gutter) + state.widths.slice(0, state.selected.col).reduce((sum, width) => sum + scaled(width), 0);
  const right = left + scaled(state.widths[state.selected.col] || 0);
  if (left < scroller.scrollLeft + state.gutter) scroller.scrollLeft = Math.max(0, left - state.gutter);
  else if (right > scroller.scrollLeft + scroller.clientWidth) {
    scroller.scrollLeft = right - scroller.clientWidth + 16;
  }
}

function moveSelection(dRow, dCol, extend) {
  if (!state.indices.length || !state.colCount) return;
  if (!state.selected || state.indices.indexOf(state.selected.row) === -1) {
    selectCell(state.indices[0], 0, true);
    return;
  }
  let rowPos = state.indices.indexOf(state.selected.row);
  let col = state.selected.col;
  rowPos = Math.max(0, Math.min(state.indices.length - 1, rowPos + dRow));
  col = Math.max(0, Math.min(state.colCount - 1, col + dCol));
  const row = state.indices[rowPos];
  if (extend) extendSelection(row, col, true, false);
  else selectCell(row, col, true);
}

function autosize(col) {
  let width = measure(colName(col).toUpperCase()) + 48;
  const limit = Math.min(state.indices.length, 300);
  for (let i = 0; i < limit; i++) {
    const index = state.indices[i];
    if (col < state.rowLens[index]) width = Math.max(width, measure(state.rows[index][col]) + 28);
  }
  state.widths[col] = Math.round(Math.min(640, Math.max(96, width)));
  applyTemplate();
  renderWindow();
}

function hasFiles(event) {
  return [...(event.dataTransfer?.types || [])].includes("Files");
}

document.getElementById("open-btn").addEventListener("click", chooseFile);
document.getElementById("empty-open").addEventListener("click", chooseFile);
document.getElementById("toolbar-open").addEventListener("click", chooseFile);
document.getElementById("close-btn").addEventListener("click", closeFile);
document.getElementById("download-edited").addEventListener("click", saveEdited);
document.getElementById("download-original").addEventListener("click", saveOriginal);
document.getElementById("download-view").addEventListener("click", saveView);
document.getElementById("trim-spaces").addEventListener("click", trimSpaces);
document.getElementById("sample-btn").addEventListener("click", () => {
  state.originalBuffer = null;
  state.encoding = "UTF-8";
  state.byteLength = new TextEncoder().encode(ExcelsiorCSV.SAMPLE_TEXT).length;
  state.delimiterChoice = "auto";
  openText("Example — values Excel changes.csv", ExcelsiorCSV.SAMPLE_TEXT, { newFile: true });
});

fileInput.addEventListener("change", () => {
  const file = fileInput.files && fileInput.files[0];
  fileInput.value = "";
  if (file) onFile(file);
});

delimiterSelect.addEventListener("change", () => {
  if (!state.text) return;
  state.delimiterChoice = delimiterSelect.value;
  openText(state.fileName, state.text, { newFile: false });
});

headerToggle.addEventListener("change", () => {
  state.hasHeader = headerToggle.checked;
  if (state.rows.length > 1) {
    prefs.hasHeader = state.hasHeader;
    savePrefs();
  }
  analyze();
  rebuildIndices();
  renderAll();
});

riskToggle.addEventListener("change", () => {
  state.markRisks = riskToggle.checked;
  savePrefs();
  renderHeader();
  renderWindow();
});

spaceToggle.addEventListener("change", () => {
  state.showSpaces = spaceToggle.checked;
  savePrefs();
  renderWindow();
});

monoToggle.addEventListener("change", () => {
  state.mono = monoToggle.checked;
  sheet.classList.toggle("mono", state.mono);
  savePrefs();
});

searchInput.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.query = searchInput.value;
    rebuildIndices();
    scroller.scrollTop = 0;
    renderWindow();
    renderStatus();
  }, 80);
});

searchInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    findNext(event.shiftKey ? -1 : 1);
  } else if (event.key === "Escape") {
    event.preventDefault();
    closeFind();
    scroller.focus();
  }
});

replaceInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    replaceOne();
  } else if (event.key === "Escape") {
    event.preventDefault();
    closeFind();
    scroller.focus();
  }
});

document.getElementById("find-close").addEventListener("click", () => {
  closeFind();
  scroller.focus();
});

document.getElementById("zoom-out").addEventListener("click", () => setZoom(state.zoom - 0.1));
document.getElementById("zoom-in").addEventListener("click", () => setZoom(state.zoom + 0.1));
document.getElementById("zoom-fit").addEventListener("click", fitColumns);
zoomRange.addEventListener("input", () => setZoom(Number(zoomRange.value) / 100));

sheet.addEventListener(
  "wheel",
  (event) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    setZoom(state.zoom + (event.deltaY > 0 ? -0.1 : 0.1));
  },
  { passive: false },
);

document.getElementById("find-next").addEventListener("click", () => findNext(1));
document.getElementById("find-prev").addEventListener("click", () => findNext(-1));
document.getElementById("replace-one").addEventListener("click", replaceOne);
document.getElementById("replace-all").addEventListener("click", replaceAll);

headLine.addEventListener("click", (event) => {
  if (event.target.closest(".resize")) return;
  const button = event.target.closest("button[data-col]");
  if (!button) return;
  selectColumn(Number(button.dataset.col));
});

headLine.addEventListener("mousedown", (event) => {
  const handle = event.target.closest(".resize");
  if (!handle) return;
  event.preventDefault();
  const col = Number(handle.dataset.col);
  const startX = event.clientX;
  const startW = state.widths[col];
  document.body.classList.add("resizing");
  function onMove(moveEvent) {
    state.widths[col] = Math.max(80, Math.round(startW + (moveEvent.clientX - startX) / state.zoom));
    applyTemplate();
  }
  function onUp() {
    document.body.classList.remove("resizing");
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
  }
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
});

headLine.addEventListener("dblclick", (event) => {
  const handle = event.target.closest(".resize");
  if (!handle) return;
  autosize(Number(handle.dataset.col));
});

viewport.addEventListener("click", (event) => {
  const cell = event.target.closest(".cell");
  if (!cell) return;
  const row = Number(cell.parentElement.dataset.index);
  const col = Number(cell.dataset.col);
  const extend = event.shiftKey;
  const toggle = event.ctrlKey || event.metaKey;
  if (extend) extendSelection(row, col, false, toggle);
  else if (toggle) toggleCellSelection(row, col);
  else selectCell(row, col, false);
});

viewport.addEventListener("contextmenu", (event) => {
  if (event.ctrlKey && event.target.closest(".cell")) event.preventDefault();
});

viewport.addEventListener("dblclick", (event) => {
  const cell = event.target.closest(".cell");
  if (!cell) return;
  selectCell(Number(cell.parentElement.dataset.index), Number(cell.dataset.col), false);
  focusEditor(true);
});

formulaInput.addEventListener("input", () => {
  fitEditor();
  previewEdit();
});

formulaInput.addEventListener("focus", () => {
  rememberOrigin();
  if (state.selected && formulaInput.value !== cellStored(state.selected.row, state.selected.col)) previewEdit();
  else updateFormulaButtons();
});

formulaInput.addEventListener("blur", () => {
  commitEditor();
  updateFormulaButtons();
});

formulaInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.altKey) {
    event.preventDefault();
    commitEditor();
    moveSelection(1, 0);
  } else if (event.key === "Enter" && event.altKey) {
    event.preventDefault();
    insertEditorNewline();
  } else if (event.key === "Escape") {
    event.preventDefault();
    cancelEditor();
  } else if (event.key === "Tab") {
    event.preventDefault();
    commitEditor();
    moveSelection(0, event.shiftKey ? -1 : 1);
  }
});

formulaCancel.addEventListener("mousedown", (event) => event.preventDefault());
formulaCommit.addEventListener("mousedown", (event) => event.preventDefault());
formulaCancel.addEventListener("click", cancelEditor);
formulaCommit.addEventListener("click", () => {
  commitEditor();
  scroller.focus();
});

scroller.addEventListener("scroll", scheduleWindow, { passive: true });
headScroll.addEventListener(
  "wheel",
  (event) => {
    scroller.scrollLeft += event.deltaX;
    scroller.scrollTop += event.deltaY;
    event.preventDefault();
  },
  { passive: false },
);

if (typeof ResizeObserver !== "undefined") {
  const observer = new ResizeObserver(() => {
    syncScrollbar();
    if (state.rows.length) renderWindow();
  });
  observer.observe(scroller);
}

document.addEventListener("keydown", (event) => {
  const typing = event.target instanceof Element && event.target.closest("input, textarea, select");
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "o") {
    event.preventDefault();
    chooseFile();
    return;
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
    event.preventDefault();
    focusFind();
    return;
  }
  if (event.ctrlKey && !event.metaKey && !event.altKey && event.key.toLowerCase() === "h") {
    event.preventDefault();
    focusReplace();
    return;
  }
  if ((event.metaKey || event.ctrlKey) && (event.key === "-" || event.key === "_")) {
    event.preventDefault();
    if (!workspace.hidden) setZoom(state.zoom - 0.1);
    return;
  }
  if ((event.metaKey || event.ctrlKey) && (event.key === "=" || event.key === "+")) {
    event.preventDefault();
    if (!workspace.hidden) setZoom(state.zoom + 0.1);
    return;
  }
  if ((event.metaKey || event.ctrlKey) && event.key === "0") {
    event.preventDefault();
    if (!workspace.hidden) setZoom(1);
    return;
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    if (!workspace.hidden) saveEdited();
    return;
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "c" && !typing) {
    if (state.selection && state.selection.size > 1) {
      event.preventDefault();
      copyText(selectionCopyText(), `Copied ${state.selection.size.toLocaleString("en-US")} fields`);
      return;
    }
    if (state.highlightCol != null) {
      event.preventDefault();
      const col = state.highlightCol;
      copyText(columnCopyText(col), `Copied column ${columnLetter(col)}`);
      return;
    }
    if (state.selected) {
      const { row, col } = state.selected;
      if (col < state.rowLens[row]) {
        event.preventDefault();
        copyText(state.rows[row][col], "Copied as written");
      }
    }
    return;
  }
  if (typing || workspace.hidden) return;
  const page = Math.max(1, Math.floor(scroller.clientHeight / rowHeight()) - 1);
  if (event.key === "ArrowDown") {
    event.preventDefault();
    moveSelection(1, 0, event.shiftKey);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    moveSelection(-1, 0, event.shiftKey);
  } else if (event.key === "ArrowRight") {
    event.preventDefault();
    moveSelection(0, 1, event.shiftKey);
  } else if (event.key === "ArrowLeft") {
    event.preventDefault();
    moveSelection(0, -1, event.shiftKey);
  } else if (event.key === "PageDown") {
    event.preventDefault();
    moveSelection(page, 0, event.shiftKey);
  } else if (event.key === "PageUp") {
    event.preventDefault();
    moveSelection(-page, 0, event.shiftKey);
  } else if (event.key === "Escape") {
    if (!findDialog.hidden) {
      closeFind();
      return;
    }
    state.selected = null;
    state.anchor = null;
    state.selection = new Set();
    const hadColumn = state.highlightCol != null;
    state.highlightCol = null;
    if (hadColumn) renderHeader();
    if (hadColumn && state.query) {
      rebuildIndices();
      renderStatus();
    }
    renderWindow();
    renderInspector();
    fillEditor();
  } else if (event.key === "F2") {
    if (!state.selected) return;
    event.preventDefault();
    focusEditor(false);
  } else if (event.key === "Delete" || event.key === "Backspace") {
    if (!state.selected) return;
    event.preventDefault();
    if (state.selection && state.selection.size > 1) {
      for (const key of state.selection) {
        const [row, col] = key.split(":").map(Number);
        applyCellEdit(row, col, "", false);
      }
      refreshAfterEdit(state.selected.row);
      return;
    }
    applyCellEdit(state.selected.row, state.selected.col, "");
    fillEditor();
  } else if (event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey) {
    if (!state.selected) return;
    event.preventDefault();
    const { row, col } = state.selected;
    selectCell(row, col, false);
    fillEditor();
    formulaInput.value = event.key;
    fitEditor();
    focusEditor(false);
    updateFormulaButtons();
  }
});

window.addEventListener("beforeunload", (event) => {
  if (!state.dirty) return;
  event.preventDefault();
  event.returnValue = "";
});

let dragDepth = 0;
window.addEventListener("dragenter", (event) => {
  if (!hasFiles(event)) return;
  event.preventDefault();
  dragDepth += 1;
  drop.hidden = false;
});
window.addEventListener("dragleave", () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) drop.hidden = true;
});
window.addEventListener("dragover", (event) => {
  if (!hasFiles(event)) return;
  event.preventDefault();
});
window.addEventListener("drop", (event) => {
  if (!hasFiles(event)) return;
  event.preventDefault();
  dragDepth = 0;
  drop.hidden = true;
  const file = event.dataTransfer.files && event.dataTransfer.files[0];
  if (file) onFile(file);
});

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredPrompt = event;
  installBtn.hidden = false;
});
installBtn.addEventListener("click", async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  installBtn.hidden = true;
});
window.addEventListener("appinstalled", () => {
  installBtn.hidden = true;
  deferredPrompt = null;
});

if ("serviceWorker" in navigator && (location.protocol === "http:" || location.protocol === "https:")) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

sheet.classList.toggle("mono", state.mono);
renderRecent();
renderInspector();
