import { cacheRepository } from "./cacheRepository.js";
import { movementDataRepository } from "./movementDataRepository.js";
import { getByCod } from "./lineDataService.js";
import { getById as getVehicleTypeById } from "./vehicleTypeDataService.js";
import { syncMinuteRange } from "./dataSyncService.js";

export const MOVEMENT_MAX_GAP_MS = 6 * 60 * 1000;

// Janela usada para identificar o turno de um veiculo que atravessa a
// meia-noite: quanto do dia anterior (a partir de que horario) conta como
// "ja em operacao" e ate que horario do dia seguinte se considera a
// continuacao do mesmo turno.
const PREVIOUS_DAY_WINDOW_START = { hour: 23, minute: 0 };
const NEXT_DAY_WINDOW_END = { hour: 1, minute: 30 };

const VALID_VEHICLE_PREFIX_REGEX = /^[A-Z]{2}[0-9]{3}$/;

function pad2(value) {
  return String(value).padStart(2, "0");
}

export function getDateKey(date) {
  const year = date.getFullYear();
  const month = pad2(date.getMonth() + 1);
  const day = pad2(date.getDate());
  return `${year}-${month}-${day}`;
}

function shiftDateKey(dateKey, deltaDays) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return getDateKey(new Date(year, month - 1, day + deltaDays));
}

function isTodayKey(dateKey) {
  return dateKey === getDateKey(new Date());
}

function parseDateTimeKeyToEpoch(dateTimeKey) {
  const [datePart, timePart] = dateTimeKey.split(" ");
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute] = timePart.split(":").map(Number);
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime();
}

function parseRefreshToEpoch(dateKey, refreshValue) {
  if (refreshValue == null) {
    return null;
  }

  const match = String(refreshValue).trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) {
    return null;
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);

  if (hour > 23 || minute > 59) {
    return null;
  }

  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime();
}

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

const EARTH_RADIUS_M = 6371000;

function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

function toDegrees(radians) {
  return (radians * 180) / Math.PI;
}

