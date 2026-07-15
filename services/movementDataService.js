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
  const codigolinhaSet = new Set();
  const tipoVeicSet = new Set();
  const timelineSet = new Set();

  for (const entry of sortedEntries) {
    const t = parseDateTimeKeyToEpoch(entry.dateTimeKey);
    const items = extractVehicleItems(entry.data);

    if (items.length === 0) {
      continue;
    }

    timelineSet.add(t);

    for (const item of items) {
      const cod = String(item.COD ?? "").trim();
      const lat = toNumber(item.LAT);
      const lon = toNumber(item.LON);

      if (!cod || !VALID_VEHICLE_PREFIX_REGEX.test(cod) || lat === null || lon === null) {
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

      if (!vehicleFrames.has(cod)) {
        vehicleFrames.set(cod, []);
      }

      vehicleFrames.get(cod).push({
        t,
        lat,
        lon,
        codigolinha,
        tipoVeic,
        adapt: item.ADAPT != null ? String(item.ADAPT) : "",
        situacao: situacaoParts.join(" / "),
        sent: item.SENT != null ? String(item.SENT) : "",
        tabela: item.TABELA != null ? String(item.TABELA) : "",
      });
    }
  }

  const { lineLabels, vehicleTypeLabels } = await buildLabelMaps(codigolinhaSet, tipoVeicSet);

  const vehicles = {};
  for (const [cod, frames] of vehicleFrames) {
    frames.sort((a, b) => a.t - b.t);
    vehicles[cod] = frames;
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
