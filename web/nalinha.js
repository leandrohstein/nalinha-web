import { cacheRepository } from "./services/cacheRepository.js";
import { buildDataUrl, buildDateTimeKey, getVehicleData } from "./services/vehicleDataService.js";
import { getByCod, getLineData } from "./services/lineDataService.js";
import { getById as getVehicleTypeById, getVehicleTypeData } from "./services/vehicleTypeDataService.js";
import {
  closeHistoricalModal as closeUiHistoricalModal,
  escapeHtml as uiEscapeHtml,
  formatCellValue as uiFormatCellValue,
  formatDataDateTime as uiFormatDataDateTime,
  normalizeText as uiNormalizeText,
  openHistoricalModal as openUiHistoricalModal,
  renderCellContent as uiRenderCellContent,
  setFreshnessDot as uiSetFreshnessDot,
  setFreshnessVisibility as uiSetFreshnessVisibility,
  setStatus as uiSetStatus,
  updatePaginationControls as uiUpdatePaginationControls,
} from "./ui/nalinhaUi.js";
import { applySearch } from "./ui/search.js";

const ui = {
  status: document.querySelector("#status"),
  dataTimeText: document.querySelector("#dataTimeText"),
  resultOutput: document.querySelector("#resultOutput"),
  loadButton: document.querySelector("#loadDataBtn"),
  loadHistoricalBtn: document.querySelector("#loadHistoricalBtn"),
  freshnessDot: document.querySelector("#freshnessDot"),
  pageSizeSelect: document.querySelector("#pageSizeSelect"),
  prevPageBtn: document.querySelector("#prevPageBtn"),
  nextPageBtn: document.querySelector("#nextPageBtn"),
  pageInfo: document.querySelector("#pageInfo"),
  searchInput: document.querySelector("#searchInput"),
  totalCount: document.querySelector("#totalCount"),
  preloadTooltip: document.querySelector("#preloadTooltip"),
  autoUpdateBtn: document.querySelector("#autoUpdateBtn"),
  historicalModal: document.querySelector("#historicalModal"),
  historicalDateInput: document.querySelector("#historicalDateInput"),
  cancelHistoricalBtn: document.querySelector("#cancelHistoricalBtn"),
  confirmHistoricalBtn: document.querySelector("#confirmHistoricalBtn"),
};

const paginationState = {
  rows: [],
  allRows: [],
  headerNames: [],
  columnCount: 0,
  currentPage: 1,
  pageSize: 50,
};

const HEADER_LABEL_MAP = {
  COD: "Prefixo",
  REFRESH: "Atualização",
  LAT: "Lat",
  LON: "Lon",
  CODIGOLINHA: "Linha",
  ADAPT: "Adaptado",
  TIPO_VEIC: "Tipo Veículo",
  TABELA: "Tabela",
  SITUACAO: "Situação",
  SENT: "Sentido",
};

let autoUpdate = null;
let isHistoricalViewActive = false;
let autoUpdateFocusTimer = null;

const preloadState = {
  running: false,
  loopPromise: null,
  mode: "current",
  nextTargetDate: null,
  dayStartDate: null,
  activeDateKey: "",
  missingUrls404: new Set(),
};

function getDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfDay(date) {
  const day = new Date(date);
  day.setHours(0, 0, 0, 0);
  return day;
}

function previousMinute(date) {
  return new Date(date.getTime() - 60 * 1000);
}

function endOfDay(date) {
  const day = new Date(date);
  day.setHours(23, 59, 0, 0);
  return day;
}

function resetPreloadCursor(referenceDate = new Date(), mode = "current") {
  const dayStart = startOfDay(referenceDate);
  const target = mode === "full-day"
    ? endOfDay(referenceDate)
    : new Date(referenceDate);

  if (mode !== "full-day") {
    target.setSeconds(0, 0);
  }

  preloadState.mode = mode;
  preloadState.nextTargetDate = target;
  preloadState.activeDateKey = getDateKey(target);
  preloadState.dayStartDate = dayStart;
  preloadState.missingUrls404.clear();
}

