import { cacheRepository } from "./cacheRepository.js";
import { buildDataUrl, buildHourUrl, buildDateTimeKey } from "./vehicleDataService.js";
import { assertServiceEnabled } from "./serviceOutage.js";

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

function buildTimeKey(date) {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:00`;
}

/**
 * Busca o arquivo consolidado de uma hora (ex: 14.json), que reune num
 * objeto unico o conteudo bruto de todos os arquivos por minuto ja
 * publicados para aquela hora de dateKey (chave "HH:MM:SS" -> mesmo
 * payload do arquivo por minuto correspondente; minutos sem dado
 * simplesmente nao aparecem). So existe para dias ja encerrados - retorna
 * null (sem lancar) em qualquer falha (404 = hora ainda nao consolidada,
 * ou qualquer outro erro), sinalizando ao chamador para cair de volta no
 * fluxo minuto a minuto so para essa hora.
 */
async function fetchHourFile(dateKey, hour) {
  try {
    assertServiceEnabled();
    const response = await fetch(buildHourUrl(dateKey, hour), { method: "GET" });

    if (!response.ok) {
      return null;
    }

    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Busca (uma unica vez por hora, com cache em memoria em hourDataCache) o
 * arquivo consolidado da hora de targetDate.
 */
async function getHourData(dateKey, hour, hourDataCache) {
  if (hourDataCache.has(hour)) {
    return hourDataCache.get(hour);
  }

  const data = await fetchHourFile(dateKey, hour);
  hourDataCache.set(hour, data);
  return data;
}

async function fetchAndCacheMinute(targetDate, dateKey = null, hourDataCache = null) {
  const dateTimeKey = buildDateTimeKey(targetDate);
  const cached = await cacheRepository.get(dateTimeKey);
  if (cached !== null) {
    return "cache";
  }

  if (hourDataCache) {
    const hour = targetDate.getHours();
    const hourData = await getHourData(dateKey, hour, hourDataCache);

    if (hourData) {
      const data = hourData[buildTimeKey(targetDate)];
      if (data === undefined) {
        return "missing";
      }

      await cacheRepository.set(dateTimeKey, data, buildHourUrl(dateKey, hour));
      return "network";
    }

    // Hora sem arquivo consolidado (404/erro): cai pro fetch minuto a
    // minuto abaixo, so para os minutos dessa hora especifica.
  }

  const url = buildDataUrl(targetDate);

  try {
    assertServiceEnabled();
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
 * Busca e armazena em cache (IndexedDB) os dados de veiculos entre duas
 * datas/horarios especificos (inclusive), minuto a minuto. Sem callbacks de
 * progresso/cancelamento - pensada para sincronizar silenciosamente, em
 * background, pequenos intervalos (ex: a virada da meia-noite) sem exibir
 * overlay de sincronizacao.
 */
export async function syncMinuteRange(startDate, endDate) {
  const totalMinutes = Math.round((endDate.getTime() - startDate.getTime()) / 60000) + 1;

  for (let minute = 0; minute < totalMinutes; minute += 1) {
    const targetDate = new Date(startDate.getTime() + minute * 60000);
    await fetchAndCacheMinute(targetDate);
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

  // Dias ja encerrados podem ter arquivos consolidados por hora (ver
  // docs/formato-all-json.md), que evitam buscar ate 1440 arquivos
  // individuais - cada hora e buscada uma unica vez, sob demanda, e fica
  // em cache em memoria (hourDataCache) pro resto do loop. O dia de hoje
  // nunca tem esses arquivos (ainda esta em andamento), entao continua
  // indo minuto a minuto. Se uma hora nao tiver arquivo consolidado (404)
  // ou a busca falhar, o loop cai automaticamente de volta pro fluxo por
  // minuto so para os minutos dessa hora.
  const hourDataCache = isTodayKey(dateKey) ? null : new Map();

  for (let minute = startMinute; minute < dayTotalMinutes; minute += 1) {
    if (isCancelled?.()) {
      summary.cancelled = true;
      break;
    }

    const targetDate = new Date(dayStart.getTime() + minute * 60000);
    const status = await fetchAndCacheMinute(targetDate, dateKey, hourDataCache);

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