function round(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function haversineDistanceM(lat1, lon1, lat2, lon2) {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;

  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function computeBearingDegrees(lat1, lon1, lat2, lon2) {
  const phi1 = toRadians(lat1);
  const phi2 = toRadians(lat2);
  const deltaLambda = toRadians(lon2 - lon1);

  const y = Math.sin(deltaLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);

  return (toDegrees(Math.atan2(y, x)) + 360) % 360;
}

/**
 * Anota cada quadro (ja ordenado por tempo) de um veiculo com metricas de
 * deslocamento em relacao ao quadro anterior: distancia do segmento,
 * distancia acumulada no array, velocidade media do segmento e o bearing
 * (direcao) do deslocamento. O primeiro quadro nao tem ponto anterior, entao
 * fica com distancia/velocidade zeradas e bearing nulo.
 */
function annotateMovementMetrics(frames) {
  let accumulatedM = 0;

  frames.forEach((frame, index) => {
    if (index === 0) {
      frame.distanciaSegmentoM = 0;
      frame.distanciaAcumuladaM = 0;
      frame.velocidadeMediaKmh = 0;
      frame.bearingGraus = null;
      return;
    }

    const previous = frames[index - 1];
    const segmentM = haversineDistanceM(previous.lat, previous.lon, frame.lat, frame.lon);
    accumulatedM += segmentM;

    const hoursDiff = (frame.t - previous.t) / 3600000;
    const speedKmh = hoursDiff > 0 ? segmentM / 1000 / hoursDiff : 0;
    const bearingDegrees = computeBearingDegrees(previous.lat, previous.lon, frame.lat, frame.lon);

    frame.distanciaSegmentoM = round(segmentM, 1);
    frame.distanciaAcumuladaM = round(accumulatedM, 1);
    frame.velocidadeMediaKmh = round(speedKmh, 1);
    frame.bearingGraus = round(bearingDegrees, 1);
  });
}

function extractVehicleItems(rawData) {
  const items = rawData !== null && typeof rawData === "object" ? Object.values(rawData) : [rawData];
  return items.filter((item) => item !== null && typeof item === "object");
}

async function buildLabelMaps(codigolinhaSet, tipoVeicSet) {
  const lineEntries = await Promise.all(
    [...codigolinhaSet].map(async (cod) => {
      if (String(cod).trim().toUpperCase() === "REC") {
        return [cod, "FORA DE OPERAÇÃO"];
      }

      const line = await getByCod(cod);
      return [cod, line ? `${line.COD}-${line.NOME}` : cod];
    })
  );

  const vehicleTypeEntries = await Promise.all(
    [...tipoVeicSet].map(async (id) => {
      const item = await getVehicleTypeById(id);
      return [
        id,
        item
          ? {
              nome: String(item.nome ?? ""),
              icone: String(item.icone ?? ""),
              tecnologia: Array.isArray(item.tecnologia) ? item.tecnologia : [],
            }
          : null,
      ];
    })
  );

  return {
    lineLabels: Object.fromEntries(lineEntries),
    vehicleTypeLabels: Object.fromEntries(vehicleTypeEntries),
  };
}

/**
 * Converte entradas cruas do cacheRepository (snapshots por minuto) em
 * quadros por veiculo. Nao depende de um dateKey fixo - cada entrada usa a
 * propria data embutida no seu dateTimeKey, permitindo reutilizar esta
 * funcao tanto para o dia principal quanto para pequenas fatias de dias
 * adjacentes (ex: virada da meia-noite).
 */
function parseEntriesIntoVehicleFrames(entries) {
  const sortedEntries = [...entries].sort((a, b) => a.dateTimeKey.localeCompare(b.dateTimeKey));

  const vehicleFrames = new Map();
  const lastKnownByVehicle = new Map();
  const codigolinhaSet = new Set();
  const tipoVeicSet = new Set();
  const timelineSet = new Set();

  for (const entry of sortedEntries) {
    const entryDateKey = entry.dateTimeKey.slice(0, 10);
    const items = extractVehicleItems(entry.data);

    for (const item of items) {
      const cod = String(item.COD ?? "").trim();

      if (!cod || !VALID_VEHICLE_PREFIX_REGEX.test(cod)) {
        continue;
      }

      const refreshTime = parseRefreshToEpoch(entryDateKey, item.REFRESH);

      if (!vehicleFrames.has(cod)) {
        vehicleFrames.set(cod, new Map());
      }

      if (refreshTime === null) {
        // Sem REFRESH valido neste minuto sincronizado: mantem a ultima
        // posicao conhecida do veiculo (se houver) marcada como
        // desatualizada, em vez de descartar o instante por completo.
        const lastKnown = lastKnownByVehicle.get(cod);
        if (!lastKnown) {
          continue;
        }

        const fileTime = parseDateTimeKeyToEpoch(entry.dateTimeKey);
        timelineSet.add(fileTime);
        vehicleFrames.get(cod).set(fileTime, { ...lastKnown, t: fileTime, stale: true });
        continue;
      }

      const lat = toNumber(item.LAT);
      const lon = toNumber(item.LON);

      if (lat === null || lon === null) {
        continue;
      }

      const codigolinha = item.CODIGOLINHA != null ? String(item.CODIGOLINHA) : "";
      const tipoVeic = item.TIPO_VEIC != null ? String(item.TIPO_VEIC) : "";

      if (codigolinha) {
        codigolinhaSet.add(codigolinha);
      }

      if (tipoVeic) {
        tipoVeicSet.add(tipoVeic);
      }

      const situacaoParts = [item.SITUACAO, item.SITUACAO2]
        .map((value) => (value == null ? "" : String(value)))
        .filter(Boolean);

      const frame = {
        t: refreshTime,
        lat,
        lon,
        codigolinha,
        tipoVeic,
        adapt: item.ADAPT != null ? String(item.ADAPT) : "",
        situacao: situacaoParts.join(" / "),
        sent: item.SENT != null ? String(item.SENT) : "",
        tabela: item.TABELA != null ? String(item.TABELA) : "",
        stale: false,
      };

      timelineSet.add(refreshTime);

      // Sobrescreve intencionalmente: se o mesmo veiculo repetir o REFRESH
      // em arquivos sincronizados diferentes, fica o snapshot mais recente
      // buscado para aquele minuto (sortedEntries esta em ordem cronologica
      // de sincronizacao), evitando dois quadros com o mesmo "t".
      vehicleFrames.get(cod).set(refreshTime, frame);
      lastKnownByVehicle.set(cod, frame);
    }
  }

  const vehicles = {};
  for (const [cod, frameMap] of vehicleFrames) {
    const frames = [...frameMap.values()].sort((a, b) => a.t - b.t);
    annotateMovementMetrics(frames);
    vehicles[cod] = frames;
  }

  return {
    vehicles,
    codigolinhaSet,
    tipoVeicSet,
    timeline: [...timelineSet].sort((a, b) => a - b),
  };
}

export async function buildMovementTrack(dateKey) {
  const entries = await cacheRepository.getEntriesForDate(dateKey);
  const { vehicles, codigolinhaSet, tipoVeicSet, timeline } = parseEntriesIntoVehicleFrames(entries);
  const { lineLabels, vehicleTypeLabels } = await buildLabelMaps(codigolinhaSet, tipoVeicSet);

  const record = {
    dateKey,
    builtAt: Date.now(),
    startTime: timeline.length > 0 ? timeline[0] : null,
    endTime: timeline.length > 0 ? timeline[timeline.length - 1] : null,
    timeline,
    vehicles,
    lineLabels,
    vehicleTypeLabels,
  };

  await movementDataRepository.set(record);
  return record;
}

/**
 * Quadros do(s) veiculo(s) no fim do dia anterior (23:00-23:59), usados para
 * identificar se um turno que aparenta comecar no inicio do dia atual e na
 * verdade a continuacao de um turno ja em andamento ontem. Sincroniza
 * silenciosamente (sem overlay) essa pequena janela antes de ler o cache.
 */
export async function getPreviousDayLateFrames(dateKey) {
  const previousDateKey = shiftDateKey(dateKey, -1);
  const [year, month, day] = previousDateKey.split("-").map(Number);
  const startDate = new Date(year, month - 1, day, PREVIOUS_DAY_WINDOW_START.hour, PREVIOUS_DAY_WINDOW_START.minute);
  const endDate = new Date(year, month - 1, day, 23, 59);

  await syncMinuteRange(startDate, endDate);

  const entries = await cacheRepository.getEntriesInRange(
    `${previousDateKey} ${pad2(PREVIOUS_DAY_WINDOW_START.hour)}:${pad2(PREVIOUS_DAY_WINDOW_START.minute)}`,
    `${previousDateKey} 23:59`
  );

  return parseEntriesIntoVehicleFrames(entries).vehicles;
}

/**
 * Quadros do(s) veiculo(s) no comeco do dia seguinte (00:00 ate o horario de
 * corte definido em NEXT_DAY_WINDOW_END), usados para estender a exibicao de
 * um turno que atravessa a meia-noite dentro da mesma tela do dia atual.
 * Sincroniza silenciosamente essa pequena janela antes de ler o cache. Nao
 * ha o que buscar quando dateKey e hoje, pois o dia seguinte ainda nao
 * aconteceu.
 */
export async function getNextDayEarlyFrames(dateKey) {
  if (isTodayKey(dateKey)) {
    return {};
  }

  const nextDateKey = shiftDateKey(dateKey, 1);
  const [year, month, day] = nextDateKey.split("-").map(Number);
  const startDate = new Date(year, month - 1, day, 0, 0);
  const endDate = new Date(year, month - 1, day, NEXT_DAY_WINDOW_END.hour, NEXT_DAY_WINDOW_END.minute);

  await syncMinuteRange(startDate, endDate);

  const entries = await cacheRepository.getEntriesInRange(
    `${nextDateKey} 00:00`,
    `${nextDateKey} ${pad2(NEXT_DAY_WINDOW_END.hour)}:${pad2(NEXT_DAY_WINDOW_END.minute)}`
  );

  return parseEntriesIntoVehicleFrames(entries).vehicles;
}

/**
 * Instante (epoch ms) do horario de corte da extensao no dia seguinte a
 * dateKey - usado para limitar ate onde um turno que atravessa a meia-noite
 * e considerado parte da mesma janela de operacao do dia atual.
 */
export function getNextDayExtensionCutoff(dateKey) {
  const nextDateKey = shiftDateKey(dateKey, 1);
  const [year, month, day] = nextDateKey.split("-").map(Number);
  return new Date(year, month - 1, day, NEXT_DAY_WINDOW_END.hour, NEXT_DAY_WINDOW_END.minute, 0, 0).getTime();
}

export async function getMovementTrack(dateKey, options = {}) {
  const { forceRebuild = false } = options;

  if (!forceRebuild) {
    const cached = await movementDataRepository.get(dateKey);
    if (cached) {
      return cached;
    }
  }

  return buildMovementTrack(dateKey);
}
