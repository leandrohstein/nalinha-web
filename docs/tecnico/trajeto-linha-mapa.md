# Documentação técnica — Trajeto da linha no mapa

Desenho, sobre o mapa real (Leaflet), do traçado oficial (geoJson) da linha ativa na tela de [Movimentação](../movimentacao.md), incluindo os pontos de parada.

Arquivos envolvidos: [`map.js`](../../map.js), [`services/lineGeoJsonService.js`](../../services/lineGeoJsonService.js), [`services/lineGeoJsonRepository.js`](../../services/lineGeoJsonRepository.js), [`services/lineColorService.js`](../../services/lineColorService.js).

## 1. Resolver qual linha exibir — `resolveRouteLineCode()`

Chamada a cada quadro renderizado (dentro de `scheduleLineRouteUpdate`, disparada por `renderFrame`) e a cada mudança de filtro (`applyFilter`). Prioridade, na ordem:

1. **Bloco de operação atual do veículo fixado** — `findCurrentOperationBlock()` usa `computeServiceBlocks(track.vehicles[pinnedCod])` (de [`ui/movimentacaoUi.js`](../../ui/movimentacaoUi.js)) para achar blocos contínuos em que o veículo esteve numa mesma `codigolinha` (ignorando trechos `REC` curtos que não trocam de tabela — ver comentário em `computeServiceBlocks`) e retorna o bloco que contém `state.currentTime`. Se o veículo fixado está operando agora, o trajeto dessa linha tem prioridade sobre qualquer filtro.
2. **Filtro por linha** (`state.filterInfo.field === "linha"`) — usa `filter.value` diretamente.
3. **Prefixo completo casando um único veículo** — `resolveSinglePrefixMatchCod()` (filtro de 5 caracteres com exatamente 1 correspondência em `state.filteredCods`) seguido de `findVehicleLineCode()`, que varre todos os quadros do veículo em busca da primeira `codigolinha` diferente de `REC` (mesmo que agora ele esteja fora de operação).

Sem nenhum desses casos, retorna `null` e o trajeto é removido do mapa.

## 2. Debounce + invalidação por token — `scheduleLineRouteUpdate()`

```
scheduleLineRouteUpdate()
  → lineCode = resolveRouteLineCode()
  → se lineCode === state.lastRouteLineCode: não faz nada (early return)
  → state.lastRouteLineCode = lineCode
  → cancela debounce pendente; state.lineRouteToken += 1
  → se !lineCode: clearLineRoute() e para
  → agenda updateLineRoute(lineCode) após LINE_ROUTE_DEBOUNCE_MS (400ms)
```

Pontos importantes:

- A função é chamada **todo frame** durante a reprodução, então o primeiro `if` (comparar com `state.lastRouteLineCode`) é essencial — sem ele o debounce nunca dispararia, pois seria reiniciado antes de completar.
- `state.lineRouteToken` é incrementado sempre que a linha resolvida muda (mesmo que ainda dentro do debounce). `updateLineRoute` captura o token no início e o revalida após cada `await`; se não bater mais, descarta o resultado. Isso evita que uma resposta de rede lenta para uma linha antiga sobrescreva o trajeto de uma linha mais nova já selecionada.

## 3. Busca dos dados — `updateLineRoute(lineCode)`

- `getLineGeoJson(lineCode)` ([`services/lineGeoJsonService.js`](../../services/lineGeoJsonService.js)): busca `geoJson/<cod>.json` no repositório de dados (GitHub raw), cacheado no IndexedDB (`urbs-line-geojson-db`) por 24h. Particularidade: um cache com `data === null` (linha ainda sem trajeto publicado) **não** é considerado válido para reaproveitar — sempre tenta de novo, para não ficar até 24h sem mostrar o trajeto assim que ele for publicado. Em caso de falha de rede, se já existe algum cache (mesmo vencido), ele é retornado como fallback em vez de propagar o erro.
- `getByCod(lineCode)`: metadados da linha (nome, `CATEGORIA_SERVICO`), usados só para resolver a cor.
- `getLineRouteColor(lineRecord)` ([`services/lineColorService.js`](../../services/lineColorService.js)): mapeia `CATEGORIA_SERVICO` normalizada (sem acento, maiúscula) para uma cor:
  - `MADRUGUEIRO` → vermelho escuro fixo; `JARDINEIRA` → verde fixo.
  - `CONVENCIONAL` / `SERVICO AOS OPERADORES` → cor da categoria "Troncal".
  - `LINHA DIRETA` → cor específica por código (`LINHA_DIRETA_COLOR_BY_COD`, mapa curado manualmente linha a linha) ou uma cor cinza padrão se o código não estiver no mapa.
  - Demais categorias (Troncal, Alimentador, Expresso, Interbairros, Ligeirão) → cor fixa por categoria; categoria desconhecida → roxo padrão (`#7c3aed`, o mesmo usado como `LINE_ROUTE_STYLE.color` de fallback em `map.js`).

## 4. Renderização no mapa

- `clearLineRoute()` limpa o `routeLayer` (um `L.layerGroup` próprio, separado da camada de marcadores) antes de desenhar de novo.
- O geoJson é adicionado em **duas camadas `L.geoJSON` separadas**, nessa ordem (a ordem de inserção define a pilha visual no pane do Leaflet):
  1. Features que não são ponto (`LineString`, o traçado): estilizadas com `LINE_ROUTE_STYLE` (peso 4, opacidade 0.7) e a cor resolvida acima.
  2. Features de ponto (`Point`/`MultiPoint`, as paradas): renderizadas como `L.circleMarker` via `pointToLayer`, com tooltip do nome da parada (`feature.properties.nome`) quando presente.
- **Raio dos pontos de parada por zoom** — `getLineRoutePointRadius(zoom)` interpola linearmente entre `LINE_ROUTE_POINT_MIN_RADIUS` (3) e `LINE_ROUTE_POINT_MAX_RADIUS` (8.33) usando a mesma faixa de zoom dos marcadores de veículo (`MARKER_SIZE_MIN_ZOOM`=11 a `MARKER_SIZE_MAX_ZOOM`=19).
- **Visibilidade dos pontos de parada** — `getLineRoutePointStyle(zoom)`: ficam ocultos (`fillOpacity`/`opacity` = 0, mas continuam no DOM) quando o checkbox "Ocultar pontos de parada" (`state.hideStopPoints`) está marcado, ou quando o zoom é menor que `LINE_ROUTE_POINT_MIN_ZOOM` (13) — evita poluir o mapa com centenas de pontos em zoom afastado.
- `map.on("zoomend", ...)` chama `updateRoutePointStyles()`, que percorre `routeLayer` (descendo um nível, pois o grupo de pontos é um `L.geoJSON`/`FeatureGroup` contendo os `circleMarker`s individuais) reaplicando raio/estilo sem precisar rebuscar dados — só a camada de pontos responde a isso (`setRadius` existe apenas nela).

## 5. Interação com outros controles

- **Botão de centralizar** — quando há um filtro por linha ativo, usa `getRouteLayerBounds()`: percorre as camadas de `routeLayer` chamando `getBounds()` (todo `L.geoJSON` é um `FeatureGroup` e já tem isso pronto) e funde os bounds válidos, em vez de enquadrar só os veículos visíveis.
- **Badge do botão de centralizar** — `updateRecenterLineBadge()` mostra o código da linha filtrada com a cor resolvida por `getLineRouteColor`, cacheada em `state.lineColorCache` (Map por código de linha, compartilhado com os blocos de janela de operação na barra de progresso — ver `renderOperationWindowMarks`) para não repetir a busca de `getByCod`/cálculo de cor a cada atualização.
