# Movimentação (`map.html`)

Replay em mapa da movimentação dos veículos ao longo de um dia inteiro, com busca/filtro por linha ou veículo, mapa linear esquemático e Picture-in-Picture.

## Carregar um dia

- Seletor de data (até o dia atual) + botão "Carregar": sincroniza os snapshots minuto a minuto daquele dia (buscando da rede o que ainda não está no cache local) e monta os trajetos de cada veículo.
  - Um overlay de sincronização mostra o progresso (%) e pode ser cancelado; ao cancelar, nada é processado e é preciso carregar de novo.
  - Sincronizações incompletas de uma visita anterior continuam de onde pararam, em vez de recomeçar do zero.
  - Dias já totalmente sincronizados (dados históricos, imutáveis) pulam a etapa de sincronização e vão direto para o processamento.
- Botão "Reprocessar": reconstrói os trajetos a partir dos dados já sincronizados no IndexedDB, sem tentar buscar nada na rede — útil se a lógica de processamento mudou ou os dados pareceram inconsistentes.
- Veículos cujo turno atravessa a meia-noite continuam sendo exibidos de forma contínua (sem "reiniciar" às 00:00): o app busca automaticamente uma pequena janela do fim do dia anterior e do início do dia seguinte para reconhecer e estender esses turnos.

## Mapa e marcadores

- Mapa (OpenStreetMap via Leaflet) com um marcador hexagonal por veículo visível, colorido conforme a situação (verde = no horário, amarelo = atrasado, vermelho = adiantado, cinza = indefinido).
- Estados visuais adicionais do marcador:
  - **Fora de operação** (linha `REC`): marcador fica em opacidade reduzida e some para trás dos demais.
  - **Stale**: sem atualização de GPS naquele minuto específico — marcador mostra um ícone de atenção.
  - **Frozen**: sem nenhum dado de GPS há mais tempo (acima do intervalo máximo aceitável) — a posição fica "congelada" no último ponto conhecido, com indicação visual, em vez de o veículo sumir do mapa.
- **Tooltip** ao passar o mouse (ou fixado, ver abaixo): prefixo do veículo, ícone de sinal GPS (ok / atenção / perdido), selo de acessibilidade, ícone do tipo de veículo e da tecnologia (elétrico, biodiesel, híbrido), nome da linha, situação, velocidade instantânea e distância acumulada no dia.
- **Fixar veículo (pin)**: clicar num marcador fixa o tooltip dele aberto e habilita as informações de janela de operação na barra de progresso. Clicar de novo desfixa.
- **Auto-pin por prefixo**: quando o filtro de busca é um prefixo completo (5 caracteres) que corresponde a exatamente um veículo, ele é fixado automaticamente.
- **Seguir veículo** (checkbox no mapa): mantém o mapa centralizado continuamente no veículo fixado enquanto ele se move.
- **Ocultar fora de operação** / **Ocultar pontos de parada**: checkboxes para simplificar a visualização do mapa.
- **Centralizar mapa** (botão): enquadra todos os veículos visíveis, ou — se houver um filtro por linha ativo — o trajeto completo dela; mostra um selo com o código da linha filtrada, na cor da categoria dela.
- **Zoom automático**: ao filtrar por um prefixo completo que casa com um único veículo, o mapa dá zoom nele.

## Busca / filtro

- Mesma sintaxe `linha:` / `prefixo:` do Relatório de Operações.
- Ao filtrar por **linha**, o app calcula "janelas de operação" por veículo: cada veículo só é exibido nos trechos de tempo em que de fato estava operando aquela linha (considerando que um veículo pode trocar de linha ao longo do dia, e voltar a operar a mesma linha mais de uma vez).
- A barra de progresso ganha uma marca clicável no primeiro instante em que algum veículo entra na linha filtrada naquele dia, e a reprodução salta automaticamente para esse instante ao aplicar o filtro.

## Reprodução (player)

- Play/pause, reiniciar (volta ao início do dia), barra de progresso arrastável (seek).
- Marcas de hora clicáveis na barra de progresso, para saltar direto para uma hora cheia.
- Velocidade de reprodução ajustável: 1, 2 (padrão), 5, 10 ou 20 minutos simulados por segundo real.
- Navegação por teclado: setas esquerda/direita avançam ou retrocedem 1 minuto (quando o foco não está nos campos de busca/data).
- Quando há um veículo fixado, a barra de progresso mostra blocos coloridos indicando os períodos em que ele esteve em operação naquele dia, cada bloco na cor da categoria da linha correspondente (podem ser linhas diferentes ao longo do dia); passar o mouse mostra a linha e o horário do bloco.
- Botão "Pular para a próxima operação": aparece quando o veículo fixado está fora de operação no instante atual e existe uma próxima operação programada nos dados do dia.

## Trajeto da linha no mapa

- Ao filtrar por linha (ou fixar um veículo que está operando uma linha), o trajeto oficial dela (geoJson) é desenhado no mapa, colorido pela categoria de serviço: Troncal, Alimentador, Expresso, Interbairros, Ligeirão, Madrugueiro, Jardineira, ou cores específicas por linha para as "Linha Direta". Os pontos de parada do trajeto aparecem como marcadores com o nome ao passar o mouse (ocultáveis pelo checkbox "Ocultar pontos de parada").
- Detalhes de implementação: [documentação técnica — Trajeto da linha no mapa](tecnico/trajeto-linha-mapa.md).

## Mapa linear (esquemático)

Painel abaixo do mapa, exibido quando há uma linha ativa (filtro por linha, ou veículo fixado em operação):

- Uma trilha horizontal por sentido (ida/volta), com as paradas posicionadas proporcionalmente à distância real ao longo do trajeto.
- Os veículos daquela linha aparecem como ícones posicionados/ordenados na trilha do seu sentido, com base na projeção da posição real deles sobre o trajeto oficial.
- Cada veículo mostra, ao passar o mouse, o espaçamento até o veículo imediatamente à frente (distância em metros/km e tempo estimado em segundos/minutos).
- Clicar num veículo no mapa linear fixa/desfixa ele, exatamente como clicar no marcador do mapa.
- Em linhas circulares, o espaçamento do primeiro veículo é calculado em relação ao último, fechando o ciclo.
- Detalhes de implementação: [documentação técnica — Mapa linear (esquemático)](tecnico/mapa-linear.md).

## Picture-in-Picture (PiP)

- Quando suportado pelo navegador, um botão no mapa abre-o numa janela flutuante independente (fora da aba), com seus próprios controles de play/pause e exibição do horário atual — útil para acompanhar a movimentação enquanto se navega em outras abas/janelas.
- Ao fechar a janela PiP, o mapa retorna automaticamente para o lugar original na página.

## Sincronização e recuperação

- Overlay de sincronização com barra de progresso, cancelável a qualquer momento pelo botão correspondente.
- Mensagens de status no rodapé informam quantidade de veículos em tela, filtros ativos e o instante atual sendo exibido.
