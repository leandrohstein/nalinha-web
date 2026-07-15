import { lineGeoJsonRepository } from "./lineGeoJsonRepository.js";

const LINE_GEOJSON_BASE_URL =
  "https://raw.githubusercontent.com/leandrohstein/transporteservico-urbs-data/refs/heads/data/geoJson";
const ONE_DAY_IN_MS = 24 * 60 * 60 * 1000;

function isCacheFresh(cachedAt, now = Date.now()) {
  return typeof cachedAt === "number" && now - cachedAt < ONE_DAY_IN_MS;
}

function buildLineGeoJsonUrl(cod) {
  return `${LINE_GEOJSON_BASE_URL}/${encodeURIComponent(cod)}.json`;
}

async function fetchLineGeoJsonFromNetwork(cod) {
  const url = buildLineGeoJsonUrl(cod);
  const response = await fetch(url, { method: "GET" });

  if (response.status === 404) {
    return { url, data: null };
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} - ${response.statusText}`);
  }

  return { url, data: await response.json() };
}

/**
 * Retorna o geoJson do trajeto de uma linha (pelo codigo/prefixo usado no
 * nome do arquivo, ex: 203 -> geoJson/203.json), buscando na rede no maximo
 * 1x por dia por linha e reaproveitando o IndexedDB nas demais chamadas.
 */
export async function getLineGeoJson(cod, now = Date.now()) {
  const normalizedCod = String(cod ?? "").trim();
  if (!normalizedCod) {
    return null;
  }

  const cached = await lineGeoJsonRepository.get(normalizedCod);

  if (cached && isCacheFresh(cached.cachedAt, now)) {
    return cached.data;
  }

  try {
    const { url, data } = await fetchLineGeoJsonFromNetwork(normalizedCod);
    await lineGeoJsonRepository.set(normalizedCod, data, url, now);
    return data;
  } catch (error) {
    if (cached) {
      // Falha de rede: mantem exibindo o ultimo trajeto conhecido em vez de
      // remover o desenho do mapa por causa de uma falha pontual.
      return cached.data;
    }

    throw error;
  }
}
