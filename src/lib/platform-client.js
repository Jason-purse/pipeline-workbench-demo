const fs = require("fs");
const os = require("os");
const path = require("path");
const { Worker } = require("worker_threads");

const { maskToken, sha256Hex } = require("./crypto");
const { platforms } = require("../data/profiles");

const SESSION_TTL_MS = Number(process.env.WORKBENCH_SESSION_TTL_MS || 30 * 60 * 1000);
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const CACHE_DIR = process.env.WORKBENCH_CACHE_DIR || path.join(PROJECT_ROOT, ".workbench-cache");
const COOKIE_DIR = path.join(CACHE_DIR, "cookies");
const REQUEST_DIR = path.join(CACHE_DIR, "requests");
const SESSION_CACHE_PATH = path.join(CACHE_DIR, "session-cache.json");
const HTTP_CONNECT_TIMEOUT_SECONDS = Number(process.env.WORKBENCH_HTTP_CONNECT_TIMEOUT_SECONDS || 3);
const HTTP_MAX_TIME_SECONDS = Number(process.env.WORKBENCH_HTTP_MAX_TIME_SECONDS || 12);
const RELEASE_HTTP_CONNECT_TIMEOUT_SECONDS = Number(process.env.WORKBENCH_RELEASE_HTTP_CONNECT_TIMEOUT_SECONDS || 5);
const RELEASE_HTTP_MAX_TIME_SECONDS = Number(process.env.WORKBENCH_RELEASE_HTTP_MAX_TIME_SECONDS || 35);
const PUBLISH_RATE_INTERVAL_MS = Number(process.env.WORKBENCH_PUBLISH_RATE_INTERVAL_MS || 5000);
const PUBLISH_RATE_MAX_ATTEMPTS = Number(process.env.WORKBENCH_PUBLISH_RATE_MAX_ATTEMPTS || 24);
const SERVICE_PAGE_SIZE = Number(process.env.WORKBENCH_SERVICE_PAGE_SIZE || 10);
const SERVICE_MAX_PAGE_SIZE = Number(process.env.WORKBENCH_SERVICE_MAX_PAGE_SIZE || 100);
const SERVICE_MAX_PAGES = Number(process.env.WORKBENCH_SERVICE_MAX_PAGES || 3);
const sessionCache = new Map();
const retainedCookieJars = new Set();

const releaseRequestOptions = {
  connectTimeoutSeconds: RELEASE_HTTP_CONNECT_TIMEOUT_SECONDS,
  maxTimeSeconds: RELEASE_HTTP_MAX_TIME_SECONDS
};

const NODE_HTTP_WORKER_SOURCE = String.raw`
const fs = require("fs");
const http = require("http");
const https = require("https");
const path = require("path");
const { URL } = require("url");
const { workerData } = require("worker_threads");

const requestData = workerData.request;
const signal = new Int32Array(requestData.control);

function finish(result, status) {
  try {
    fs.mkdirSync(path.dirname(requestData.resultPath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(requestData.resultPath, JSON.stringify(result));
  } catch (error) {
    // The parent process will turn a missing result file into a request error.
  }
  Atomics.store(signal, 0, status);
  Atomics.notify(signal, 0);
}

function readCookieJar(cookieJar) {
  if (!cookieJar) return { version: 1, cookies: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(cookieJar, "utf8"));
    if (parsed && parsed.version === 1 && Array.isArray(parsed.cookies)) return parsed;
  } catch (error) {
    // Invalid or missing cookie jars are treated as empty and overwritten after login.
  }
  return { version: 1, cookies: [] };
}

function saveCookieJar(cookieJar, jar) {
  if (!cookieJar) return;
  fs.mkdirSync(path.dirname(cookieJar), { recursive: true, mode: 0o700 });
  fs.writeFileSync(cookieJar, JSON.stringify({
    version: 1,
    updatedAt: new Date().toISOString(),
    cookies: jar.cookies
  }, null, 2), { mode: 0o600 });
}

function domainMatches(cookie, hostname) {
  const domain = String(cookie.domain || "").toLowerCase();
  const host = String(hostname || "").toLowerCase();
  if (!domain) return false;
  if (cookie.hostOnly) return host === domain;
  return host === domain || host.endsWith("." + domain);
}

function pathMatches(cookie, pathname) {
  const cookiePath = cookie.path || "/";
  const current = pathname || "/";
  return current === cookiePath || current.startsWith(cookiePath.endsWith("/") ? cookiePath : cookiePath + "/");
}

function cookieHeaderFor(jar, url) {
  const now = Date.now();
  const cookies = jar.cookies.filter((cookie) => {
    if (cookie.expires && cookie.expires <= now) return false;
    if (cookie.secure && url.protocol !== "https:") return false;
    return domainMatches(cookie, url.hostname) && pathMatches(cookie, url.pathname);
  });
  return cookies.map((cookie) => cookie.name + "=" + cookie.value).join("; ");
}

function defaultCookiePath(url) {
  const pathname = url.pathname || "/";
  if (!pathname.includes("/")) return "/";
  const base = pathname.slice(0, pathname.lastIndexOf("/") + 1);
  return base || "/";
}

function applySetCookie(jar, url, setCookieHeaders) {
  const headers = Array.isArray(setCookieHeaders)
    ? setCookieHeaders
    : setCookieHeaders
      ? [setCookieHeaders]
      : [];
  const now = Date.now();

  for (const header of headers) {
    const parts = String(header).split(";").map((part) => part.trim()).filter(Boolean);
    const first = parts.shift();
    if (!first || !first.includes("=")) continue;
    const index = first.indexOf("=");
    const cookie = {
      name: first.slice(0, index),
      value: first.slice(index + 1),
      domain: url.hostname,
      hostOnly: true,
      path: defaultCookiePath(url),
      secure: false,
      httpOnly: false,
      expires: null
    };

    for (const part of parts) {
      const attrIndex = part.indexOf("=");
      const key = (attrIndex >= 0 ? part.slice(0, attrIndex) : part).trim().toLowerCase();
      const value = attrIndex >= 0 ? part.slice(attrIndex + 1).trim() : "";
      if (key === "domain" && value) {
        cookie.domain = value.replace(/^\./, "").toLowerCase();
        cookie.hostOnly = false;
      } else if (key === "path" && value) {
        cookie.path = value;
      } else if (key === "max-age") {
        const seconds = Number(value);
        if (Number.isFinite(seconds)) cookie.expires = now + seconds * 1000;
      } else if (key === "expires") {
        const parsed = Date.parse(value);
        if (Number.isFinite(parsed)) cookie.expires = parsed;
      } else if (key === "secure") {
        cookie.secure = true;
      } else if (key === "httponly") {
        cookie.httpOnly = true;
      }
    }

    jar.cookies = jar.cookies.filter((item) => !(item.name === cookie.name && item.domain === cookie.domain && item.path === cookie.path));
    if (!cookie.expires || cookie.expires > now) jar.cookies.push(cookie);
  }
}

function serializeError(error) {
  return {
    message: error && error.message || String(error),
    code: error && error.code,
    name: error && error.name
  };
}

function requestOnce(targetUrl, redirects) {
  return new Promise((resolve, reject) => {
    const url = new URL(targetUrl);
    const body = requestData.body;
    const jar = readCookieJar(requestData.cookieJar);
    const headers = {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(body),
      "user-agent": "PipelineWorkbench/0.1 ElectronNodeHttp"
    };
    const cookieHeader = cookieHeaderFor(jar, url);
    if (cookieHeader) headers.cookie = cookieHeader;

    const client = url.protocol === "https:" ? https : http;
    const req = client.request(url, { method: "POST", headers }, (res) => {
      clearTimeout(connectTimer);
      applySetCookie(jar, url, res.headers["set-cookie"]);
      saveCookieJar(requestData.cookieJar, jar);

      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects < 3) {
        res.resume();
        resolve(requestOnce(new URL(res.headers.location, url).toString(), redirects + 1));
        return;
      }

      const chunks = [];
      let bytes = 0;
      res.on("data", (chunk) => {
        bytes += chunk.length;
        if (bytes > requestData.maxBufferBytes) {
          req.destroy(Object.assign(new Error("Response exceeded max buffer"), { code: "EMAXBUFFER" }));
          return;
        }
        chunks.push(chunk);
      });
      res.on("end", () => {
        clearTimeout(totalTimer);
        resolve({
          ok: true,
          httpStatus: res.statusCode,
          body: Buffer.concat(chunks).toString("utf8")
        });
      });
    });

    const connectTimer = setTimeout(() => {
      req.destroy(Object.assign(
        new Error("Failed to connect to " + url.host + " after " + requestData.connectTimeoutMs + " ms: Timeout was reached"),
        { code: "ETIMEDOUT" }
      ));
    }, requestData.connectTimeoutMs);
    const totalTimer = setTimeout(() => {
      req.destroy(Object.assign(
        new Error("Operation timed out after " + requestData.maxTimeMs + " ms"),
        { code: "ETIMEDOUT" }
      ));
    }, requestData.maxTimeMs);

    req.on("socket", (socket) => {
      socket.on("connect", () => clearTimeout(connectTimer));
      socket.on("secureConnect", () => clearTimeout(connectTimer));
    });
    req.on("error", (error) => {
      clearTimeout(connectTimer);
      clearTimeout(totalTimer);
      reject(error);
    });
    req.write(body);
    req.end();
  });
}

requestOnce(requestData.url, 0)
  .then((result) => finish(result, 1))
  .catch((error) => finish({ ok: false, error: serializeError(error) }, 2));
`;

function ensureCacheDir() {
  fs.mkdirSync(COOKIE_DIR, { recursive: true, mode: 0o700 });
  fs.mkdirSync(REQUEST_DIR, { recursive: true, mode: 0o700 });
}

function createWrapper(payload) {
  const safePayload = payload || {};
  return {
    datatype: "json",
    i18n: "zh",
    params: JSON.stringify(safePayload),
    userInfo: {},
    ...safePayload
  };
}

function parseNodeHttpResponse(result) {
  const body = result && result.body || "";
  let json;

  try {
    json = JSON.parse(body);
  } catch (error) {
    json = { raw: body.slice(0, 1000) };
  }

  return {
    httpStatus: result && result.httpStatus || null,
    json
  };
}

function classifyRequestError(error, options = {}) {
  const text = `${error && error.message || ""} ${error && error.stderr || ""} ${error && error.stdout || ""}`;
  const dnsFailed = /Could not resolve|Name or service not known|nodename nor servname provided|ENOTFOUND|EAI_AGAIN/i.test(text);
  const connectFailed = /Failed to connect|No route to host|Connection refused|Connection timed out|ECONNREFUSED|EHOSTUNREACH|ENETUNREACH/i.test(text);
  const responseTimedOut = /timed out|Operation timed out|SSL connection timeout/i.test(text) || error && error.signal === "SIGTERM";
  const timedOut = error && (dnsFailed || connectFailed || responseTimedOut);
  const networkStage = dnsFailed ? "dns" : connectFailed ? "connect" : responseTimedOut ? "response" : null;
  const connectTimeout = options.connectTimeoutSeconds || HTTP_CONNECT_TIMEOUT_SECONDS;
  const maxTime = options.maxTimeSeconds || HTTP_MAX_TIME_SECONDS;
  const message = timedOut
    ? dnsFailed
      ? `平台域名解析失败（connect=${connectTimeout}s, total=${maxTime}s），请检查 DNS、VPN 或 hosts。`
      : connectFailed
        ? `Workbench 后台进程无法连接平台（connect=${connectTimeout}s, total=${maxTime}s）。如果浏览器已可访问，通常是后台进程启动早于 VPN 路由刷新；请重启 Workbench 后重试。`
        : `平台响应超时（connect=${connectTimeout}s, total=${maxTime}s）。VPN 可能可达，但接口响应超过本地保护阈值。`
    : (error && error.message) || "平台请求失败";
  return {
    reason: timedOut ? "network_timeout" : "request_failed",
    networkStage,
    message,
    error: (error && error.message) || String(error),
    timedOut: Boolean(timedOut)
  };
}

