import { getMovementTrack, getDateKey, MOVEMENT_MAX_GAP_MS } from "./services/movementDataService.js";
import { getLineData } from "./services/lineDataService.js";
import { getVehicleTypeData } from "./services/vehicleTypeDataService.js";
import { syncDayToCache } from "./services/dataSyncService.js";
import {
  buildTooltipHtml,
  computeFilteredCods,
  formatClock,
  formatDateLabel,
  getInterpolatedPoint,
  getMarkerColor,
  isOutOfService,
  toDateInputValue,
} from "./ui/movimentacaoUi.js";

const DEFAULT_CENTER = [-25.4284, -49.2733];
const DEFAULT_ZOOM = 12;
const MARKER_SIZE = 10;

function createHexIcon() {
  return L.divIcon({
    className: "vehicle-hex-marker",
    html: '<div class="hex-shape"></div>',
    iconSize: [MARKER_SIZE, MARKER_SIZE],
    iconAnchor: [MARKER_SIZE / 2, MARKER_SIZE / 2],
  });
}

const ui = {
  status: document.querySelector("#status"),
  dateInput: document.querySelector("#movementDateInput"),
  loadBtn: document.querySelector("#loadMovementBtn"),
  rebuildBtn: document.querySelector("#rebuildMovementBtn"),
  searchInput: document.querySelector("#movementSearchInput"),
  clearSearchBtn: document.querySelector("#clearMovementSearchBtn"),
  restartBtn: document.querySelector("#restartBtn"),
  playPauseBtn: document.querySelector("#playPauseBtn"),
  currentTimeLabel: document.querySelector("#currentTimeLabel"),
  totalTimeLabel: document.querySelector("#totalTimeLabel"),
  seekRange: document.querySelector("#seekRange"),
  seekHourMarks: document.querySelector("#seekHourMarks"),
  speedSelect: document.querySelector("#speedSelect"),
  syncOverlay: document.querySelector("#syncOverlay"),
  syncOverlayMessage: document.querySelector("#syncOverlayMessage"),
  cancelSyncBtn: document.querySelector("#cancelSyncBtn"),
  recenterBtn: null,
  hideOutOfServiceCheckbox: null,
};

const state = {
  track: null,
  filteredCods: null,
  visibleCods: [],
  playing: false,
  currentTime: null,
  rafId: null,
  lastFrameWallClock: null,
  markers: new Map(),
  wasPlayingBeforeSeek: false,
  syncToken: 0,
  hideOutOfService: false,
};

function setStatus(message) {
  ui.status.textContent = message;
  ui.status.classList.remove("chip-hidden");
}

function showSyncOverlay(message, options = {}) {
  const { cancellable = false } = options;
  ui.syncOverlayMessage.textContent = message;
  ui.cancelSyncBtn.classList.toggle("hidden", !cancellable);
  ui.syncOverlay.classList.remove("hidden");
}

function hideSyncOverlay() {
  ui.syncOverlay.classList.add("hidden");
}

function updateDataControlsAvailability() {
  const hasTrack = Boolean(state.track);

  ui.searchInput.disabled = !hasTrack;
  ui.clearSearchBtn.disabled = !hasTrack;
  ui.restartBtn.disabled = !hasTrack;
  ui.playPauseBtn.disabled = !hasTrack;
  ui.seekRange.disabled = !hasTrack;
  ui.speedSelect.disabled = !hasTrack;
}

function trackGaEvent(eventName, params = {}) {
  if (typeof window.gtag !== "function") {
    return;
  }

  window.gtag("event", eventName, params);
}

const map = L.map("map", { zoomControl: true }).setView(DEFAULT_CENTER, DEFAULT_ZOOM);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  maxZoom: 19,
}).addTo(map);
const markerLayer = L.layerGroup().addTo(map);

const RecenterControl = L.Control.extend({
  options: { position: "topleft" },

  onAdd() {
    const container = L.DomUtil.create("div", "leaflet-bar leaflet-control");

    this.recenterBtn = L.DomUtil.create("a", "leaflet-control-recenter", container);
    this.recenterBtn.href = "#";
    this.recenterBtn.title = "Centralizar mapa nos veículos";
    this.recenterBtn.setAttribute("role", "button");
    this.recenterBtn.setAttribute("aria-label", "Centralizar mapa nos veículos");
    this.recenterBtn.innerHTML = "🎯";

    L.DomEvent.disableClickPropagation(container);

    return container;
  },
});

