import { lineDataRepository } from "./lineDataRepository.js";
import { assertServiceEnabled } from "./serviceOutage.js";

const LINE_DATA_URL =
  "https://raw.githubusercontent.com/nalinha-app/transporteservico-urbs-data-2026/refs/heads/data/getLinhas.json";
const ONE_DAY_IN_MS = 24 * 60 * 60 * 1000;

function normalizeLineData(data) {
  const rawItems = Array.isArray(data) ? data : Object.values(data || {});

  return rawItems.filter(
    (item) => item && typeof item === "object" && Object.hasOwn(item, "COD")
  );
}

function isCacheFresh(cachedAt, now = Date.now()) {
  if (typeof cachedAt !== "number") {
    return false;
  }

  return now - cachedAt < ONE_DAY_IN_MS;
}

async function fetchLineDataFromNetwork() {
  assertServiceEnabled();
  const response = await fetch(LINE_DATA_URL, { method: "GET" });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} - ${response.statusText}`);
  }

  return response.json();
}

export async function getLineData(now = Date.now()) {
  const cachedEntry = await lineDataRepository.getSnapshot();

  if (cachedEntry.cachedAt && isCacheFresh(cachedEntry.cachedAt, now)) {
    return {
      url: LINE_DATA_URL,
      data: cachedEntry.data,
      source: "cache",
      cachedAt: cachedEntry.cachedAt,
    };
  }

  const data = normalizeLineData(await fetchLineDataFromNetwork());
  await lineDataRepository.replaceAll(data, now);

  return {
    url: LINE_DATA_URL,
    data,
    source: "network",
    cachedAt: now,
  };
}

export async function getByCod(cod) {
  return lineDataRepository.getByCod(cod);
}

export { LINE_DATA_URL };