function postJsonViaNode(url, payload, cookieJar, options = {}) {
  const connectTimeoutSeconds = Number(options.connectTimeoutSeconds || HTTP_CONNECT_TIMEOUT_SECONDS);
  const maxTimeSeconds = Number(options.maxTimeSeconds || HTTP_MAX_TIME_SECONDS);
  const maxBufferBytes = Number(options.maxBufferBytes || 30 * 1024 * 1024);
  ensureCacheDir();

  const resultPath = path.join(REQUEST_DIR, `${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
  const control = new SharedArrayBuffer(4);
  const signal = new Int32Array(control);
  const worker = new Worker(NODE_HTTP_WORKER_SOURCE, {
    eval: true,
    workerData: {
      request: {
        url,
        body: JSON.stringify(payload),
        cookieJar,
        connectTimeoutMs: connectTimeoutSeconds * 1000,
        maxTimeMs: maxTimeSeconds * 1000,
        maxBufferBytes,
        resultPath,
        control
      }
    }
  });
  worker.unref();

  const deadline = Date.now() + (maxTimeSeconds + 2) * 1000;
  while (Atomics.load(signal, 0) === 0 && Date.now() < deadline) {
    Atomics.wait(signal, 0, 0, Math.min(500, Math.max(1, deadline - Date.now())));
  }

  if (Atomics.load(signal, 0) === 0) {
    worker.terminate();
    try {
      fs.unlinkSync(resultPath);
    } catch (error) {
      // Request result cleanup is best-effort.
    }
    const error = new Error(`Operation timed out after ${maxTimeSeconds * 1000} ms`);
    error.code = "ETIMEDOUT";
    throw error;
  }

  let result;
  try {
    result = JSON.parse(fs.readFileSync(resultPath, "utf8"));
  } finally {
    try {
      fs.unlinkSync(resultPath);
    } catch (error) {
      // Request result cleanup is best-effort.
    }
  }

  if (!result.ok) {
    const error = new Error(result.error && result.error.message || "Platform request failed");
    error.code = result.error && result.error.code;
    error.name = result.error && result.error.name || error.name;
    throw error;
  }

  return parseNodeHttpResponse(result);
}

function sleepSync(ms) {
  const normalized = Number(ms);
  if (!Number.isFinite(normalized) || normalized <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, normalized);
}

function objectOf(response) {
  const json = response.json;
  return json && (json.object ?? json.data ?? json.result ?? json.body ?? json);
}

function arrayOf(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value && value.rows)) return value.rows;
  if (Array.isArray(value && value.list)) return value.list;
  if (Array.isArray(value && value.data)) return value.data;
  return [];
}

function compactObject(value) {
  if (!value || typeof value !== "object") return value;
  const result = {};
  for (const key of Object.keys(value).slice(0, 40)) {
    const child = value[key];
    if (child == null || ["string", "number", "boolean"].includes(typeof child)) {
      result[key] = child;
    } else if (Array.isArray(child)) {
      result[key] = `[array:${child.length}]`;
    } else {
      result[key] = `[object:${Object.keys(child).slice(0, 8).join(",")}]`;
    }
  }
  return result;
}

function compactBuildTask(row) {
  const compact = compactObject(row);
  return {
    ...compact,
    id: row && (row.id || row.taskId || row.buildTaskId),
    taskId: row && (row.taskId || row.id || row.buildTaskId),
    buildTaskId: row && (row.buildTaskId || row.taskId || row.id),
    releaseTaskId: row && row.releaseTaskId,
    structureApplyId: row && row.structureApplyId,
    source: row && row.source || "selectBuildTask",
    codeBranch: row && row.codeBranch,
    envType: row && row.envType,
    applicationCode: row && row.applicationCode,
    customerNameEn: row && row.customerNameEn
  };
}

function compactPendingBuildApply(row) {
  const compact = compactObject(row);
  const id = row && row.id;
  const branch = row && (row.branch || row.codeBranch || row.envType);
  return {
    ...compact,
    id,
    taskId: id,
    buildTaskId: id,
    structureApplyId: id,
    pendingApply: true,
    buildAll: true,
    source: "structureListPage",
    customerNameEn: row && row.customerNameEn,
    applicationCode: row && (row.applicationCode || row.applicationName),
    applicationName: row && (row.applicationName || row.applicationCode),
    applicationNameCh: row && row.applicationNameCh,
    codeBranch: branch,
    envType: branch,
    branch,
    createTime: row && row.applyTime,
    applyTime: row && row.applyTime,
    applyStatus: row && row.applyStatus,
    imageNum: row && row.imageNum,
    buildImageNum: row && row.buildImageNum,
    publishEnvironment: row && row.publishEnvironment,
    structureType: row && row.structureType
  };
}

function taskPublishStage(row) {
  if (!row || typeof row !== "object") return null;
  if (row.reuseBlockedReason) return row.reuseBlockedReason;
  if (row.pendingApply && row.applyStatus !== undefined && row.applyStatus !== null && String(row.applyStatus) !== "0") return `applyStatus=${row.applyStatus}`;
  if (row.releaseStatus !== undefined && row.releaseStatus !== null && String(row.releaseStatus).trim() !== "") return `releaseStatus=${row.releaseStatus}`;
  if (row.publishStatus !== undefined && row.publishStatus !== null && String(row.publishStatus).trim() !== "") return `publishStatus=${row.publishStatus}`;
  if (row.releaseTaskId !== undefined && row.releaseTaskId !== null && String(row.releaseTaskId).trim() !== "") return `releaseTaskId=${row.releaseTaskId}`;
  return null;
}

function imageMatchesRequest(item, image) {
  return (
    (!image.imageJenkinsName || item.imageJenkinsName === image.imageJenkinsName || item.imageNameEn === image.imageJenkinsName) &&
    (!image.imageNameEn || item.imageNameEn === image.imageNameEn || item.imageJenkinsName === image.imageJenkinsName || !item.imageNameEn) &&
    (!image.imageVersion || item.imageVersion === image.imageVersion)
  );
}

function imageMatchesRequestIdentity(item, image) {
  return (
    (!image.imageJenkinsName || item.imageJenkinsName === image.imageJenkinsName || item.imageNameEn === image.imageJenkinsName) &&
    (!image.imageNameEn || item.imageNameEn === image.imageNameEn || item.imageJenkinsName === image.imageJenkinsName || !item.imageNameEn)
  );
}

function exactRequestedImageGroup(rawImages, requestedImages) {
  const requested = arrayOf(requestedImages).filter((item) => item.imageJenkinsName || item.imageNameEn);
  const images = arrayOf(rawImages).filter((item) => item.imageJenkinsName || item.imageNameEn);
  if (!requested.length || images.length !== requested.length) return false;
  const allRequestedPresent = requested.every((image) => images.some((item) => imageMatchesRequest(item, image)));
  const noExtraServices = images.every((item) => requested.some((image) => imageMatchesRequestIdentity(item, image)));
  return allRequestedPresent && noExtraServices;
}

function requestedImagesForTaskLookup(images, ignoreVersion = false) {
  return arrayOf(images)
    .filter((item) => item.imageJenkinsName || item.imageNameEn)
    .map((item) => {
      if (!ignoreVersion) return item;
      const { imageVersion, ...rest } = item;
      return rest;
    });
}

function requestedImagesFromPermissionOptions(options = {}) {
  const groupImages = requestedImagesForTaskLookup(options.images || options.buildImages, false);
  if (groupImages.length) return groupImages;
  return requestedImagesForTaskLookup([{
    imageJenkinsName: options.imageJenkinsName,
    imageNameEn: options.imageNameEn,
    imageVersion: options.imageVersion
  }], false);
}

function findBuildImagesForRequests(imageRows, requestedImages) {
  const rows = arrayOf(imageRows);
  return requestedImages.map((image) => rows.find((item) => imageMatchesRequest(item, image)) || null);
}

function findBuildImage(imageRows, options = {}) {
  return arrayOf(imageRows).find((item) =>
    (!options.imageJenkinsName || item.imageJenkinsName === options.imageJenkinsName || item.imageNameEn === options.imageJenkinsName) &&
    (!options.imageNameEn || item.imageNameEn === options.imageNameEn || item.imageJenkinsName === options.imageJenkinsName || !item.imageNameEn) &&
    (!options.imageVersion || item.imageVersion === options.imageVersion)
  );
}

function isEditableDuplicateApplyTask(task) {
  if (!task || !task.pendingApply) return false;
  return ["0", "4"].includes(String(task.applyStatus ?? ""));
}

function recoverableDuplicateBuildApplyGroup(groups, requestedImages = []) {
  const targetImages = requestedImagesForTaskLookup(requestedImages, false)
    .filter((item) => (item.imageJenkinsName || item.imageNameEn) && item.imageVersion);
  if (!targetImages.length) return null;

  for (const group of arrayOf(groups)) {
    const task = group && group.task;
    if (!isEditableDuplicateApplyTask(task)) continue;
    const images = arrayOf(group && group.images);
    const matchedRequestedImages = targetImages.filter((image) =>
      images.some((item) => imageMatchesRequest(item, image))
    );
    if (!matchedRequestedImages.length) continue;
    const extraImages = images.filter((item) =>
      !targetImages.some((image) => imageMatchesRequestIdentity(item, image))
    );
    const missingTargetImages = targetImages.filter((image) =>
      !images.some((item) => imageMatchesRequestIdentity(item, image))
    );
    return {
      ...group,
      task,
      images: images.map(compactObject),
      targetImages: targetImages.map(compactObject),
      matchedRequestedImages: matchedRequestedImages.map(compactObject),
      extraImages: extraImages.map(compactObject),
      missingTargetImages: missingTargetImages.map(compactObject)
    };
  }
  return null;
}

function pendingApplyRowMatches(row, options = {}, requestedImages = []) {
  if (!row || typeof row !== "object") return false;
  const branch = options.envType || options.codeBranch;
  if (String(row.applyStatus) !== "0") return false;
  if (options.customerNameEn && row.customerNameEn !== options.customerNameEn) return false;
  if (options.applicationCode && row.applicationCode && row.applicationCode !== options.applicationCode) return false;
  if (branch && row.branch && row.branch !== branch) return false;
  const imageNum = Number(row.imageNum);
  if (Number.isFinite(imageNum) && imageNum > 0 && requestedImages.length && imageNum !== requestedImages.length) return false;
  return true;
}

function listPendingBuildApplyGroups(session, options = {}, requestedImages = []) {
  if (options.releaseTaskId || !requestedImages.length || !options.customerNameEn || !options.applicationCode || !(options.codeBranch || options.envType)) {
    return {
      groups: [],
      rowsChecked: 0,
      response: null
    };
  }

  const pageSize = Number(options.pendingApplyPageSize || 20);
  const basePayload = {
    userId: session.login.staffCode,
    status: "0",
    customerNameEn: options.customerNameEn,
    applicationCode: options.applicationCode,
    imageNameEn: options.imageNameEn || requestedImages[0]?.imageNameEn,
    pageSize
  };
  Object.keys(basePayload).forEach((key) => {
    if (basePayload[key] == null || basePayload[key] === "") delete basePayload[key];
  });

  const firstResponse = postJsonViaNode(
    `${platforms.build.apiBase}/support/structureListPage`,
    createWrapper({ ...basePayload, pageNumber: 1 }),
    session.cookieJar
  );
  const firstObject = objectOf(firstResponse);
  const total = Number(firstObject && firstObject.total) || arrayOf(firstObject).length;
  const { pagesToFetch, hasMore, totalPages } = boundedPageCount(total, pageSize, options.maxPendingApplyPages || 1);
  const rows = [...arrayOf(firstObject)];

  for (let pageNumber = 2; pageNumber <= pagesToFetch; pageNumber += 1) {
    const pageResponse = postJsonViaNode(
      `${platforms.build.apiBase}/support/structureListPage`,
      createWrapper({ ...basePayload, pageNumber }),
      session.cookieJar
    );
    rows.push(...arrayOf(objectOf(pageResponse)));
  }

  const groups = [];
  for (const row of rows) {
    if (!pendingApplyRowMatches(row, options, requestedImages)) continue;
    const applyId = row.id;
    if (!applyId) continue;
    const serviceResponse = postJsonViaNode(
      `${platforms.build.apiBase}/support/serviceList`,
      createWrapper({ applyId, staffCode: session.login.staffCode }),
      session.cookieJar
    );
    const rawImages = arrayOf(objectOf(serviceResponse));
    if (!exactRequestedImageGroup(rawImages, requestedImages)) continue;
    groups.push({
      taskId: applyId,
      task: compactPendingBuildApply(row),
      images: rawImages.map(compactObject),
      pendingApply: true
    });
  }

  return {
    groups,
    rowsChecked: rows.length,
    total,
    totalPages,
    pagesFetched: pagesToFetch,
    hasMore,
    response: responseSummary(firstResponse)
  };
}

function buildApplyRowMatches(row, options = {}, requestedImages = []) {
  if (!row || typeof row !== "object") return false;
  const applyId = options.applyId || options.taskId || options.structureApplyId;
  if (applyId && String(row.id) !== String(applyId)) return false;
  const branch = options.envType || options.codeBranch;
  if (options.customerNameEn && row.customerNameEn !== options.customerNameEn) return false;
  if (options.applicationCode && row.applicationCode && row.applicationCode !== options.applicationCode) return false;
  if (branch && row.branch && row.branch !== branch) return false;
  const imageNum = Number(row.imageNum);
  if (Number.isFinite(imageNum) && imageNum > 0 && requestedImages.length && imageNum !== requestedImages.length) return false;
  return true;
}

function duplicateApplyRowMatches(row, options = {}) {
  if (!row || typeof row !== "object") return false;
  const branch = options.envType || options.codeBranch;
  if (options.customerNameEn && row.customerNameEn !== options.customerNameEn) return false;
  if (options.applicationCode && row.applicationCode && row.applicationCode !== options.applicationCode) return false;
  if (branch && row.branch && row.branch !== branch) return false;
  return true;
}

function buildApplyStatusCandidates(options = {}) {
  if (options.status !== undefined && options.status !== null && options.status !== "") return [String(options.status)];
  const applyId = options.applyId || options.taskId || options.structureApplyId;
  return applyId ? ["0", "2", "1"] : ["0"];
}

function duplicateBuildApplyStatusCandidates(options = {}) {
  if (options.status !== undefined && options.status !== null && options.status !== "") return [String(options.status)];
  return arrayOf(options.statusCandidates).length ? arrayOf(options.statusCandidates).map(String) : ["0", "1"];
}

function listBuildApplyGroups(session, options = {}, requestedImages = []) {
  const applyId = options.applyId || options.taskId || options.structureApplyId;
  if (!applyId && (!options.customerNameEn || !options.applicationCode || !(options.codeBranch || options.envType))) {
    return {
      groups: [],
      rowsChecked: 0,
      response: null
    };
  }

  const pageSize = Number(options.pendingApplyPageSize || options.applyPageSize || 20);
  const basePayload = {
    userId: session.login.staffCode,
    customerNameEn: options.customerNameEn,
    applicationCode: options.applicationCode,
    imageNameEn: options.imageNameEn || requestedImages[0]?.imageNameEn,
    pageSize
  };
  Object.keys(basePayload).forEach((key) => {
    if (basePayload[key] == null || basePayload[key] === "") delete basePayload[key];
  });

  const statusCandidates = buildApplyStatusCandidates(options);
  const rows = [];
  const pageSummaries = [];
  let firstResponse = null;
  let rowsChecked = 0;
  let aggregateTotal = 0;
  let aggregatePagesFetched = 0;
  let aggregateHasMore = false;
  let aggregateTotalPages = 0;

  for (const status of statusCandidates) {
    const firstPageResponse = postJsonViaNode(
      `${platforms.build.apiBase}/support/structureListPage`,
      createWrapper({ ...basePayload, status, pageNumber: 1 }),
      session.cookieJar
    );
    if (!firstResponse) firstResponse = firstPageResponse;
    const firstObject = objectOf(firstPageResponse);
    const total = Number(firstObject && firstObject.total) || arrayOf(firstObject).length;
    const { pagesToFetch, hasMore, totalPages } = boundedPageCount(total, pageSize, options.maxPendingApplyPages || options.maxApplyPages || 5);
    const statusRows = [...arrayOf(firstObject)];

    for (let pageNumber = 2; pageNumber <= pagesToFetch; pageNumber += 1) {
      const pageResponse = postJsonViaNode(
        `${platforms.build.apiBase}/support/structureListPage`,
        createWrapper({ ...basePayload, status, pageNumber }),
        session.cookieJar
      );
      statusRows.push(...arrayOf(objectOf(pageResponse)));
    }

    rowsChecked += statusRows.length;
    aggregateTotal += total;
    aggregatePagesFetched += pagesToFetch;
    aggregateHasMore = aggregateHasMore || hasMore;
    aggregateTotalPages += totalPages;
    pageSummaries.push({ status, rows: statusRows.length, total, pagesFetched: pagesToFetch, hasMore });
    rows.push(...statusRows.map((row) => ({ ...row, structureListStatus: status })));
  }

  const groups = [];
  for (const row of rows) {
    if (!buildApplyRowMatches(row, options, requestedImages)) continue;
    const rowApplyId = row.id;
    if (!rowApplyId) continue;
    const serviceResponse = postJsonViaNode(
      `${platforms.build.apiBase}/support/serviceList`,
      createWrapper({ applyId: rowApplyId, staffCode: session.login.staffCode }),
      session.cookieJar
    );
    const rawImages = arrayOf(objectOf(serviceResponse));
    if (requestedImages.length && !exactRequestedImageGroup(rawImages, requestedImages)) continue;
    groups.push({
      taskId: rowApplyId,
      task: compactPendingBuildApply(row),
      images: rawImages.map(compactObject),
      pendingApply: true
    });
  }

  return {
    groups,
    rowsChecked,
    total: aggregateTotal,
    totalPages: aggregateTotalPages,
    pagesFetched: aggregatePagesFetched,
    hasMore: aggregateHasMore,
    statusCandidates,
    pageSummaries,
    response: responseSummary(firstResponse)
  };
}

function listDuplicateBuildApplyGroups(session, options = {}, requestedImages = []) {
  const targetImages = requestedImagesForTaskLookup(requestedImages, false)
    .filter((item) => (item.imageJenkinsName || item.imageNameEn) && item.imageVersion);
  if (!targetImages.length || !options.customerNameEn || !options.applicationCode || !(options.codeBranch || options.envType)) {
    return {
      groups: [],
      rowsChecked: 0,
      response: null
    };
  }

  const pageSize = Number(options.pendingApplyPageSize || options.applyPageSize || 20);
  const basePayload = {
    userId: session.login.staffCode,
    customerNameEn: options.customerNameEn,
    applicationCode: options.applicationCode,
    pageSize
  };
  Object.keys(basePayload).forEach((key) => {
    if (basePayload[key] == null || basePayload[key] === "") delete basePayload[key];
  });

  const statusCandidates = duplicateBuildApplyStatusCandidates(options);
  const rows = [];
  const pageSummaries = [];
  let firstResponse = null;
  let rowsChecked = 0;
  let aggregateTotal = 0;
  let aggregatePagesFetched = 0;
  let aggregateHasMore = false;
  let aggregateTotalPages = 0;

  for (const status of statusCandidates) {
    const firstPageResponse = postJsonViaNode(
      `${platforms.build.apiBase}/support/structureListPage`,
      createWrapper({ ...basePayload, status, pageNumber: 1 }),
      session.cookieJar
    );
    if (!firstResponse) firstResponse = firstPageResponse;
    const firstObject = objectOf(firstPageResponse);
    const total = Number(firstObject && firstObject.total) || arrayOf(firstObject).length;
    const { pagesToFetch, hasMore, totalPages } = boundedPageCount(total, pageSize, options.maxPendingApplyPages || options.maxApplyPages || 5);
    const statusRows = [...arrayOf(firstObject)];

    for (let pageNumber = 2; pageNumber <= pagesToFetch; pageNumber += 1) {
      const pageResponse = postJsonViaNode(
        `${platforms.build.apiBase}/support/structureListPage`,
        createWrapper({ ...basePayload, status, pageNumber }),
        session.cookieJar
      );
      statusRows.push(...arrayOf(objectOf(pageResponse)));
    }

    rowsChecked += statusRows.length;
    aggregateTotal += total;
    aggregatePagesFetched += pagesToFetch;
    aggregateHasMore = aggregateHasMore || hasMore;
    aggregateTotalPages += totalPages;
    pageSummaries.push({ status, rows: statusRows.length, total, pagesFetched: pagesToFetch, hasMore });
    rows.push(...statusRows.map((row) => ({ ...row, structureListStatus: status })));
  }

  const groups = [];
  for (const row of rows) {
    if (!duplicateApplyRowMatches(row, options)) continue;
    const rowApplyId = row.id;
    if (!rowApplyId) continue;
    const serviceResponse = postJsonViaNode(
      `${platforms.build.apiBase}/support/serviceList`,
      createWrapper({ applyId: rowApplyId, staffCode: session.login.staffCode }),
      session.cookieJar
    );
    const rawImages = arrayOf(objectOf(serviceResponse));
    const candidate = recoverableDuplicateBuildApplyGroup([{
      taskId: rowApplyId,
      task: compactPendingBuildApply(row),
      images: rawImages.map(compactObject),
      pendingApply: true
    }], targetImages);
    if (candidate) groups.push(candidate);
  }

  return {
    groups,
    rowsChecked,
    total: aggregateTotal,
    totalPages: aggregateTotalPages,
    pagesFetched: aggregatePagesFetched,
    hasMore: aggregateHasMore,
    statusCandidates,
    pageSummaries,
    response: responseSummary(firstResponse)
  };
}

function responseSummary(response) {
  return {
    httpStatus: response.httpStatus,
    status: response.json && response.json.status,
    code: response.json && response.json.code,
    error: response.json && response.json.error,
    message: response.json && response.json.message,
    msg: response.json && response.json.msg,
    object: compactObject(objectOf(response))
  };
}

function mutationOutcome(response) {
  const summary = responseSummary(response);
  const object = objectOf(response);
  const businessCode = firstPrimitive(object, ["code", "statusCode", "errCode"]);
  const businessMessage = firstPrimitive(object, ["msg", "message", "errMsg"]) || summary.message || summary.msg || summary.error;
  const httpOk = response.httpStatus >= 200 && response.httpStatus < 300;
  const wrapperOk = !response.json || response.json.status == null || String(response.json.status) === "1";
  const businessOk = String(businessCode) === "200";

  return {
    ...summary,
    businessOk: Boolean(httpOk && wrapperOk && businessOk),
    businessCode: businessCode == null ? null : String(businessCode),
    businessMessage,
    object: compactObject(object)
  };
}

function isSuccessLikePlatformMessage(message) {
  return /^(消息处理成功|处理成功|success|ok|successful)$/i.test(String(message || "").trim());
}

function businessFailureMessage(action, outcome) {
  const codeText = outcome.businessCode ? `业务码 ${outcome.businessCode}` : "未返回成功业务码";
  const message = outcome.businessMessage && !isSuccessLikePlatformMessage(outcome.businessMessage)
    ? `：${outcome.businessMessage}`
    : "。平台返回了外层成功文案，但业务动作未确认；请刷新平台状态，确认该版本是否仍可处理或已被其他流程处理。";
  return `${action}未被平台接受（${codeText}）${message}`;
}

function looseMutationOutcome(response) {
  const base = mutationOutcome(response);
  const object = objectOf(response);
  const httpOk = response.httpStatus >= 200 && response.httpStatus < 300;
  const wrapperOk = !response.json || response.json.status == null || String(response.json.status) === "1";
  const booleanOk = object === true;
  const successPrimitive = firstPrimitive(object, ["success", "ok"]);
  const businessCode = firstPrimitive(object, ["code", "statusCode", "errCode"]);
  const truthyWithoutBusinessCode = businessCode == null && object != null && object !== false;
  const objectOk = successPrimitive === true || String(successPrimitive) === "true";
  return {
    ...base,
    businessOk: Boolean(base.businessOk || (httpOk && wrapperOk && (booleanOk || objectOk || truthyWithoutBusinessCode))),
    object: compactObject(object)
  };
}

function publishAppsAcceptedOutcome(response) {
  const base = mutationOutcome(response);
  const object = objectOf(response);
  const httpOk = response.httpStatus >= 200 && response.httpStatus < 300;
  const wrapperOk = !response.json || response.json.status == null || String(response.json.status) === "1";
  const businessCode = firstPrimitive(object, ["code", "statusCode", "errCode"]);
  const businessMessage = firstPrimitive(object, ["msg", "message", "errMsg"]) || base.businessMessage || base.message || base.msg || base.error;
  const explicitBusinessFailure = businessCode != null && String(businessCode) !== "200";
  const accepted = httpOk && wrapperOk && object !== false && !explicitBusinessFailure;

  return {
    ...base,
    businessOk: Boolean(accepted),
    businessCode: businessCode == null ? base.businessCode : String(businessCode),
    businessMessage,
    object: compactObject(object)
  };
}

function publishRateSignal(response) {
  const summary = responseSummary(response);
  const object = objectOf(response);
  const httpOk = response.httpStatus >= 200 && response.httpStatus < 300;
  const wrapperOk = !response.json || response.json.status == null || String(response.json.status) === "1";
  if (!httpOk || !wrapperOk || typeof object === "boolean") {
    return {
      status: "blocked",
      reason: "publish_rate_unavailable",
      value: object,
      response: summary
    };
  }

  const numeric = Number(
    typeof object === "object" && object
      ? firstPrimitive(object, ["rate", "progress", "percent", "value"])
      : object
  );
  if (Number.isFinite(numeric) && numeric >= 100) {
    return {
      status: "done",
      reason: "publish_rate_done",
      value: numeric,
      response: summary
    };
  }
  if (Number.isFinite(numeric)) {
    return {
      status: "running",
      reason: "publish_rate_running",
      value: numeric,
      response: summary
    };
  }
  return {
    status: "running",
    reason: "publish_rate_unknown",
    value: compactObject(object),
    response: summary
  };
}

function waitPublishAppRate(session, basePayload, publishApp, options = {}) {
  const maxAttempts = Number(options.maxAttempts || PUBLISH_RATE_MAX_ATTEMPTS);
  const intervalMs = Number(options.intervalMs || PUBLISH_RATE_INTERVAL_MS);
  const postJson = options.postJson || postJsonViaNode;
  const sleep = options.sleep || sleepSync;
  const payload = {
    customerNameEn: basePayload.customerNameEn,
    showNameEn: basePayload.showNameEn,
    environment: basePayload.environment,
    environmentFlag: basePayload.environmentFlag,
    applicationCode: publishApp.applicationCode,
    applicationVersion: publishApp.applicationVersion
  };
  let lastSignal = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = postJson(
        `${platforms.releaseApi.apiBase}/cloud/publishAppRate`,
        createWrapper(payload),
        session.cookieJar,
        releaseRequestOptions
      );
      lastSignal = publishRateSignal(response);
      if (lastSignal.status === "done") {
        return {
          ok: true,
          payload,
          attempts: attempt,
          signal: lastSignal
        };
      }
      if (lastSignal.status === "blocked") {
        return {
          ok: false,
          blocked: true,
          reason: lastSignal.reason,
          message: "发布请求已受理，但发布进度接口未确认完成；Pipeline 已暂停，可稍后继续或刷新发布详情确认平台状态。",
          payload,
          attempts: attempt,
          signal: lastSignal
        };
      }
    } catch (error) {
      const failure = classifyRequestError(error, releaseRequestOptions);
      lastSignal = {
        status: "blocked",
        reason: failure.reason,
        failure
      };
      return {
        ok: false,
        blocked: true,
        payload,
        attempts: attempt,
        ...failure
      };
    }

    if (attempt < maxAttempts) sleep(intervalMs);
  }

  return {
    ok: false,
    blocked: true,
    reason: "publish_rate_timeout",
    message: `发布请求已受理，但发布进度在 ${maxAttempts} 次观察内未到 100%；Pipeline 已暂停，可稍后继续或刷新发布详情确认平台状态。`,
    payload,
    attempts: maxAttempts,
    signal: lastSignal
  };
}

function waitPublishAppsRate(session, payload, options = {}) {
  const results = [];
  for (const publishApp of payload.publishApps) {
    const result = waitPublishAppRate(session, payload, publishApp, options);
    results.push(result);
    if (!result.ok) {
      return {
        ok: false,
        blocked: true,
        reason: result.reason,
        message: result.message,
        results
      };
    }
  }
  return {
    ok: true,
    results
  };
}

function loginFailureMessage(platformLabel, response, loginObject) {
  const visiblePlatformLabel = /发布/.test(platformLabel || "")
    ? "发布平台"
    : (/构建/.test(platformLabel || "") ? "构建平台" : (platformLabel || "平台"));
  const rawMessage = firstPrimitive(loginObject, ["msg", "message", "errMsg"]) ||
    firstPrimitive(response.json, ["msg", "message", "error"]) ||
    "未返回 loginToken";
  if (/Zookeeper Can not be find any agents|invoke .* was error/i.test(rawMessage)) {
    return `${visiblePlatformLabel}当前不可用：后端登录服务异常，请稍后重试或联系平台维护。`;
  }
  return `${visiblePlatformLabel}登录失败：${rawMessage}`;
}

function rawLoginFailureMessage(response, loginObject) {
  return firstPrimitive(loginObject, ["msg", "message", "errMsg"]) ||
    firstPrimitive(response.json, ["msg", "message", "error"]);
}

function isDuplicateBuildInfoMessage(message) {
  return /已存在构建信息|请勿重复提交构建申请|duplicate/i.test(String(message || ""));
}

function isBuildPowerEnabled(value) {
  return String(value) === "0";
}

function generateImageVersions(session, options = {}, images = []) {
  const imageNames = images.map((item) => item.imageNameEn).filter(Boolean);
  if (imageNames.length !== images.length) {
    return {
      ok: false,
      reason: "missing_image_name_en",
      message: "创建构建任务前需要平台服务行里的 imageNameEn，用于调用 /support/generateImageVersion。"
    };
  }

  const payload = {
    customerNameEn: options.customerNameEn,
    structureType: options.structureType,
    codeBranch: options.codeBranch,
    images: imageNames.map((imageNameEn) => ({ imageNameEn })),
    applicationCode: options.applicationCode
  };
  if (options.extendFlag !== undefined) {
    payload.extendFlag = options.extendFlag === true || options.extendFlag === "true";
  } else {
    payload.laneNamespace = options.laneNamespace || "";
  }

  if (!payload.customerNameEn || !payload.structureType || !payload.codeBranch || !payload.applicationCode || !payload.images.length) {
    return {
      ok: false,
      reason: "missing_generate_version_params",
      payload
    };
  }

  const response = postJsonViaNode(
    `${platforms.build.apiBase}/support/generateImageVersion`,
    createWrapper(payload),
    session.cookieJar
  );
  const raw = objectOf(response);
  const versions = raw && typeof raw.msg === "object" ? raw.msg : raw;
  const versionMap = versions && typeof versions === "object" && !Array.isArray(versions) ? versions : {};
  const missingVersions = imageNames.filter((imageNameEn) => !versionMap[imageNameEn]);

  return {
    ok: response.httpStatus >= 200 && response.httpStatus < 300 && !missingVersions.length,
    reason: missingVersions.length ? "missing_generated_versions" : undefined,
    payload,
    response: responseSummary(response),
    versions: versionMap,
    missingVersions
  };
}

function resolvedGeneratedVersion(item, generated) {
  return generated.versions[item.imageNameEn] || item.imageVersion;
}

function probeImageVersion(credentials, options = {}) {
  const session = loginBuildPlatform(credentials);
  if (!session.ok) return { ok: false, session };

  try {
    const generated = generateImageVersions(session, {
      customerNameEn: options.customerNameEn,
      structureType: options.structureType,
      codeBranch: options.codeBranch,
      applicationCode: options.applicationCode,
      laneNamespace: options.laneNamespace,
      extendFlag: options.extendFlag
    }, options.images || options.buildImages || []);

    return {
      ok: generated.ok,
      session: session.login,
      reason: generated.reason,
      message: generated.message,
      probe: generated
    };
  } catch (error) {
    return {
      ok: false,
      session: session.login,
      reason: "request_failed",
      error: error.message
    };
  } finally {
    removeCookieJar(session.cookieJar);
  }
}

function probeStructureTypeConfigs(credentials, options = {}) {
  const session = loginBuildPlatform(credentials);
  if (!session.ok) return { ok: false, session };

  const payload = {
    customerNameEn: options.customerNameEn,
    namespace: options.namespace
  };

  if (!payload.customerNameEn || !payload.namespace) {
    removeCookieJar(session.cookieJar);
    return {
      ok: false,
      session: session.login,
      reason: "missing_structure_config_params",
      payload
    };
  }

  try {
    const response = postJsonViaNode(
      `${platforms.build.apiBase}/support/getStructureTypeConfigs`,
      createWrapper(payload),
      session.cookieJar
    );
    return {
      ok: response.httpStatus >= 200 && response.httpStatus < 300,
      session: session.login,
      payload,
      configs: arrayOf(objectOf(response)).map(compactObject),
      response: responseSummary(response)
    };
  } catch (error) {
    return {
      ok: false,
      session: session.login,
      payload,
      ...classifyRequestError(error)
    };
  } finally {
    removeCookieJar(session.cookieJar);
  }
}

function normalizeServiceRow(row, extra = {}) {
  const normalized = compactObject(row);
  const imageJenkinsName = row && (row.imageJenkinsName || row.serviceNameEn || row.microServiceName || row.serviceName);
  return {
    ...normalized,
    ...extra,
    imageJenkinsName,
    serviceKey: [
      extra.customerNameEn,
      extra.applicationCode,
      extra.codeBranch,
      imageJenkinsName
    ].filter(Boolean).join("::")
  };
}

function firstPrimitive(value, keys) {
  if (!value || typeof value !== "object") return undefined;
  for (const key of keys) {
    if (value[key] != null && ["string", "number", "boolean"].includes(typeof value[key])) {
      return value[key];
    }
  }
  return undefined;
}

function normalizeCustomerApplicationRows(response) {
  return arrayOf(objectOf(response))
    .map(compactObject)
    .map((item) => {
      const code = firstPrimitive(item, ["applicationCode", "applicationNameEn", "code", "value", "applicationName"]);
      if (!code) return null;
      const name = firstPrimitive(item, ["applicationName", "applicationNameCh", "name", "label"]) || code;
      return {
        ...item,
        applicationCode: String(code),
        applicationName: String(name)
      };
    })
    .filter(Boolean);
}

function fetchCustomerApplications(session, customerNameEn) {
  if (!customerNameEn) {
    return {
      count: 0,
      rows: [],
      source: "COMMON_SELECT_CUSTOMER_APP_LIST_SAGA",
      endpoint: "/support/findCustomerAppList",
      note: "缺少客户标识，未读取客户应用。"
    };
  }
  const response = postJsonViaNode(
    `${platforms.build.apiBase}/support/findCustomerAppList`,
    createWrapper({
      userId: session.login.staffCode,
      customerNameEn
    }),
    session.cookieJar
  );
  const rows = normalizeCustomerApplicationRows(response);
  return {
    count: rows.length,
    rows,
    source: "COMMON_SELECT_CUSTOMER_APP_LIST_SAGA",
    endpoint: "/support/findCustomerAppList",
    note: "与原构建页面应用下拉一致：按 userId + customerNameEn 读取客户应用。"
  };
}

function boundedPageCount(total, pageSize, maxPages = SERVICE_MAX_PAGES) {
  const totalPages = Math.max(1, Math.ceil((Number(total) || 0) / pageSize));
  const normalizedMax = Number(maxPages);
  const pagesToFetch = normalizedMax > 0 ? Math.min(totalPages, normalizedMax) : totalPages;
  return {
    totalPages,
    pagesToFetch,
    hasMore: totalPages > pagesToFetch
  };
}

function normalizeServiceQuery(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeServiceSearchPayload(value) {
  return String(value || "").trim();
}

function normalizePositiveInteger(value, fallback, max) {
  const numeric = Number(value);
  const normalizedFallback = Math.max(1, Math.trunc(Number(fallback) || 1));
  if (!Number.isFinite(numeric)) return normalizedFallback;
  const integer = Math.trunc(numeric);
  if (integer < 1) return normalizedFallback;
  const normalizedMax = max ? Math.max(1, Math.trunc(Number(max) || integer)) : null;
  return normalizedMax ? Math.min(integer, normalizedMax) : integer;
}

function serviceRowMatchesQuery(row, query) {
  const normalizedQuery = normalizeServiceQuery(query);
  if (!normalizedQuery) return true;
  return [
    row && row.imageJenkinsName,
    row && row.imageNameEn,
    row && row.serviceNameEn,
    row && row.microServiceName,
    row && row.serviceName,
    row && row.imageNameCh
  ].some((value) => String(value || "").toLowerCase().includes(normalizedQuery));
}

function fetchPublishMicroServices(session, payload, options = {}) {
  const pageNumber = normalizePositiveInteger(options.pageNumber ?? payload.pageNumber, 1);
  const pageSize = normalizePositiveInteger(options.pageSize ?? payload.pageSize, SERVICE_PAGE_SIZE, SERVICE_MAX_PAGE_SIZE);
  const serviceSearch = normalizeServiceSearchPayload(options.serviceSearch ?? payload.imageJenkinsName);
  const requestPayload = compactObject({
    ...payload,
    imageJenkinsName: serviceSearch || undefined,
    pageNumber,
    pageSize
  });
  const response = postJsonViaNode(
    `${platforms.build.apiBase}/support/selectPublishMicroServiceInfo`,
    createWrapper(requestPayload),
    session.cookieJar
  );
  const responseObject = objectOf(response);
  const rows = arrayOf(responseObject);
  const total = Number(responseObject && responseObject.total) || rows.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return {
    total,
    pageNo: pageNumber,
    pageSize,
    totalPages,
    pagesFetched: 1,
    hasMore: pageNumber < totalPages,
    query: serviceSearch,
    rows,
    status: response.json && response.json.status,
    error: response.json && response.json.error,
    serverPaged: true
  };
}

function flattenMenu(nodes, pathParts = [], result = []) {
  for (const node of nodes || []) {
    const name = node.menuName || node.name || node.title || "";
    const currentPath = [...pathParts, name].filter(Boolean);
    result.push({
      name,
      appId: node.appId,
      menuType: node.menuType,
      url: node.url,
      path: currentPath.join(" / ")
    });
    flattenMenu(node.childMenuList || node.children || [], currentPath, result);
  }
  return result;
}

function flattenNamespaceInfos(namespaceContainers) {
  const result = [];
  for (const container of namespaceContainers || []) {
    const namespaceInfos = Array.isArray(container.namespaceInfos) ? container.namespaceInfos : [];
    if (!namespaceInfos.length) {
      result.push(container);
      continue;
    }

    for (const item of namespaceInfos) {
      result.push({
        customerNameCh: container.customerNameCh,
        customerNameEn: container.customerNameEn,
        customerAbbreviation: container.customerAbbreviation,
        envName: item.envName,
        envType: item.envType,
        codeBranch: item.codeBranch,
        namespace: item.namespace,
        useStatus: item.useStatus,
        synStatus: item.synStatus,
        id: item.id
      });
    }
  }
  return result;
}

function createCookieJar(prefix, cacheKey) {
  if (!cacheKey) return path.join(os.tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}.cookies`);
  ensureCacheDir();
  return path.join(COOKIE_DIR, `${prefix}-${sha256Hex(cacheKey).slice(0, 24)}.cookies`);
}

