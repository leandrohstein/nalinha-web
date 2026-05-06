import { vehicleTypeDataRepository } from "./vehicleTypeDataRepository.js";

const VEHICLE_TYPE_DATA_URL =
  "https://raw.githubusercontent.com/leandrohstein/transporteservico-urbs-data/refs/heads/data/tipoVeiculos.json";
const ONE_DAY_IN_MS = 24 * 60 * 60 * 1000;

function normalizeVehicleTypeData(data) {
  const rawItems = Array.isArray(data) ? data : Object.values(data || {});

  return rawItems.filter(
    (item) => item && typeof item === "object" && Object.hasOwn(item, "id")
  );
}

function isCacheFresh(cachedAt, now = Date.now()) {
  if (typeof cachedAt !== "number") {
    return false;
  }

  return now - cachedAt < ONE_DAY_IN_MS;
}

async function fetchVehicleTypeDataFromNetwork() {
  const response = await fetch(VEHICLE_TYPE_DATA_URL, { method: "GET" });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} - ${response.statusText}`);
  }

  return response.json();
}

export async function getVehicleTypeData(now = Date.now()) {
  const cachedEntry = await vehicleTypeDataRepository.getSnapshot();

  if (cachedEntry.cachedAt && isCacheFresh(cachedEntry.cachedAt, now)) {
    return {
      url: VEHICLE_TYPE_DATA_URL,
      data: cachedEntry.data,
      source: "cache",
      cachedAt: cachedEntry.cachedAt,
    };
  }

  const data = normalizeVehicleTypeData(await fetchVehicleTypeDataFromNetwork());
  await vehicleTypeDataRepository.replaceAll(data, now);

  return {
    url: VEHICLE_TYPE_DATA_URL,
    data,
    source: "network",
    cachedAt: now,
  };
}

export async function getById(id) {
  return vehicleTypeDataRepository.getById(id);
}

export { VEHICLE_TYPE_DATA_URL };
