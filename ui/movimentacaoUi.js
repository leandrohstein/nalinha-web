import { escapeHtml, getSituationDotClass, normalizeText } from "./nalinhaUi.js";

const SITUATION_COLOR_MAP = {
  "status-dot--red": "#dc2626",
  "status-dot--yellow": "#f59e0b",
  "status-dot--green": "#16a34a",
  "status-dot--gray": "#6b7280",
};

function lowerBoundIndex(frames, t) {
  let lo = 0;
  let hi = frames.length;

  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].t <= t) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }

  return lo - 1;
}

export function getInterpolatedPoint(frames, t, maxGapMs) {
  if (!frames || frames.length === 0) {
    return null;
  }

  const idx = lowerBoundIndex(frames, t);
  if (idx === -1) {
    return null;
  }

  const a = frames[idx];

  if (idx === frames.length - 1) {
    return t - a.t <= maxGapMs ? { ...a, ratio: 0 } : null;
  }

  const b = frames[idx + 1];

  if (b.t - a.t > maxGapMs) {
    return t - a.t <= maxGapMs ? { ...a, ratio: 0 } : null;
  }

  const ratio = (t - a.t) / (b.t - a.t);

  return {
    t,
    lat: a.lat + (b.lat - a.lat) * ratio,
    lon: a.lon + (b.lon - a.lon) * ratio,
    codigolinha: ratio < 0.5 ? a.codigolinha : b.codigolinha,
    tipoVeic: ratio < 0.5 ? a.tipoVeic : b.tipoVeic,
    situacao: ratio < 0.5 ? a.situacao : b.situacao,
    sent: ratio < 0.5 ? a.sent : b.sent,
    tabela: ratio < 0.5 ? a.tabela : b.tabela,
    adapt: ratio < 0.5 ? a.adapt : b.adapt,
    stale: ratio < 0.5 ? a.stale : b.stale,
    ratio,
  };
}

export function getMarkerColor(situacao) {
  const dotClass = getSituationDotClass(situacao || "");
  return SITUATION_COLOR_MAP[dotClass] || SITUATION_COLOR_MAP["status-dot--gray"];
}

export function isOutOfService(codigolinha) {
  return String(codigolinha ?? "").trim().toUpperCase() === "REC";
}

export function parseVehicleFilter(rawInput) {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    return null;
  }

  const colonIndex = trimmed.indexOf(":");
  if (colonIndex <= 0) {
    return null;
  }

  const field = trimmed.slice(0, colonIndex).trim().toLowerCase();
  const value = normalizeText(trimmed.slice(colonIndex + 1));

  if (!value || (field !== "linha" && field !== "prefixo")) {
    return null;
  }

  return { field, value };
}

export function computeFilteredCods(track, filter) {
  if (!filter) {
    return null;
  }

  const allCods = Object.keys(track.vehicles);

  if (filter.field === "prefixo") {
    return new Set(allCods.filter((cod) => normalizeText(cod).startsWith(filter.value)));
  }

  // "linha": candidatos sao os veiculos que passam pela linha em algum
  // momento do dia; a exibicao efetiva de cada quadro e decidida em tempo
  // real por matchesCurrentFilter, pois um veiculo pode trocar de linha.
  return new Set(
    allCods.filter((cod) =>
      track.vehicles[cod].some((frame) => normalizeText(frame.codigolinha).startsWith(filter.value))
    )
  );
}

export function matchesCurrentFilter(filter, point) {
  if (!filter || filter.field !== "linha") {
    return true;
  }

  return isOutOfService(point.codigolinha) || normalizeText(point.codigolinha).startsWith(filter.value);
}

export function buildTooltipHtml(cod, point, track) {
  const lineLabel = track.lineLabels[point.codigolinha] ?? point.codigolinha ?? "";
  const vehicleTypeLabel = track.vehicleTypeLabels[point.tipoVeic] ?? "";
  const adaptBadge = point.adapt === "1" ? " ♿" : "";
  const staleBadge = point.stale ? " ⚠️" : "";

  const lines = [
    `<strong>${escapeHtml(cod)}</strong>${adaptBadge}${staleBadge}`,
    lineLabel ? escapeHtml(lineLabel) : "",
    [point.situacao, vehicleTypeLabel].filter(Boolean).map(escapeHtml).join(" • "),
    point.stale ? "Sem atualização neste minuto" : "",
  ].filter(Boolean);

  return lines.join("<br>");
}

export function formatClock(epochMs) {
  return new Date(epochMs).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function formatDateLabel(dateKey) {
  const [year, month, day] = dateKey.split("-");
  return `${day}/${month}/${year}`;
}

export function toDateInputValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
