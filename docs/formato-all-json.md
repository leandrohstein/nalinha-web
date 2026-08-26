# Formato dos arquivos consolidados por hora

Contrato para os repositórios `nalinha-app/transporteservico-urbs-data-YYYY`
(um por ano, branch `data`) gerarem um arquivo consolidado por hora,
substituindo — do ponto de vista do consumidor (`nalinha-web`) — a
necessidade de buscar até 1440 arquivos por minuto para reconstruir um dia
inteiro. Cada dia usa o repositório do seu próprio ano (ex: dados de
2024-05-10 ficam em `transporteservico-urbs-data-2024`).

## Por que por hora, e não um arquivo único por dia

A primeira versão deste contrato previa **um arquivo por dia**
(`all.json`). Medindo em dados reais de 2024, dias mais densos (720
arquivos/minuto, ~1 a cada 2min) já geravam um `all.json` de ~200 MB: em
2026 (coleta minuto a minuto, até 1440 arquivos/dia) isso passaria de ~400
MB por dia. Isso quebra em dois lugares:

- **GitHub bloqueia push de arquivo acima de 100 MB** sem Git LFS.
- **O navegador busca e faz parse do arquivo inteiro de uma vez**
  (`fetch(...).json()`) — um JSON de centenas de MB por dia arrisca
  estourar memória (principalmente em celular) e não tem como mostrar
  progresso incremental durante o download.

Particionar por hora (24 arquivos/dia) resolve os dois problemas com
folga (pior caso projetado ~17 MB/hora) e ainda reduz o número de
requisições de até 1440/dia para até 24/dia (98%+ de redução) — só um
pouco menos agressivo que um arquivo único por dia, mas sem os riscos
acima.

## Caminho

```
veiculos/YYYY-MM-DD/HH.json
```

`HH` é a hora em 24h, com dois dígitos (`00` a `23`). Mesmo padrão de
pasta já usado hoje para os arquivos por minuto
(`veiculos/YYYY-MM-DD/HH:MM:00.json`), só adicionando até 24 arquivos
extras (um por hora que teve pelo menos um snapshot) dentro da pasta do
dia.

## Formato

Objeto JSON (não array), com uma chave por minuto daquela hora que teve
dado disponível, no formato `"HH:MM:SS"` (espelhando o nome dos arquivos
por minuto que já existem, sem a extensão `.json`). O valor de cada chave
é **exatamente o mesmo conteúdo bruto** que hoje está no arquivo
`HH:MM:00.json` correspondente — sem nenhuma transformação, filtro ou
normalização adicional.

```json
// veiculos/2026-08-25/14.json
{
  "14:00:00": { /* conteúdo idêntico ao de veiculos/2026-08-25/14:00:00.json */ },
  "14:01:00": { /* conteúdo idêntico ao de veiculos/2026-08-25/14:01:00.json */ },
  "14:05:00": { /* ... */ }
}
```

### Minutos ausentes

Se em algum minuto da hora a URBS não respondeu (ou o arquivo por minuto
correspondente não existe/não foi gerado), **a chave daquele minuto
simplesmente não deve aparecer no objeto**. Não usar `null`, `{}` vazio ou
qualquer outro valor sentinela — a ausência da chave é o próprio sinal de
"sem dado neste minuto", do mesmo jeito que hoje um 404 no arquivo por
minuto é interpretado como "minuto sem dado".

### Horas sem nenhum dado

Se uma hora inteira não teve nenhum snapshot, o arquivo `HH.json`
correspondente simplesmente não deve existir (em vez de existir vazio
`{}`) — o consumidor trata um 404 nesse arquivo como "sem arquivo
consolidado para essa hora" e cai de volta para o fluxo minuto a minuto
só para os minutos daquela hora.

### Segundos sempre `:00`

Os arquivos por minuto de origem sempre têm segundos `:00` no nome
(`HH:MM:00.json`), então as chaves dentro de cada `HH.json` também devem
seguir esse padrão (`"14:37:00"`, nunca `"14:37:22"`).

## Quando gerar

Só depois que a hora terminar. O dia corrente (hoje) **não** deve ter
nenhum `HH.json` — o consumidor continua buscando esse dia minuto a
minuto normalmente, como já faz hoje.

## Retenção dos arquivos por minuto

Fora do escopo deste documento — o consumidor não depende de os arquivos
por minuto originais continuarem existindo depois que os `HH.json` de uma
hora forem publicados, mas também não faz mal mantê-los (decisão livre
para esse repositório: espaço em disco / histórico bruto vs. redundância).

## Compatibilidade

Dias (ou horas específicas dentro de um dia) que nunca tiverem um
`HH.json` continuam funcionando normalmente — o lado consumidor tenta
buscar o arquivo da hora primeiro e, se receber 404, cai automaticamente
de volta para o fluxo minuto a minuto só para os minutos daquela hora. Ou
seja, a adoção pode ser gradual e até parcial dentro de um mesmo dia, sem
quebrar nada para trás.
