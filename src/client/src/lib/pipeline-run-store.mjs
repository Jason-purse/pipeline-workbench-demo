import { createFlowContract } from "./pipeline-flow-contract.mjs";
import { buildPipelineRun } from "./pipeline-run-builder.mjs";
import {
  applyCommandEventToMemento,
  createPipelineRunMemento,
  normalizePipelineRunMemento,
  resumePointFromMemento
} from "./pipeline-run-memento.mjs";

export const PIPELINE_RUN_HISTORY_KEY = "pipeline-run-history-v2";
export const PIPELINE_RUN_HISTORY_LIMIT = 80;
export const DEFAULT_RELEASE_REASON = "功能更新";
export const DEFAULT_RELEASE_NOTICE = "测试";
export const RUNNING_STALE_AFTER_MS = 60 * 60 * 1000;
export const PIPELINE_RUN_SCHEMA_VERSION = 2;

const TERMINAL_SUCCESS = new Set(["done", "cancelled"]);
const RESUMABLE_STATUS = new Set(["draft", "blocked", "failed"]);
const SERVICE_ROW_PIPELINE_IDS = ["build-and-release", "build-only"];
const BUILD_COMMAND_IDS = [
  "read-build-status",
  "generate-version",
  "create-or-reuse-task",
  "wait-buildable-task",
  "trigger-build",
  "observe-build",
  "confirm-build-platform-publish"
];
const RELEASE_COMMAND_IDS = [
  "wait-release-record",
  "read-release-detail",
  "publish-company",
  "publish-spot"
];
const BAD_STATUS_PRIORITY = ["failed", "blocked", "running"];

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

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function epochMs(value) {
  const date = new Date(value || "");
  const time = date.getTime();
  return Number.isFinite(time) ? time : 0;
}

function serviceName(service = {}) {
  return service.imageJenkinsName || service.imageNameEn || service.serviceNameEn || service.serviceName || "unknown-service";
}

function selectedServicesText(services = []) {
  return asArray(services).map(serviceName).filter(Boolean).join(" / ");
}

