const DOT_CLASSES = ["dot--green-blink", "dot--green", "dot--yellow", "dot--red", "dot--neutral"];

function pad2(value) {
  return String(value).padStart(2, "0");
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function formatCellValue(value) {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  return String(value);
}

export function normalizeText(value) {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

export function setStatus(ui, message) {
  ui.status.textContent = message;
}

export function getSituationDotClass(value) {
  const normalizedValue = normalizeText(value);

  const parts = normalizedValue
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);

  const hasStatus = (status) =>
    parts.includes(status) || normalizedValue.includes(status);

  if (hasStatus("ADIANTADO")) {
    return "status-dot--red";
  }

  if (hasStatus("ATRASADO")) {
    return "status-dot--yellow";
  }

  if (hasStatus("NO HORARIO")) {
    return "status-dot--green";
  }

  return "status-dot--gray";
}

export function renderCellContent(headerName, cellValue, lineMap = {}) {
  const formattedValue = formatCellValue(cellValue);
  const normalizedHeader = normalizeText(headerName);

  if (normalizedHeader === "CODIGOLINHA") {
    const key = String(cellValue ?? "");
    if (normalizeText(key) === "REC") {
      return "FORA DE OPERAÇÃO";
    }

    const label = lineMap[key] ?? formattedValue;
    return escapeHtml(label);
  }

  if (normalizedHeader === "ADAPT") {
    return String(cellValue) === "1"
      ? '<span class="adapt-badge" title="Acessivel para cadeirantes" aria-label="Acessivel para cadeirantes">\u267F</span>'
      : "";
  }

  if (normalizedHeader !== "SITUACAO") {
    return escapeHtml(formattedValue);
  }

  const dotClass = getSituationDotClass(formattedValue);
  return `<span class="status-cell"><span class="status-dot ${dotClass}" aria-hidden="true"></span><span>${escapeHtml(formattedValue)}</span></span>`;
}

export function updatePaginationControls(ui, paginationState, totalRows) {
  const totalPages = totalRows > 0 ? Math.ceil(totalRows / paginationState.pageSize) : 0;
  const currentPage = totalPages > 0 ? paginationState.currentPage : 0;

  ui.pageInfo.textContent = `Pagina ${currentPage}/${totalPages}`;
  ui.prevPageBtn.disabled = currentPage <= 1;
  ui.nextPageBtn.disabled = currentPage === 0 || currentPage >= totalPages;

  const isFiltered = paginationState.rows.length !== paginationState.allRows.length;
  if (totalRows === 0) {
    ui.totalCount.textContent = "";
  } else if (isFiltered) {
    ui.totalCount.textContent = `${totalRows} item${totalRows !== 1 ? "s" : ""} encontrado${totalRows !== 1 ? "s" : ""} (de ${paginationState.allRows.length} no total)`;
  } else {
    ui.totalCount.textContent = `${totalRows} item${totalRows !== 1 ? "s" : ""} no total`;
  }
}

export function renderPageTable(ui, paginationState, lineMap = {}) {
  const { rows, columnCount, headerNames, currentPage, pageSize } = paginationState;

  if (rows.length === 0 || columnCount === 0) {
    ui.resultOutput.innerHTML = '<div class="empty-result">Sem linhas para exibir.</div>';
    updatePaginationControls(ui, paginationState, 0);
    return;
  }

  const headerHtml = headerNames
    .map((headerName) => `<th>${escapeHtml(headerName)}</th>`)
    .join("");

  const startIndex = (currentPage - 1) * pageSize;
  const pageRows = rows.slice(startIndex, startIndex + pageSize);

  const bodyHtml = pageRows
    .map((row) => {
      const cells = Array.from({ length: columnCount }, (_, index) => row[index])
        .map((cellValue, index) => `<td>${renderCellContent(headerNames[index] || "", cellValue, lineMap)}</td>`)
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");

  ui.resultOutput.innerHTML = `<table><thead><tr>${headerHtml}</tr></thead><tbody>${bodyHtml}</tbody></table>`;
  updatePaginationControls(ui, paginationState, rows.length);
}

export function formatDataDateTime(baseTime, minuteOffset) {
  const target = new Date(baseTime.getTime() - minuteOffset * 60 * 1000);
  const day = pad2(target.getDate());
  const month = pad2(target.getMonth() + 1);
  const year = target.getFullYear();
  const hour = pad2(target.getHours());
  const minute = pad2(target.getMinutes());
  return `${day}/${month}/${year} ${hour}:${minute}`;
}

export function setFreshnessDot(ui, minuteOffset) {
  ui.freshnessDot.classList.remove(...DOT_CLASSES);

  if (minuteOffset === 0) {
    ui.freshnessDot.classList.add("dot--green-blink");
    return;
  }

  if (minuteOffset === 1) {
    ui.freshnessDot.classList.add("dot--green");
    return;
  }

  if (minuteOffset === 3 || minuteOffset === 4) {
    ui.freshnessDot.classList.add("dot--yellow");
    return;
  }

  if (minuteOffset === 5) {
    ui.freshnessDot.classList.add("dot--red");
    return;
  }

  ui.freshnessDot.classList.add("dot--neutral");
}

export function setFreshnessVisibility(ui, visible) {
  ui.freshnessDot.style.display = visible ? "inline-block" : "none";
}

export function toDateTimeLocalValue(date) {
  const year = date.getFullYear();
  const month = pad2(date.getMonth() + 1);
  const day = pad2(date.getDate());
  const hour = pad2(date.getHours());
  const minute = pad2(date.getMinutes());
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

export function openHistoricalModal(ui) {
  const now = new Date();
  now.setSeconds(0, 0);

  const defaultDate = new Date(now.getTime() - 60 * 1000);
  ui.historicalDateInput.max = toDateTimeLocalValue(now);
  ui.historicalDateInput.value = toDateTimeLocalValue(defaultDate);

  ui.historicalModal.inert = false;
  ui.historicalModal.classList.add("open");
  ui.historicalModal.setAttribute("aria-hidden", "false");
  ui.historicalDateInput.focus();
}

export function closeHistoricalModal(ui) {
  const activeElement = document.activeElement;
  if (activeElement && ui.historicalModal.contains(activeElement)) {
    if (ui.loadHistoricalBtn) {
      ui.loadHistoricalBtn.focus();
    } else {
      document.body.focus();
    }
  }

  ui.historicalModal.inert = true;
  ui.historicalModal.classList.remove("open");
  ui.historicalModal.setAttribute("aria-hidden", "true");
}
