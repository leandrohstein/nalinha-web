# Documentação técnica — Mapa linear (esquemático)

Painel abaixo do mapa real, na tela de [Movimentação](../movimentacao.md), que representa a linha ativa como uma ou mais trilhas retas (uma por sentido), com as paradas e os veículos posicionados proporcionalmente à distância percorrida ao longo do trajeto oficial — em vez de coordenadas geográficas.

Arquivos envolvidos: [`map.js`](../../map.js), [`services/vehicleSpacingService.js`](../../services/vehicleSpacingService.js), [`services/lineLinearLayoutRepository.js`](../../services/lineLinearLayoutRepository.js), [`services/lineGeoJsonService.js`](../../services/lineGeoJsonService.js).

## 1. Resolver qual linha exibir — `resolveLinearMapLineCode()`

Mais restrito que a resolução do [trajeto no mapa](trajeto-linha-mapa.md): só mostra o mapa linear quando

1. o veículo fixado está dentro de um bloco de operação **agora** (`findCurrentOperationBlock()`, mesma função usada pelo trajeto no mapa), ou
2. o filtro de busca atual é por linha (`filter.field === "linha"`).

Ao contrário do trajeto no mapa, **não** aparece só por um prefixo completo casar com um único veículo fora de operação no instante atual — o painel fica oculto nesse caso.

## 2. Debounce + invalidação por token — `scheduleLinearMapUpdate()`