async function preloadOneMinute(targetDate) {
  const url = buildDataUrl(targetDate);
  const dateTimeKey = buildDateTimeKey(targetDate);

  if (preloadState.missingUrls404.has(url)) {
    return { status: "skip-404", url };
  }

  const cached = await cacheRepository.get(dateTimeKey);
  if (cached !== null) {
    return { status: "cache", url };
  }

  const response = await fetch(url, { method: "GET" });

  if (response.status === 404) {
    preloadState.missingUrls404.add(url);
    return { status: "missing", url };
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} - ${response.statusText}`);
  }

  const data = await response.json();
  await cacheRepository.set(dateTimeKey, data, url);
  return { status: "network", url };
}

function formatTooltipClock(date = new Date()) {
  return date.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatTargetLabel(date) {
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function setPreloadTooltip(message, tone = "") {
  ui.preloadTooltip.textContent = message;
  ui.preloadTooltip.classList.remove("success", "error");

  if (tone) {
    ui.preloadTooltip.classList.add(tone);
  }
}

async function runPreloadLoop() {
  while (preloadState.running) {
    if (preloadState.mode === "current") {
      const now = new Date();
      const currentDateKey = getDateKey(now);

      if (!preloadState.nextTargetDate || preloadState.activeDateKey !== currentDateKey) {
        resetPreloadCursor(now, "current");
      }
    }

    const dayStart = preloadState.dayStartDate || startOfDay(new Date());
    const targetDate = new Date(preloadState.nextTargetDate.getTime());

    if (targetDate < dayStart) {
      const finalLabel = preloadState.mode === "full-day"
        ? `Pre-cache concluido para ${dayStart.toLocaleDateString("pt-BR")} (00:00-23:59).`
        : "Pre-cache concluido ate 00:00 da data atual.";

      setPreloadTooltip(finalLabel, "success");
      preloadState.running = false;
      break;
    }

    setPreloadTooltip(`Pre-cache: verificando ${targetDate.toLocaleString("pt-BR")}`);

    try {
      const result = await preloadOneMinute(targetDate);
      const targetLabel = formatTargetLabel(targetDate);

      if (result.status === "network") {
        setPreloadTooltip(`Pre-cache OK (rede) para ${targetLabel}`, "success");
      } else if (result.status === "cache") {
        setPreloadTooltip(`Pre-cache OK (cache) para ${targetLabel}`, "success");
      } else if (result.status === "missing") {
        setPreloadTooltip(`Pre-cache: sem dados (404) para ${targetLabel}`);
      } else {
        setPreloadTooltip(`Pre-cache: 404 previamente conhecido para ${targetLabel}`);
      }

      preloadState.nextTargetDate = previousMinute(targetDate);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setPreloadTooltip(
        `Pre-cache falhou as ${formatTooltipClock()}: ${message}`,
        "error"
      );
      preloadState.nextTargetDate = previousMinute(targetDate);
    }
  }

  preloadState.loopPromise = null;
}

async function startPreloadCycle(options = {}) {
  const {
    referenceDate = new Date(),
    mode = "current",
    forceRestart = false,
  } = options;

  if (preloadState.running && !forceRestart) {
    return;
  }

  if (preloadState.running && forceRestart) {
    preloadState.running = false;
    if (preloadState.loopPromise) {
      await preloadState.loopPromise;
    }
  }

  resetPreloadCursor(referenceDate, mode);
  const cycleLabel = mode === "full-day"
    ? `Pre-cache: ciclo ativo para ${startOfDay(referenceDate).toLocaleDateString("pt-BR")}`
    : "Pre-cache: ciclo ativo";
  setPreloadTooltip(cycleLabel);
  preloadState.running = true;
  preloadState.loopPromise = runPreloadLoop();
}

function setStatus(message) {
  uiSetStatus(ui, message);
}

function updateLoadButtonState() {
  if (isHistoricalViewActive) {
    ui.loadButton.textContent = "Tempo Real";
    ui.loadButton.disabled = false;
    return;
  }

  ui.loadButton.textContent = "Atualizar";
  ui.loadButton.disabled = Boolean(autoUpdate?.enabled);
}

function escapeHtml(value) {
  return uiEscapeHtml(value);
}

function getOutputArray(data) {
  if (data !== null && typeof data === "object") {
    return Object.values(data);
  }

  return [data];
}

function toRowValues(item) {
  if (item !== null && typeof item === "object") {
    return Object.values(item);
  }

  return [item];
}

function normalizeRows(data) {
  const outputArray = getOutputArray(data);
  return outputArray.map((item) => toRowValues(item));
}

function getMaxColumnCount(rows) {
  return rows.reduce((max, row) => Math.max(max, row.length), 0);
}

function getHeaderNames(data, columnCount) {
  const outputArray = getOutputArray(data);
  const headerNames = Array.from({ length: columnCount }, (_, index) => `Valor ${index + 1}`);

  outputArray.forEach((item) => {
    if (item !== null && typeof item === "object" && !Array.isArray(item)) {
      const keys = Object.keys(item);
      keys.forEach((key, index) => {
        if (index < headerNames.length && headerNames[index].startsWith("Valor ")) {
          headerNames[index] = key;
        }
      });
    }
  });

  return headerNames;
}

function formatCellValue(value) {
  return uiFormatCellValue(value);
}

function normalizeText(value) {
  return uiNormalizeText(value);
}

function renderCellContent(headerName, cellValue, lineMap = {}, vehicleTypeMap = {}) {
  if (normalizeText(headerName) === "TIPO_VEIC") {
    const key = String(cellValue ?? "");
    const label = vehicleTypeMap[key] ?? "";
    return escapeHtml(label);
  }

  return uiRenderCellContent(headerName, cellValue, lineMap);
}

function updatePaginationControls(totalRows) {
  uiUpdatePaginationControls(ui, paginationState, totalRows);
}

function getDisplayHeaderName(headerName) {
  const normalized = normalizeText(headerName);
  return HEADER_LABEL_MAP[normalized] || headerName;
}

async function buildLineMap(headerNames, pageRows) {
  const codigoIndex = headerNames.findIndex(
    (h) => normalizeText(h) === "CODIGOLINHA"
  );

  if (codigoIndex === -1) {
    return {};
  }

  const uniqueCodes = [...new Set(pageRows.map((row) => String(row[codigoIndex] ?? "")).filter(Boolean))];
  const entries = await Promise.all(
    uniqueCodes.map(async (cod) => {
      if (normalizeText(cod) === "REC") {
        return [cod, "FORA DE OPERAÇÃO"];
      }

      const line = await getByCod(cod);
      const label = line ? `${line.COD}-${line.NOME}` : cod;
      return [cod, label];
    })
  );

  return Object.fromEntries(entries);
}

async function buildVehicleTypeMap(headerNames, pageRows) {
  const tipoVeicIndex = headerNames.findIndex(
    (h) => normalizeText(h) === "TIPO_VEIC"
  );

  if (tipoVeicIndex === -1) {
    return {};
  }

  const uniqueIds = [...new Set(pageRows.map((row) => String(row[tipoVeicIndex] ?? "")).filter(Boolean))];
  const entries = await Promise.all(
    uniqueIds.map(async (id) => {
      const item = await getVehicleTypeById(id);
      const label = item ? String(item.nome ?? "") : "";
      return [id, label];
    })
  );

  return Object.fromEntries(entries);
}

async function renderCurrentPage() {
  const { rows, columnCount, headerNames, currentPage, pageSize } = paginationState;

  if (rows.length === 0 || columnCount === 0) {
    ui.resultOutput.innerHTML = '<div class="empty-result">Sem linhas para exibir.</div>';
    updatePaginationControls(0);
    return;
  }

  const headerHtml = headerNames
    .map((headerName) => `<th>${escapeHtml(getDisplayHeaderName(headerName))}</th>`)
    .join("");

  const startIndex = (currentPage - 1) * pageSize;
  const pageRows = rows.slice(startIndex, startIndex + pageSize);

  const lineMap = await buildLineMap(headerNames, pageRows);
  const vehicleTypeMap = await buildVehicleTypeMap(headerNames, pageRows);

  const bodyHtml = pageRows
    .map((row) => {
      const cells = Array.from({ length: columnCount }, (_, index) => row[index])
        .map((cellValue, index) => `<td>${renderCellContent(headerNames[index] || "", cellValue, lineMap, vehicleTypeMap)}</td>`)
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");

  ui.resultOutput.innerHTML = `<table><thead><tr>${headerHtml}</tr></thead><tbody>${bodyHtml}</tbody></table>`;
  updatePaginationControls(rows.length);
}

function applyColumnTransforms(headerNames, rows) {
  const normalizedHeaders = headerNames.map(normalizeText);
  const indicesToRemove = new Set();

  normalizedHeaders.forEach((h, i) => {
    if (h === "TCOUNT") {
      indicesToRemove.add(i);
    }
  });

  const situacaoIndex = normalizedHeaders.indexOf("SITUACAO");
  const situacao2Index = normalizedHeaders.indexOf("SITUACAO2");

  let transformedRows = rows;
  if (situacaoIndex !== -1 && situacao2Index !== -1) {
    indicesToRemove.add(situacao2Index);
    transformedRows = rows.map((row) => {
      const newRow = [...row];
      const s1 = formatCellValue(row[situacaoIndex]);
      const s2 = formatCellValue(row[situacao2Index]);
      const parts = [s1, s2].filter(Boolean);
      newRow[situacaoIndex] = parts.join(" / ");
      return newRow;
    });
  }

  if (indicesToRemove.size === 0) {
    return { headerNames, rows: transformedRows };
  }

  const keepIndices = headerNames.map((_, i) => i).filter((i) => !indicesToRemove.has(i));

  return {
    headerNames: keepIndices.map((i) => headerNames[i]),
    rows: transformedRows.map((row) => keepIndices.map((i) => row[i])),
  };
}

async function showResult(data) {
  const rawRows = normalizeRows(data);
  const rawColumnCount = getMaxColumnCount(rawRows);
  const rawHeaderNames = getHeaderNames(data, rawColumnCount);

  const { headerNames, rows } = applyColumnTransforms(rawHeaderNames, rawRows);
  const columnCount = getMaxColumnCount(rows);

  paginationState.allRows = rows;
  paginationState.rows = rows;
  paginationState.columnCount = columnCount;
  paginationState.headerNames = headerNames;
  paginationState.currentPage = 1;
  paginationState.pageSize = Number(ui.pageSizeSelect.value);
  ui.searchInput.value = "";

  await renderCurrentPage();
}

function clearResult() {
  ui.resultOutput.innerHTML = "";
  ui.searchInput.value = "";
  paginationState.rows = [];
  paginationState.allRows = [];
  paginationState.headerNames = [];
  paginationState.columnCount = 0;
  paginationState.currentPage = 1;
  updatePaginationControls(0);
}

function formatDataDateTime(baseTime, minuteOffset) {
  return uiFormatDataDateTime(baseTime, minuteOffset);
}

function setFreshnessDot(minuteOffset) {
  uiSetFreshnessDot(ui, minuteOffset);
}

function openHistoricalModal() {
  openUiHistoricalModal(ui);
}

function closeHistoricalModal() {
  closeUiHistoricalModal(ui);
}

async function fetchCurrentData(baseDate = new Date(), options = {}) {
  const { showFreshnessDot = true } = options;
  const now = baseDate instanceof Date ? baseDate : new Date(baseDate);

  if (Number.isNaN(now.getTime())) {
    setStatus("Data inválida para carregar dados.");
    return false;
  }

  ui.dataTimeText.textContent = "Calculando...";
  setStatus("Verificando cache...");
  clearResult();
  uiSetFreshnessVisibility(ui, showFreshnessDot);

  if (showFreshnessDot) {
    setFreshnessDot(-1);
  }

  try {
    const result = await getVehicleData(now);
    ui.dataTimeText.textContent = formatDataDateTime(now, result.minuteOffset);

    if (showFreshnessDot) {
      setFreshnessDot(result.minuteOffset);
    }

    await showResult(result.data);

    const usedHistory = result.minuteOffset > 0;
    const historyLabel = usedHistory
      ? ` (historico: ${result.minuteOffset} min)`
      : "";

    if (result.source === "cache") {
      setStatus(`Dados carregados do IndexedDB (cache)${historyLabel}.`);
      return true;
    }

    setStatus(`Busca concluída e dados salvos no IndexedDB${historyLabel}.`);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ui.dataTimeText.textContent = "Sem dados";

    if (showFreshnessDot) {
      setFreshnessDot(-1);
    }

    clearResult();
    setStatus(`Falha na busca: ${message}`);
    return false;
  }
}

async function syncCurrentDataToCache() {
  try {
    await getVehicleData(new Date());
    return true;
  } catch {
    return false;
  }
}

const AUTO_UPDATE_INTERVAL_MS = 60 * 1000;
const AUTO_UPDATE_MAX_FAILURES = 5;
const AUTO_UPDATE_FOCUS_TIMEOUT_MS = 5 * 60 * 1000;

function clearAutoUpdateFocusTimer() {
  if (autoUpdateFocusTimer !== null) {
    clearTimeout(autoUpdateFocusTimer);
    autoUpdateFocusTimer = null;
  }
}

function isWindowInactive() {
  return document.hidden || !document.hasFocus();
}

function scheduleAutoUpdateFocusGuard() {
  clearAutoUpdateFocusTimer();

  if (!isWindowInactive()) {
    return;
  }

  autoUpdateFocusTimer = setTimeout(() => {
    autoUpdateFocusTimer = null;

    if (isWindowInactive() && autoUpdate?.enabled) {
      autoUpdate.stop();
      setStatus("Auto-atualizacao desligada: janela sem foco por mais de 5 minutos.");
    }
  }, AUTO_UPDATE_FOCUS_TIMEOUT_MS);
}

autoUpdate = {
  enabled: true,
  failures: 0,
  timerId: null,

  setEnabled(enabled) {
    this.enabled = enabled;
    ui.autoUpdateBtn.textContent = enabled ? "Auto: ON" : "Auto: OFF";
    ui.autoUpdateBtn.classList.toggle("stopped", !enabled);
    updateLoadButtonState();
  },

  stop() {
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
    this.setEnabled(false);
  },

  start() {
    this.failures = 0;
    this.setEnabled(true);
    this.scheduleNext();
  },

  scheduleNext() {
    if (!this.enabled) {
      return;
    }

    if (this.timerId !== null) {
      clearTimeout(this.timerId);
    }

    this.timerId = setTimeout(async () => {
      this.timerId = null;

      const success = isHistoricalViewActive
        ? await syncCurrentDataToCache()
        : await fetchCurrentData();

      if (success) {
        this.failures = 0;
      } else {
        this.failures += 1;
      }

      if (this.failures >= AUTO_UPDATE_MAX_FAILURES) {
        this.stop();
        setStatus("Auto-atualização desligada após 5 falhas consecutivas.");
        return;
      }

      this.scheduleNext();
    }, AUTO_UPDATE_INTERVAL_MS);
  },

  toggle() {
    if (this.enabled) {
      this.stop();
      return;
    }

    this.start();
  },
};

ui.searchInput.addEventListener("input", async () => {
  paginationState.rows = applySearch(ui.searchInput.value, paginationState);
  paginationState.currentPage = 1;
  await renderCurrentPage();
});

window.addEventListener("blur", scheduleAutoUpdateFocusGuard);
window.addEventListener("focus", clearAutoUpdateFocusTimer);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    scheduleAutoUpdateFocusGuard();
    return;
  }

  clearAutoUpdateFocusTimer();
});

ui.autoUpdateBtn.addEventListener("click", () => autoUpdate?.toggle());
ui.loadButton.addEventListener("click", () => {
  isHistoricalViewActive = false;
  updateLoadButtonState();
  fetchCurrentData();
});
ui.loadHistoricalBtn.addEventListener("click", openHistoricalModal);

ui.cancelHistoricalBtn.addEventListener("click", closeHistoricalModal);

ui.confirmHistoricalBtn.addEventListener("click", async () => {
  const rawValue = ui.historicalDateInput.value;
  if (!rawValue) {
    setStatus("Selecione data e hora para carregar.");
    return;
  }

  const selectedDate = new Date(rawValue);
  if (Number.isNaN(selectedDate.getTime())) {
    setStatus("Data informada inválida.");
    return;
  }

  if (selectedDate >= new Date()) {
    setStatus("Selecione uma data anterior ao momento atual.");
    return;
  }

  closeHistoricalModal();
  const loaded = await fetchCurrentData(selectedDate, { showFreshnessDot: false });

  if (loaded) {
    isHistoricalViewActive = true;
    updateLoadButtonState();
    await startPreloadCycle({
      referenceDate: selectedDate,
      mode: "full-day",
      forceRestart: true,
    });
  }
});

ui.historicalModal.addEventListener("click", (event) => {
  if (event.target === ui.historicalModal) {
    closeHistoricalModal();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && ui.historicalModal.classList.contains("open")) {
    closeHistoricalModal();
  }
});

ui.pageSizeSelect.addEventListener("change", async () => {
  paginationState.pageSize = Number(ui.pageSizeSelect.value);
  paginationState.currentPage = 1;
  await renderCurrentPage();
});

ui.prevPageBtn.addEventListener("click", async () => {
  if (paginationState.currentPage > 1) {
    paginationState.currentPage -= 1;
    await renderCurrentPage();
  }
});

ui.nextPageBtn.addEventListener("click", async () => {
  const totalPages = paginationState.rows.length > 0
    ? Math.ceil(paginationState.rows.length / paginationState.pageSize)
    : 0;

  if (paginationState.currentPage < totalPages) {
    paginationState.currentPage += 1;
    await renderCurrentPage();
  }
});

updatePaginationControls(0);
getLineData().catch(() => {});
getVehicleTypeData().catch(() => {});
fetchCurrentData().finally(() => {
  startPreloadCycle({
    referenceDate: previousMinute(new Date()),
    mode: "current",
  });
});
autoUpdate?.start();
updateLoadButtonState();
