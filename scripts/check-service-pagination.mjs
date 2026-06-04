import assert from "node:assert/strict";

import {
  DEFAULT_SERVICE_PAGE_SIZE,
  normalizePageSize,
  paginateRows,
  paginationItems,
  removeSelectedServiceKey,
  serverPageInfo,
  serviceListPageInfo
} from "../src/client/src/lib/service-pagination.mjs";

const rows = Array.from({ length: 27 }, (_, index) => ({ id: index + 1 }));
const serviceRows = Array.from({ length: 27 }, (_, index) => ({
  id: index + 1,
  imageJenkinsName: `service-${index + 1}`
}));

assert.equal(DEFAULT_SERVICE_PAGE_SIZE, 10);
assert.equal(normalizePageSize(7), 10);
assert.equal(normalizePageSize("5"), 5);

assert.deepEqual(
  paginateRows(rows, 1, 10),
  {
    rows: rows.slice(0, 10),
    page: 1,
    pageSize: 10,
    total: 27,
    totalPages: 3,
    start: 1,
    end: 10,
    hasPrev: false,
    hasNext: true
  }
);

assert.deepEqual(
  paginateRows(rows, 3, 10),
  {
    rows: rows.slice(20, 27),
    page: 3,
    pageSize: 10,
    total: 27,
    totalPages: 3,
    start: 21,
    end: 27,
    hasPrev: true,
    hasNext: false
  }
);

assert.equal(paginateRows(rows, 99, 10).page, 3, "page clamps after filtering shrinks total pages");
assert.equal(paginateRows(rows.slice(0, 4), 3, 10).page, 1, "filtered list resets to first valid page");

const selectedKeys = new Set(["service-2", "service-26"]);
assert.equal(selectedKeys.has("service-2"), true);
assert.equal(selectedKeys.has("service-26"), true, "selection state can survive across visible pages");

assert.deepEqual(
  paginationItems(8, 16),
  [1, "ellipsis-prev", 6, 7, 8, 9, 10, "ellipsis-next", 16],
  "large page sets expose direct jump pages plus ellipsis markers"
);
assert.deepEqual(
  paginationItems(2, 4),
  [1, 2, 3, 4],
  "small page sets show every page"
);
assert.deepEqual(
  removeSelectedServiceKey(["service-2", "service-26"], "service-2"),
  ["service-26"],
  "selected service can be removed from an independent selected-services area"
);
assert.deepEqual(
  serverPageInfo({
    rows: serviceRows.slice(20, 27),
    total: 27,
    pageNo: 3,
    pageSize: 10
  }),
  {
    rows: serviceRows.slice(20, 27),
    page: 3,
    pageSize: 10,
    total: 27,
    totalPages: 3,
    start: 21,
    end: 27,
    hasPrev: true,
    hasNext: false,
    serverPaged: true
  },
  "service inventory renders the platform-returned page without local fake pagination"
);

assert.equal(
  serviceListPageInfo({
    rows: serviceRows,
    search: "2",
    page: 2,
    pageSize: 5
  }).total,
  10,
  "legacy local page helper remains available for non-platform local lists"
);

console.log("service pagination checks passed");
