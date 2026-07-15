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

  // Os codigos de linha sempre tem 3 caracteres (ex: "203", "022", "X36").
  // Enquanto o usuario digita menos que isso, qualquer prefixo casaria com
  // varias linhas diferentes ao mesmo tempo, deixando a filtragem instavel
  // (marcadores/janelas mudando a cada tecla) - so ativa o filtro por linha
  // quando o codigo estiver completo.
  if (field === "linha" && value.length < 3) {
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

function isMatch(codigolinha, filterValue) {
  return !isOutOfService(codigolinha) && normalizeText(codigolinha).startsWith(filterValue);
}

function isOther(codigolinha, filterValue) {
  return !isOutOfService(codigolinha) && !normalizeText(codigolinha).startsWith(filterValue);
}

/**
 * Divide os quadros (ja ordenados por tempo) de um veiculo em blocos
 * delimitados por trechos em "outra linha" (nao REC, nao a linha filtrada).
 * Retorna so os blocos que contem ao menos um quadro na linha filtrada, com
 * o indice de inicio/fim (exclusivo) dentro do array, a tabela do primeiro
 * quadro que deu match (usada para comparar com o dia anterior) e o
 * instante desse primeiro quadro (o momento real em que o veiculo entra na
 * linha, distinto do inicio do bloco que inclui o "fora de operacao" antes).
 */
function findMatchBlocks(frames, filterValue) {
  const blocks = [];
  let blockStartIdx = null;
  let matchTabela = null;
  let matchStart = null;

  for (let i = 0; i <= frames.length; i += 1) {
    const frame = frames[i];

    if (frame && !isOther(frame.codigolinha, filterValue)) {
      if (blockStartIdx === null) {
        blockStartIdx = i;
      }

      if (matchTabela === null && isMatch(frame.codigolinha, filterValue)) {
        matchTabela = frame.tabela;
        matchStart = frame.t;
      }

      continue;
    }

    if (blockStartIdx !== null) {
      if (matchTabela !== null) {
        blocks.push({ startIdx: blockStartIdx, endIdx: i, tabela: matchTabela, matchStart });
      }

      blockStartIdx = null;
      matchTabela = null;
      matchStart = null;
    }
  }

  return blocks;
}

/**
 * Para o filtro por linha, calcula por veiculo as janelas de tempo em que
 * ele deve ser exibido, a partir dos blocos encontrados por findMatchBlocks
 * (do inicio do bloco - ou seja, incluindo o "fora de operacao" que o
 * antecede - ate o proximo trecho em outra linha, ou o fim do dia). Um
 * veiculo pode ter varias janelas nao contiguas ao longo do dia: se ele
 * voltar a operar a mesma linha depois de rodar em outra linha, um novo
 * ciclo REC -> linha -> REC e reconhecido como uma nova janela.
 *
 * edgeFrames (opcional) permite ajustar turnos que atravessam a
 * meia-noite:
 * - previousDayLateFrames: quadros do fim do dia anterior (23:00-23:59). Se
 *   a primeira janela do veiculo comeca no 1o quadro do dia (sem "outra
 *   linha" antes dela hoje) e o veiculo ja estava na mesma linha/tabela
 *   nesse trecho de ontem, a janela e descartada (ja foi mostrada ontem).
 * - nextDayEarlyFrames + nextDayExtensionCutoff: quadros do inicio do dia
 *   seguinte (00:00 ate o horario de corte). Se a ultima janela do veiculo
 *   ainda esta aberta (sem "outra linha" encontrada ate o fim dos dados de
 *   hoje), continua a analise nesses quadros para achar o fechamento real
 *   ou, na ausencia dele, limita ate o horario de corte - e os quadros
 *   usados sao devolvidos em extendedFrames para estender a exibicao.
 *
 * Retorna { windows: null, extendedFrames: new Map(), effectiveEndTime }
 * quando o filtro nao e por linha.
 */
export function computeOperationWindows(track, filter, edgeFrames = {}) {
  if (!filter || filter.field !== "linha") {
    return { windows: null, extendedFrames: new Map(), effectiveEndTime: track ? track.endTime : null };
  }

  const { previousDayLateFrames, nextDayEarlyFrames, nextDayExtensionCutoff } = edgeFrames;
  const windows = new Map();
  const extendedFrames = new Map();
  let effectiveEndTime = track.endTime;

  for (const [cod, frames] of Object.entries(track.vehicles)) {
    if (frames.length === 0) {
      continue;
    }

    const blocks = findMatchBlocks(frames, filter.value);
    if (blocks.length === 0) {
      continue;
    }

    const vehicleWindows = blocks.map((block) => ({
      start: frames[block.startIdx].t,
      end: block.endIdx < frames.length ? frames[block.endIdx].t : Infinity,
      tabela: block.tabela,
      startIdx: block.startIdx,
      matchStart: block.matchStart,
    }));

    const firstWindow = vehicleWindows[0];
    if (firstWindow.startIdx === 0 && previousDayLateFrames?.[cod]) {
      const alreadyShownYesterday = previousDayLateFrames[cod].some(
        (frame) => isMatch(frame.codigolinha, filter.value) && frame.tabela === firstWindow.tabela
      );

      if (alreadyShownYesterday) {
        vehicleWindows.shift();
      }
    }

    const lastWindow = vehicleWindows[vehicleWindows.length - 1];
    if (lastWindow && lastWindow.end === Infinity && nextDayEarlyFrames?.[cod]?.length > 0) {
      const cutoff = nextDayExtensionCutoff ?? Infinity;
      let closingTime = null;

      for (const frame of nextDayEarlyFrames[cod]) {
        if (frame.t > cutoff) {
          break;
        }

        if (isOther(frame.codigolinha, filter.value)) {
          closingTime = frame.t;
          break;
        }
      }

      lastWindow.end = closingTime ?? cutoff;

      const mergedFrames = [...frames, ...nextDayEarlyFrames[cod].filter((frame) => frame.t <= lastWindow.end)].sort(
        (a, b) => a.t - b.t
      );
      extendedFrames.set(cod, mergedFrames);

      if (lastWindow.end > effectiveEndTime) {
        effectiveEndTime = lastWindow.end;
      }
    }

    if (vehicleWindows.length > 0) {
      windows.set(
        cod,
        vehicleWindows.map(({ start, end, matchStart }) => ({ start, end, matchStart }))
      );
    }
  }

  return { windows, extendedFrames, effectiveEndTime };
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
 * operacao" (REC) e passa a mostrar a linha filtrada, considerando apenas as
 * janelas de operacao validas (ja com os ajustes de virada de meia-noite
 * aplicados por computeOperationWindows - ex: uma janela que comecava as
 * 00:00 mas que na verdade e continuacao do turno de ontem e descartada, e
 * portanto nao conta aqui). Retorna null se nao houver nenhuma janela.
 */
export function computeFirstLineEntryTime(operationWindows) {
  if (!operationWindows) {
    return null;
  }

  let earliest = null;

  for (const windows of operationWindows.values()) {
    for (const window of windows) {
      if (window.matchStart == null) {
        continue;
      }

      if (earliest === null || window.matchStart < earliest) {
        earliest = window.matchStart;
      }
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
