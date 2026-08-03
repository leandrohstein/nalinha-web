# Relatório de Operações (`index.html`)

Tela inicial do app: uma tabela com o snapshot mais recente (ou de um horário passado) de todos os veículos reportados pela URBS, com busca, paginação e atualização automática.

## Tabela de dados

- Cada linha da tabela é um veículo; as colunas vêm dos campos do snapshot da URBS, com nomes traduzidos para português (ex: `COD` → "Prefixo", `CODIGOLINHA` → "Linha", `TIPO_VEIC` → "Tipo Veículo", `SENT` → "Sentido").
- **Linha (código da linha)**: exibida como `"<código>-<nome da linha>"`; veículos com código `REC` aparecem como "FORA DE OPERAÇÃO".
- **Situação**: exibida com uma bolinha colorida — verde ("no horário"), amarelo ("atrasado"), vermelho ("adiantado"), cinza (outro/indefinido) — seguida do texto. Quando o snapshot tem duas situações (`SITUACAO`/`SITUACAO2`), elas são combinadas numa só célula.
- **Adaptado**: vira um ícone de acessibilidade (♿) quando o veículo é adaptado para cadeirantes.
- **Tipo de veículo**: código numérico traduzido para o nome cadastrado (ex: "Articulado", "Convencional").
- A coluna técnica `TCOUNT` é descartada da exibição.

## Busca

- Campo de busca com a sintaxe `linha:` / `prefixo:` (ver [README](README.md)). Os resultados filtrados são ordenados por linha+tabela ou por prefixo, conforme o campo usado.
- Em telas mobile (≤768px), dois botões ("Linha" / "Prefixo") definem o modo de busca, dispensando digitar o prefixo do filtro — só o valor precisa ser digitado.
- Botão "Limpar" reseta a busca.
- Buscas são reportadas ao Google Analytics (tipo de busca, termo, quantidade de resultados) com debounce de 500ms, sem repetir eventos para o mesmo termo.

## Paginação

- Seletor de itens por página (50 ou 100).
- Navegação "Anterior"/"Próxima" com indicador "Página X/Y".
- Contador de itens total, distinguindo "N itens encontrados (de M no total)" quando há um filtro ativo.

## Atualização de dados

- **Indicador de frescor** (bolinha ao lado do horário dos dados): verde piscando = dado do minuto atual, verde = 1 minuto atrás, amarelo = 3–4 minutos atrás, vermelho = 5 minutos atrás, cinza/neutro = indisponível ou visualização histórica.
- **Auto-atualização**: busca novos dados a cada 60 segundos. É desligada automaticamente após 5 falhas de rede consecutivas, ou após a aba/janela ficar 5 minutos sem foco (para não gastar rede/bateria à toa); volta a funcionar normalmente ao reganhar o foco. Pode ser ligada/desligada manualmente pelo botão "Auto: ON/OFF".
- **Atualizar**: botão para forçar uma busca imediata (fica desabilitado enquanto a auto-atualização está ligada, já que ela já cobre isso).
- **Período anterior**: abre um modal para escolher uma data/hora passada (até o minuto atual) e carregar o snapshot daquele momento a partir do cache ou da rede. Ao confirmar, a tela entra em "modo histórico" (o botão de atualizar vira "Tempo Real" para voltar ao modo ao vivo) e dispara, em segundo plano, uma sincronização silenciosa ("pré-cache") do restante daquele dia, mostrada num indicador de progresso próprio, para deixar a navegação por aquele dia mais rápida depois.
- O modal de período anterior pode ser fechado com Esc, clicando fora dele, ou pelo botão Cancelar.

## Navegação

- Link "Movimentação" no topo leva para a tela de mapa/replay ([movimentacao.md](movimentacao.md)).
