# NaLinha Web - GitHub Pages

Esta pasta `web` contém a versão web da extensão NaLinha, preparada para funcionar no GitHub Pages.

## Estrutura

```
web/
├── index.html          # Página principal (relatório de operações)
├── popup.html          # Página alternativa de popup
├── popup.css           # Estilos CSS
├── nalinha.js          # Script principal
├── services/           # Serviços de dados
│   ├── cacheRepository.js
│   ├── lineDataRepository.js
│   ├── lineDataService.js
│   ├── vehicleDataService.js
│   ├── vehicleTypeDataRepository.js
│   └── vehicleTypeDataService.js
├── ui/                 # Interface do usuário
│   ├── nalinhaUi.js
│   └── search.js
└── icons/              # Ícones da aplicação
    ├── icon16.png
    ├── icon32.png
    ├── icon48.png
    ├── icon128.png
    └── icon.png
```

## Como usar no GitHub Pages

### 1. Configurar o repositório
Se ainda não configurou, siga estes passos:
- Vá para Settings → Pages
- Em "Source", selecione a branch (ex: `main`)
- Em "Folder", selecione `/root` ou `/docs` (dependendo de sua estrutura)

### 2. Implantar em `/root`
Se seu repositório está configurado para servir a raiz (`/`):
```bash
# Copie o conteúdo de web/ para a raiz do repositório
cp -r web/* .
```

### 3. Implantar em `/docs`
Se seu repositório está configurado para servir `/docs`:
```bash
# Copie o conteúdo de web/ para docs/
cp -r web/* docs/
```

### 4. Acessar a aplicação
Após o deploy, acesse:
- `https://seu-usuario.github.io/seu-repositorio/` (se em subdiretório)
- `https://seu-usuario.github.io/` (se em domínio root)

## Recursos

- ✅ Visualização de dados de ônibus em tempo real
- ✅ Cache local com IndexedDB
- ✅ Busca por linha e prefixo
- ✅ Modo histórico para análise de períodos anteriores
- ✅ Auto-atualização de dados
- ✅ Interface responsiva

## Notas

- A aplicação usa dados públicos do GitHub (repositórios `nalinha-app/transporteservico-urbs-data-YYYY`, segregados por ano)
- Todos os dados são armazenados localmente no navegador (IndexedDB)
- Funciona totalmente offline após carregar os dados uma vez
- Compatível com navegadores modernos (Chrome, Firefox, Safari, Edge)
