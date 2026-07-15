const CATEGORY_COLORS = {
  TRONCAL: "#f4d000",
  ALIMENTADOR: "#f7941e",
  EXPRESSO: "#e2231a",
  INTERBAIRROS: "#00a651",
  LIGEIRAO: "#1a2b6d",
};

const DEFAULT_LINE_ROUTE_COLOR = "#7c3aed";
const LINHA_DIRETA_DEFAULT_COLOR = "#7e7e7e";
const MADRUGUEIRO_COLOR = "#bc002b";
const JARDINEIRA_COLOR = "#95bb2b";

const DIACRITICS_REGEX = new RegExp(String.fromCharCode(91, 0x0300) + "-" + String.fromCharCode(0x036f, 93), "g");

// Cada linha "Linha Direta" com cor propria e identificada pelo COD (prefixo)
// exato da linha, conferido contra a base atual de
// CATEGORIA_SERVICO="LINHA DIRETA" em getLinhas.json. Quando o COD nao esta
// aqui, usa LINHA_DIRETA_DEFAULT_COLOR.
const LINHA_DIRETA_COLOR_BY_COD = {
  "022": { label: "Inter 2 (horário)", color: "#9e9e9e" },
  "023": { label: "Inter 2 (anti-horário)", color: "#9e9e9e" },
  "024": { label: "C. Raso / Camp. Siqueira", color: "#9e9e9e" },
  206: { label: "Barreirinha - S. José", color: "#f4d000" },
  210: { label: "CIC/Cabral", color: "#00b3a4" },
  220: { label: "Cabral/Hauer", color: "#3d7dca" },
  304: { label: "Pinhais - Campo Comprido", color: "#e6007e" },
  305: { label: "Centenário", color: "#f4901e" },
  307: { label: "S. Felicidade - B. Alto", color: "#7a1f2b" },
  469: { label: "Centro Politécnico", color: "#4d4d4d" },
  505: { label: "Boqueirão - C. Cívico", color: "#2e1065" },
  506: { label: "Bairro Novo", color: "#f4a7c0" },
  507: { label: "Sítio Cercado (horário)", color: "#9c7a4b" },
  508: { label: "Sítio Cercado (anti-horário)", color: "#9c7a4b" },
  520: { label: "Osternack / S. Cercado L.D.", color: "#f4a7c0" },
  607: { label: "Colombo/CIC", color: "#00b3a4" },
  610: { label: "S. Cercado / C. Raso", color: "#9c7a4b" },
  700: { label: "Pinheirinho/Cabral", color: "#f4901e" },
  702: { label: "Caiuá/Cachoeira", color: "#4a72b8" },
  707: { label: "Tatuquara / Centro", color: "#8bc34a" },
  902: { label: "Sta. Felicidade / Pça. Tiradentes", color: "#7a1f2b" },
  X02: { label: "Reforço Tubo Barigui", color: "#4fc3f7" },
  X36: { label: "Ref. Guadalupe / Fazendinha", color: "#4a72b8" },
  X45: { label: "Especial B.Alto / C.Imbuia", color: "#009688" },
};

// Cores da mesma legenda, mas de linhas "Linha Direta" que ainda nao foram
// atribuidas a nenhum COD. Nao sao aplicadas em getLineRouteColor - ficam
// guardadas aqui para reuso manual: quando o COD correto for identificado,
// basta adicionar a entrada em LINHA_DIRETA_COLOR_BY_COD.
export const LINHA_DIRETA_REFERENCE_COLORS = [
  { label: "Fazenda Rio Grande", color: "#e0798a" },
  { label: "Araucária - Curitiba", color: "#e2231a" },
];

function normalize(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(DIACRITICS_REGEX, "")
    .trim()
    .toUpperCase();
}

function getLinhaDiretaColorByCod(cod) {
  const normalizedCod = String(cod ?? "").trim();
  return LINHA_DIRETA_COLOR_BY_COD[normalizedCod]?.color ?? null;
}

/**
 * Cor do trajeto (geoJson) de uma linha, a partir dos dados de
 * CATEGORIA_SERVICO/NOME retornados por lineDataService.getByCod.
 */
export function getLineRouteColor(lineRecord) {
  const categoria = normalize(lineRecord?.CATEGORIA_SERVICO);

  if (categoria === "MADRUGUEIRO") {
    return MADRUGUEIRO_COLOR;
  }

  if (categoria === "JARDINEIRA") {
    return JARDINEIRA_COLOR;
  }

  if (categoria === "CONVENCIONAL" || categoria === "SERVICO AOS OPERADORES") {
    return CATEGORY_COLORS.TRONCAL;
  }

  if (categoria === "LINHA DIRETA") {
    return getLinhaDiretaColorByCod(lineRecord?.COD) ?? LINHA_DIRETA_DEFAULT_COLOR;
  }

  return CATEGORY_COLORS[categoria] ?? DEFAULT_LINE_ROUTE_COLOR;
}
