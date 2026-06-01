export const PIPELINE_RUN_HISTORY_KEY = "pipeline-run-history-v1";
export const PIPELINE_RUN_HISTORY_LIMIT = 30;
export const DEFAULT_RELEASE_REASON = "功能更新";
export const DEFAULT_RELEASE_NOTICE = "测试";
export const RUNNING_STALE_AFTER_MS = 60 * 60 * 1000;

const TERMINAL_SUCCESS = new Set(["done", "cancelled"]);
const RESUMABLE_STATUS = new Set(["draft", "blocked", "failed"]);
const BAD_STATUS_PRIORITY = ["failed", "blocked", "running"];
const SERVICE_ROW_PIPELINE_IDS = ["build-and-release", "build-only"];

function nowIso() {
  return new Date().toISOString();
}

function cloneJson(value, fallback) {
  if (value == null) return fallback;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return fallback;
  }
}

function epochMs(value) {
  const date = new Date(value || "");
  const time = date.getTime();
  return Number.isFinite(time) ? time : 0;
}

function isStaleRunningRecord(record = {}, nowMs = Date.now()) {
  if (record.status !== "running") return false;
  const lastTouched = epochMs(record.updatedAt || record.createdAt);
  return lastTouched > 0 && nowMs - lastTouched >= RUNNING_STALE_AFTER_MS;
}