function removeCookieJar(cookieJar) {
  if (retainedCookieJars.has(cookieJar)) return;
  try {
    fs.unlinkSync(cookieJar);
  } catch (error) {
    // Temporary cookie jars are best-effort cleanup only.
  }
}

function isCookieJarUsable(cookieJar) {
  try {
    const parsed = JSON.parse(fs.readFileSync(cookieJar, "utf8"));
    return parsed && parsed.version === 1 && Array.isArray(parsed.cookies);
  } catch (error) {
    return false;
  }
}

function resolvePassword({ password, envPasswordKey }) {
  return password || (envPasswordKey ? process.env[envPasswordKey] : "");
}

function sessionCacheKey(platform, username, resolvedPassword) {
  return `${platform}:${username}:${sha256Hex(resolvedPassword).slice(0, 16)}`;
}

function readSessionCacheFile() {
  try {
    if (!fs.existsSync(SESSION_CACHE_PATH)) return {};
    const parsed = JSON.parse(fs.readFileSync(SESSION_CACHE_PATH, "utf8"));
    return parsed && typeof parsed === "object" ? parsed.sessions || {} : {};
  } catch (error) {
    return {};
  }
}

function writeSessionCacheFile(sessions) {
  ensureCacheDir();
  fs.writeFileSync(SESSION_CACHE_PATH, `${JSON.stringify({
    version: 1,
    updatedAt: new Date().toISOString(),
    sessions
  }, null, 2)}\n`, { mode: 0o600 });
}