function normalizeMasterStrategy(strategy) {
  return strategy === "hotfix" ? "hotfix" : "prod";
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

function normalizeInputs(record = {}) {
  return {
    releaseReason: record.context?.inputs?.releaseReason || record.releaseReason || DEFAULT_RELEASE_REASON,
    releaseNotice: record.context?.inputs?.releaseNotice || record.releaseNotice || DEFAULT_RELEASE_NOTICE
  };
}

function commandsForRecord(record = {}) {
  const target = normalizeTarget(record.target || record.context?.target || {});
  const inputs = normalizeInputs(record);
  const services = asArray(record.serviceSnapshot);
  const commands = asArray(record.commands);
  if (commands.length) return cloneJson(commands, []);
  return createFlowContract({
    templateId: record.templateId || "build-and-release",
    target,
    services,
    inputs
  }).commands;
}

function commandById(commands = []) {
  return new Map(asArray(commands).map((command) => [command.id, command]));
}

function normalizeContext(record = {}, target = normalizeTarget(record.target)) {
  const context = cloneJson(record.context || {}, {});
  return {
    target: normalizeTarget(context.target || target),
    inputs: {
      ...normalizeInputs(record),
      ...(context.inputs || {})
    },
    data: cloneJson(context.data || {}, {})
  };
}

function coldServiceSnapshot(services = []) {
  return asArray(services).map((service = {}) => {
    const {
      imageVersion,
      generatedVersion,
      buildId,
      candidateBuildId,
      candidateBuildIds,
      buildPower,
      detail,
      history,
      lastSuccessId,
      lastSuccessTime,
      lastFailureId,
      lastFailureTime,
      ...config
    } = cloneJson(service, {});
    return config;
  });
}

function syncServiceSnapshotFromBuildImages(services = [], context = {}) {
  const images = asArray(context?.data?.buildSnapshot?.images);
  if (!images.length) return cloneJson(asArray(services), []);
  return asArray(services).map((service = {}) => {
    const copy = cloneJson(service, {});
    const match = images.find((image = {}) =>
      image.imageJenkinsName === copy.imageJenkinsName || image.imageNameEn === copy.imageNameEn
    );
    if (!match?.imageVersion) return copy;
    return {
      ...copy,
      generatedVersion: match.imageVersion,
      imageVersion: match.imageVersion
    };
  });
}

function isLegacyV1Record(record = {}) {
  return record.schemaVersion !== PIPELINE_RUN_SCHEMA_VERSION && (
    Object.prototype.hasOwnProperty.call(record, "outcomes") ||
    Object.prototype.hasOwnProperty.call(record, "resumeStage")
  );
}

function incompatibleLegacyRecord(record = {}) {
  const timestamp = nowIso();
  const createdAt = record.createdAt || timestamp;
  const updatedAt = record.updatedAt || createdAt;
  const target = normalizeTarget(record.target);
  const inputs = normalizeInputs(record);
  const serviceSnapshot = cloneJson(asArray(record.serviceSnapshot), []);
  const draft = buildPipelineRun({
    templateId: record.templateId || "build-and-release",
    target,
    services: serviceSnapshot,
    inputs,
    id: record.id || createdAt,
    now: createdAt
  });
  return {
    ...draft,
    updatedAt,
    started: record.started !== false,
    status: "cancelled",
    phase: "历史 Run 格式不兼容",
    releaseReason: inputs.releaseReason,
    releaseNotice: inputs.releaseNotice,
    activity: [{
      at: timestamp,
      title: "历史 Run 不兼容",
      detail: "旧 outcomes/resumeStage 历史记录不能通过 PipelineRun v2 继续；请复制配置后生成新的 Run。",
      tone: "warning"
    }, ...asArray(record.activity)].slice(0, 120)
  };
}

function statusRank(status) {
  const ranks = {
    failed: 5,
    blocked: 4,
    running: 3,
    pending: 2,
    done: 1
  };
  return ranks[status] || 0;
}

function mostImportantStatus(statuses = []) {
  return statuses.slice().sort((left, right) => statusRank(right) - statusRank(left))[0] || "pending";
}

function commandStatus(memento = {}, commandId) {
  return memento.commands?.[commandId]?.status || "pending";
}

function commandGroupStatus(record = {}, commandIds = []) {
  if (record.status === "done") return "done";
  const existingIds = commandIds.filter((id) => record.memento?.commands?.[id]);
  if (!existingIds.length) return "done";
  const statuses = existingIds.map((id) => commandStatus(record.memento, id));
  for (const status of BAD_STATUS_PRIORITY) {
    if (statuses.includes(status)) return status;
  }
  return statuses.every((status) => status === "done") ? "done" : "pending";
}

function currentMementoPhase(record = {}) {
  const point = resumePointFromMemento(record.memento || {});
  return point.phase || record.phase || "待启动";
}

function recordStatusFromMemento(record = {}) {
  if (TERMINAL_SUCCESS.has(record.status)) return record.status;
  if (record.started === false) return "draft";
  if (record.status === "running") return "running";
  const point = resumePointFromMemento(record.memento || {});
  if (BAD_STATUS_PRIORITY.includes(point.status)) return point.status;
  if (record.status) return record.status;
  const statuses = Object.values(record.memento?.commands || {}).map((item) => item.status);
  const important = mostImportantStatus(statuses);
  if (important === "failed" || important === "blocked" || important === "running") return important;
  if (statuses.length && statuses.every((status) => status === "done")) return "done";
  return record.status || "draft";
}

function isStaleRunningRecord(record = {}, nowMs = Date.now()) {
  const point = resumePointFromMemento(record.memento || {});
  if (record.status !== "running" && point.status !== "running") return false;
  const lastTouched = epochMs(record.updatedAt || record.createdAt);
  return lastTouched > 0 && nowMs - lastTouched >= RUNNING_STALE_AFTER_MS;
}

function normalizeStaleRunningRecord(record = {}) {
  if (!isStaleRunningRecord(record)) return record;
  let memento = cloneJson(record.memento, createPipelineRunMemento(record.commands));
  const point = resumePointFromMemento(memento);
  if (point.commandId) {
    memento = applyCommandEventToMemento(memento, {
      type: "block",
      status: "blocked",
      commandId: point.commandId,
      title: memento.commands?.[point.commandId]?.title || point.commandId,
      phase: point.phase || "等待处理",
      detail: point.detail
        ? `${point.detail}；历史 Run 长时间未更新，已转为可继续状态。`
        : "历史 Run 长时间未更新，已转为可继续状态。",
      tone: "warning",
      at: nowIso()
    });
  }
  return {
    ...record,
    status: "blocked",
    phase: point.phase || record.phase || "等待处理",
    memento,
    activity: [{
      at: nowIso(),
      title: "Pipeline 状态修复",
      detail: "历史 Run 长时间停留在 running，已转为暂停，可从当前命令继续。",
      tone: "warning"
    }, ...asArray(record.activity || [])].slice(0, 120)
  };
}

export function normalizePipelineRunRecord(record = {}) {
  if (isLegacyV1Record(record)) return incompatibleLegacyRecord(record);

  const timestamp = nowIso();
  const target = normalizeTarget(record.target || record.context?.target || {});
  const inputs = normalizeInputs(record);
  const commands = commandsForRecord({ ...record, target });
  const createdAt = record.createdAt || timestamp;
  const updatedAt = record.updatedAt || createdAt;
  const context = normalizeContext(record, target);
  const memento = normalizePipelineRunMemento(record.memento || createPipelineRunMemento(commands), commands);
  const serviceSnapshot = syncServiceSnapshotFromBuildImages(record.serviceSnapshot, context);
  const normalized = normalizeStaleRunningRecord({
    schemaVersion: PIPELINE_RUN_SCHEMA_VERSION,
    id: record.id || createdAt,
    copiedFromRunId: record.copiedFromRunId || "",
    createdAt,
    updatedAt,
    completedAt: record.completedAt || "",
    started: record.started !== false,
    templateId: record.templateId || "build-and-release",
    status: record.status || "draft",
    phase: record.phase || currentMementoPhase({ memento }),
    target,
    releaseReason: inputs.releaseReason,
    releaseNotice: inputs.releaseNotice,
    serviceSnapshot,
    context,
    commands,
    memento,
    activity: cloneJson(asArray(record.activity), []).slice(0, 120)
  });
  const status = recordStatusFromMemento(normalized);
  const phase = normalized.phase || currentMementoPhase(normalized);
  return {
    ...normalized,
    status,
    phase
  };
}

export function upsertPipelineRunRecord(records, record, options = {}) {
  const limit = options.limit || PIPELINE_RUN_HISTORY_LIMIT;
  const incoming = normalizePipelineRunRecord(record);
  const existing = asArray(records).find((item) => item.id === incoming.id);
  const merged = existing
    ? normalizePipelineRunRecord({
        ...existing,
        ...incoming,
        createdAt: existing.createdAt || incoming.createdAt,
        updatedAt: incoming.updatedAt || nowIso()
      })
    : incoming;
  return [
    merged,
    ...asArray(records).filter((item) => item.id !== incoming.id).map(normalizePipelineRunRecord)
  ]
    .sort((left, right) => String(right.updatedAt || right.createdAt).localeCompare(String(left.updatedAt || left.createdAt)))
    .slice(0, limit);
}

export function mergePipelineRunHistories(...sources) {
  let records = [];
  for (const source of sources) {
    for (const record of asArray(source)) {
      records = upsertPipelineRunRecord(records, record);
    }
  }
  return records;
}

export function canResumePipelineRun(record = {}) {
  const normalized = normalizePipelineRunRecord(record);
  if (TERMINAL_SUCCESS.has(normalized.status)) return false;
  if (normalized.status === "running") return false;
  if (RESUMABLE_STATUS.has(normalized.status)) return true;
  const point = resumePointFromMemento(normalized.memento);
  return RESUMABLE_STATUS.has(point.status);
}

export function blockedPhaseForPipelineError(error) {
  const text = String(error || "");
  if (/^build_|build.*timeout|build.*failed|build.*observe/i.test(text)) return "等待构建完成";
  if (/^release_|^publish_|release.*timeout|publish.*timeout/i.test(text)) return "等待发布记录";
  return "等待处理";
}

export function inferResumePoint(record = {}) {
  const normalized = normalizePipelineRunRecord(record);
  if (normalized.status === "done") {
    return { id: "complete", commandId: "", stage: "complete", phase: "完成", status: "done", detail: "" };
  }
  const point = resumePointFromMemento(normalized.memento);
  const commands = commandById(normalized.commands);
  const command = commands.get(point.commandId);
  return {
    id: point.commandId || "complete",
    commandId: point.commandId || "",
    stage: command?.stage || point.status || "start",
    phase: point.phase || command?.phase || normalized.phase,
    status: point.status || normalized.status,
    detail: point.detail || ""
  };
}

export function clonePipelineRunDraft(record = {}) {
  const normalized = normalizePipelineRunRecord(record);
  return {
    templateId: normalized.templateId,
    target: normalized.target,
    releaseReason: normalized.releaseReason,
    releaseNotice: normalized.releaseNotice,
    serviceSnapshot: coldServiceSnapshot(normalized.serviceSnapshot),
    context: cloneJson({
      target: normalized.context?.target || normalized.target,
      inputs: normalized.context?.inputs || normalizeInputs(normalized),
      data: {}
    }, {})
  };
}

export function clonePipelineRunRecord(record = {}, options = {}) {
  const normalized = normalizePipelineRunRecord(record);
  const now = options.now || nowIso();
  const id = options.id || `${Date.now()}`;
  const draft = buildPipelineRun({
    templateId: normalized.templateId,
    target: normalized.target,
    services: coldServiceSnapshot(normalized.serviceSnapshot),
    inputs: normalizeInputs(normalized),
    id,
    now
  });
  return normalizePipelineRunRecord({
    ...draft,
    copiedFromRunId: normalized.id,
    status: "draft",
    phase: "已复制",
    releaseReason: normalized.releaseReason,
    releaseNotice: normalized.releaseNotice,
    activity: [{
      at: now,
      title: "Pipeline 已复制",
      detail: `复制自 Run ${normalized.id}`,
      tone: "default"
    }]
  });
}

export function phaseCardsForRunRecord(record = {}, options = {}) {
  const normalized = normalizePipelineRunRecord(record);
  const branch = normalized.target?.branch || options.branch || "";
  const flow = buildMode(branch, normalized.target?.buildStrategy || options.buildStrategy || "prod");
  const serviceText = normalized.serviceSnapshot?.length ? selectedServicesText(normalized.serviceSnapshot) : options.selectedLabel || "";
  if (normalized.started === false) {
    return [
      { id: "target", label: "服务目标", status: normalized.serviceSnapshot?.length || serviceText ? "done" : "pending", value: serviceText },
      { id: "probe", label: "探测", status: "pending", value: "待启动" },
      { id: "build", label: "构建", status: "pending", value: flow.label },
      { id: "release", label: "发布", status: "pending", value: releasePlanText(branch) }
    ];
  }
  const probeStatus = normalized.status === "done"
    ? "done"
    : commandStatus(normalized.memento, "probe-platforms") || (options.buildProbeOk ? "done" : "pending");
  const probeValue = normalized.status === "done"
    ? "历史已完成"
    : probeStatus === "done" || options.buildProbeOk
      ? "平台已读"
      : "待刷新";
  return [
    { id: "target", label: "服务目标", status: normalized.serviceSnapshot?.length || serviceText ? "done" : "pending", value: serviceText },
    { id: "probe", label: "探测", status: probeStatus, value: probeValue },
    { id: "build", label: "构建", status: commandGroupStatus(normalized, BUILD_COMMAND_IDS), value: flow.label },
    { id: "release", label: "发布", status: releaseRequired(branch) ? commandGroupStatus(normalized, RELEASE_COMMAND_IDS) : "done", value: releasePlanText(branch) }
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
