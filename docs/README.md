# Documentação de funcionalidades — NaLinha Web

Esta pasta descreve, do ponto de vista do usuário, as funcionalidades existentes no NaLinha Web. Para arquitetura de código, camadas de cache e convenções de desenvolvimento, veja o [CLAUDE.md](../CLAUDE.md) na raiz do repositório.

O app tem duas telas:

- **[Relatório de Operações](relatorio-operacoes.md)** (`index.html`) — tabela em tempo real (ou histórica) com a situação de todos os veículos.
- **[Movimentação](movimentacao.md)** (`map.html`) — replay em mapa da movimentação dos veículos ao longo de um dia.

Além disso, `popup.html` é um popup simples (resquício de quando o projeto era uma extensão de navegador) que só exibe um link para abrir o Relatório de Operações.

## Documentação técnica

A pasta [`tecnico/`](tecnico/) tem, um arquivo por funcionalidade, o detalhamento de implementação (funções, algoritmos, cache, tratamento de concorrência) das funcionalidades mais complexas — hoje:

- [Trajeto da linha no mapa](tecnico/trajeto-linha-mapa.md)
- [Mapa linear (esquemático)](tecnico/mapa-linear.md)

## Conceitos compartilhados pelas duas telas

- **Sintaxe de busca `linha:` / `prefixo:`** — digitar `linha:386` filtra pelo código da linha (só ativa com o código completo, 3+ caracteres); `prefixo:XY014` filtra pelo prefixo do veículo. A busca ignora acentos/maiúsculas e usa correspondência por início de texto (prefix match).
- **Cache local (IndexedDB)** — todos os dados (snapshots de veículos, linhas, tipos de veículo, trajetos geoJson) são cacheados no navegador para evitar sincronizar novamente o que já foi baixado. Ver detalhamento em [CLAUDE.md](../CLAUDE.md).
- **"Chips" de status** — as mensagens de status (rodapé) e de pré-cache somem sozinhas depois de 30s ou ao serem clicadas.