function forgetPersistentSession(cacheKey) {
  const sessions = readSessionCacheFile();
  delete sessions[cacheKey];
  writeSessionCacheFile(sessions);
}

function evictSession(cacheKey) {
  const cached = sessionCache.get(cacheKey);
  if (cached) {
    sessionCache.delete(cacheKey);
    retainedCookieJars.delete(cached.session.cookieJar);
    removeCookieJar(cached.session.cookieJar);
  }
  forgetPersistentSession(cacheKey);
}

function getCachedSession(cacheKey) {
  const cached = sessionCache.get(cacheKey);
  if (cached && (cached.expiresAt <= Date.now() || !fs.existsSync(cached.session.cookieJar) || !isCookieJarUsable(cached.session.cookieJar))) {
    evictSession(cacheKey);
    return null;
  }
  const usable = cached || readSessionCacheFile()[cacheKey];
  if (!usable) return null;
  if (usable.expiresAt <= Date.now() || !fs.existsSync(usable.session.cookieJar) || !isCookieJarUsable(usable.session.cookieJar)) {
    evictSession(cacheKey);
    return null;
  }
  retainedCookieJars.add(usable.session.cookieJar);
  sessionCache.set(cacheKey, usable);
  return {
    ...usable.session,
    cached: true,
    persistent: !cached,
    login: {
      ...usable.session.login,
      cached: true,
      persistent: !cached,
      expiresAt: new Date(usable.expiresAt).toISOString()
    }
  };
}