const recenterControl = new RecenterControl();
recenterControl.addTo(map);
ui.recenterBtn = recenterControl.recenterBtn;

ui.recenterBtn.addEventListener("click", (event) => {
  event.preventDefault();
  trackGaEvent("recenter_map");

  if (state.track) {
    fitMapToTrack(state.track);
  } else {
    map.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
  }
});

const MapControls = L.Control.extend({
  options: { position: "topright" },

  onAdd() {
    const container = L.DomUtil.create("div", "leaflet-control map-controls-panel");
    L.DomEvent.disableClickPropagation(container);
    L.DomEvent.disableScrollPropagation(container);

    const checkboxLabel = L.DomUtil.create("label", "map-control-checkbox", container);
    this.hideOutOfServiceCheckbox = L.DomUtil.create("input", "", checkboxLabel);
    this.hideOutOfServiceCheckbox.type = "checkbox";
    checkboxLabel.appendChild(document.createTextNode("Ocultar fora de operação"));

    return container;
  },
});

const mapControls = new MapControls();
mapControls.addTo(map);
ui.hideOutOfServiceCheckbox = mapControls.hideOutOfServiceCheckbox;

ui.hideOutOfServiceCheckbox.addEventListener("change", () => {
  state.hideOutOfService = ui.hideOutOfServiceCheckbox.checked;
  trackGaEvent("toggle_hide_out_of_service", { hidden: state.hideOutOfService });

  if (state.track) {
    renderFrame(state.currentTime);
  }
});

function recomputeVisibleCods() {
  state.visibleCods = state.track
    ? state.filteredCods
      ? [...state.filteredCods]
      : Object.keys(state.track.vehicles)
    : [];
}

function clearMarkers() {
  markerLayer.clearLayers();
  state.markers.clear();
}

function renderFrame(t) {
  const track = state.track;
  if (!track) {
    return;
  }

  const activeCods = new Set();

  for (const cod of state.visibleCods) {
    const frames = track.vehicles[cod];
    const point = getInterpolatedPoint(frames, t, MOVEMENT_MAX_GAP_MS);

    if (!point) {
      continue;
    }

    const outOfService = isOutOfService(point.codigolinha);

    if (outOfService && state.hideOutOfService) {
      continue;
    }

    activeCods.add(cod);

    let marker = state.markers.get(cod);
    if (!marker) {
      marker = L.marker([point.lat, point.lon], { icon: createHexIcon() }).addTo(markerLayer);
      marker.bindTooltip("", { direction: "top", offset: [0, -8] });
      state.markers.set(cod, marker);
    } else {
      marker.setLatLng([point.lat, point.lon]);
    }

    const markerEl = marker.getElement();
    const hexEl = markerEl?.querySelector(".hex-shape");

    if (hexEl) {
      hexEl.style.background = getMarkerColor(point.situacao);
    }

    markerEl?.classList.toggle("vehicle-hex-marker--out-of-service", outOfService);
    marker.setZIndexOffset(outOfService ? -1000 : 0);
    marker.setTooltipContent(buildTooltipHtml(cod, point, track));
  }

  for (const [cod, marker] of state.markers) {
    if (!activeCods.has(cod)) {
      markerLayer.removeLayer(marker);
      state.markers.delete(cod);
    }
  }

  const suffix = state.filteredCods ? ` de ${state.visibleCods.length} filtrado(s)` : "";
  setStatus(
    `${activeCods.size} veículo${activeCods.size !== 1 ? "s" : ""} em tela${suffix} — ${formatDateLabel(track.dateKey)} ${formatClock(t)}`
  );
}

function updateSeekUi() {
  if (!state.track || state.currentTime === null) {
    return;
  }

  ui.seekRange.value = String(state.currentTime - state.track.startTime);
  ui.currentTimeLabel.textContent = formatClock(state.currentTime);
}

