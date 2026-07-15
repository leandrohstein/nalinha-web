import { cacheRepository } from "./cacheRepository.js";
import { buildDataUrl, buildDateTimeKey } from "./vehicleDataService.js";

function pad2(value) {
  return String(value).padStart(2, "0");
}

function isTodayKey(dateKey) {
  const now = new Date();
  const todayKey = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  return dateKey === todayKey;
}

function startOfDay(dateKey) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day, 0, 0, 0, 0);
}

async function fetchAndCacheMinute(targetDate) {
  const dateTimeKey = buildDateTimeKey(targetDate);
  const cached = await cacheRepository.get(dateTimeKey);
  if (cached !== null) {
    return "cache";
  }

  const url = buildDataUrl(targetDate);

  try {
    const response = await fetch(url, { method: "GET" });

    if (response.status === 404) {
      return "missing";
    }

    if (!response.ok) {
      return "failed";
    }

    const data = await response.json();
    await cacheRepository.set(dateTimeKey, data, url);
    return "network";
  } catch {
    return "failed";
  }
}

/**
 * Busca e armazena em cache (IndexedDB) os dados de veiculos de uma data,
 * minuto a minuto, entre 00:00 e 23:59 (ou ate o minuto atual, se a data for
 * hoje). Nao possui nenhuma dependencia de UI - apenas obtem e valida dados -
 * para que possa ser reutilizada por qualquer tela que precise sincronizar
 * uma data antes de processa-la.
 */
export async function syncDayToCache(dateKey, options = {}) {
  const { onStep, isCancelled, fromMinute = 0 } = options;

  const dayStart = startOfDay(dateKey);
  const now = new Date();
  const dayEnd = isTodayKey(dateKey)
    ? new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes(), 0, 0)
    : new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate(), 23, 59, 0, 0);

  const dayTotalMinutes = Math.round((dayEnd.getTime() - dayStart.getTime()) / 60000) + 1;
  const startMinute = Math.min(Math.max(fromMinute, 0), dayTotalMinutes);
  const totalMinutes = dayTotalMinutes - startMinute;
  const dayReachesEndOfDay = dayEnd.getHours() === 23 && dayEnd.getMinutes() === 59;

  const summary = {
    rangeStart: dayStart,
    rangeEnd: dayEnd,
    dayTotalMinutes,
    totalMinutes,
    processed: 0,
    cachedCount: 0,
    fetchedCount: 0,
    missingCount: 0,
    failedCount: 0,
    cancelled: false,
    syncedThroughMinute: startMinute - 1,
    dayReachesEndOfDay,
  };

  for (let minute = startMinute; minute < dayTotalMinutes; minute += 1) {
    if (isCancelled?.()) {
      summary.cancelled = true;
      break;
    }

    const targetDate = new Date(dayStart.getTime() + minute * 60000);
    const status = await fetchAndCacheMinute(targetDate);

    if (isCancelled?.()) {
      summary.cancelled = true;
      break;
    }

    summary.processed += 1;
    summary.syncedThroughMinute = minute;

    if (status === "cache") {
      summary.cachedCount += 1;
    } else if (status === "network") {
      summary.fetchedCount += 1;
    } else if (status === "missing") {
      summary.missingCount += 1;
    } else {
      summary.failedCount += 1;
    }

    onStep?.({
      targetDate,
      dateTimeKey: buildDateTimeKey(targetDate),
      status,
      processed: summary.processed,
      total: totalMinutes,
    });
  }

  summary.isComplete = !summary.cancelled && summary.syncedThroughMinute === dayTotalMinutes - 1;

  return summary;
}