function rememberSession(cacheKey, session) {
  if (!session.ok || !SESSION_TTL_MS) return session;
  const existing = sessionCache.get(cacheKey);
  if (existing) {
    sessionCache.delete(cacheKey);
    retainedCookieJars.delete(existing.session.cookieJar);
    if (existing.session.cookieJar !== session.cookieJar) removeCookieJar(existing.session.cookieJar);
  }
  const expiresAt = Date.now() + SESSION_TTL_MS;
  retainedCookieJars.add(session.cookieJar);
  try {
    fs.chmodSync(session.cookieJar, 0o600);
  } catch (error) {
    // Cookie jar permissions are best-effort; the cache file itself is also 0600.
  }
  const cachedSession = {
    ...session,
    cached: false,
    login: {
      ...session.login,
      cached: false,
      expiresAt: new Date(expiresAt).toISOString()
    }
  };
  sessionCache.set(cacheKey, { session: cachedSession, expiresAt });
  const sessions = readSessionCacheFile();
  sessions[cacheKey] = { session: cachedSession, expiresAt };
  writeSessionCacheFile(sessions);
  return cachedSession;
}

function loginBuildPlatform({ username, password, envPasswordKey }) {
  const resolvedPassword = resolvePassword({ password, envPasswordKey });
  if (!username || !resolvedPassword) {
    return { ok: false, reason: "missing_credentials" };
  }

  const cacheKey = sessionCacheKey("build", username, resolvedPassword);
  const cached = getCachedSession(cacheKey);
  if (cached) return cached;

  const cookieJar = createCookieJar("workbench-build", cacheKey);
  try {
    const login = postJsonViaNode(
      `${platforms.build.apiBase}/authority/login`,
      createWrapper({
        account: username,
        password: sha256Hex(resolvedPassword),
        deviceType: "pc",
        appId: platforms.build.appId
      }),
      cookieJar
    );
    const loginObject = objectOf(login);
    const token = loginObject && loginObject.loginToken;
    const failureMessage = token ? null : loginFailureMessage(platforms.build.label, login, loginObject);
    const rawFailureMessage = token ? null : rawLoginFailureMessage(login, loginObject);

    const session = {
      ok: Boolean(token),
      cookieJar,
      token,
      reason: token ? undefined : "build_login_failed",
      message: failureMessage,
      login: {
        httpStatus: login.httpStatus,
        status: login.json && login.json.status,
        objectStatus: loginObject && loginObject.status,
        error: login.json && login.json.error,
        message: token ? login.json && login.json.message : failureMessage,
        rawMessage: rawFailureMessage,
        tokenPreview: maskToken(token),
        userNameCn: loginObject && loginObject.userNameCn,
        staffCode: loginObject && loginObject.staffCode
      }
    };
    if (!session.ok) removeCookieJar(cookieJar);
    return rememberSession(cacheKey, session);
  } catch (error) {
    removeCookieJar(cookieJar);
    return {
      ok: false,
      ...classifyRequestError(error)
    };
  }
}

function discoverApplicationServices(session, options) {
  const customerNameEn = options.customerNameEn || "demo-customer-a";
  const applicationCodes = options.applicationCodes && options.applicationCodes.length ? options.applicationCodes : ["emr", "mem"];
  const targetBranch = options.codeBranch;
  const serviceSearch = options.serviceSearch || "";
  const servicePageNumber = options.servicePageNumber || 1;
  const servicePageSize = options.servicePageSize || SERVICE_PAGE_SIZE;

  return applicationCodes.map((applicationCode) => {
    try {
      const basePayload = { customerNameEn, applicationCode };
      const detail = postJsonViaNode(
        `${platforms.build.apiBase}/support/findMyApplicationDetail`,
        createWrapper(basePayload),
        session.cookieJar
      );
      const detailObject = compactObject(objectOf(detail));
      const namespaces = postJsonViaNode(
        `${platforms.build.apiBase}/support/selectNamespaceList`,
        createWrapper(basePayload),
        session.cookieJar
      );
      const namespaceList = arrayOf(objectOf(namespaces));
      const namespaceInfos = flattenNamespaceInfos(namespaceList);
      const branches = namespaceInfos
        .map((item) => firstPrimitive(item, ["codeBranch", "branch", "showNameEn", "environmentCode"]))
        .filter(Boolean)
        .filter((codeBranch, index, list) => list.indexOf(codeBranch) === index)
        .filter((codeBranch) => !targetBranch || codeBranch === targetBranch);
      if (targetBranch && !branches.length) branches.push(targetBranch);
      let microservicesByBranch = [];
      let buildTaskTypes = null;

      microservicesByBranch = branches.map((codeBranch) => {
        const serviceObject = fetchPublishMicroServices(session, {
          userId: session.login.staffCode,
          customerNameEn,
          applicationCode,
          codeBranch
        }, {
          pageNumber: servicePageNumber,
          pageSize: servicePageSize,
          serviceSearch
        });
        const rows = serviceObject.rows.map((row) => normalizeServiceRow(row, { customerNameEn, applicationCode, codeBranch }));
        return {
          codeBranch,
          total: serviceObject.total,
          rawTotal: serviceObject.total,
          pageNo: serviceObject.pageNo,
          pageSize: serviceObject.pageSize,
          totalPages: serviceObject.totalPages,
          pagesFetched: serviceObject.pagesFetched,
          hasMore: serviceObject.hasMore,
          serverPaged: serviceObject.serverPaged,
          query: serviceObject.query,
          visibleRows: rows.length,
          rows,
          status: serviceObject.status,
          error: serviceObject.error
        };
      });

      buildTaskTypes = postJsonViaNode(
        `${platforms.build.apiBase}/support/getBuildTaskType`,
        createWrapper(basePayload),
        session.cookieJar
      );

      const totalServices = microservicesByBranch.reduce((sum, item) => sum + (Number(item.total) || 0), 0);
      const sampleRows = microservicesByBranch.flatMap((item) =>
        item.rows.slice(0, 3).map((row) => ({ ...row, codeBranch: item.codeBranch }))
      );

      return {
        applicationCode,
        applicationName: detailObject.applicationName || detailObject.applicationNameCh || applicationCode,
        customerNameEn,
        detail: detailObject,
        namespaces: namespaceInfos.slice(0, 12).map(compactObject),
        namespaceCount: namespaceInfos.length,
        selectedCodeBranch: branches[0] || null,
        microservices: {
          total: totalServices,
          rows: sampleRows
        },
        branches: microservicesByBranch,
        buildTaskTypes: arrayOf(objectOf(buildTaskTypes)).map(compactObject)
      };
    } catch (error) {
      return {
        applicationCode,
        customerNameEn,
        error: error.message
      };
    }
  });
}

function discoverBuildWorkflowCustomers(credentials) {
  const session = loginBuildPlatform(credentials);
  if (!session.ok) return { ok: false, session };

  try {
    const customers = postJsonViaNode(
      `${platforms.build.apiBase}/support/findCustomerList`,
      createWrapper({ userId: session.login.staffCode }),
      session.cookieJar
    );
    const customerList = arrayOf(objectOf(customers)).map(compactObject).filter((item) => item.customerNameEn || item.customerNameCh);
    return {
      ok: true,
      session: session.login,
      customers: customerList,
      apps: {
        count: 0,
        rows: [],
        source: "customer-selected",
        note: "探测客户阶段不读取全局应用字典；新增 workflow 时按所选客户读取应用。"
      }
    };
  } catch (error) {
    return {
      ok: false,
      session: session.login,
      platform: platforms.build,
      ...classifyRequestError(error)
    };
  } finally {
    removeCookieJar(session.cookieJar);
  }
}

function probeBuildServiceDetail(credentials, options = {}) {
  const session = loginBuildPlatform(credentials);
  if (!session.ok) return { ok: false, session };

  const payload = {
    customerNameEn: options.customerNameEn,
    imageJenkinsName: options.imageJenkinsName,
    codeBranch: options.codeBranch,
    applicationName: options.applicationCode,
    userId: session.login.staffCode
  };

  if (!payload.customerNameEn || !payload.imageJenkinsName || !payload.codeBranch || !payload.applicationName) {
    removeCookieJar(session.cookieJar);
    return {
      ok: false,
      session: session.login,
      reason: "missing_service_detail_params"
    };
  }

  try {
    const detail = postJsonViaNode(
      `${platforms.build.apiBase}/support/getStructureImageDetail`,
      createWrapper(payload),
      session.cookieJar
    );
    const detailRows = arrayOf(objectOf(detail)).map(compactObject);
    const firstDetail = detailRows[0] || {};
    const historyPayload = {
      customerNameEn: options.customerNameEn,
      codeBranch: options.codeBranch,
      applicationName: options.applicationCode,
      imageJenkinsName: options.imageJenkinsName,
      imageVersion: options.imageVersion || firstDetail.imageVersion
    };
    let history = null;

    if (historyPayload.imageVersion) {
      history = postJsonViaNode(
        `${platforms.build.apiBase}/support/getStructureDetailList`,
        createWrapper(historyPayload),
        session.cookieJar
      );
    }

    return {
      ok: true,
      session: session.login,
      service: {
        applicationCode: options.applicationCode,
        codeBranch: options.codeBranch,
        imageJenkinsName: options.imageJenkinsName
      },
      detail: detailRows,
      history: history ? arrayOf(objectOf(history)).slice(0, 10).map(compactObject) : [],
      blockedMutations: [
        "/support/buildImages",
        "/support/stopBuildImages",
        "/support/confirmPublish"
      ]
    };
  } catch (error) {
    return {
      ok: false,
      session: session.login,
      service: {
        applicationCode: options.applicationCode,
        codeBranch: options.codeBranch,
        imageJenkinsName: options.imageJenkinsName
      },
      ...classifyRequestError(error)
    };
  } finally {
    removeCookieJar(session.cookieJar);
  }
}

