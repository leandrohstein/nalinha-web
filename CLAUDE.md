# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Visão geral

NaLinha Web é uma aplicação estática (HTML/CSS/JS puro, ES modules, sem bundler/build step, sem `package.json`), publicada via GitHub Pages, que exibe dados de operação e movimentação dos ônibus da URBS (Curitiba). Todos os dados vêm de repositórios GitHub companheiros da organização `nalinha-app` (branch `data`) que publicam o feed público da URBS como arquivos JSON estáticos (snapshots de veículos por minuto, lista de linhas, tipos de veículo, geoJson de trajeto por linha). Os dumps de veículos são segregados por ano em repositórios separados (`transporteservico-urbs-data-2023`, `-2024`, `-2025`, `-2026`, ...) — a URL usada depende do ano da data buscada (`buildVeiculosBaseUrl` em `services/vehicleDataService.js`). Linhas, tipos de veículo e geoJson de trajeto não são segregados por ano e ficam sempre no repositório mais recente (`transporteservico-urbs-data-2026`). Este app é só um consumidor estático desses arquivos via `raw.githubusercontent.com` — não existe backend próprio; "sincronizar" sempre significa "buscar os minutos faltantes nesses JSONs e cachear em IndexedDB".

Há duas páginas independentes que compartilham as camadas `services/` e `ui/`:
- **`index.html` + `nalinha.js`** — "Relátorio de Operações": tabela paginada/buscável com o snapshot mais recente dos veículos.
- **`map.html` + `map.js`** — "Movimentação": replay em mapa (Leaflet) da movimentação dos veículos num dia escolhido, com view linear/esquemática da linha, suporte a Picture-in-Picture e controles de reprodução.

## Comandos

Não há build, lint ou testes configurados. Para rodar localmente é necessário um servidor estático (ES modules + `fetch` exigem `http(s)://`, não funcionam em `file://`), por exemplo:

```bash
python3 -m http.server
# ou
npx serve
```

## Arquitetura

### Camadas de cache (IndexedDB nativo, sem lib)

Cada `services/*Repository.js` só sabe conversar com o seu próprio IndexedDB (abrir a DB + CRUD via Promises). O `services/*Service.js` correspondente adiciona a lógica de negócio por cima (TTL de frescor, fetch de rede + fallback, formatação dos dados). O código de UI (`nalinha.js`, `map.js`, `ui/*.js`) nunca toca IndexedDB diretamente — sempre passa pela camada de serviço.

| Repository | DB | Conteúdo | TTL |
|---|---|---|---|
| `cacheRepository.js` | `urbs-cache-db` | snapshot bruto de veículos por minuto, chave `"YYYY-MM-DD HH:MM"` | sem TTL (histórico) |
| `lineDataRepository.js` | `urbs-line-data-db` | metadados das linhas (`getLinhas.json`) | 24h |
| `vehicleTypeDataRepository.js` | `urbs-vehicle-type-data-db` | metadados de tipo de veículo (ícone/tecnologia) | 24h |
| `lineGeoJsonRepository.js` | `urbs-line-geojson-db` | geoJson do trajeto por linha (shapes + paradas) | 24h; em falha de rede reaproveita o último cache conhecido |
| `lineLinearLayoutRepository.js` | `urbs-line-linear-layout-db` | resultado (caro de calcular) de qual shape representa cada sentido + paradas projetadas | 24h + `LINE_LINEAR_LAYOUT_CACHE_VERSION` (incrementar ao mudar o formato cacheado) |
| `movementDataRepository.js` | `urbs-movement-db` | trilha de movimentação já processada (frames por veículo, o dia inteiro) | derivada sob demanda a partir do `cacheRepository` |

### Pipeline de replay de movimentação (`map.js`)

1. `dataSyncService.syncDayToCache` busca os minutos faltantes do dia escolhido e popula o `cacheRepository` (com overlay cancelável na UI).
2. `movementDataService.buildMovementTrack` converte os snapshots em arrays de frames por veículo (`parseEntriesIntoVehicleFrames`), calculando distância/velocidade/bearing entre frames consecutivos (`annotateMovementMetrics`) e descartando velocidades fisicamente implausíveis (> 70 km/h, `MAX_VALID_SPEED_KMH`).
3. Turnos que atravessam a meia-noite são costurados com uma janela pequena do dia anterior/seguinte (`getPreviousDayLateFrames` / `getNextDayEarlyFrames`), para o turno não parecer reiniciar às 00:00.
4. A reprodução interpola a posição do veículo entre frames (`getInterpolatedPoint` em `ui/movimentacaoUi.js`) e move os marcadores/timeline do Leaflet.
5. O "mapa linear" (opcional) projeta as posições dos veículos no traçado geoJson da linha via `vehicleSpacingService` (`projectPointOntoPolyline`, `computeSpacing`) para mostrar ordem/espaçamento (headway) ao longo da rota, fora do mapa real.

### Busca

`ui/search.js` implementa a sintaxe de filtro `linha:` / `prefixo:` usada na tabela de operações; `ui/movimentacaoUi.js` tem uma implementação equivalente (`parseVehicleFilter`/`matchesCurrentFilter`) para o filtro de veículos no mapa de movimentação — ao mudar a sintaxe de busca, checar as duas.

## Convenções

- Comentários, strings e textos de UI em português (pt-BR).
- ES modules em todo o código (`<script type="module">`) — sem bundler/transpiler, o código roda como está no navegador.
- Sem suite de testes e sem linter configurado.
