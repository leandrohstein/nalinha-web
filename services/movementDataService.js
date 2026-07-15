import { cacheRepository } from "./cacheRepository.js";
import { movementDataRepository } from "./movementDataRepository.js";
import { getByCod } from "./lineDataService.js";
import { getById as getVehicleTypeById } from "./vehicleTypeDataService.js";

export const MOVEMENT_MAX_GAP_MS = 6 * 60 * 1000;

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
      return [id, item ? String(item.nome ?? "") : ""];
    })
  );

  return {
    lineLabels: Object.fromEntries(lineEntries),
    vehicleTypeLabels: Object.fromEntries(vehicleTypeEntries),
  };
}

export async function buildMovementTrack(dateKey) {
  const entries = await cacheRepository.getEntriesForDate(dateKey);
  const sortedEntries = [...entries].sort((a, b) => a.dateTimeKey.localeCompare(b.dateTimeKey));

  const vehicleFrames = new Map();
  const lastKnownByVehicle = new Map();
  const codigolinhaSet = new Set();
  const tipoVeicSet = new Set();
  const timelineSet = new Set();

  for (const entry of sortedEntries) {
    const items = extractVehicleItems(entry.data);

    for (const item of items) {
      const cod = String(item.COD ?? "").trim();

      if (!cod || !VALID_VEHICLE_PREFIX_REGEX.test(cod)) {
        continue;
      }

      const refreshTime = parseRefreshToEpoch(dateKey, item.REFRESH);

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

  const { lineLabels, vehicleTypeLabels } = await buildLabelMaps(codigolinhaSet, tipoVeicSet);

  const vehicles = {};
  for (const [cod, frameMap] of vehicleFrames) {
    vehicles[cod] = [...frameMap.values()].sort((a, b) => a.t - b.t);
  }

  const timeline = [...timelineSet].sort((a, b) => a - b);

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