function probeBuildLog(credentials, options = {}) {
  const session = loginBuildPlatform(credentials);
  if (!session.ok) return { ok: false, session };

  const payload = {
    customerNameEn: options.customerNameEn,
    codeBranch: options.codeBranch,
    applicationName: options.applicationCode,
    imageJenkinsName: options.imageJenkinsName,
    buildID: String(options.buildID || options.buildId || "").replace(/^#/, "")
  };

  if (!payload.customerNameEn || !payload.codeBranch || !payload.applicationName || !payload.imageJenkinsName || !payload.buildID) {
    removeCookieJar(session.cookieJar);
    return {
      ok: false,
      session: session.login,
      reason: "missing_build_log_params"
    };
  }

  try {
    const log = postJsonViaNode(
      `${platforms.build.apiBase}/support/getStructureLog`,
      createWrapper(payload),
      session.cookieJar,
      { maxTimeSeconds: Math.max(HTTP_MAX_TIME_SECONDS, 30) }
    );
    const object = objectOf(log);
    return {
      ok: true,
      session: session.login,
      service: {
        applicationCode: options.applicationCode,
        codeBranch: options.codeBranch,
        imageJenkinsName: options.imageJenkinsName,
        buildID: payload.buildID
      },
      payload,
      log: typeof object === "string" ? object : object,
      response: responseSummary(log)
    };
  } catch (error) {
    return {
      ok: false,
      session: session.login,
      service: {
        applicationCode: options.applicationCode,
        codeBranch: options.codeBranch,
        imageJenkinsName: options.imageJenkinsName,
        buildID: payload.buildID
      },
      ...classifyRequestError(error, { maxTimeSeconds: Math.max(HTTP_MAX_TIME_SECONDS, 30) })
    };
  } finally {
    removeCookieJar(session.cookieJar);
  }
}

function executeBuildImages(credentials, options = {}) {
  const session = loginBuildPlatform(credentials);
  if (!session.ok) return { ok: false, session };

  const buildImages = (options.buildImages || []).map((item) => {
    const image = {
      imageJenkinsName: item.imageJenkinsName,
      applicationCode: item.applicationCode || options.applicationCode
    };
    if (item.imageVersion) image.imageVersion = item.imageVersion;
    if (item.coverageRun != null) image.coverageRun = item.coverageRun;
    return image;
  });
  const payload = {
    customerNameEn: options.customerNameEn,
    applicationCode: options.applicationCode,
    applicationName: options.applicationName || options.applicationCode,
    buildPerId: session.login.staffCode,
    codeBranch: options.codeBranch,
    kubernetesVersion: options.kubernetesVersion
  };

  if (options.buildAll) payload.buildAll = true;
  else payload.buildImages = buildImages;
  if (options.applyId) payload.applyId = options.applyId;
  if (options.taskId) payload.taskId = options.taskId;

  if (
    !payload.customerNameEn ||
    !payload.applicationCode ||
    !payload.codeBranch ||
    (!payload.buildAll && !buildImages.length) ||
    (payload.buildAll && !payload.applyId)
  ) {
    removeCookieJar(session.cookieJar);
    return {
      ok: false,
      session: session.login,
      reason: "missing_build_params"
    };
  }

  try {
    const response = postJsonViaNode(
      `${platforms.build.apiBase}/support/buildImages`,
      createWrapper(payload),
      session.cookieJar
    );
    const outcome = mutationOutcome(response);
    if (!outcome.businessOk) {
      return {
        ok: false,
        session: session.login,
        payload,
        reason: "build_images_business_failed",
        response: outcome
      };
    }
    return {
      ok: true,
      session: session.login,
      payload,
      response: outcome
    };
  } catch (error) {
    return {
      ok: false,
      session: session.login,
      payload,
      reason: "request_failed",
      error: error.message
    };
  } finally {
    removeCookieJar(session.cookieJar);
  }
}

function buildRecoveryEditImages(requestedImages) {
  return requestedImagesForTaskLookup(requestedImages, false)
    .map((item) => ({
      imageJenkinsName: item.imageJenkinsName,
      imageVersion: item.imageVersion,
      imageDeployId: item.imageDeployId,
      imageNameEn: item.imageNameEn,
      applicationCode: item.applicationCode
    }))
    .filter((item) => item.imageJenkinsName);
}

function recoverDuplicateBuildApplyInSession(session, options = {}, requestedImages = []) {
  const targetImages = buildRecoveryEditImages(requestedImages);
  const missingImageVersions = targetImages.filter((item) => !item.imageVersion);
  const missingDeployIds = targetImages.filter((item) => item.imageDeployId == null || item.imageDeployId === "");
  if (!targetImages.length || missingImageVersions.length || missingDeployIds.length) {
    return {
      ok: false,
      reason: "missing_duplicate_recovery_target_identity",
      message: "已有构建信息恢复需要当前服务组的 imageJenkinsName、imageVersion 和 imageDeployId。",
      targetImages: targetImages.map(compactObject),
      missingImageVersions: missingImageVersions.map(compactObject),
      missingDeployIds: missingDeployIds.map(compactObject)
    };
  }

  const applyProbe = listDuplicateBuildApplyGroups(session, options, targetImages);
  const candidate = applyProbe.groups[0] || null;
  if (!candidate) {
    return {
      ok: false,
      reason: "recoverable_duplicate_apply_not_found",
      message: "平台提示已有构建信息，但未定位到可编辑的同版本阻塞申请。",
      targetImages: targetImages.map(compactObject),
      applyProbe: {
        groups: applyProbe.groups.length,
        rowsChecked: applyProbe.rowsChecked,
        pagesFetched: applyProbe.pagesFetched,
        hasMore: applyProbe.hasMore,
        statusCandidates: applyProbe.statusCandidates,
        pageSummaries: applyProbe.pageSummaries
      }
    };
  }

  const applyId = firstPrimitive(candidate.task, ["structureApplyId", "applyId", "id", "taskId"]);
  if (!applyId) {
    return {
      ok: false,
      reason: "missing_recoverable_apply_id",
      message: "已定位到同版本阻塞申请，但缺少 applyId，无法编辑。",
      candidate
    };
  }

  let returnOutcome = null;
  if (String(candidate.task.applyStatus ?? "") !== "4") {
    const returnResponse = postJsonViaNode(
      `${platforms.build.apiBase}/support/updateProdStructApplyStatus`,
      createWrapper({
        userId: session.login.staffCode,
        applyId,
        applyStatus: "4"
      }),
      session.cookieJar
    );
    returnOutcome = looseMutationOutcome(returnResponse);
    if (!returnOutcome.businessOk) {
      return {
        ok: false,
        reason: "return_apply_business_failed",
        message: businessFailureMessage("构建申请退回", returnOutcome),
        applyId,
        candidate,
        response: returnOutcome
      };
    }
  }

  const editImages = targetImages.map((item) => ({
    imageJenkinsName: item.imageJenkinsName,
    imageVersion: item.imageVersion,
    imageDeployId: item.imageDeployId
  }));
  const editPayload = {
    applyId,
    customerNameEn: options.customerNameEn,
    applicationCode: options.applicationCode,
    applyBy: session.login.staffCode,
    userNameAuth: session.login.userNameCn,
    branch: options.codeBranch || options.branch || options.envType,
    structureType: options.structureType || candidate.task.structureType || "prod",
    deploymentDescribe: options.deploymentDescribe,
    deploymentExplain: options.deploymentExplain,
    envName: options.envName || options.codeBranch || options.envType,
    isFeiShu: "0",
    images: editImages
  };
  if (options.canaryNamespaceId) editPayload.canaryNamespaceId = options.canaryNamespaceId;

  const editResponse = postJsonViaNode(
    `${platforms.build.apiBase}/support/applyProdStruct`,
    createWrapper(editPayload),
    session.cookieJar
  );
  const editOutcome = mutationOutcome(editResponse);
  if (!editOutcome.businessOk) {
    return {
      ok: false,
      reason: "edit_apply_business_failed",
      message: businessFailureMessage("构建申请编辑保存", editOutcome),
      applyId,
      candidate,
      returnResponse: returnOutcome,
      payload: editPayload,
      response: editOutcome
    };
  }

  let verify = null;
  try {
    verify = listBuildApplyGroups(session, {
      ...options,
      applyId,
      status: "0",
      maxApplyPages: 1,
      maxPendingApplyPages: 1
    }, targetImages);
  } catch (error) {
    verify = {
      error: error.message,
      groups: []
    };
  }
  const verifiedGroup = verify.groups?.[0] || null;
  return {
    ok: true,
    recovered: true,
    strategy: "return-edit-existing-apply",
    applyId,
    candidate,
    targetImages: targetImages.map(compactObject),
    returnResponse: returnOutcome,
    payload: editPayload,
    response: editOutcome,
    task: verifiedGroup?.task || { ...candidate.task, id: applyId, taskId: applyId, structureApplyId: applyId, applyStatus: "0" },
    images: verifiedGroup?.images || targetImages.map(compactObject),
    verify: verify ? {
      groups: verify.groups?.length || 0,
      rowsChecked: verify.rowsChecked,
      pagesFetched: verify.pagesFetched,
      hasMore: verify.hasMore,
      error: verify.error
    } : null
  };
}

function executeBuildTask(credentials, options = {}) {
  const session = loginBuildPlatform(credentials);
  if (!session.ok) return { ok: false, session };

  const codeBranch = options.codeBranch || options.branch;
  const flowMode = options.flowMode || (codeBranch === "release" ? "release-task" : "apply-task");

  try {
    if (flowMode === "release-task") {
      const requestedImages = options.buildImages || [];
      const generated = generateImageVersions(session, {
        customerNameEn: options.customerNameEn,
        structureType: options.structureType || "release",
        codeBranch,
        applicationCode: options.applicationCode,
        laneNamespace: options.laneNamespace,
        extendFlag: options.extendFlag
      }, requestedImages);

      if (!generated.ok) {
        return {
          ok: false,
          session: session.login,
          flowMode,
          reason: generated.reason || "generate_image_version_failed",
          versionProbe: generated
        };
      }

      const payload = {
        customerNameEn: options.customerNameEn,
        codeBranch,
        applicationName: options.applicationName || options.applicationCode,
        applicationCode: options.applicationCode,
        buildPerId: session.login.staffCode,
        structureType: options.structureType || "release",
        releaseAppSub: options.releaseAppSub,
        releaseModule: options.releaseModule,
        releaseType: options.releaseType,
        releaseContent: options.releaseContent,
        buildType: options.buildType || options.structureType || "release",
        buildImages: requestedImages.map((item) => {
          const image = {
            imageJenkinsName: item.imageJenkinsName,
            imageVersion: resolvedGeneratedVersion(item, generated),
            applicationCode: item.applicationCode || options.applicationCode
          };
          if (item.coverageRun != null) image.coverageRun = item.coverageRun;
          return image;
        })
      };

      if (!payload.customerNameEn || !payload.applicationCode || !payload.codeBranch || !payload.releaseContent || !payload.buildImages.length) {
        return {
          ok: false,
          session: session.login,
          reason: "missing_release_task_params",
          payload
        };
      }

      const response = postJsonViaNode(
        `${platforms.build.apiBase}/support/buildImages`,
        createWrapper(payload),
        session.cookieJar
      );
      const outcome = mutationOutcome(response);
      if (!outcome.businessOk) {
        return {
          ok: false,
          session: session.login,
          flowMode,
          endpoint: "/support/buildImages",
          payload,
          versionProbe: generated,
          reason: "release_task_business_failed",
          response: outcome
        };
      }
      return {
        ok: true,
        session: session.login,
        flowMode,
        endpoint: "/support/buildImages",
        payload,
        versionProbe: generated,
        response: outcome
      };
    }

    const requestedImages = options.images || options.buildImages || [];
    const generated = generateImageVersions(session, {
      customerNameEn: options.customerNameEn,
      structureType: options.structureType || "prod",
      codeBranch,
      applicationCode: options.applicationCode,
      laneNamespace: options.laneNamespace,
      extendFlag: options.extendFlag
    }, requestedImages);

    if (!generated.ok) {
      return {
        ok: false,
        session: session.login,
        flowMode,
        reason: generated.reason || "generate_image_version_failed",
        versionProbe: generated
      };
    }

    const payload = {
      customerNameEn: options.customerNameEn,
      applicationCode: options.applicationCode,
      applyBy: session.login.staffCode,
      userNameAuth: session.login.userNameCn,
      branch: codeBranch,
      structureType: options.structureType || "prod",
      deploymentDescribe: options.deploymentDescribe,
      deploymentExplain: options.deploymentExplain,
      envName: options.envName,
      isFeiShu: "0",
      images: requestedImages.map((item) => ({
        imageJenkinsName: item.imageJenkinsName,
        imageVersion: resolvedGeneratedVersion(item, generated),
        imageDeployId: item.imageDeployId
      }))
    };

    if (options.applyId) payload.applyId = options.applyId;
    if (options.canaryNamespaceId) payload.canaryNamespaceId = options.canaryNamespaceId;

    if (!payload.customerNameEn || !payload.applicationCode || !payload.branch || !payload.structureType || !payload.images.length) {
      return {
        ok: false,
        session: session.login,
        reason: "missing_apply_task_params",
        payload
      };
    }

    const response = postJsonViaNode(
      `${platforms.build.apiBase}/support/applyProdStruct`,
      createWrapper(payload),
      session.cookieJar
    );
    const outcome = mutationOutcome(response);
    if (!outcome.businessOk) {
      const duplicateBuildInfo = isDuplicateBuildInfoMessage(outcome.businessMessage);
      const duplicateRecovery = duplicateBuildInfo && options.recoverDuplicateBuildInfo !== false
        ? recoverDuplicateBuildApplyInSession(session, { ...options, codeBranch }, payload.images)
        : null;
      if (duplicateRecovery?.ok) {
        return {
          ok: true,
          session: session.login,
          flowMode,
          endpoint: "/support/applyProdStruct",
          recovered: true,
          payload: duplicateRecovery.payload,
          originalPayload: payload,
          versionProbe: generated,
          response: duplicateRecovery.response,
          duplicateRecovery,
          task: duplicateRecovery.task,
          images: duplicateRecovery.images
        };
      }
      return {
        ok: false,
        session: session.login,
        flowMode,
        endpoint: "/support/applyProdStruct",
        payload,
        versionProbe: generated,
        reason: "apply_task_business_failed",
        duplicateBuildInfo,
        duplicateRecovery,
        response: outcome
      };
    }
    return {
      ok: true,
      session: session.login,
      flowMode,
      endpoint: "/support/applyProdStruct",
      payload,
      versionProbe: generated,
      response: outcome
    };
  } catch (error) {
    return {
      ok: false,
      session: session.login,
      flowMode,
      reason: "request_failed",
      error: error.message
    };
  } finally {
    removeCookieJar(session.cookieJar);
  }
}

function probeBuildApply(credentials, options = {}) {
  const session = loginBuildPlatform(credentials);
  if (!session.ok) return { ok: false, session };

  try {
    const requestedImages = requestedImagesForTaskLookup(options.images || options.buildImages, options.ignoreVersion !== false);
    const applyProbe = listBuildApplyGroups(session, options, requestedImages);
    const firstGroup = applyProbe.groups[0] || null;
    return {
      ok: true,
      session: session.login,
      payload: {
        applyId: options.applyId || options.taskId || options.structureApplyId,
        customerNameEn: options.customerNameEn,
        applicationCode: options.applicationCode,
        codeBranch: options.codeBranch,
        envType: options.envType || options.codeBranch
      },
      task: firstGroup?.task || null,
      images: firstGroup?.images || [],
      groups: applyProbe.groups,
      rowsChecked: applyProbe.rowsChecked,
      total: applyProbe.total,
      totalPages: applyProbe.totalPages,
      pagesFetched: applyProbe.pagesFetched,
      hasMore: applyProbe.hasMore,
      statusCandidates: applyProbe.statusCandidates,
      pageSummaries: applyProbe.pageSummaries,
      response: applyProbe.response
    };
  } catch (error) {
    return {
      ok: false,
      session: session.login,
      reason: "request_failed",
      error: error.message
    };
  } finally {
    removeCookieJar(session.cookieJar);
  }
}

function executeBuildPlatformPublish(credentials, options = {}) {
  const session = loginBuildPlatform(credentials);
  if (!session.ok) return { ok: false, session };

  const payload = {
    applyId: options.applyId || options.taskId || options.structureApplyId,
    processorUserId: session.login.staffCode,
    environment: options.environment || options.publishEnvironment
  };

  if (!payload.applyId || payload.environment == null || payload.environment === "") {
    removeCookieJar(session.cookieJar);
    return {
      ok: false,
      session: session.login,
      reason: "missing_build_platform_publish_params",
      payload
    };
  }

  try {
    const response = postJsonViaNode(
      `${platforms.build.apiBase}/support/confirmPublish`,
      createWrapper(payload),
      session.cookieJar
    );
    const outcome = looseMutationOutcome(response);
    if (!outcome.businessOk) {
      return {
        ok: false,
        session: session.login,
        payload,
        reason: "build_platform_publish_business_failed",
        response: outcome
      };
    }
    return {
      ok: true,
      session: session.login,
      payload,
      response: outcome
    };
  } catch (error) {
    return {
      ok: false,
      session: session.login,
      payload,
      reason: "request_failed",
      error: error.message
    };
  } finally {
    removeCookieJar(session.cookieJar);
  }
}

function listBuildTasks(credentials, options = {}) {
  const session = loginBuildPlatform(credentials);
  if (!session.ok) return { ok: false, session };

    const payload = options.releaseTaskId
      ? { releaseTaskId: options.releaseTaskId }
      : {
          customerNameEn: options.customerNameEn,
          applicationCode: options.applicationCode,
          envType: options.envType || options.codeBranch,
          codeBranch: options.codeBranch,
          imageJenkinsName: options.imageJenkinsName,
          imageNameEn: options.imageNameEn,
          imageVersion: options.imageVersion,
          status: options.taskStatus || options.status || "0",
          pageNumber: options.taskPageNumber || 1,
          pageSize: options.taskPageSize || 20
        };
  Object.keys(payload).forEach((key) => {
    if (payload[key] == null || payload[key] === "") delete payload[key];
  });

  if (!options.releaseTaskId && (!payload.customerNameEn || !payload.applicationCode || !payload.codeBranch)) {
    removeCookieJar(session.cookieJar);
    return {
      ok: false,
      session: session.login,
      reason: "missing_task_query_params",
      payload
    };
  }

  try {
    const requestedImages = requestedImagesForTaskLookup(options.images || options.buildImages, options.ignoreVersion);
    let pendingApplyProbe = {
      groups: [],
      rowsChecked: 0,
      response: null
    };
    let pendingApplyError = null;
    try {
      pendingApplyProbe = listPendingBuildApplyGroups(session, options, requestedImages);
    } catch (error) {
      pendingApplyError = {
        reason: "pending_apply_lookup_failed",
        error: error.message
      };
    }

    const taskResponse = postJsonViaNode(
      `${platforms.build.apiBase}/support/selectBuildTask`,
      createWrapper(payload),
      session.cookieJar
    );
    const tasksObject = objectOf(taskResponse);
    const taskRows = arrayOf(tasksObject);
    const taskPageNumber = Math.max(Number(options.taskPageNumber || 1), 1);
    const taskPageSize = Math.max(Number(options.taskPageSize || 20), 1);
    const taskTotal = Number(tasksObject && tasksObject.total) || taskRows.length;
    const maxImageLookups = Math.min(
      Math.max(Number(options.maxTaskImageLookups || (options.imageJenkinsName || options.imageNameEn || options.imageVersion ? 10 : 1)), 1),
      taskRows.length
    );
    let firstTaskImages = pendingApplyProbe.groups[0]?.images || [];
    let matchedTask = pendingApplyProbe.groups[0]?.task || null;
    let matchedTaskImages = pendingApplyProbe.groups[0]?.images || [];
    let matchedImage = pendingApplyProbe.groups[0]
      ? compactObject(findBuildImage(pendingApplyProbe.groups[0].images, options) || pendingApplyProbe.groups[0].images[0])
      : null;
    const taskImagesByTask = [...pendingApplyProbe.groups];

    for (const task of taskRows.slice(0, maxImageLookups)) {
      const taskId = firstPrimitive(task, ["id", "taskId", "buildTaskId"]);
      if (!taskId) continue;
      const infoResponse = postJsonViaNode(
        `${platforms.build.apiBase}/support/selectBuildInfoList`,
        createWrapper({ taskId, staffCode: session.login.staffCode }),
        session.cookieJar
      );
      const rawImages = arrayOf(objectOf(infoResponse));
      const imageRows = rawImages.map(compactObject);
      if (!firstTaskImages.length) firstTaskImages = imageRows;
      const compactTask = {
        ...compactBuildTask(task),
        reuseBlockedReason: "非待处理构建申请，不作为复用候选"
      };
      taskImagesByTask.push({
        taskId,
        task: compactTask,
        images: imageRows
      });

      const candidate = findBuildImage(rawImages, options);
      const groupMatched = exactRequestedImageGroup(rawImages, requestedImages) && !taskPublishStage(compactTask);
      if (candidate && !matchedImage) {
        matchedTaskImages = imageRows;
        matchedImage = compactObject(candidate);
      }
      if (groupMatched && !matchedTask) {
        matchedTask = compactTask;
        matchedTaskImages = imageRows;
      }
    }

    return {
      ok: true,
      session: session.login,
      payload,
      tasks: [
        ...pendingApplyProbe.groups.map((group) => group.task),
        ...taskRows.map(compactBuildTask)
      ],
      taskPage: {
        pageNumber: taskPageNumber,
        pageSize: taskPageSize,
        total: taskTotal,
        returned: taskRows.length,
        hasMore: taskPageNumber * taskPageSize < taskTotal,
        serverPaged: true
      },
      firstTaskImages,
      taskImagesByTask,
      matchedTask,
      matchedTaskImages,
      matchedImage,
      pendingApplyProbe: {
        groups: pendingApplyProbe.groups.length,
        rowsChecked: pendingApplyProbe.rowsChecked,
        total: pendingApplyProbe.total,
        pagesFetched: pendingApplyProbe.pagesFetched,
        hasMore: pendingApplyProbe.hasMore,
        error: pendingApplyError
      },
      response: responseSummary(taskResponse)
    };
  } catch (error) {
    return {
      ok: false,
      session: session.login,
      payload,
      reason: "request_failed",
      error: error.message
    };
  } finally {
    removeCookieJar(session.cookieJar);
  }
}

function verifyTaskBuildPermission(credentials, options = {}) {
  const session = loginBuildPlatform(credentials);
  if (!session.ok) return { ok: false, session };

  const taskId = options.taskId;
  const applyId = options.applyId;
  if (!taskId && !applyId) {
    removeCookieJar(session.cookieJar);
    return {
      ok: false,
      session: session.login,
      reason: "missing_task_identity"
    };
  }

  try {
    let pendingApplyGroup = null;
    if (applyId) {
      const requestedImages = requestedImagesFromPermissionOptions(options);
      const applyProbe = listBuildApplyGroups(session, {
        ...options,
        applyId,
        status: "0",
        maxApplyPages: 1,
        maxPendingApplyPages: 1
      }, requestedImages);
      pendingApplyGroup = applyProbe.groups.find((group) => String(group.taskId) === String(applyId)) || null;
      if (!pendingApplyGroup) {
        return {
          ok: false,
          session: session.login,
          reason: "apply_not_pending",
          message: "申请单不在待处理任务中，不能复用或构建。",
          applyId,
          applyProbe: {
            rowsChecked: applyProbe.rowsChecked,
            groups: applyProbe.groups.length,
            pagesFetched: applyProbe.pagesFetched,
            hasMore: applyProbe.hasMore
          }
        };
      }
    }

    if (applyId && (options.buildAll || options.pendingApply || !taskId)) {
      const imageRows = pendingApplyGroup?.images || [];
      const requestedImages = requestedImagesFromPermissionOptions(options);
      const matchedImages = findBuildImagesForRequests(imageRows, requestedImages);
      const missingImages = requestedImages.filter((_, index) => !matchedImages[index]);

      if (missingImages.length) {
        return {
          ok: false,
          session: session.login,
          reason: "apply_image_not_found",
          applyId,
          imageCount: imageRows.length,
          missingImages
        };
      }

      const deniedImages = matchedImages.filter((item) => item && !isBuildPowerEnabled(item.buildPower));
      if (deniedImages.length) {
        return {
          ok: false,
          session: session.login,
          reason: "apply_image_build_power_denied",
          applyId,
          images: deniedImages.map(compactObject)
        };
      }

      return {
        ok: true,
        session: session.login,
        applyId,
        pendingApply: true,
        image: compactObject(matchedImages[0]),
        images: matchedImages.map(compactObject),
        imageCount: matchedImages.length
      };
    }

    let resolvedTaskId = taskId;
    let taskRows = [];
    if (!resolvedTaskId) {
      const taskResponse = postJsonViaNode(
        `${platforms.build.apiBase}/support/selectBuildTask`,
        createWrapper({
          customerNameEn: options.customerNameEn,
          applicationCode: options.applicationCode,
          envType: options.envType || options.codeBranch,
          codeBranch: options.codeBranch
        }),
        session.cookieJar
      );
      taskRows = arrayOf(objectOf(taskResponse));
      const matchedTask = taskRows.find((item) => item.structureApplyId === applyId);
      resolvedTaskId = matchedTask && matchedTask.id;
      if (!resolvedTaskId) {
        return {
          ok: false,
          session: session.login,
          reason: "task_not_found_for_apply_id",
          applyId,
          tasksChecked: taskRows.length
        };
      }
    }

    const infoResponse = postJsonViaNode(
      `${platforms.build.apiBase}/support/selectBuildInfoList`,
      createWrapper({ taskId: resolvedTaskId, staffCode: session.login.staffCode }),
      session.cookieJar
    );
    const imageRows = arrayOf(objectOf(infoResponse));
    const matchedImage = imageRows.find((item) =>
      item.imageJenkinsName === options.imageJenkinsName &&
      (!options.imageVersion || item.imageVersion === options.imageVersion)
    );

    if (!matchedImage) {
      return {
        ok: false,
        session: session.login,
        reason: "task_image_not_found",
        taskId: resolvedTaskId,
        imageCount: imageRows.length
      };
    }

    if (!isBuildPowerEnabled(matchedImage.buildPower)) {
      return {
        ok: false,
        session: session.login,
        reason: "task_image_build_power_denied",
        taskId: resolvedTaskId,
        image: compactObject(matchedImage)
      };
    }

    return {
      ok: true,
      session: session.login,
      taskId: resolvedTaskId,
      image: compactObject(matchedImage)
    };
  } catch (error) {
    return {
      ok: false,
      session: session.login,
      reason: "request_failed",
      error: error.message
    };
  } finally {
    removeCookieJar(session.cookieJar);
  }
}

function probeBuildPlatform(credentials, options = {}) {
  const session = loginBuildPlatform(credentials);
  if (!session.ok) return { ok: false, session };
  const customerNameEn = options.customerNameEn || "demo-customer-a";
  const fast = options.fast !== false;

  try {
    let menu = [];
    let customerList = [];
    let customerApplications;
    let myAppObject = null;
    let authObject = {};
    try {
      customerApplications = fetchCustomerApplications(session, customerNameEn);
    } catch (error) {
      customerApplications = {
        count: 0,
        rows: [],
        source: "COMMON_SELECT_CUSTOMER_APP_LIST_SAGA",
        endpoint: "/support/findCustomerAppList",
        ...classifyRequestError(error)
      };
    }
    if (!fast) {
      const tree = postJsonViaNode(
        `${platforms.build.apiBase}/authority/getTreeList`,
        createWrapper({
          token: session.token,
          appId: platforms.build.appId,
          dimenCode: "System",
          deviceType: "pc"
        }),
        session.cookieJar
      );
      const authority = postJsonViaNode(
        `${platforms.build.apiBase}/authority/getAuthorityByAppId`,
        createWrapper({ token: session.token, appId: platforms.build.appId }),
        session.cookieJar
      );
      const customers = postJsonViaNode(`${platforms.build.apiBase}/support/findCustomerList`, createWrapper({}), session.cookieJar);
      const myApps = postJsonViaNode(
        `${platforms.build.apiBase}/support/myApplicationListPage`,
        createWrapper({ customerNameEn, pageNumber: 1, pageSize: 15 }),
        session.cookieJar
      );
      menu = flattenMenu(objectOf(tree));
      customerList = arrayOf(objectOf(customers));
      myAppObject = objectOf(myApps);
      authObject = objectOf(authority) || {};
    }

    return {
      ok: true,
      session: session.login,
      platform: platforms.build,
      fast,
      menu: menu.filter((item) => /构建|服务|应用|系统|jenkins|harbor|hanbor/i.test(`${item.path} ${item.url || ""}`)),
      permissions: arrayOf(authObject.authList).map((item) => ({
        name: item.permissionsName,
        code: item.permissionsCode,
        checked: item.checked
      })),
      customers: {
        count: customerList.length,
        matched: customerList
          .filter((item) => JSON.stringify(item).includes(customerNameEn))
          .map(compactObject)
      },
      customerApplications,
      apps: {
        ...customerApplications,
        note: "兼容旧字段：这里是客户维度应用列表，不是空参全局应用字典。"
      },
      myApplications: {
        total: myAppObject && myAppObject.total,
        rows: arrayOf(myAppObject).map(compactObject),
        note: fast ? "Fast refresh skipped myApplicationListPage; service list uses the original selectPublishMicroServiceInfo pageNumber/pageSize/imageJenkinsName payload." : "The real page dispatch payload should still be captured; this probe uses pageSize=15 from reducer defaults."
      },
      serviceDiscovery: discoverApplicationServices(session, {
        customerNameEn,
        applicationCodes: options.applicationCodes,
        codeBranch: options.codeBranch,
        serviceSearch: options.serviceSearch,
        servicePageNumber: options.servicePageNumber,
        servicePageSize: options.servicePageSize
      })
    };
  } catch (error) {
    return {
      ok: false,
      session: session.login,
      platform: platforms.build,
      ...classifyRequestError(error)
    };
  } finally {
    removeCookieJar(session.cookieJar);
  }
}

function loginReleasePlatform({ username, password, envPasswordKey }) {
  const resolvedPassword = resolvePassword({ password, envPasswordKey });
  if (!username || !resolvedPassword) {
    return { ok: false, reason: "missing_credentials" };
  }

  const cacheKey = sessionCacheKey("release", username, resolvedPassword);
  const cached = getCachedSession(cacheKey);
  if (cached) return cached;

  const cookieJar = createCookieJar("workbench-release", cacheKey);
  try {
    const login = postJsonViaNode(
      `${platforms.releaseShell.apiBase}/authority/login`,
      createWrapper({
        account: username,
        password: sha256Hex(resolvedPassword),
        deviceType: "pc",
        appId: ""
      }),
      cookieJar,
      releaseRequestOptions
    );
    const loginObject = objectOf(login);
    const token = loginObject && loginObject.loginToken;
    const failureMessage = token ? null : loginFailureMessage(platforms.releaseShell.label, login, loginObject);
    const rawFailureMessage = token ? null : rawLoginFailureMessage(login, loginObject);

    const session = {
      ok: Boolean(token),
      cookieJar,
      token,
      reason: token ? undefined : "release_login_failed",
      message: failureMessage,
      login: {
        httpStatus: login.httpStatus,
        status: login.json && login.json.status,
        objectStatus: loginObject && loginObject.status,
        error: login.json && login.json.error,
        message: token ? login.json && login.json.message : failureMessage,
        rawMessage: rawFailureMessage,
        tokenPreview: maskToken(token),
        userNameCn: loginObject && loginObject.userNameCn,
        staffCode: loginObject && loginObject.staffCode
      }
    };
    if (!session.ok) removeCookieJar(cookieJar);
    return rememberSession(cacheKey, session);
  } catch (error) {
    removeCookieJar(cookieJar);
    return {
      ok: false,
      ...classifyRequestError(error, releaseRequestOptions)
    };
  }
}

function mapReleaseCard(card) {
  const customer = card.customerEnvironment && card.customerEnvironment.customer;
  const environment = card.customerEnvironment && card.customerEnvironment.environment;
  return {
    customerEnvKey: card.customerEnvKey,
    customer: customer && {
      customerNameCh: customer.customerNameCh,
      customerNameEn: customer.customerNameEn,
      customerCodeAbbreviation: customer.customerCodeAbbreviation
    },
    environment: environment && {
      id: environment.id,
      showName: environment.showName,
      showNameEn: environment.showNameEn,
      environmentFlag: environment.environmentFlag,
      companyAddress: environment.companyAddress,
      spotAddress: environment.spotAddress,
      publishNum: environment.publishNum,
      crossVersionNum: environment.crossVersionNum
    },
    apps: (card.apps || []).map((app) => ({
      applicationName: app.applicationName,
      applicationCode: app.applicationCode,
      applicationVersion: app.applicationVersion,
      spotAppVersion: app.spotAppVersion,
      toPublishServiceNum: app.toPublishServiceNum,
      publishStatus: app.publishStatus,
      thirdApp: app.thirdApp,
      createTime: app.createTime
    }))
  };
}

function probeReleasePlatform(credentials, options = "demo-customer-a") {
  const probeOptions = typeof options === "string" ? { customerNameEn: options } : (options || {});
  const customerNameEn = probeOptions.customerNameEn || "demo-customer-a";
  const fast = probeOptions.fast !== false;
  const session = loginReleasePlatform(credentials);
  if (!session.ok) return { ok: false, session, reason: session.reason, message: session.message || session.login && session.login.message };

  try {
    let customers = null;
    let apps = null;
    if (!fast) {
      customers = postJsonViaNode(`${platforms.releaseApi.apiBase}/cloud/getCustomerListAuth`, createWrapper({}), session.cookieJar, releaseRequestOptions);
      apps = postJsonViaNode(`${platforms.releaseApi.apiBase}/cloud/getCustomerAppListAuth`, createWrapper({}), session.cookieJar, releaseRequestOptions);
    }
    const overview = postJsonViaNode(
      `${platforms.releaseApi.apiBase}/cloud/publishOverviewList`,
      createWrapper({
        customerNameEn,
        userId: session.login.staffCode
      }),
      session.cookieJar,
      releaseRequestOptions
    );

    const customerList = customers ? arrayOf(objectOf(customers)) : [];
    const appList = apps ? arrayOf(objectOf(apps)) : [];
    const overviewList = arrayOf(objectOf(overview));

    return {
      ok: true,
      session: session.login,
      fast,
      platform: {
        shell: platforms.releaseShell,
        api: platforms.releaseApi
      },
      customers: {
        count: customerList.length,
        matched: customerList
          .filter((item) => JSON.stringify(item).includes(customerNameEn))
          .map(compactObject)
      },
      apps: {
        count: appList.length
      },
      environments: overviewList.map(mapReleaseCard)
    };
  } catch (error) {
    return {
      ok: false,
      session: session.login,
      platform: {
        shell: platforms.releaseShell,
        api: platforms.releaseApi
      },
      ...classifyRequestError(error, releaseRequestOptions)
    };
  } finally {
    removeCookieJar(session.cookieJar);
  }
}

function getCurrentAppPublishDetail(credentials, options = {}) {
  const session = loginReleasePlatform(credentials);
  if (!session.ok) return { ok: false, session, reason: session.reason, message: session.message || session.login && session.login.message };

  const payload = {
    customerNameEn: options.customerNameEn,
    showNameEn: options.showNameEn,
    environmentFlag: options.environmentFlag,
    applicationCode: options.applicationCode,
    applicationVersion: options.applicationVersion
  };

  if (!payload.customerNameEn || !payload.showNameEn || !payload.environmentFlag || !payload.applicationCode || !payload.applicationVersion) {
    removeCookieJar(session.cookieJar);
    return {
      ok: false,
      session: session.login,
      reason: "missing_publish_detail_params"
    };
  }

  try {
    const response = postJsonViaNode(
      `${platforms.releaseApi.apiBase}/cloud/getCurrentAppPublishDetail`,
      createWrapper(payload),
      session.cookieJar,
      releaseRequestOptions
    );
    return {
      ok: true,
      session: session.login,
      payload,
      detail: compactObject(objectOf(response)),
      raw: objectOf(response)
    };
  } catch (error) {
    return {
      ok: false,
      blocked: true,
      session: session.login,
      payload,
      ...classifyRequestError(error, releaseRequestOptions)
    };
  } finally {
    removeCookieJar(session.cookieJar);
  }
}

function executePublishApps(credentials, options = {}) {
  const session = loginReleasePlatform(credentials);
  if (!session.ok) return { ok: false, session, reason: session.reason, message: session.message || session.login && session.login.message };

  const payload = {
    userId: session.login.staffCode,
    customerNameEn: options.customerNameEn,
    showNameEn: options.showNameEn,
    environment: options.environment || "company",
    environmentFlag: options.environmentFlag,
    publishApps: (options.publishApps || []).map((item) => ({
      applicationCode: item.applicationCode,
      applicationVersion: item.applicationVersion
    }))
  };

  if (!payload.customerNameEn || !payload.showNameEn || !payload.environmentFlag || !payload.publishApps.length) {
    removeCookieJar(session.cookieJar);
    return {
      ok: false,
      session: session.login,
      reason: "missing_publish_params"
    };
  }

  try {
    const response = postJsonViaNode(
      `${platforms.releaseApi.apiBase}/cloud/publishApps`,
      createWrapper(payload),
      session.cookieJar,
      releaseRequestOptions
    );
    const outcome = publishAppsAcceptedOutcome(response);
    if (!outcome.businessOk) {
      return {
        ok: false,
        blocked: true,
        session: session.login,
        payload,
        reason: "publish_business_failed",
        message: businessFailureMessage("发布请求", outcome),
        response: outcome
      };
    }
    const rate = waitPublishAppsRate(session, payload, {
      maxAttempts: options.publishRateMaxAttempts,
      intervalMs: options.publishRateIntervalMs
    });
    if (!rate.ok) {
      return {
        ok: false,
        blocked: true,
        session: session.login,
        payload,
        reason: rate.reason,
        message: rate.message,
        response: outcome,
        publishRate: rate
      };
    }
    return {
      ok: true,
      session: session.login,
      payload,
      response: outcome,
      publishRate: rate
    };
  } catch (error) {
    return {
      ok: false,
      session: session.login,
      payload,
      ...classifyRequestError(error, releaseRequestOptions)
    };
  } finally {
    removeCookieJar(session.cookieJar);
  }
}

module.exports = {
  createWrapper,
  executeBuildPlatformPublish,
  executeBuildImages,
  executeBuildTask,
  executePublishApps,
  discoverBuildWorkflowCustomers,
  getCurrentAppPublishDetail,
  probeBuildApply,
  listBuildTasks,
  probeImageVersion,
  probeStructureTypeConfigs,
  probeBuildPlatform,
  probeBuildServiceDetail,
  probeBuildLog,
  probeReleasePlatform,
  verifyTaskBuildPermission
};
module.exports._internals = {
  boundedPageCount,
  classifyRequestError,
  exactRequestedImageGroup,
  buildApplyRowMatches,
  buildApplyStatusCandidates,
  duplicateBuildApplyStatusCandidates,
  isBuildPowerEnabled,
  listBuildApplyGroups,
  listDuplicateBuildApplyGroups,
  recoverableDuplicateBuildApplyGroup,
  buildRecoveryEditImages,
  requestedImagesForTaskLookup,
  requestedImagesFromPermissionOptions,
  isDuplicateBuildInfoMessage,
  taskPublishStage,
  loginFailureMessage,
  rawLoginFailureMessage,
  businessFailureMessage,
  isSuccessLikePlatformMessage,
  publishAppsAcceptedOutcome,
  publishRateSignal,
  normalizeCustomerApplicationRows,
  serviceRowMatchesQuery,
  waitPublishAppRate,
  waitPublishAppsRate
};
