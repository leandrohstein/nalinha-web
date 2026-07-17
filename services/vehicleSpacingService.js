import { getLineGeoJson } from "./lineGeoJsonService.js";
import { haversineDistanceM } from "./movementDataService.js";
import { lineLinearLayoutRepository } from "./lineLinearLayoutRepository.js";

const EARTH_RADIUS_M = 6371000;
const LINE_LINEAR_LAYOUT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// Incrementa sempre que o FORMATO dos dados cacheados mudar (ex: um novo
// campo por parada, uma mudanca em como o nome e limpo) - sem isso, uma
// linha que ja tinha cache de antes da mudanca continuaria servindo o
// formato antigo por ate 24h (o TTL sozinho so cobre a linha ficar
// desatualizada pelo tempo, nao o CODIGO de derivacao ter mudado).
const LINE_LINEAR_LAYOUT_CACHE_VERSION = 2;

function isLinearLayoutCacheFresh(cached, now) {
  return (
    typeof cached?.cachedAt === "number" &&
    now - cached.cachedAt < LINE_LINEAR_LAYOUT_CACHE_TTL_MS &&
    cached.version === LINE_LINEAR_LAYOUT_CACHE_VERSION
  );
}

function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

function round(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

// Projecao local equiretangular (lon escalado por cos da latitude), precisa
// o suficiente para distancias na escala de uma cidade - usada so para achar
// o ponto mais proximo em cada segmento; a distancia final ao longo da rota
// e sempre acumulada com haversineDistanceM (exata).
function toLocalXY(lat, lon, refLat) {
  return [EARTH_RADIUS_M * toRadians(lon) * Math.cos(toRadians(refLat)), EARTH_RADIUS_M * toRadians(lat)];
}

/**
 * Projeta um ponto (lat/lon) no traçado (lista de [lon,lat], ordem geoJson),
 * retornando a distancia perpendicular ate o traçado (perpM - o quao "longe"
 * o ponto esta da linha) e a distancia acumulada ao longo do traçado ate o
 * ponto mais proximo (alongM - a posicao do ponto "dentro" da rota). Pura e
 * sincrona - segura pra chamar a cada frame de renderizacao.
 */
export function projectPointOntoPolyline(coords, lat, lon) {
  const refLat = lat;
  const point = toLocalXY(lat, lon, refLat);

  let accumulatedM = 0;
  let best = null;

  for (let i = 0; i < coords.length - 1; i += 1) {
    const [lon1, lat1] = coords[i];
    const [lon2, lat2] = coords[i + 1];
    const segLenM = haversineDistanceM(lat1, lon1, lat2, lon2);

    const a = toLocalXY(lat1, lon1, refLat);
    const b = toLocalXY(lat2, lon2, refLat);
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const lenSq = dx * dx + dy * dy;

    let t = lenSq > 0 ? ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lenSq : 0;
    t = Math.min(1, Math.max(0, t));

    const perpM = Math.hypot(point[0] - (a[0] + t * dx), point[1] - (a[1] + t * dy));
    const alongM = accumulatedM + t * segLenM;

    if (!best || perpM < best.perpM) {
      best = { perpM, alongM };
    }

    accumulatedM += segLenM;
  }

  return best;
}

/**
 * Tempo estimado (em segundos) ate o veiculo de tras alcancar a posicao
 * atual do veiculo da frente, na definicao usual de "headway" de tempo:
 * distancia do espacamento dividida pela velocidade do proprio veiculo de
 * tras (nao a velocidade relativa entre os dois) - e a mesma logica de "a
 * quantos segundos de distancia" usada em transporte publico. Sem
 * velocidade valida (veiculo parado ou sem dado), a estimativa nao existe.
 */
function computeGapTimeS(gapToPreviousM, speedKmh) {
  if (gapToPreviousM === null || !Number.isFinite(speedKmh) || speedKmh <= 0) {
    return null;
  }

  const speedMps = (speedKmh * 1000) / 3600;
  return round(gapToPreviousM / speedMps, 0);
}

/**
 * Ordena veiculos ja projetados num traçado (ver projectPointOntoPolyline)
 * pela posicao ao longo da rota e calcula o espacamento (gapToPreviousM /
 * gapToPreviousS) para o veiculo imediatamente anterior. Pura e sincrona.
 *
 * Em traçados circulares (isLoop=true) o espacamento fecha o ciclo: o
 * primeiro veiculo da lista (menor alongM) tambem ganha gapToPreviousM em
 * relacao ao ultimo, passando pela "costura" do loop, em vez de ficar sem
 * gap. A soma de todos os gaps sempre bate com lengthM.
 *
 * @param {{cod: string, alongM: number, speedKmh?: number|null}[]} vehiclePositions
 * @param {number} lengthM
 * @param {boolean} isLoop
 */
export function computeSpacing(vehiclePositions, lengthM, isLoop) {
  const sorted = [...vehiclePositions]
    .sort((a, b) => a.alongM - b.alongM)
    .map((entry) => ({ ...entry, gapToPreviousM: null, gapToPreviousS: null }));

  for (let i = 1; i < sorted.length; i += 1) {
    const gapToPreviousM = round(sorted[i].alongM - sorted[i - 1].alongM, 1);
    sorted[i].gapToPreviousM = gapToPreviousM;
    sorted[i].gapToPreviousS = computeGapTimeS(gapToPreviousM, sorted[i].speedKmh);
  }

  if (isLoop && sorted.length > 1) {
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const wrapGapM = round(lengthM - last.alongM + first.alongM, 1);

    first.gapToPreviousM = wrapGapM;
    first.gapToPreviousS = computeGapTimeS(wrapGapM, first.speedKmh);
  }

  return sorted;
}

function computePolylineLengthM(coords) {
  let total = 0;

  for (let i = 0; i < coords.length - 1; i += 1) {
    const [lon1, lat1] = coords[i];
    const [lon2, lat2] = coords[i + 1];
    total += haversineDistanceM(lat1, lon1, lat2, lon2);
  }

  return total;
}

// Linhas circulares tem o shape comecando e terminando bem perto um do outro
// (a "costura" do loop). 300m e bem folgado pra imprecisao do proprio
// traçado, mas nunca chegaria perto de acontecer por acaso numa linha
// ponta-a-ponta (os terminais ficam a quilometros um do outro).
const LOOP_CLOSURE_THRESHOLD_M = 300;

function extractShapes(geoJson) {
  const shapes = [];

  for (const feature of geoJson?.features ?? []) {
    if (feature?.geometry?.type === "LineString") {
      const coords = feature.geometry.coordinates;
      if (coords.length < 2) {
        continue;
      }

      const [lon1, lat1] = coords[0];
      const [lon2, lat2] = coords[coords.length - 1];

      shapes.push({
        shapeId: feature.properties?.shapeId ?? null,
        coords,
        lengthM: computePolylineLengthM(coords),
        isLoop: haversineDistanceM(lat1, lon1, lat2, lon2) < LOOP_CLOSURE_THRESHOLD_M,
      });
    }
  }

  return shapes;
}

// O nome da parada no geoJson costuma vir com as OUTRAS linhas que passam
// por ela grudadas no fim (ex: "Terminal Cabral - 250 - Ligeirão Norte/Sul
// - 203-Santa Cândida/Capão Raso"), porque e o mesmo nome usado na base da
// URBS pra listar todas as linhas daquele ponto - nao faz sentido pra um
// tooltip que ja esta no contexto de UMA linha especifica. O padrao comum e
// " - <codigo da linha><resto>", entao corta a partir da primeira ocorrencia
// de um traco seguido de algo que parece codigo de linha (ate 2 letras +
// 2-3 digitos, ex: "203", "022", "X36") - nomes sem esse padrao (raros, ex:
// "Praça Rui Barbosa - (Embarque) ...") ficam como estao.
const LINE_REFERENCE_IN_STOP_NAME_REGEX = /\s*-\s*[A-Za-z]{0,2}\d{2,3}\b.*$/;

function cleanStopName(nome) {
  if (!nome) {
    return nome;
  }

  return nome.replace(LINE_REFERENCE_IN_STOP_NAME_REGEX, "").trim();
}

function extractStopsBySentido(geoJson) {
  const stopsBySentido = new Map();

  for (const feature of geoJson?.features ?? []) {
    if (feature?.geometry?.type !== "Point") {
      continue;
    }

    const sentido = feature.properties?.sentido ?? "";
    const nome = cleanStopName(feature.properties?.nome ?? "");
    const [lon, lat] = feature.geometry.coordinates;

    if (!stopsBySentido.has(sentido)) {
      stopsBySentido.set(sentido, []);
    }
    stopsBySentido.get(sentido).push({ nome, lat, lon });
  }

  return stopsBySentido;
}

function averagePerpDistanceM(shapeCoords, points) {
  if (points.length === 0) {
    return Infinity;
  }

  const totalPerpM = points.reduce(
    (sum, point) => sum + projectPointOntoPolyline(shapeCoords, point.lat, point.lon).perpM,
    0
  );

  return totalPerpM / points.length;
}

/**
 * Escolhe, entre os shapes (traçados) da linha, o que melhor representa um
 * grupo de pontos (veiculos de um sentido, ou paradas de um sentido). Em
 * corredores/tubo as faixas de ida e volta ficam a poucos metros uma da
 * outra, entao a distancia perpendicular de UM ponto isolado pode "colar"
 * no shape errado - por isso a escolha e pela MENOR distancia perpendicular
 * MEDIA de todos os pontos do grupo, validado com dados reais das linhas
 * 203 (2 sentidos) e 602 (circular, 5 shapes do mesmo loop).
 */
// buildLineLinearLayout recebe o dia inteiro de pontos (todos os quadros de
// todos os veiculos que passaram pela linha, nao so um instante) pra nao
// deixar nenhum sentido sem grupo resolvido - o que pode ser milhares de
// pontos por sentido. resolveBestShapeForPoints so precisa de uma amostra
// representativa pra calcular a media com confianca, entao os pontos usados
// nele sao limitados a esse tanto (amostrados por igual, nao so os
// primeiros) antes de projetar em cada shape candidato.
const MAX_POINTS_FOR_SHAPE_RESOLUTION = 150;

function subsampleEvenly(points, maxCount) {
  if (points.length <= maxCount) {
    return points;
  }

  const step = points.length / maxCount;
  const sampled = [];
  for (let i = 0; i < maxCount; i += 1) {
    sampled.push(points[Math.floor(i * step)]);
  }

  return sampled;
}

function resolveBestShapeForPoints(shapes, points) {
  const sampledPoints = subsampleEvenly(points, MAX_POINTS_FOR_SHAPE_RESOLUTION);
  let best = null;

  for (const shape of shapes) {
    const avgPerpM = averagePerpDistanceM(shape.coords, sampledPoints);

    if (!best || avgPerpM < best.avgPerpM) {
      best = { shape, avgPerpM };
    }
  }

  return best?.shape ?? null;
}

/**
 * Entre os grupos de paradas (agrupadas por "sentido", nome do terminal de
 * origem no geoJson - nao tem relacao direta com o SENT do veiculo), acha o
 * que melhor se encaixa no shape ja resolvido para um grupo de veiculos.
 */
function resolveStopsForShape(stopsBySentido, shape) {
  let best = null;

  for (const points of stopsBySentido.values()) {
    const avgPerpM = averagePerpDistanceM(shape.coords, points);

    if (!best || avgPerpM < best.avgPerpM) {
      best = { points, avgPerpM };
    }
  }

  if (!best) {
    return [];
  }

  return best.points
    .map((point) => ({
      nome: point.nome,
      alongM: round(projectPointOntoPolyline(shape.coords, point.lat, point.lon).alongM, 1),
      isTerminal: point.nome.startsWith("Terminal"),
    }))
    .sort((a, b) => a.alongM - b.alongM);
}

// O que fica caro em buildLineLinearLayout e resolver, pra cada sentido, qual
// shape do geoJson representa ele (resolveBestShapeForPoints, que projeta
// ate 150 pontos em cada shape candidato) e as paradas correspondentes - e
// nao os dados em si, que sao pequenos e estaveis (o traçado de uma linha
// nao muda de um dia pro outro). Por isso so o RESULTADO dessa resolucao
// (shapeId por sentido + paradas ja projetadas) e cacheado - nao geoJson
// nem coords, que ja tem cache proprio em getLineGeoJson e sao so
// re-hidratados daqui a partir do shapeId cacheado.
function hydrateGroupsFromCache(cachedGroups, shapes) {
  const shapesById = new Map(shapes.map((shape) => [shape.shapeId, shape]));
  const groups = new Map();

  for (const [sent, cachedGroup] of Object.entries(cachedGroups ?? {})) {
    const shape = shapesById.get(cachedGroup.shapeId);
    if (!shape) {
      // O traçado mudou de shapeId desde que o cache foi gravado (raro) -
      // esse sentido fica de fora; buildLineLinearLayout recalcula do zero
      // se isso deixar o layout sem nenhum grupo valido.
      continue;
    }

    groups.set(sent, {
      shapeId: shape.shapeId,
      coords: shape.coords,
      lengthM: round(shape.lengthM, 1),
      isLoop: shape.isLoop,
      stops: cachedGroup.stops,
    });
  }

  return groups;
}

function serializeGroupsForCache(groups) {
  const serialized = {};

  for (const [sent, group] of groups) {
    serialized[sent] = { shapeId: group.shapeId, stops: group.stops };
  }

  return serialized;
}

/**
 * Monta o "layout" do mapa linear de uma linha: para cada sentido presente
 * no snapshot de veiculos informado, resolve qual shape (traçado) do geoJson
 * representa aquele sentido e projeta as paradas correspondentes nele.
 *
 * O snapshot de veiculos e necessario so pra desambiguar shape<->sentido
 * (nao ha esse vinculo direto no geoJson) - depois de montado, o layout
 * retornado (coords + lengthM + isLoop por sentido) pode ser reusado a cada
 * frame com projectPointOntoPolyline/computeSpacing, sem rebuscar o geoJson.
 *
 * O resultado da resolucao (shapeId por sentido + paradas) fica em cache no
 * IndexedDB por 24h (ver hydrateGroupsFromCache) - enquanto o cache estiver
 * valido, filtrar a mesma linha de novo (mesma sessao ou apos recarregar a
 * pagina) nao precisa reprocessar nada, so re-hidratar com o geoJson (que ja
 * tem cache proprio).
 *
 * @param {string} lineCode
 * @param {{sent: string, lat: number, lon: number}[]} vehicleSnapshot
 * @returns {Promise<{lineCode: string, groups: Map<string, {shapeId: string|null, coords: number[][], lengthM: number, isLoop: boolean, stops: {nome:string, alongM:number, isTerminal:boolean}[]}>} | null>}
 */
export async function buildLineLinearLayout(lineCode, vehicleSnapshot, now = Date.now()) {
  const geoJson = await getLineGeoJson(lineCode);
  const shapes = extractShapes(geoJson);

  if (shapes.length === 0) {
    return null;
  }

  const cached = await lineLinearLayoutRepository.get(lineCode);
  if (isLinearLayoutCacheFresh(cached, now)) {
    const groups = hydrateGroupsFromCache(cached.groups, shapes);
    if (groups.size > 0) {
      return { lineCode, groups };
    }
  }

  const stopsBySentido = extractStopsBySentido(geoJson);

  const pointsBySent = new Map();
  for (const vehicle of vehicleSnapshot ?? []) {
    const sent = vehicle.sent || "";
    if (!pointsBySent.has(sent)) {
      pointsBySent.set(sent, []);
    }
    pointsBySent.get(sent).push(vehicle);
  }

  const groups = new Map();

  for (const [sent, points] of pointsBySent) {
    const shape = shapes.length === 1 ? shapes[0] : resolveBestShapeForPoints(shapes, points);
    if (!shape) {
      continue;
    }

    const lengthM = round(shape.lengthM, 1);
    const stops = resolveStopsForShape(stopsBySentido, shape);

    // Linha circular: repete a primeira parada no fim do traçado (mesmo
    // nome, alongM = lengthM), pra deixar visualmente claro no mapa linear
    // que o final do trajeto fecha o loop de volta pra ela.
    if (shape.isLoop && stops.length > 0) {
      stops.push({ nome: stops[0].nome, alongM: lengthM, isTerminal: stops[0].isTerminal });
    }

    groups.set(sent, {
      shapeId: shape.shapeId,
      coords: shape.coords,
      lengthM,
      isLoop: shape.isLoop,
      stops,
    });
  }

  if (groups.size === 0) {
    return null;
  }

  await lineLinearLayoutRepository.set(lineCode, serializeGroupsForCache(groups), LINE_LINEAR_LAYOUT_CACHE_VERSION, now);

  return { lineCode, groups };
}
