import { cacheRepository } from "./cacheRepository.js";
import { assertServiceEnabled } from "./serviceOutage.js";

const DATA_ORG = "nalinha-app";
const MAX_HISTORY_MINUTES = 5;

function pad2(value) {
  return String(value).padStart(2, "0");
}

// Os dumps de veiculos sao segregados por ano em repositorios separados
// (transporteservico-urbs-data-2023, -2024, ...); cada URL usa o repositorio
// do ano da propria data que esta sendo buscada.
function buildVeiculosBaseUrl(year) {
  return `https://raw.githubusercontent.com/${DATA_ORG}/transporteservico-urbs-data-${year}/refs/heads/data/veiculos`;
}

export function buildDataUrl(now = new Date()) {
  const year = now.getFullYear();
  const month = pad2(now.getMonth() + 1);
  const day = pad2(now.getDate());
  const hour = pad2(now.getHours());
  const minute = pad2(now.getMinutes());

  const datePart = `${year}-${month}-${day}`;
  const filePart = `${hour}%3A${minute}%3A00.json`;

  return `${buildVeiculosBaseUrl(year)}/${datePart}/${filePart}`;
}

export function buildHourUrl(dateKey, hour) {
  const year = dateKey.slice(0, 4);
  return `${buildVeiculosBaseUrl(year)}/${dateKey}/${pad2(hour)}.json`;
}

export function buildDateTimeKey(now = new Date()) {
  const year = now.getFullYear();
  const month = pad2(now.getMonth() + 1);
  const day = pad2(now.getDate());
  const hour = pad2(now.getHours());
  const minute = pad2(now.getMinutes());

  return `${year}-${month}-${day} ${hour}:${minute}`;
}

function subtractMinutes(date, minutes) {
  return new Date(date.getTime() - minutes * 60 * 1000);
}

async function fetchFromNetwork(url) {
  assertServiceEnabled();
  const response = await fetch(url, { method: "GET" });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} - ${response.statusText}`);
  }

  return response.json();
}

export async function getVehicleData(now = new Date()) {
  let lastError = null;

  for (let minuteOffset = 0; minuteOffset <= MAX_HISTORY_MINUTES; minuteOffset += 1) {
    const targetTime = subtractMinutes(now, minuteOffset);
    const url = buildDataUrl(targetTime);
    const dateTimeKey = buildDateTimeKey(targetTime);
    const cached = await cacheRepository.get(dateTimeKey);

    if (cached !== null) {
      return {
        url,
        data: cached,
        source: "cache",
        minuteOffset,
      };
    }

    try {
      const data = await fetchFromNetwork(url);
      await cacheRepository.set(dateTimeKey, data, url);

      return {
        url,
        data,
        source: "network",
        minuteOffset,
      };
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }

  throw new Error("Nenhum dado encontrado nos ultimos 5 minutos.");
}