function normalizeStaleRunningRecord(record = {}) {
  if (!isStaleRunningRecord(record)) return record;
  const outcomes = cloneJson(record.outcomes || {}, {});
  for (const [id, outcome] of Object.entries(outcomes)) {
    if (outcome?.status === "running") {
      outcomes[id] = {
        ...outcome,
        status: "blocked",
        detail: outcome.detail
          ? `${outcome.detail}；历史 Run 长时间未更新，已转为可继续状态。`
          : "历史 Run 长时间未更新，已转为可继续状态。"
      };
    }
  }
  return {
    ...record,
    status: "blocked",
    phase: record.phase || "等待处理",
    outcomes,
    activity: [{
      at: nowIso(),
      title: "Pipeline 状态修复",
      detail: "历史 Run 长时间停留在 running，已转为暂停，可从当前阶段继续。",
      tone: "warning"
    }, ...asArray(record.activity || [])].slice(0, 120)
  };
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function serviceName(service = {}) {
  return service.imageJenkinsName || service.imageNameEn || service.serviceNameEn || service.serviceName || "unknown-service";
}

function selectedServicesText(services = []) {
  const names = asArray(services).map(serviceName).filter(Boolean);
  return names.join(" / ");
}

export function releaseStagesFor(branch) {
  if (branch === "develop") return [];
  if (branch === "master") return ["company", "spot"];
  return ["spot"];
}

export function releaseRequired(branch) {
  return releaseStagesFor(branch).length > 0;
}

export function releaseStageLabel(stage) {
  return stage === "company" ? "公司发布" : "现场发布";
}

export function releasePlanText(branch) {
  const stages = releaseStagesFor(branch);
  if (!stages.length) return "发布跳过";
  return stages.map(releaseStageLabel).join(" + ");
}

function normalizeMasterStrategy(strategy) {
  return strategy === "hotfix" ? "hotfix" : "prod";
}

export function buildMode(branch, strategy = "prod") {
  if (branch === "develop") return { mode: "direct", label: "开发直构建", structureType: null };
  if (branch === "release") return { mode: "release-task", label: "提测申请+构建", structureType: "release" };
  if (branch === "master") {
    const structureType = normalizeMasterStrategy(strategy);
    return {
      mode: "apply-task",
      label: structureType === "hotfix" ? "Hotfix 申请+构建" : "生产申请+构建",
      structureType
    };
  }
  return { mode: "apply-task", label: "申请+构建", structureType: "prod" };
}

function firstStatus(outcomes, ids, statuses = BAD_STATUS_PRIORITY) {
  for (const status of statuses) {
    const id = ids.find((item) => outcomes[item]?.status === status);
    if (id) return { status, outcome: outcomes[id], id };
  }
  return null;
}

function buildPhaseStatus(record = {}) {
  const outcomes = record.outcomes || {};
  const fatal = firstStatus(outcomes, ["build", "build-observe", "build-platform-publish", "build-task", "create-task", "version", "build-status"], ["failed", "blocked"]);
  if (fatal) return fatal.status;
  if (outcomes["build-observe"]?.status) return outcomes["build-observe"].status;
  if (record.status === "done" && (record.templateId === "build-only" || outcomes.release?.status === "done")) return "done";
  const active = firstStatus(outcomes, ["build", "build-platform-publish", "build-task", "create-task", "version", "build-status"], ["running"]);
  if (active) return "running";
  if (outcomes.build?.status === "done") return "running";
  if (outcomes["create-task"]?.status === "done" || outcomes["build-task"]?.status === "done" || outcomes.version?.status === "done") return "running";
  return "pending";
}

function publishStageStatus(outcomes = {}, stage) {
  return outcomes[`publish-${stage}`]?.status || "pending";
}

function releasePhaseStatus(record = {}) {
  const branch = record.target?.branch || "";
  if (!releaseRequired(branch)) return "done";
  const outcomes = record.outcomes || {};
  const fatal = firstStatus(outcomes, ["release", "release-observe", "release-detail", "publish-company", "publish-spot"], ["failed", "blocked"]);
  if (fatal) return fatal.status;
  if (outcomes["release-observe"]?.status && outcomes["release-observe"].status !== "done") return outcomes["release-observe"].status;
  const stages = releaseStagesFor(branch);
  const stageStatuses = stages.map((stage) => publishStageStatus(outcomes, stage));
  const hasStageEvidence = stages.some((stage) => outcomes[`publish-${stage}`]?.status);
  if (stageStatuses.length && stageStatuses.every((status) => status === "done")) return "done";
  if (outcomes.release?.status === "done" && !hasStageEvidence) return "done";
  if (stageStatuses.some((status) => status === "running")) return "running";
  if (outcomes["release-detail"]?.status === "done" && stageStatuses.some((status) => status === "done")) return "running";
  if (outcomes["release-detail"]?.status === "done") return "pending";
  return outcomes["release-observe"]?.status === "done" ? "pending" : "pending";
}

export function phaseCardsForRunRecord(record = {}, options = {}) {
  const branch = record.target?.branch || options.branch || "";
  const flow = buildMode(branch, record.target?.buildStrategy || options.buildStrategy || "prod");
  const serviceText = record.serviceSnapshot?.length ? selectedServicesText(record.serviceSnapshot) : options.selectedLabel || "";
  const completed = record.status === "done";
  const probeStatus = completed ? "done" : record.outcomes?.probe?.status || (options.buildProbeOk ? "done" : "pending");
  const probeValue = completed
    ? "历史已完成"
    : options.buildProbeOk || record.outcomes?.probe?.status === "done"
      ? "平台已读"
      : "待刷新";
  return [
    { id: "target", label: "服务目标", status: record.serviceSnapshot?.length || serviceText ? "done" : "pending", value: serviceText },
    { id: "probe", label: "探测", status: probeStatus, value: probeValue },
    { id: "build", label: "构建", status: buildPhaseStatus(record), value: flow.label },
    { id: "release", label: "发布", status: releasePhaseStatus(record), value: releasePlanText(branch) }
  ];
}

export function progressForPhaseCards(cards = []) {
  if (!cards.length) return 0;
  return Math.round((cards.filter((item) => item.status === "done").length / cards.length) * 100);
}

export function toggleExpandedRunIds(ids = [], id) {
  if (!id) return asArray(ids);
  const current = asArray(ids);
  return current.includes(id)
    ? current.filter((item) => item !== id)
    : [...current, id];
}

export function serviceRowPipelineIds() {
  return [...SERVICE_ROW_PIPELINE_IDS];
}

export function releasePendingSummary({ releaseNeeded, releaseProbeOk, releaseApp }) {
  if (!releaseNeeded) return { text: "开发环境无发布段", variant: "success" };
  if (!releaseProbeOk) return { text: "发布平台待探测", variant: "warning" };
  if (!releaseApp) return { text: "当前应用无发布记录", variant: "outline" };
  const count = Number(releaseApp.toPublishServiceNum || 0);
  if (count <= 0) return { text: "发布平台无待处理服务", variant: "success" };
  return { text: `发布平台待处理 ${count} 个服务`, variant: "warning" };
}

function normalizeTarget(target = {}) {
  return {
    profileId: target.profileId || "",
    accountId: target.accountId || "",
    customerNameEn: target.customerNameEn || "",
    appCode: target.appCode || target.applicationCode || "",
    branch: target.branch || target.codeBranch || "",
    buildStrategy: target.buildStrategy || "prod",
    releaseEnvId: target.releaseEnvId || target.environmentId || "",
    releaseEnvLabel: target.releaseEnvLabel || target.environmentLabel || ""
  };
}

export function normalizePipelineRunRecord(record = {}) {
  const timestamp = nowIso();
  const source = normalizeStaleRunningRecord(record);
  const createdAt = record.createdAt || timestamp;
  const updatedAt = record.updatedAt || createdAt;
  return {
    id: source.id || createdAt,
    copiedFromRunId: source.copiedFromRunId || "",
    createdAt,
    updatedAt,
    completedAt: source.completedAt || "",
    started: source.started !== false,
    templateId: source.templateId || "build-and-release",
    status: source.status || "draft",
    phase: source.phase || "待选择",
    target: normalizeTarget(source.target),
    releaseReason: source.releaseReason || DEFAULT_RELEASE_REASON,
    releaseNotice: source.releaseNotice || DEFAULT_RELEASE_NOTICE,
    serviceSnapshot: cloneJson(asArray(source.serviceSnapshot), []),
    buildSnapshot: cloneJson(source.buildSnapshot, null),
    outcomes: cloneJson(source.outcomes || {}, {}),
    activity: cloneJson(asArray(source.activity), []).slice(0, 120),
    resumeStage: source.resumeStage || inferResumeStage(source)
  };
}

export function upsertPipelineRunRecord(records, record, options = {}) {
  const limit = options.limit || PIPELINE_RUN_HISTORY_LIMIT;
  const incoming = normalizePipelineRunRecord(record);
  const existing = asArray(records).find((item) => item.id === incoming.id);
  const merged = existing
    ? {
        ...existing,
        ...incoming,
        createdAt: incoming.createdAt || existing.createdAt,
        updatedAt: incoming.updatedAt || nowIso()
      }
    : incoming;
  return [
    merged,
    ...asArray(records).filter((item) => item.id !== incoming.id)
  ]
    .sort((left, right) => String(right.updatedAt || right.createdAt).localeCompare(String(left.updatedAt || left.createdAt)))
    .slice(0, limit);
}

export function canResumePipelineRun(record = {}) {
  if (TERMINAL_SUCCESS.has(record.status)) return false;
  if (RESUMABLE_STATUS.has(record.status)) return true;
  return Object.values(record.outcomes || {}).some((outcome) => RESUMABLE_STATUS.has(outcome?.status));
}

export function inferResumeStage(record = {}) {
  const outcomes = record.outcomes || {};
  const hasOutcome = (...ids) => ids.some((id) => Boolean(outcomes[id]));
  const hasBadOutcome = (...ids) => ids.some((id) => {
    const status = outcomes[id]?.status;
    return status === "blocked" || status === "failed" || status === "running";
  });

  if (hasBadOutcome("release", "release-observe", "release-detail", "publish-company", "publish-spot")) return "release";
  if (outcomes.release?.status === "done") return "complete";
  if (record.buildSnapshot && (outcomes.build?.status === "done" || hasOutcome("build-observe", "build-platform-publish"))) return "release";
  if (hasBadOutcome("build", "build-observe", "build-platform-publish", "build-task", "create-task", "version", "build-status")) return "build";
  if (outcomes["create-task"]?.status === "done" || outcomes["build-task"]?.status === "done") return "build";
  if (hasBadOutcome("probe")) return "prepare";
  return record.status === "done" ? "complete" : "start";
}

export function clonePipelineRunDraft(record = {}) {
  const normalized = normalizePipelineRunRecord(record);
  return {
    templateId: normalized.templateId,
    target: normalized.target,
    releaseReason: normalized.releaseReason,
    releaseNotice: normalized.releaseNotice,
    serviceSnapshot: cloneJson(normalized.serviceSnapshot, [])
  };
}

export function clonePipelineRunRecord(record = {}, options = {}) {
  const normalized = normalizePipelineRunRecord(record);
  const now = options.now || nowIso();
  const id = options.id || `${Date.now()}`;
  return normalizePipelineRunRecord({
    id,
    copiedFromRunId: normalized.id,
    createdAt: now,
    updatedAt: now,
    completedAt: "",
    started: false,
    templateId: normalized.templateId,
    status: "draft",
    phase: "已复制",
    target: normalized.target,
    releaseReason: normalized.releaseReason,
    releaseNotice: normalized.releaseNotice,
    serviceSnapshot: cloneJson(normalized.serviceSnapshot, []),
    buildSnapshot: null,
    outcomes: {},
    activity: [{
      at: now,
      title: "Pipeline 已复制",
      detail: `复制自 Run ${normalized.id}`,
      tone: "default"
    }],
    resumeStage: "start"
  });
}

export function restorePipelineRunHistory(storage) {
  if (!storage) return [];
  try {
    const parsed = JSON.parse(storage.getItem(PIPELINE_RUN_HISTORY_KEY) || "[]");
    return asArray(parsed).map(normalizePipelineRunRecord).slice(0, PIPELINE_RUN_HISTORY_LIMIT);
  } catch {
    return [];
  }
}

export function savePipelineRunHistory(storage, records) {
  if (!storage) return;
  storage.setItem(
    PIPELINE_RUN_HISTORY_KEY,
    JSON.stringify(asArray(records).map(normalizePipelineRunRecord).slice(0, PIPELINE_RUN_HISTORY_LIMIT))
  );
}
