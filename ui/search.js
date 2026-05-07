import { formatCellValue, normalizeText } from "./nalinhaUi.js";

const SEARCH_FIELD_MAP = {
  linha: { filter: "CODIGOLINHA", sort: ["CODIGOLINHA", "TABELA"] },
  prefixo: { filter: "COD", sort: ["COD"] },
};

function toSortKey(value) {
  const part = value.split("-")[0].trim();
  const num = Number(part);
  return Number.isFinite(num) ? num : part;
}

export function applySearch(rawInput, paginationState) {
  const { allRows, headerNames } = paginationState;

  if (!rawInput.trim()) {
    return allRows;
  }

  const colonIndex = rawInput.indexOf(":");
  if (colonIndex <= 0) {
    return allRows;
  }

  const fieldAlias = rawInput.slice(0, colonIndex).trim().toLowerCase();
  const fieldValue = normalizeText(rawInput.slice(colonIndex + 1));
  const mapping = SEARCH_FIELD_MAP[fieldAlias];

  if (!mapping || !fieldValue) {
    return allRows;
  }

  const filterIndex = headerNames.findIndex(
    (h) => normalizeText(h) === mapping.filter
  );

  if (filterIndex === -1) {
    return allRows;
  }

  const filtered = allRows.filter((row) =>
    normalizeText(formatCellValue(row[filterIndex])).startsWith(fieldValue)
  );

  const sortIndices = mapping.sort
    .map((fieldName) => headerNames.findIndex(
      (h) => normalizeText(h) === fieldName
    ))
    .filter((index) => index !== -1);

  if (sortIndices.length === 0) {
    return filtered;
  }

  return [...filtered].sort((a, b) => {
    for (const sortIndex of sortIndices) {
      const va = normalizeText(formatCellValue(a[sortIndex]));
      const vb = normalizeText(formatCellValue(b[sortIndex]));

      const ka = toSortKey(va);
      const kb = toSortKey(vb);

      if (typeof ka === "number" && typeof kb === "number") {
        if (ka !== kb) {
          return ka - kb;
        }
        continue;
      }

      const comparison = String(ka).localeCompare(String(kb));
      if (comparison !== 0) {
        return comparison;
      }
    }

    return 0;
  });
}
