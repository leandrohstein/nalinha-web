import { getVehicleData } from "./services/vehicleDataService.js";
import { syncDayToCache } from "./services/dataSyncService.js";
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
import { APP_VERSION } from "./version.js";

const ui = {
  status: document.querySelector("#status"),
  dataTimeText: document.querySelector("#dataTimeText"),
  resultOutput: document.querySelector("#resultOutput"),
  loadButton: document.querySelector("#loadDataBtn"),
  loadHistoricalBtn: document.querySelector("#loadHistoricalBtn"),
  viewMovementLink: document.querySelector("#viewMovementLink"),
  freshnessDot: document.querySelector("#freshnessDot"),
  pageSizeSelect: document.querySelector("#pageSizeSelect"),
  prevPageBtn: document.querySelector("#prevPageBtn"),
  nextPageBtn: document.querySelector("#nextPageBtn"),
  pageInfo: document.querySelector("#pageInfo"),
  searchInput: document.querySelector("#searchInput"),
  clearSearchBtn: document.querySelector("#clearSearchBtn"),
  searchModeLinhaBtn: document.querySelector("#searchModeLinhaBtn"),
  searchModePrefixoBtn: document.querySelector("#searchModePrefixoBtn"),
  totalCount: document.querySelector("#totalCount"),
  preloadTooltip: document.querySelector("#preloadTooltip"),
  autoUpdateBtn: document.querySelector("#autoUpdateBtn"),
  historicalModal: document.querySelector("#historicalModal"),
  historicalDateInput: document.querySelector("#historicalDateInput"),
  cancelHistoricalBtn: document.querySelector("#cancelHistoricalBtn"),
  confirmHistoricalBtn: document.querySelector("#confirmHistoricalBtn"),
  versionChip: document.querySelector("#versionChip"),
};

ui.versionChip.textContent = `v${APP_VERSION}`;

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
let statusHideTimer = null;
let preloadHideTimer = null;
let searchAnalyticsTimer = null;
let lastTrackedSearchKey = "";
let mobileSearchMode = "linha";

const CHIP_AUTO_HIDE_MS = 30 * 1000;
const SEARCH_ANALYTICS_DEBOUNCE_MS = 500;

function trackGaEvent(eventName, params = {}) {
  if (typeof window.gtag !== "function") {
    return;
  }

  window.gtag("event", eventName, params);
}

function getSearchAnalyticsPayload(rawSearchValue = getEffectiveSearchValue()) {
  const trimmedValue = rawSearchValue.trim();
  if (!trimmedValue) {
    return null;
  }

  const colonIndex = trimmedValue.indexOf(":");
  if (colonIndex <= 0) {
    return null;
  }

  const searchType = normalizeText(trimmedValue.slice(0, colonIndex)).toLowerCase();
  const searchTerm = trimmedValue.slice(colonIndex + 1).trim();

  if (!searchTerm || !["linha", "prefixo"].includes(searchType)) {
    return null;
  }

  return {
    search_term: searchTerm,
    search_type: searchType === "linha" ? "Linha" : "Prefixo",
    results_count: paginationState.rows.length,
  };
}

function resetSearchAnalyticsTracking() {
  if (searchAnalyticsTimer !== null) {
    clearTimeout(searchAnalyticsTimer);
    searchAnalyticsTimer = null;
  }

  lastTrackedSearchKey = "";
}

function scheduleSearchAnalytics() {
  if (searchAnalyticsTimer !== null) {
    clearTimeout(searchAnalyticsTimer);
  }

  searchAnalyticsTimer = setTimeout(() => {
    searchAnalyticsTimer = null;

    const payload = getSearchAnalyticsPayload();
    if (!payload) {
      lastTrackedSearchKey = "";
      return;
    }

    const trackingKey = `${payload.search_type}:${payload.search_term}`;
    if (trackingKey === lastTrackedSearchKey) {
      return;
    }

    lastTrackedSearchKey = trackingKey;
    trackGaEvent("search", payload);
  }, SEARCH_ANALYTICS_DEBOUNCE_MS);
}

function isMobileSearchModeActive() {
  return window.matchMedia("(max-width: 768px)").matches;
}

function getEffectiveSearchValue() {
  const rawValue = ui.searchInput.value.trim();

  if (!isMobileSearchModeActive()) {
    return rawValue;
  }

  if (!rawValue) {
    return rawValue;
  }

  if (rawValue.includes(":")) {
    return rawValue;
  }

  return `${mobileSearchMode}:${rawValue}`;
}

function updateMobileSearchModeButtons() {
  ui.searchModeLinhaBtn?.classList.toggle("active", mobileSearchMode === "linha");
  ui.searchModePrefixoBtn?.classList.toggle("active", mobileSearchMode === "prefixo");
}

async function applyCurrentSearchAndRender() {
  paginationState.rows = applySearch(getEffectiveSearchValue(), paginationState);
  paginationState.currentPage = 1;
  await renderCurrentPage();
}

