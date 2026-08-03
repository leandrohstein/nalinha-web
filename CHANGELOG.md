# Changelog

Histórico de versões gerado retroativamente a partir do histórico de commits (nenhuma release existia antes desta configuração) e, a partir daqui, mantido automaticamente pelo [release-please](https://github.com/googleapis/release-please).

## [1.1.1](https://github.com/leandrohstein/nalinha-web/compare/v1.1.0...v1.1.1) (2026-07-20)

### Correções

* descarta velocidade calculada acima de 70 km/h e exibe -.- km/h ([f4595d4](https://github.com/leandrohstein/nalinha-web/commit/f4595d4))

## [1.1.0](https://github.com/leandrohstein/nalinha-web/compare/v1.0.0...v1.1.0) (2026-07-17)

### Funcionalidades

* exibe icones de tipo e tecnologia do veiculo no tooltip do mapa ([6bb9c3d](https://github.com/leandrohstein/nalinha-web/commit/6bb9c3d))
* substitui icones inline por sprite SVG para tipos e tecnologias de veiculo ([804198a](https://github.com/leandrohstein/nalinha-web/commit/804198a))
* adiciona zoom automatico e exibicao da rota ao filtrar por prefixo completo ([39fca1f](https://github.com/leandrohstein/nalinha-web/commit/39fca1f))
* fixa tooltip do veiculo ao clicar e mantem o mapa seguindo ele ([7e10793](https://github.com/leandrohstein/nalinha-web/commit/7e10793))
* reorganiza layout do tooltip do veiculo no mapa ([202aa29](https://github.com/leandrohstein/nalinha-web/commit/202aa29))
* exibe janelas de operacao do veiculo fixado sobre o seekRange ([f027f51](https://github.com/leandrohstein/nalinha-web/commit/f027f51))
* adiciona botao para pular para a proxima operacao do veiculo fixado ([8827081](https://github.com/leandrohstein/nalinha-web/commit/8827081))
* exibe o trajeto da linha ao entrar na janela de operacao do veiculo fixado ([1f7ecc3](https://github.com/leandrohstein/nalinha-web/commit/1f7ecc3))
* exibe velocidade e distancia percorrida na ultima linha do tooltip ([c2e37d5](https://github.com/leandrohstein/nalinha-web/commit/c2e37d5))
* oculta pontos de parada do trajeto da linha abaixo do zoom 13 ([bdd2ca6](https://github.com/leandrohstein/nalinha-web/commit/bdd2ca6))
* ajusta zoom ao trajeto da linha e exibe badge no botao de centralizar ([751526f](https://github.com/leandrohstein/nalinha-web/commit/751526f))
* mantem posicao congelada com opacidade reduzida sem GPS recente ([06b6296](https://github.com/leandrohstein/nalinha-web/commit/06b6296))
* adiciona icones de sinal/GPS ao sprite e exibe no tooltip do veiculo ([465ef75](https://github.com/leandrohstein/nalinha-web/commit/465ef75))
* reimporta badges como paths e ajusta tamanhos/tooltips dos icones ([1a9f934](https://github.com/leandrohstein/nalinha-web/commit/1a9f934))
* adiciona mapa linear de espacamento dos veiculos por sentido ([1f696fe](https://github.com/leandrohstein/nalinha-web/commit/1f696fe))
* adiciona opcao de seguir o veiculo fixado no mapa ([980f513](https://github.com/leandrohstein/nalinha-web/commit/980f513))

### Correções

* centraliza o marcador de tempo atual do seekRange com as demais marcacoes ([a1e2ad6](https://github.com/leandrohstein/nalinha-web/commit/a1e2ad6))
* faz o card da pagina de movimentacao ocupar 90% da altura da tela ([d1e3a57](https://github.com/leandrohstein/nalinha-web/commit/d1e3a57))
* nao guarda 404 de trajeto de linha em cache por 24h ([f96d479](https://github.com/leandrohstein/nalinha-web/commit/f96d479))
* corrige tooltip, limpeza de nome e marcador de terminal no mapa linear ([c7889da](https://github.com/leandrohstein/nalinha-web/commit/c7889da))

## 1.0.0 (2026-07-15)

Release inicial retroativa, cobrindo o histórico do projeto desde o primeiro commit até a primeira PR mergeada.

### Funcionalidades

* ativar responsividade ([89c4b35](https://github.com/leandrohstein/nalinha-web/commit/89c4b35))
* segmentação do css / ajuste na exibição da informação de update ([b232d9b](https://github.com/leandrohstein/nalinha-web/commit/b232d9b))
* implement search filter functionality with mobile support ([33208fe](https://github.com/leandrohstein/nalinha-web/commit/33208fe))
* adiciona tela de Movimentacao com trajeto dos veiculos no mapa ([6020473](https://github.com/leandrohstein/nalinha-web/commit/6020473))
* adiciona link de navegacao para a tela de Movimentacao ([e837945](https://github.com/leandrohstein/nalinha-web/commit/e837945))
* substitui marcador circular por hexagonal no mapa de veiculos ([7790cb1](https://github.com/leandrohstein/nalinha-web/commit/7790cb1))
* sincroniza dados e bloqueia a interface do mapa durante o carregamento ([fd9c698](https://github.com/leandrohstein/nalinha-web/commit/fd9c698))
* destaca veiculos fora de operacao com transparencia no mapa ([95fb6d7](https://github.com/leandrohstein/nalinha-web/commit/95fb6d7))
* adiciona controles de mapa para centralizar e ocultar veiculos fora de operacao ([0b67f05](https://github.com/leandrohstein/nalinha-web/commit/0b67f05))
* adiciona marcadores de hora navegaveis na barra de progresso ([5ffaa44](https://github.com/leandrohstein/nalinha-web/commit/5ffaa44))
* adiciona Picture-in-Picture para o mapa de movimentacao ([fd79730](https://github.com/leandrohstein/nalinha-web/commit/fd79730))
* usa o campo REFRESH de cada veiculo para marcar o tempo do trajeto ([ae3c4df](https://github.com/leandrohstein/nalinha-web/commit/ae3c4df))
* adiciona atalhos de teclado para navegar no tempo do mapa ([a80543c](https://github.com/leandrohstein/nalinha-web/commit/a80543c))
* ajusta tamanho dos marcadores de veiculos conforme o zoom do mapa ([f4369a4](https://github.com/leandrohstein/nalinha-web/commit/f4369a4))
* exibe o trajeto (geoJson) da linha filtrada no mapa de movimentacao ([c76adb8](https://github.com/leandrohstein/nalinha-web/commit/c76adb8))
* marca na timeline o momento em que o primeiro veiculo entra na linha filtrada ([e3d5f27](https://github.com/leandrohstein/nalinha-web/commit/e3d5f27))
* restringe exibicao do veiculo ao periodo de operacao da linha filtrada ([da9abe4](https://github.com/leandrohstein/nalinha-web/commit/da9abe4))
* ajusta janelas de operacao na virada da meia-noite e marcador de entrada na linha ([e6961a4](https://github.com/leandrohstein/nalinha-web/commit/e6961a4))
* adiciona controle para ocultar os pontos de parada do trajeto da linha ([d0d2397](https://github.com/leandrohstein/nalinha-web/commit/d0d2397))
* adiciona tooltip com o nome do ponto de parada no hover ([8199870](https://github.com/leandrohstein/nalinha-web/commit/8199870))
* adiciona metricas de deslocamento ao calculo de movimentacao ([50615e4](https://github.com/leandrohstein/nalinha-web/commit/50615e4))
* ajusta ordem de empilhamento dos elementos do mapa de movimentacao ([2f2fd34](https://github.com/leandrohstein/nalinha-web/commit/2f2fd34))

### Correções

* path ([5c20f3c](https://github.com/leandrohstein/nalinha-web/commit/5c20f3c))
* responsive navigation ([473aff1](https://github.com/leandrohstein/nalinha-web/commit/473aff1))
* correção no fluxo de limpeza de filtros ([da6bfc3](https://github.com/leandrohstein/nalinha-web/commit/da6bfc3))
* ignora registros com prefixo de veiculo em formato invalido ([16c4d98](https://github.com/leandrohstein/nalinha-web/commit/16c4d98))
* filtro por linha reavalia a linha atual do veiculo a cada quadro ([f5ac70f](https://github.com/leandrohstein/nalinha-web/commit/f5ac70f))

### Performance

* evita ressincronizar dias ja sincronizados e processados no mapa ([00203f5](https://github.com/leandrohstein/nalinha-web/commit/00203f5))

### Refatorações

* unifica nucleo de sincronizacao de dados entre index e mapa ([bcbc618](https://github.com/leandrohstein/nalinha-web/commit/bcbc618))
