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

/**
 * Para o filtro por linha, calcula por veiculo as janelas de tempo em que
 * ele deve ser exibido. Os quadros de cada veiculo sao divididos em blocos
 * delimitados por trechos em "outra linha" (nao REC, nao a linha filtrada);
 * cada bloco que contem ao menos um quadro na linha filtrada vira uma janela
 * (do inicio do bloco - ou seja, incluindo o "fora de operacao" que o
 * antecede - ate o proximo trecho em outra linha, ou o fim do dia). Um
 * veiculo pode ter varias janelas nao contiguas ao longo do dia: se ele
 * voltar a operar a mesma linha depois de rodar em outra linha, um novo
 * ciclo REC -> linha -> REC e reconhecido como uma nova janela. Retorna
 * null se o filtro nao for por linha.
 */
export function computeOperationWindows(track, filter) {
  if (!filter || filter.field !== "linha") {
    return null;
  }

  const windows = new Map();

  for (const [cod, frames] of Object.entries(track.vehicles)) {
    const vehicleWindows = [];
    let blockStartIdx = null;
    let blockHasMatch = false;

    for (let i = 0; i <= frames.length; i += 1) {
      const frame = frames[i];
      const isOther =
        frame && !isOutOfService(frame.codigolinha) && !normalizeText(frame.codigolinha).startsWith(filter.value);

      if (frame && !isOther) {
        if (blockStartIdx === null) {
          blockStartIdx = i;
        }

        if (!isOutOfService(frame.codigolinha)) {
          blockHasMatch = true;
        }

        continue;
      }

      if (blockStartIdx !== null) {
        if (blockHasMatch) {
          vehicleWindows.push({
            start: frames[blockStartIdx].t,
            end: frame ? frame.t : Infinity,
          });
        }

        blockStartIdx = null;
        blockHasMatch = false;
      }
    }

    if (vehicleWindows.length > 0) {
      windows.set(cod, vehicleWindows);
    }
  }

  return windows;
}

export function matchesCurrentFilter(filter, point, cod, operationWindows) {
  if (!filter || filter.field !== "linha") {
    return true;
  }

  const vehicleWindows = operationWindows?.get(cod);
  if (!vehicleWindows) {
    return false;
  }

  return vehicleWindows.some((window) => point.t >= window.start && point.t < window.end);
}

/**
 * Primeiro instante do dia em que algum veiculo deixa de estar "fora de
 * operacao" (REC) e passa a mostrar a linha filtrada. Retorna null se o
 * filtro nao for por linha ou se nenhum veiculo entrar na linha.
 */
export function computeFirstLineEntryTime(track, filter) {
  if (!track || !filter || filter.field !== "linha") {
    return null;
  }

  let earliest = null;

  for (const frames of Object.values(track.vehicles)) {
    for (const frame of frames) {
      if (isOutOfService(frame.codigolinha)) {
        continue;
      }

      if (!normalizeText(frame.codigolinha).startsWith(filter.value)) {
        continue;
      }

      if (earliest === null || frame.t < earliest) {
        earliest = frame.t;
      }

      break;
    }
  }

  return earliest;
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