function renderHourMarks(track) {
  ui.seekHourMarks.innerHTML = "";

  if (!track) {
    return;
  }

  const { startTime, endTime } = track;
  const totalDuration = endTime - startTime;

  if (totalDuration <= 0) {
    return;
  }

  const firstHour = new Date(startTime);
  firstHour.setMinutes(0, 0, 0);
  if (firstHour.getTime() < startTime) {
    firstHour.setHours(firstHour.getHours() + 1);
  }

  for (let hourTime = firstHour.getTime(); hourTime <= endTime; hourTime += 60 * 60 * 1000) {
    const percent = ((hourTime - startTime) / totalDuration) * 100;
    const hourLabel = String(new Date(hourTime).getHours()).padStart(2, "0");

    const mark = document.createElement("button");
    mark.type = "button";
    mark.className = "seek-hour-mark";
    mark.style.left = `${percent}%`;
    mark.title = `Saltar para ${hourLabel}:00`;
    mark.setAttribute("aria-label", `Saltar para ${hourLabel}:00`);
    mark.textContent = hourLabel;

    mark.addEventListener("click", () => {
      trackGaEvent("movement_jump_hour", { hour: hourLabel });
      jumpToTime(hourTime);
    });

    ui.seekHourMarks.appendChild(mark);
  }
}

function jumpToTime(targetTime) {
  if (!state.track) {
    return;
  }

  const wasPlaying = state.playing;
  pause();

  state.currentTime = Math.min(Math.max(targetTime, state.track.startTime), state.track.endTime);
  renderFrame(state.currentTime);
  updateSeekUi();

  if (wasPlaying) {
    play();
  }
}

function updatePlayPauseUi() {
  ui.playPauseBtn.textContent = state.playing ? "⏸" : "▶";
}

function pause() {
  state.playing = false;
  if (state.rafId !== null) {
    cancelAnimationFrame(state.rafId);
    state.rafId = null;
  }
  state.lastFrameWallClock = null;
  updatePlayPauseUi();
}

function tick(nowWallClock) {
  if (!state.playing || !state.track) {
    return;
  }

  if (state.lastFrameWallClock === null) {
    state.lastFrameWallClock = nowWallClock;
  }

  const deltaMs = nowWallClock - state.lastFrameWallClock;
  state.lastFrameWallClock = nowWallClock;

  const speedMinutesPerSecond = Number(ui.speedSelect.value) || 1;
  const simulatedDeltaMs = deltaMs * speedMinutesPerSecond * 60;

  state.currentTime = Math.min(state.currentTime + simulatedDeltaMs, state.track.endTime);

  renderFrame(state.currentTime);
  updateSeekUi();

  if (state.currentTime >= state.track.endTime) {
    pause();
    return;
  }

  state.rafId = requestAnimationFrame(tick);
}

function play() {
  if (!state.track || state.playing) {
    return;
  }

  if (state.currentTime >= state.track.endTime) {
    state.currentTime = state.track.startTime;
  }

  state.playing = true;
  state.lastFrameWallClock = null;
  updatePlayPauseUi();
  state.rafId = requestAnimationFrame(tick);
}

function restart() {
  pause();

  if (!state.track) {
    return;
  }

  state.currentTime = state.track.startTime;
  renderFrame(state.currentTime);
  updateSeekUi();
}

function fitMapToTrack(track) {
  const points = [];

  for (const frames of Object.values(track.vehicles)) {
    if (frames.length > 0) {
      points.push([frames[0].lat, frames[0].lon]);
    }
  }

  if (points.length === 0) {
    return;
  }

  map.fitBounds(L.latLngBounds(points), { padding: [24, 24] });
}

function applyFilter() {
  state.filteredCods = state.track ? computeFilteredCods(state.track, ui.searchInput.value) : null;
  recomputeVisibleCods();

  if (state.track) {
    renderFrame(state.currentTime);
  }
}