function startStatusAutoHide() {
  if (statusHideTimer !== null) {
    return;
  }

  statusHideTimer = setTimeout(() => {
    ui.status.classList.add("chip-hidden");
    statusHideTimer = null;
  }, CHIP_AUTO_HIDE_MS);
}

function startPreloadAutoHide() {
  if (preloadHideTimer !== null) {
    return;
  }

  preloadHideTimer = setTimeout(() => {
    ui.preloadTooltip.classList.add("chip-hidden");
    preloadHideTimer = null;
  }, CHIP_AUTO_HIDE_MS);
}

const preloadState = {
  running: false,
  loopPromise: null,
  activeDateKey: "",
};

function getDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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
  ui.preloadTooltip.classList.remove("chip-hidden");

  if (tone) {
    ui.preloadTooltip.classList.add(tone);
  }

  startPreloadAutoHide();
}

async function runPreloadCycle(dateKey) {
  try {
    const result = await syncDayToCache(dateKey, {
      onStep: ({ targetDate, status }) => {
        const targetLabel = formatTargetLabel(targetDate);

        if (status === "network") {
          setPreloadTooltip(`Pre-cache OK (rede) para ${targetLabel}`, "success");
        } else if (status === "cache") {
          setPreloadTooltip(`Pre-cache OK (cache) para ${targetLabel}`, "success");
        } else if (status === "missing") {
          setPreloadTooltip(`Pre-cache: sem dados (404) para ${targetLabel}`);
        } else {
          setPreloadTooltip(`Pre-cache falhou as ${formatTooltipClock()} para ${targetLabel}`, "error");
        }
      },
      isCancelled: () => !preloadState.running,
    });

    if (!result.cancelled) {
      setPreloadTooltip(
        `Pre-cache concluido para ${result.rangeEnd.toLocaleDateString("pt-BR")} (00:00-${formatTooltipClock(result.rangeEnd)}).`,
        "success"
      );
      preloadState.running = false;
    }
  } finally {
    preloadState.loopPromise = null;
  }
}

async function startPreloadCycle(options = {}) {
  const { referenceDate = new Date(), forceRestart = false } = options;

  if (preloadState.running && !forceRestart) {
    return;
  }

  if (preloadState.running && forceRestart) {
    preloadState.running = false;
    if (preloadState.loopPromise) {
      await preloadState.loopPromise;
    }
  }

  const dateKey = getDateKey(referenceDate);
  preloadState.activeDateKey = dateKey;
  preloadState.running = true;

  setPreloadTooltip(`Pre-cache: ciclo ativo para ${referenceDate.toLocaleDateString("pt-BR")}`);
  preloadState.loopPromise = runPreloadCycle(dateKey);
}

function setStatus(message) {
  uiSetStatus(ui, message);
  ui.status.classList.remove("chip-hidden");

  startStatusAutoHide();
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

function getColumnClassName(headerName) {
  const normalized = normalizeText(headerName);

  if (normalized === "REFRESH") {
    return "col-refresh";
  }

  if (normalized === "LAT") {
    return "col-lat";
  }

  if (normalized === "LON") {
    return "col-lon";
  }

  return "";
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
    .map((headerName) => {
      const displayHeader = getDisplayHeaderName(headerName);
      const columnClass = getColumnClassName(headerName);
      const classAttr = columnClass ? ` class="${columnClass}"` : "";
      return `<th${classAttr}>${escapeHtml(displayHeader)}</th>`;
    })
    .join("");

  const startIndex = (currentPage - 1) * pageSize;
  const pageRows = rows.slice(startIndex, startIndex + pageSize);

  const lineMap = await buildLineMap(headerNames, pageRows);
  const vehicleTypeMap = await buildVehicleTypeMap(headerNames, pageRows);

  const bodyHtml = pageRows
    .map((row) => {
      const cells = Array.from({ length: columnCount }, (_, index) => row[index])
        .map((cellValue, index) => {
          const headerName = headerNames[index] || "";
          const displayHeader = getDisplayHeaderName(headerName);
          const columnClass = getColumnClassName(headerName);
          const classAttr = columnClass ? ` class="${columnClass}"` : "";
          return `<td${classAttr} data-label="${escapeHtml(displayHeader)}">${renderCellContent(headerName, cellValue, lineMap, vehicleTypeMap)}</td>`;
        })
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
  paginationState.columnCount = columnCount;
  paginationState.headerNames = headerNames;
  paginationState.currentPage = 1;
  paginationState.pageSize = Number(ui.pageSizeSelect.value);
  paginationState.rows = applySearch(getEffectiveSearchValue(), paginationState);

  await renderCurrentPage();
}

function clearResult() {
  ui.resultOutput.innerHTML = "";
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
  await applyCurrentSearchAndRender();
  scheduleSearchAnalytics();
});

ui.clearSearchBtn?.addEventListener("click", async () => {
  resetSearchAnalyticsTracking();
  ui.searchInput.value = "";
  await applyCurrentSearchAndRender();
  ui.searchInput.focus();
  trackGaEvent("clear_search");
});

ui.searchModeLinhaBtn?.addEventListener("click", async () => {
  mobileSearchMode = "linha";
  updateMobileSearchModeButtons();
  await applyCurrentSearchAndRender();
  trackGaEvent("select_search_type", { search_type: "Linha" });
  scheduleSearchAnalytics();
});

ui.searchModePrefixoBtn?.addEventListener("click", async () => {
  mobileSearchMode = "prefixo";
  updateMobileSearchModeButtons();
  await applyCurrentSearchAndRender();
  trackGaEvent("select_search_type", { search_type: "Prefixo" });
  scheduleSearchAnalytics();
});

updateMobileSearchModeButtons();

ui.status.addEventListener("click", () => {
  ui.status.classList.add("chip-hidden");
  if (statusHideTimer !== null) {
    clearTimeout(statusHideTimer);
    statusHideTimer = null;
  }
  trackGaEvent("dismiss_ui_chip", { chip: "status" });
});

ui.preloadTooltip.addEventListener("click", () => {
  ui.preloadTooltip.classList.add("chip-hidden");
  if (preloadHideTimer !== null) {
    clearTimeout(preloadHideTimer);
    preloadHideTimer = null;
  }
  trackGaEvent("dismiss_ui_chip", { chip: "preload" });
});

startStatusAutoHide();
startPreloadAutoHide();

window.addEventListener("blur", scheduleAutoUpdateFocusGuard);
window.addEventListener("focus", clearAutoUpdateFocusTimer);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    scheduleAutoUpdateFocusGuard();
    return;
  }

  clearAutoUpdateFocusTimer();
});