Mesmo padrão de [`scheduleLineRouteUpdate`](trajeto-linha-mapa.md#2-debounce--invalidação-por-token--schedulelinerouteupdate): chamada todo frame (via `renderFrame`) e em toda mudança de filtro; só age quando a linha resolvida (`resolveLinearMapLineCode()`) muda em relação a `state.lastLinearMapLineCode`; usa debounce de `LINE_ROUTE_DEBOUNCE_MS` (400ms) e um token próprio (`state.linearMapToken`, incrementado a cada mudança) para descartar respostas assíncronas de uma linha que já deixou de ser a atual.

## 3. Montagem do layout (uma vez por linha) — `buildLineLinearLayout(lineCode, vehicleSnapshot)`

Definida em [`services/vehicleSpacingService.js`](../../services/vehicleSpacingService.js), chamada por `updateLinearMap(lineCode)` em `map.js`. É a parte cara da funcionalidade — resolver **qual shape do geoJson representa cada sentido** — por isso o resultado é cacheado.

1. `getLineGeoJson(lineCode)` busca o geoJson da linha (mesmo cache de 24h usado pelo trajeto no mapa).
2. `extractShapes(geoJson)` filtra as features `LineString`, calculando para cada uma:
   - `lengthM`: soma das distâncias haversine entre pontos consecutivos.
   - `isLoop`: `true` quando a distância entre o primeiro e o último ponto é menor que `LOOP_CLOSURE_THRESHOLD_M` (300m) — linhas circulares têm início/fim praticamente no mesmo lugar.
3. **Cache do layout resolvido** (`lineLinearLayoutRepository`, IndexedDB `urbs-line-linear-layout-db`): válido por 24h **e** quando `version === LINE_LINEAR_LAYOUT_CACHE_VERSION` (atualmente `2`). A versão existe separada do TTL porque o TTL só cobre "ficou velho com o tempo" — se o *formato* do que é cacheado mudar (ex: um novo campo por parada), um cache antigo dentro do TTL continuaria sendo servido no formato errado sem o bump de versão.
   - Se o cache está fresco, `hydrateGroupsFromCache` religa cada grupo cacheado (`{shapeId, stops}`) ao shape correspondente (buscado de novo via `getLineGeoJson`, que também tem cache próprio) por `shapeId`. Se um `shapeId` cacheado não existe mais nos shapes atuais (traçado mudou), aquele sentido fica de fora — só quando **nenhum** sentido sobrevive é que o layout é recalculado do zero.
4. **Resolução de shape por sentido** (quando não há cache válido): os veículos do snapshot passado (`vehicleSnapshot`) são agrupados por `sent` (campo `SENT` do veículo). Para cada grupo, `resolveBestShapeForPoints(shapes, points)`:
   - Se só existe 1 shape, usa ele direto.
   - Senão, amostra até `MAX_POINTS_FOR_SHAPE_RESOLUTION` (150) pontos igualmente espaçados (`subsampleEvenly`) e projeta cada um em cada shape candidato via `projectPointOntoPolyline`, escolhendo o shape com **menor distância perpendicular média** (`averagePerpDistanceM`). Necessário porque em corredores/tubos as faixas de ida e volta ficam a poucos metros uma da outra — a distância de um único ponto isolado pode "colar" no shape errado, mas a média de uma amostra grande é confiável (validado com as linhas 203, que tem 2 sentidos, e 602, circular com 5 shapes do mesmo loop).
5. **Paradas por sentido**: `extractStopsBySentido(geoJson)` agrupa as features `Point` do geoJson pela propriedade `sentido` (não confundir com o `SENT` do veículo — são conceitos diferentes, um vem do geoJson estático e outro do AVL). Nomes de parada são limpos por `cleanStopName`, que remove o sufixo com as outras linhas que passam por ali (padrão `" - <código da linha><resto>"`, ex: `"Terminal Cabral - 250 - Ligeirão Norte/Sul"` → `"Terminal Cabral"`).
   - `resolveStopsForShape(stopsBySentido, shape)` usa a mesma lógica de menor distância perpendicular média para achar qual grupo de paradas pertence ao shape já resolvido, e projeta cada parada nele (`alongM`) via `projectPointOntoPolyline`.
   - Linhas circulares (`isLoop`) recebem a primeira parada duplicada no fim (`alongM = lengthM`), para deixar visualmente claro que o trajeto fecha o loop.
6. Só o **resultado** da resolução (`shapeId` + paradas já projetadas por sentido) é persistido no cache — não o geoJson/coords em si, que têm cache próprio e são só "re-hidratados" a cada leitura.

### Por que usar o dia inteiro de pontos, não o instante atual

`updateLinearMap` passa para `buildLineLinearLayout` o resultado de `getAllDayLineVehiclePoints(lineCode)` — todos os quadros de todos os veículos que passaram por aquela linha em qualquer momento do dia já carregado — em vez de `getCurrentLineVehiclePoints` (posição só no instante atual). Usar apenas o instante atual arriscaria deixar um sentido sem nenhum ponto para resolver o shape (ex: nenhum veículo "volta" ainda passou naquele minuto), e o painel ficaria sem uma das trilhas até o filtro ser reaplicado — o que pode nunca acontecer.

## 4. Renderização estática — `buildLinearMapDom(layout, color)`

Chamada só quando o layout muda (linha diferente), não a cada frame. Monta, por sentido (ordenados por `LINEAR_MAP_SENT_ORDER`: `IDA` primeiro, `VOLTA` depois, outros/vazio por último — rótulo `"N/D"` quando `SENT` vem vazio, comum em veículos ainda saindo da garagem):

- Um "trilho" (`.linear-map-rail`) e as paradas posicionadas em `left: (stop.alongM / group.lengthM) * 100%`, com `.linear-map-stop--terminal` quando `stop.isTerminal` (nome começa com "Terminal").
- Uma camada vazia (`.linear-map-vehicles-layer`) onde os ícones de veículo serão inseridos/atualizados a cada frame por `renderLinearMapVehicles`.
- `group.vehicleEls` (Map por código de veículo) e `group.lastAlongMByCod` (Map usada pela suavização, ver abaixo) são inicializados aqui e vivem no objeto do grupo enquanto o layout não muda.

## 5. Atualização por frame — `renderLinearMapVehicles()`

Chamada em todo `renderFrame()` (reprodução, seek, etc.) — não faz nenhuma chamada assíncrona, só reprojeta e reposiciona:

1. `getCurrentLineVehiclePoints(layout.lineCode)`: posição interpolada (`getInterpolatedPoint`) de cada veículo que está, no instante atual, na linha do layout e com `sent` definido (veículos sem sentido ainda atribuído pela URBS simplesmente não aparecem).
2. Para cada veículo, `projectPointOntoPolyline(group.coords, lat, lon)` dá o `alongM` bruto (posição ao longo do trajeto) e `perpM` (distância perpendicular, não usada aqui).
3. **Suavização de regressão** — `smoothLinearMapAlongM(previousAlongM, rawAlongM)`: o geoJson é uma referência simplificada da rota; em desvios (ex: entrada num terminal) o veículo se afasta dele e o ponto mais próximo projetado pode "recuar" por alguns quadros até o veículo se reaproximar do traçado — sem correção isso apareceria como o ônibus andando para trás no mapa linear. Regressões pequenas (até `LINEAR_MAP_BACKWARD_JITTER_TOLERANCE_M`, 700m) ficam "paradas" na última posição boa (`previousAlongM`); regressões maiores — fechamento real de loop, início de nova viagem — são grandes demais para serem esse efeito e passam direto. O estado anterior por veículo fica em `group.lastAlongMByCod`.
4. `computeSpacing(vehiclePositions, lengthM, isLoop)`: ordena os veículos do grupo por `alongM` e calcula, para cada um (exceto o primeiro, a menos que `isLoop`), `gapToPreviousM` (diferença de `alongM` para o veículo anterior) e `gapToPreviousS` — headway em segundos, calculado como `gapToPreviousM / velocidade do próprio veículo` (não a velocidade relativa entre os dois), a mesma definição usual de headway em transporte público (`computeGapTimeS`). Em `isLoop`, o primeiro veículo da lista também ganha gap em relação ao último, fechando o ciclo pela "costura" do loop — a soma de todos os gaps sempre bate com `lengthM`.
5. **Diffing de DOM**: `group.vehicleEls` (Map cod→elemento) é comparado com o conjunto de códigos vistos neste frame (`seenCods`); elementos de veículos que saíram são removidos do DOM e do Map (e de `lastAlongMByCod`); elementos novos são criados sob demanda (ícone `🚌` + código, com listener de clique que chama `togglePinnedVehicle`, igual ao marcador no mapa); os demais só têm `style.left`, a classe `linear-map-vehicle--pinned` e o `title` (via `formatGapLabel`) atualizados.
   - `formatGapLabel`: distância em metros ou km (≥1000m vira `X.Ykm`), seguida opcionalmente de `(~Xmin Ys)` (`formatDurationShort`) quando há velocidade válida para estimar o tempo.

## 6. Encerramento — `clearLinearMap()`

Chamada quando `resolveLinearMapLineCode()` deixa de retornar um código de linha (filtro removido, veículo fixado saiu de operação): zera `state.linearMapLayout`, esvazia e oculta `#lineLinearMap` (`aria-hidden="true"`).
