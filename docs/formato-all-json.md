# Formato do arquivo consolidado diário (`all.json`)

Contrato para os repositórios `nalinha-app/transporteservico-urbs-data-YYYY`
(um por ano, branch `data`) gerarem um arquivo consolidado por dia,
substituindo — do ponto de vista do consumidor (`nalinha-web`) — a
necessidade de buscar 1440 arquivos por minuto para reconstruir um dia
inteiro. Cada dia usa o repositório do seu próprio ano (ex: dados de
2024-05-10 ficam em `transporteservico-urbs-data-2024`).

## Caminho

```
veiculos/YYYY-MM-DD/all.json
```

Mesmo padrão de pasta já usado hoje para os arquivos por minuto
(`veiculos/YYYY-MM-DD/HH:MM:00.json`), só adicionando este arquivo extra
dentro da pasta do dia.

## Formato

Objeto JSON (não array), com uma chave por minuto que teve dado disponível
naquele dia, no formato `"HH:MM:SS"` (espelhando o nome dos arquivos por
minuto que já existem, sem a extensão `.json`). O valor de cada chave é
**exatamente o mesmo conteúdo bruto** que hoje está no arquivo
`HH:MM:00.json` correspondente — sem nenhuma transformação, filtro ou
normalização adicional.

```json
{
  "00:00:00": { /* conteúdo idêntico ao de veiculos/2026-08-25/00:00:00.json */ },
  "00:01:00": { /* conteúdo idêntico ao de veiculos/2026-08-25/00:01:00.json */ },
  "00:05:00": { /* ... */ }
}
```

### Minutos ausentes

Se em algum minuto do dia a URBS não respondeu (ou o arquivo por minuto
correspondente não existe/não foi gerado), **a chave daquele minuto
simplesmente não deve aparecer no objeto**. Não usar `null`, `{}` vazio ou
qualquer outro valor sentinela — a ausência da chave é o próprio sinal de
"sem dado neste minuto", do mesmo jeito que hoje um 404 no arquivo por
minuto é interpretado como "minuto sem dado".

### Segundos sempre `:00`

Os arquivos por minuto de origem sempre têm segundos `:00` no nome
(`HH:MM:00.json`), então as chaves do `all.json` também devem seguir esse
padrão (`"14:37:00"`, nunca `"14:37:22"`).

## Quando gerar

Só depois que o dia terminar (todos os minutos possíveis até 23:59 já
foram publicados como arquivos individuais). O dia corrente (hoje) **não**
deve ter `all.json` — o consumidor continua buscando esse dia minuto a
minuto normalmente, como já faz hoje.

## Retenção dos arquivos por minuto

Fora do escopo deste documento — o consumidor não depende de os arquivos
por minuto originais continuarem existindo depois que o `all.json` do dia
for publicado, mas também não faz mal mantê-los (decisão livre para esse
repositório: espaço em disco / histórico bruto vs. redundância).

## Compatibilidade

Dias antigos que nunca tiverem um `all.json` (por exemplo: dias anteriores
à criação deste fluxo, e que não sejam re-processados) continuam
funcionando normalmente — o lado consumidor tenta buscar `all.json`
primeiro e, se receber 404, cai automaticamente de volta para o fluxo
minuto a minuto atual. Ou seja, a adoção pode ser gradual (só dias novos,
por exemplo), sem quebrar nada para trás.