ui.autoUpdateBtn.addEventListener("click", () => {
  autoUpdate?.toggle();
  trackGaEvent("toggle_auto_update", {
    enabled: autoUpdate?.enabled ? "on" : "off",
  });
});
ui.loadButton.addEventListener("click", () => {
  const previousView = isHistoricalViewActive ? "historical" : "current";
  isHistoricalViewActive = false;
  updateLoadButtonState();
  trackGaEvent("load_current_data", { previous_view: previousView });
  fetchCurrentData();
});
ui.loadHistoricalBtn.addEventListener("click", () => {
  trackGaEvent("open_historical_modal");
  openHistoricalModal();
});

ui.viewMovementLink?.addEventListener("click", () => {
  trackGaEvent("open_movement_view");
});

ui.cancelHistoricalBtn.addEventListener("click", () => {
  trackGaEvent("close_historical_modal", { method: "cancel_button" });
  closeHistoricalModal();
});

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
  trackGaEvent("load_historical_data");
  const loaded = await fetchCurrentData(selectedDate, { showFreshnessDot: false });

  if (loaded) {
    isHistoricalViewActive = true;
    updateLoadButtonState();
    await startPreloadCycle({
      referenceDate: selectedDate,
      forceRestart: true,
    });
  }
});

ui.historicalModal.addEventListener("click", (event) => {
  if (event.target === ui.historicalModal) {
    trackGaEvent("close_historical_modal", { method: "overlay_click" });
    closeHistoricalModal();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && ui.historicalModal.classList.contains("open")) {
    trackGaEvent("close_historical_modal", { method: "escape_key" });
    closeHistoricalModal();
  }
});

ui.pageSizeSelect.addEventListener("change", async () => {
  paginationState.pageSize = Number(ui.pageSizeSelect.value);
  paginationState.currentPage = 1;
  await renderCurrentPage();
  trackGaEvent("change_page_size", { page_size: paginationState.pageSize });
});

ui.prevPageBtn.addEventListener("click", async () => {
  if (paginationState.currentPage > 1) {
    const previousPage = paginationState.currentPage;
    paginationState.currentPage -= 1;
    await renderCurrentPage();
    trackGaEvent("paginate", {
      direction: "previous",
      from_page: previousPage,
      to_page: paginationState.currentPage,
    });
  }
});

ui.nextPageBtn.addEventListener("click", async () => {
  const totalPages = paginationState.rows.length > 0
    ? Math.ceil(paginationState.rows.length / paginationState.pageSize)
    : 0;

  if (paginationState.currentPage < totalPages) {
    const previousPage = paginationState.currentPage;
    paginationState.currentPage += 1;
    await renderCurrentPage();
    trackGaEvent("paginate", {
      direction: "next",
      from_page: previousPage,
      to_page: paginationState.currentPage,
    });
  }
});

updatePaginationControls(0);
getLineData().catch(() => {});
getVehicleTypeData().catch(() => {});
fetchCurrentData().finally(() => {
  startPreloadCycle({ referenceDate: new Date() });
});
autoUpdate?.start();
updateLoadButtonState();