async function loadDate(dateKey, options = {}) {
  const { forceRebuild = false } = options;

  pause();
  clearMarkers();
  state.track = null;
  state.currentTime = null;
  updateDataControlsAvailability();
  renderHourMarks(null);

  const syncToken = ++state.syncToken;
  const isCancelled = () => state.syncToken !== syncToken;

  try {
    if (!forceRebuild) {
      showSyncOverlay(`Sincronizando dados de ${formatDateLabel(dateKey)}... (0%)`, { cancellable: true });

      const syncResult = await syncDayToCache(dateKey, {
        onStep: ({ processed, total }) => {
          const percent = total > 0 ? Math.floor((processed / total) * 100) : 100;
          showSyncOverlay(`Sincronizando dados de ${formatDateLabel(dateKey)}... (${percent}%)`, { cancellable: true });
        },
        isCancelled,
      });

      if (syncResult.cancelled || isCancelled()) {
        return;
      }

      showSyncOverlay(`Validando e processando trajetos sincronizados de ${formatDateLabel(dateKey)}...`);
    } else {
      showSyncOverlay("Reprocessando trajetos a partir do IndexedDB...");
    }

    const track = await getMovementTrack(dateKey, { forceRebuild: true });

    if (isCancelled()) {
      return;
    }

    hideSyncOverlay();

    if (!track.timeline.length) {
      setStatus(
        `Nenhum dado disponível para ${formatDateLabel(dateKey)} após a sincronização. Tente novamente mais tarde ou escolha outra data.`
      );
      ui.seekRange.max = "0";
      ui.seekRange.value = "0";
      ui.currentTimeLabel.textContent = "--:--:--";
      ui.totalTimeLabel.textContent = "--:--:--";
      return;
    }

    state.track = track;
    updateDataControlsAvailability();
    state.filteredCods = computeFilteredCods(track, ui.searchInput.value);
    recomputeVisibleCods();
    state.currentTime = track.startTime;

    ui.seekRange.max = String(track.endTime - track.startTime);
    ui.seekRange.value = "0";
    ui.totalTimeLabel.textContent = formatClock(track.endTime);
    renderHourMarks(track);

    fitMapToTrack(track);
    renderFrame(state.currentTime);
    updateSeekUi();

    const vehicleCount = Object.keys(track.vehicles).length;
    setStatus(`Trajetos prontos: ${vehicleCount} veículo(s), ${track.timeline.length} instantâneo(s) em ${formatDateLabel(dateKey)}.`);
  } catch (error) {
    if (isCancelled()) {
      return;
    }

    hideSyncOverlay();
    const message = error instanceof Error ? error.message : String(error);
    setStatus(`Falha ao processar trajetos: ${message}`);
  }
}

ui.loadBtn.addEventListener("click", () => {
  const dateKey = ui.dateInput.value;
  if (!dateKey) {
    setStatus("Selecione uma data.");
    return;
  }

  trackGaEvent("load_movement_date", { date: dateKey });
  loadDate(dateKey);
});

ui.rebuildBtn.addEventListener("click", () => {
  const dateKey = ui.dateInput.value;
  if (!dateKey) {
    setStatus("Selecione uma data.");
    return;
  }

  trackGaEvent("rebuild_movement_date", { date: dateKey });
  loadDate(dateKey, { forceRebuild: true });
});

ui.cancelSyncBtn.addEventListener("click", () => {
  trackGaEvent("cancel_movement_sync");
  state.syncToken += 1;
  hideSyncOverlay();
  setStatus("Sincronização cancelada. Selecione uma data e clique em Carregar para tentar novamente.");
});

ui.searchInput.addEventListener("input", () => {
  applyFilter();
});

ui.clearSearchBtn.addEventListener("click", () => {
  ui.searchInput.value = "";
  applyFilter();
  ui.searchInput.focus();
});

ui.restartBtn.addEventListener("click", () => {
  trackGaEvent("movement_restart");
  restart();
});

ui.playPauseBtn.addEventListener("click", () => {
  if (state.playing) {
    trackGaEvent("movement_pause");
    pause();
    return;
  }

  trackGaEvent("movement_play");
  play();
});

ui.seekRange.addEventListener("pointerdown", () => {
  state.wasPlayingBeforeSeek = state.playing;
  pause();
});

ui.seekRange.addEventListener("input", () => {
  if (!state.track) {
    return;
  }

  const offset = Number(ui.seekRange.value);
  state.currentTime = state.track.startTime + offset;
  renderFrame(state.currentTime);
  ui.currentTimeLabel.textContent = formatClock(state.currentTime);
});

ui.seekRange.addEventListener("change", () => {
  if (state.wasPlayingBeforeSeek) {
    play();
  }
  state.wasPlayingBeforeSeek = false;
});

ui.status.addEventListener("click", () => {
  ui.status.classList.add("chip-hidden");
});

async function bootstrap() {
  const todayKey = getDateKey(new Date());
  ui.dateInput.max = todayKey;
  ui.dateInput.value = toDateInputValue(new Date());
  updateDataControlsAvailability();

  setStatus("Carregando dados de linhas e tipos de veículo...");
  await Promise.allSettled([getLineData(), getVehicleTypeData()]);
  setStatus("Selecione uma data e clique em Carregar para sincronizar e visualizar a movimentação.");
}

bootstrap();
