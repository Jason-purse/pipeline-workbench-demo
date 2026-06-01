export const SERVICE_PAGE_SIZE_OPTIONS = [5, 10, 20];
export const DEFAULT_SERVICE_PAGE_SIZE = 10;

export function normalizePageSize(pageSize) {
  const numeric = Number(pageSize);
  return SERVICE_PAGE_SIZE_OPTIONS.includes(numeric) ? numeric : DEFAULT_SERVICE_PAGE_SIZE;
}

export function paginateRows(rows, page = 1, pageSize = DEFAULT_SERVICE_PAGE_SIZE) {
  const source = Array.isArray(rows) ? rows : [];
  const size = normalizePageSize(pageSize);
  const total = source.length;
  const totalPages = Math.max(1, Math.ceil(total / size));
  const requestedPage = Math.trunc(Number(page) || 1);
  const currentPage = Math.min(Math.max(requestedPage, 1), totalPages);
  const startIndex = total ? (currentPage - 1) * size : 0;
  const endIndex = total ? Math.min(startIndex + size, total) : 0;

  return {
    rows: source.slice(startIndex, endIndex),
    page: currentPage,
    pageSize: size,
    total,
    totalPages,
    start: total ? startIndex + 1 : 0,
    end: endIndex,
    hasPrev: currentPage > 1,
    hasNext: currentPage < totalPages
  };
}

export function paginationItems(page = 1, totalPages = 1, options = {}) {
  const total = Math.max(1, Math.trunc(Number(totalPages) || 1));
  const current = Math.min(Math.max(Math.trunc(Number(page) || 1), 1), total);
  const siblingCount = Math.max(1, Math.trunc(Number(options.siblingCount ?? 2)));
  const allPagesThreshold = Math.max(5, (siblingCount * 2) + 5);

  if (total <= allPagesThreshold) {
    return Array.from({ length: total }, (_, index) => index + 1);
  }

  const start = Math.max(2, current - siblingCount);
  const end = Math.min(total - 1, current + siblingCount);
  const items = [1];

  if (start > 2) {
    items.push("ellipsis-prev");
  } else {
    for (let value = 2; value < start; value += 1) items.push(value);
  }

  for (let value = start; value <= end; value += 1) items.push(value);

  if (end < total - 1) {
    items.push("ellipsis-next");
  } else {
    for (let value = end + 1; value < total; value += 1) items.push(value);
  }

  items.push(total);
  return items;
}

export function removeSelectedServiceKey(keys, key) {
  return (Array.isArray(keys) ? keys : []).filter((item) => item !== key);
}

function normalizeSearch(value) {
  return String(value || "").trim().toLowerCase();
}

function rowMatchesSearch(row, search) {
  const query = normalizeSearch(search);
  if (!query) return true;
  return [
    row && row.imageJenkinsName,
    row && row.imageNameEn,
    row && row.serviceNameEn,
    row && row.microServiceName,
    row && row.serviceName,
    row && row.imageNameCh
  ].some((value) => String(value || "").toLowerCase().includes(query));
}

export function serviceListPageInfo({ rows = [], search = "", page = 1, pageSize = DEFAULT_SERVICE_PAGE_SIZE } = {}) {
  const query = normalizeSearch(search);
  const filtered = Array.isArray(rows) && query
    ? rows.filter((row) => rowMatchesSearch(row, query))
    : Array.isArray(rows)
      ? rows
      : [];
  return {
    ...paginateRows(filtered, page, pageSize),
    search: query
  };
}

export function serverPageInfo(pageResult = {}) {
  const rows = Array.isArray(pageResult.rows) ? pageResult.rows : [];
  const pageSize = normalizePageSize(pageResult.pageSize);
  const total = Math.max(0, Number(pageResult.total) || rows.length);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const requestedPage = Math.trunc(Number(pageResult.page ?? pageResult.pageNo) || 1);
  const page = Math.min(Math.max(requestedPage, 1), totalPages);
  const start = total ? ((page - 1) * pageSize) + 1 : 0;
  const end = total ? Math.min(start + rows.length - 1, total) : 0;

  return {
    rows,
    page,
    pageSize,
    total,
    totalPages,
    start,
    end,
    hasPrev: page > 1,
    hasNext: page < totalPages,
    serverPaged: true
  };
}
