import React, { Component, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  CloudCog,
  Copy,
  History,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Server,
  Settings,
  ShieldCheck,
  Trash2,
  Workflow,
  XCircle
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  buildLogOutcome,
  buildLogText,
  normalizeBuildStageLabel,
  pickBuildStructureRecord,
  parseBuildStructureStages,
  parseBuildLogStages
} from "@/lib/build-stage-log.mjs";
import {
  DEFAULT_SERVICE_PAGE_SIZE,
  SERVICE_PAGE_SIZE_OPTIONS,
  paginateRows,
  paginationItems,
  removeSelectedServiceKey,
  serverPageInfo
} from "@/lib/service-pagination.mjs";
import {
  buildApplySignal,
  buildObservationBaselineForService,
  buildPlatformPublishEnvironmentsFor,
  buildPlatformPublishProgress,
  buildPlatformPublishSubmittedSignal,
  buildSignalForService,
  humanizeFailure,
  isBuildAlreadyRunningResult,
  isRetryableProbeResult,
  pipelineObservationDecision,
  publishableServicesForStage,
  releaseRecordSignal,
  shouldNoopReleaseRecord,
  shouldObserveAfterBuildTriggerFailure,
  shouldRestartBuildTaskAfterBuildTriggerFailure
} from "@/lib/pipeline-observer.mjs";
import { selectedServicesText, serviceGroupMismatchText, taskIdOf, taskSnapshotFor } from "@/lib/task-reuse.mjs";
import { buildPipelineRun } from "@/lib/pipeline-run-builder.mjs";
import { applyCommandEventToMemento } from "@/lib/pipeline-run-memento.mjs";
import {
  buildMode,
  canResumePipelineRun,
  clonePipelineRunRecord,
  clonePipelineRunDraft,
  DEFAULT_RELEASE_NOTICE,
  DEFAULT_RELEASE_REASON,
  blockedPhaseForPipelineError,
  inferResumePoint,
  mergePipelineRunHistories,
  normalizePipelineRunRecord,
  phaseCardsForRunRecord,
  PIPELINE_RUN_HISTORY_LIMIT,
  progressForPhaseCards,
  releasePlanText,
  releaseRequired,
  releaseStageLabel,
  releaseStagesFor,
  restorePipelineRunHistory,
  savePipelineRunHistory,
  serviceRowPipelineIds,
  toggleExpandedRunIds,
  upsertPipelineRunRecord
} from "@/lib/pipeline-run-store.mjs";
import {
  buildBranchForReleaseEnvId,
  releaseEnvIdForBuildBranch
} from "@/lib/workflow-environments.mjs";

const PIPELINES = [
  {
    id: "build-and-release",
    label: "构建 + 发布",
    shortLabel: "一键构建发布",
    icon: Workflow,
    tone: "default",
    description: "按环境策略创建/复用构建任务、触发构建，再进入对应的发布链路。"
  },
  {
    id: "build-only",
    label: "仅构建",
    shortLabel: "一键构建",
    icon: Play,
    tone: "secondary",
    description: "完成构建任务、任务内构建和构建平台发布按钮，不进入发布平台。"
  },
  {
    id: "release-existing",
    label: "发布平台待发布",
    shortLabel: "处理待发布",
    icon: CloudCog,
    tone: "secondary",
    description: "直接读取发布平台当前待发布记录并尝试公司/现场发布。"
  }
];
const SERVICE_ROW_PIPELINE_IDS = serviceRowPipelineIds();
const SERVICE_ROW_PIPELINES = PIPELINES.filter((item) => SERVICE_ROW_PIPELINE_IDS.includes(item.id));

const BASE_BRANCHES = [
  { code: "develop", label: "开发环境构建" },
  { code: "release", label: "提测构建" },
  { code: "mastertest", label: "现场测试构建" },
  { code: "master", label: "生产构建" }
];

const MASTER_BUILD_STRATEGIES = [
  { id: "prod", label: "生产构建", description: "增加主版本 / prod" },
  { id: "hotfix", label: "Hotfix 构建", description: "追加 postfix / hotfix" }
];

const PIPELINE_OBSERVER_INTERVAL_MS = 10000;
const PIPELINE_BUILD_OBSERVER_TIMEOUT_MS = 45 * 60 * 1000;
const PIPELINE_RELEASE_OBSERVER_TIMEOUT_MS = 2 * 60 * 1000;
const PIPELINE_RELEASE_EMPTY_NOOP_AFTER_MS = 30 * 1000;
const READ_RETRY_ATTEMPTS = 3;
const READ_RETRY_DELAY_MS = 1200;
const RUN_PAGE_SIZE_OPTIONS = [5, 10, 20];
const DEFAULT_RUN_PAGE_SIZE = 5;
const BUILD_DETAIL_STAGES = [
  { id: "extract", label: "Extract", name: "拉取源码" },
  { id: "verify", label: "Verify", name: "环境校验" },
  { id: "maven", label: "Maven Build", name: "Maven 构建" },
  { id: "docker", label: "Docker Build", name: "镜像构建" },
  { id: "chart", label: "Chart Deploy", name: "Chart 部署" },
  { id: "meta", label: "Meta Parse", name: "元数据解析" }
];

const BUILD_STAGE_NAME_BY_LABEL = new Map(BUILD_DETAIL_STAGES.map((stage) => [normalizeBuildStageLabel(stage.label), stage.name]));
BUILD_STAGE_NAME_BY_LABEL.set("npm build", "Npm 构建");

function serviceName(row) {
  return row?.imageJenkinsName || row?.serviceNameEn || row?.microServiceName || row?.serviceName || "unknown-service";
}

function serviceDisplayName(row) {
  return row?.imageJenkinsName || row?.imageNameEn || row?.serviceNameEn || row?.microServiceName || row?.serviceName || "unknown-service";
}

function serviceKey(row, profile, appCode, branch) {
  return [
    row?.customerNameEn || profile?.customerNameEn,
    row?.applicationCode || appCode,
    row?.codeBranch || branch,
    serviceName(row)
  ].filter(Boolean).join("::");
}

function nowText() {
  return new Date().toLocaleString("zh-CN", { hour12: false });
}

function touchRunRecord(record = {}) {
  return {
    ...record,
    updatedAt: new Date().toISOString()
  };
}

function durationText(ms) {
  const totalSeconds = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}小时${minutes ? `${minutes}分` : ""}`;
  if (minutes > 0) return `${minutes}分${seconds ? `${seconds}秒` : ""}`;
  return `${seconds}秒`;
}

function summarizeFailure(result) {
  return humanizeFailure(result);
}

function isDuplicateBuildInfoMessage(message) {
  return /已存在构建信息|请勿重复提交构建申请|duplicate/i.test(String(message || ""));
}

function buildPowerLabel(value) {
  return `buildPower=${value ?? "-"}${String(value) === "0" ? "（可构建）" : "（不可构建）"}`;
}

function directBuildBaselineKey(service = {}) {
  return service.serviceKey || service.imageJenkinsName || service.imageNameEn || service.serviceNameEn || service.serviceName || "";
}

function directBuildBaselineForServices(services = []) {
  const baselines = {};
  for (const service of services) {
    const key = directBuildBaselineKey(service);
    if (key) baselines[key] = buildObservationBaselineForService(service, service.detail);
  }
  return baselines;
}

function directBuildBaselineForService(service = {}, baselines = {}) {
  if (!baselines) return null;
  return baselines[directBuildBaselineKey(service)] ||
    baselines[service.imageJenkinsName] ||
    baselines[service.imageNameEn] ||
    null;
}

function serviceBuildStatusItemKey(service = {}, index = 0) {
  return `${serviceDisplayName(service)}-${index}`;
}

function compactSignalStructureBuildRecord(record = {}) {
  const stages = Array.isArray(record.stages) ? record.stages : [];
  return {
    ...(record.id != null ? { id: record.id } : {}),
    ...(record.name != null ? { name: record.name } : {}),
    ...(record.buildID != null ? { buildID: record.buildID } : {}),
    ...(record.buildId != null ? { buildId: record.buildId } : {}),
    ...(record.imageVersion != null ? { imageVersion: record.imageVersion } : {}),
    ...(record.status != null ? { status: record.status } : {}),
    stages: stages.map((stage) => ({
      ...(stage.id != null ? { id: stage.id } : {}),
      stageName: stage.stageName || stage.name || "",
      status: stage.status || "",
      ...(stage.duration != null ? { duration: stage.duration } : {}),
      ...(stage.durationMillis != null ? { durationMillis: stage.durationMillis } : {}),
      ...(stage.startTimeMillis != null ? { startTimeMillis: stage.startTimeMillis } : {})
    }))
  };
}

function compactSignalStructureDetail(structureDetail = null, signal = {}) {
  if (!structureDetail || typeof structureDetail !== "object") return null;
  const definition = compactStructureDetail(structureDetail);
  const hints = [
    signal.buildId,
    signal.candidateBuildId,
    ...(Array.isArray(signal.candidateBuildIds) ? signal.candidateBuildIds : [])
  ].map(buildNumberText).filter(Boolean);
  const hintSet = new Set(hints);
  const records = Array.isArray(structureDetail.pineLines) ? structureDetail.pineLines : [];
  const selectedRecords = (hintSet.size
    ? records.filter((record) => hintSet.has(buildNumberText(record.id || record.name || record.buildID || record.buildId)))
    : records.slice(0, 1)
  ).slice(0, 5);
  if (!definition && !selectedRecords.length) return null;
  return {
    ...(definition || {}),
    pineLines: selectedRecords.map(compactSignalStructureBuildRecord)
  };
}

function compactBuildSignals(signals = []) {
  return signals.map((signal) => {
    const candidateBuildIds = Array.isArray(signal.candidateBuildIds)
      ? signal.candidateBuildIds.filter(Boolean).map(String).slice(0, 5)
      : [];
    const compactStructure = compactSignalStructureDetail(signal.structureDetail, {
      ...signal,
      candidateBuildIds
    });
    return {
      service: signal.service || "",
      status: signal.status || "running",
      version: signal.version || "",
      buildId: signal.buildId || "",
      candidateBuildId: signal.candidateBuildId || candidateBuildIds[0] || "",
      candidateBuildIds,
      at: signal.at || 0,
      reason: signal.reason || "",
      ...(compactStructure ? { structureDetail: compactStructure } : {})
    };
  });
}

function formatBuildMarkerTime(value) {
  const numeric = Number(value || 0);
  if (!numeric) return "";
  const date = new Date(numeric);
  if (!Number.isFinite(date.getTime())) return "";
  return date.toLocaleString("zh-CN", { hour12: false });
}

function formatBuildMarker(id, at) {
  return [id, formatBuildMarkerTime(at)].filter(Boolean).join(" / ") || "-";
}

function buildStatusReasonText(reason) {
  const labels = {
    missing_build_detail: "平台暂未返回服务行",
    waiting_for_success: "等待新成功标记",
    waiting_for_target_version: "等待目标版本",
    last_failure_newer_than_success: "发现新失败标记",
    build_failed: "构建失败",
    build_running: "构建观察中",
    direct_build_already_running: "平台提示已有构建"
  };
  return labels[reason] || reason || "等待构建平台回写状态";
}

function serviceSignalNames(service = {}) {
  return [
    service.imageJenkinsName,
    service.imageNameEn,
    service.serviceNameEn,
    service.serviceName,
    service.serviceKey
  ].filter(Boolean).map(String);
}

function buildSignalForDisplay(service = {}, signals = []) {
  const names = new Set(serviceSignalNames(service));
  return signals.find((signal) => names.has(String(signal.service || ""))) || null;
}

function buildCommandSnapshot(record = {}, statuses = ["failed", "blocked", "running", "done"]) {
  const commands = record.memento?.commands || {};
  const ids = [
    "read-build-status",
    "generate-version",
    "create-or-reuse-task",
    "wait-buildable-task",
    "trigger-build",
    "observe-build",
    "confirm-build-platform-publish"
  ];
  for (const status of statuses) {
    const found = ids.find((id) => commands[id]?.status === status);
    if (found) return { id: found, ...commands[found] };
  }
  return null;
}

function buildDoneCommandSnapshot(record = {}) {
  const commands = record.memento?.commands || {};
  const ids = [
    "confirm-build-platform-publish",
    "observe-build",
    "trigger-build",
    "wait-buildable-task",
    "create-or-reuse-task",
    "generate-version",
    "read-build-status"
  ];
  const found = ids.find((id) => commands[id]?.status === "done");
  return found ? { id: found, ...commands[found] } : null;
}

function buildStatusFromCommand(record = {}) {
  if (record.templateId === "release-existing") {
    return {
      status: "done",
      label: "无需构建",
      detail: "该 Run 只处理发布平台待发布记录。",
      source: "Run 策略"
    };
  }

  const active = buildCommandSnapshot(record, ["failed", "blocked", "running"]);
  if (active) {
    return {
      status: active.status,
      label: statusText(active.status),
      detail: active.detail || active.phase || active.title || "构建阶段进行中",
      source: "Run 阶段"
    };
  }

  const done = buildDoneCommandSnapshot(record);
  if (record.status === "done" || done?.id === "observe-build" || done?.id === "confirm-build-platform-publish") {
    return {
      status: "done",
      label: "构建完成",
      detail: done?.detail || "Run 已记录构建段完成。",
      source: "Run 阶段"
    };
  }

  if (record.status === "failed" || record.status === "blocked") {
    return {
      status: record.status,
      label: statusText(record.status),
      detail: record.phase || "Run 停在当前阶段。",
      source: "Run 状态"
    };
  }

  return {
    status: "pending",
    label: "待观察",
    detail: "等待 Pipeline 进入构建观察。",
    source: "Run 配置"
  };
}

function serviceFallbackFromRunStage(fallback = {}, service = {}, services = []) {
  if (fallback.status !== "failed") return fallback;
  const detail = String(fallback.detail || "");
  const serviceNames = serviceSignalNames(service);
  const mentionedNames = services
    .flatMap((item) => serviceSignalNames(item))
    .filter((name) => name && detail.includes(name));
  if (!mentionedNames.length) return fallback;
  if (serviceNames.some((name) => detail.includes(name))) return fallback;
  return {
    ...fallback,
    status: "blocked",
    label: "未触发",
    detail: `批量构建在 ${mentionedNames[0]} 失败后停止；平台未返回该服务的构建结果。`
  };
}

function serviceBuildStatusItems(record = {}, signalOverrides = []) {
  const normalized = normalizePipelineRunRecord(record);
  const services = normalized.serviceSnapshot || [];
  const target = normalized.target || {};
  const storedSignals = Array.isArray(record.context?.data?.buildSignals)
    ? record.context.data.buildSignals
    : [];
  const signals = [
    ...signalOverrides,
    ...storedSignals.filter((signal) => !signalOverrides.some((override) => String(override.service || "") === String(signal.service || "")))
  ];
  const baselines = normalized.context?.data?.buildBaseline || {};
  const fallback = buildStatusFromCommand(normalized);

  return services.map((service, index) => {
    const serviceFallback = serviceFallbackFromRunStage(fallback, service, services);
    const signal = buildSignalForDisplay(service, signals);
    const baseline = directBuildBaselineForService(service, baselines);
    const signalStatus = signal?.status === "succeeded" ? "done" : signal?.status;
    const suppressLiveRunning = ["failed", "blocked"].includes(serviceFallback.status) && signalStatus === "running";
    const suppressTerminalDowngrade = serviceFallback.status === "done" && signalStatus && signalStatus !== "done";
    const effectiveSignal = suppressLiveRunning || suppressTerminalDowngrade ? null : signal;
    const effectiveSignalStatus = effectiveSignal?.status === "succeeded" ? "done" : effectiveSignal?.status;
    const status = effectiveSignalStatus || serviceFallback.status;
    const candidateBuildIds = Array.isArray(effectiveSignal?.candidateBuildIds)
      ? effectiveSignal.candidateBuildIds.filter(Boolean)
      : [effectiveSignal?.candidateBuildId].filter(Boolean);
    const buildId = effectiveSignal?.buildId || (!effectiveSignal || ["succeeded", "failed"].includes(effectiveSignal.status) ? service.buildId || "" : "");
    const targetVersion = service.generatedVersion || service.imageVersion || effectiveSignal?.version || "-";
    const structureDetail = signal?.structureDetail || service.structureDetail || service.detail?.structureDetail || null;
    const statusLabel = effectiveSignal
      ? effectiveSignal.status === "succeeded"
        ? "构建成功"
        : effectiveSignal.status === "failed"
          ? "构建失败"
          : "构建中"
      : serviceFallback.label;
    const item = {
      key: serviceBuildStatusItemKey(service, index),
      serviceIndex: index,
      name: serviceDisplayName(service),
      imageJenkinsName: service.imageJenkinsName || serviceDisplayName(service),
      imageNameEn: service.imageNameEn || "",
      serviceKey: service.serviceKey || "",
      applicationCode: service.applicationCode || target.appCode || "-",
      branch: service.codeBranch || target.branch || "-",
      targetVersion,
      status,
      statusLabel,
      source: effectiveSignal ? effectiveSignal.source || "观察轮询快照" : serviceFallback.source,
      detail: effectiveSignal ? buildStatusReasonText(effectiveSignal.reason) : serviceFallback.detail,
      reason: effectiveSignal?.reason || "",
      buildId,
      candidateBuildId: candidateBuildIds[0] || "",
      candidateBuildIds,
      observedAt: effectiveSignal?.at || 0,
      baselineSuccess: baseline ? formatBuildMarker(baseline.lastSuccessId, baseline.lastSuccessTime) : "-",
      baselineFailure: baseline ? formatBuildMarker(baseline.lastFailureId, baseline.lastFailureTime) : "-",
      structureDetail
    };
    const structureStageRows = buildStageRowsFromStructureDetail(item.structureDetail, item);
    return {
      ...item,
      structureStageRows,
      structureStageSummary: buildStructureStageSummary(structureStageRows)
    };
  });
}

function aggregateBuildStatusFromItems(record = {}, items = serviceBuildStatusItems(record)) {
  const commandStatus = buildStatusFromCommand(normalizePipelineRunRecord(record));
  if (items.some((item) => item.status === "failed") || commandStatus.status === "failed") return "failed";
  if (commandStatus.status === "blocked") return "blocked";
  if (items.some((item) => item.status === "running") || commandStatus.status === "running") return "running";
  if (record.status === "done" || (items.length > 0 && items.every((item) => item.status === "done"))) return "done";
  return commandStatus.status || "pending";
}

function aggregateBuildStatus(record = {}) {
  return aggregateBuildStatusFromItems(record, serviceBuildStatusItems(record));
}

function buildEvidenceSummaryFromItems(items = []) {
  if (!items.length) return "暂无服务快照。";
  return items.map((item) => {
    const version = item.buildId || item.observedAt ? `构建 ${item.buildId || "-"} / ${item.targetVersion || "-"}` : item.targetVersion || "-";
    return `${item.name}: ${item.statusLabel} / ${version}`;
  }).join("；");
}

function buildEvidenceSummary(record = {}) {
  return buildEvidenceSummaryFromItems(serviceBuildStatusItems(record));
}

function buildRunStageRows(record = {}) {
  const aggregateStatus = aggregateBuildStatus(record);
  const evidence = buildEvidenceSummary(record);

  return [{
    id: "build-log",
    label: "Build Log",
    name: "原始构建日志",
    status: aggregateStatus || "pending",
    detail: `${evidence}；阶段明细以平台原始 Jenkins 日志为准，未读取到日志前不推断具体阶段。`
  }];
}

function buildRunStageRowsWithLog(record = {}, logResult = null) {
  const parsedRows = buildStageRowsFromLogResult(logResult);
  if (parsedRows.length) return parsedRows;
  return buildRunStageRows(record);
}

function buildStageRowsFromLogResult(logResult = null) {
  const logText = buildLogText(logResult);
  if (!logText) return [];

  const logOutcome = buildLogOutcome(logText);
  const parsedStages = parseBuildLogStages(logText);
  if (!parsedStages.length) return [];

  return parsedStages.map((stage, index) => {
    const known = buildStageDefinitionForLabel(stage.label, index);
    const status = stage.status || (logOutcome === "done" ? "done" : "pending");
    const detail = status === "running"
      ? "原始构建日志显示当前停留在该阶段。"
      : status === "done"
        ? "原始构建日志显示该阶段已结束。"
        : status === "failed"
          ? "原始构建日志显示构建在该阶段失败或中断。"
      : "原始构建日志尚未进入该阶段。";
    return {
      id: known.id || stage.id || `log-stage-${index + 1}`,
      label: stage.label,
      name: known.name || stage.label,
      status,
      detail
    };
  });
}

function structureStageDetailText(stage = {}) {
  const duration = stage.durationMillis ? `，耗时 ${durationText(stage.durationMillis)}` : "";
  if (stage.status === "running") return `平台阶段表显示当前停留在该阶段${duration}。`;
  if (stage.status === "done") return `平台阶段表显示该阶段已结束${duration}。`;
  if (stage.status === "failed") return `平台阶段表显示构建在该阶段失败或中断${duration}。`;
  return "等待本次构建进入该阶段。";
}

function buildStageIdFromLabel(label = "", index = 0) {
  const slug = normalizeBuildStageLabel(label)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || `stage-${index + 1}`;
}

function buildStageDefinitionForLabel(label = "", index = 0) {
  const normalized = normalizeBuildStageLabel(label);
  const known = BUILD_DETAIL_STAGES.find((stage) => normalizeBuildStageLabel(stage.label) === normalized);
  if (known) return known;
  return {
    id: buildStageIdFromLabel(label, index),
    label,
    name: BUILD_STAGE_NAME_BY_LABEL.get(normalized) || label || `Stage ${index + 1}`
  };
}

function buildNumberText(value) {
  const match = String(value || "").match(/#?\s*(\d+)/);
  return match ? match[1] : "";
}

function structureStagesMatchBuildHint(stages = [], item = {}) {
  const hints = [
    item.buildId,
    item.candidateBuildId,
    ...(Array.isArray(item.candidateBuildIds) ? item.candidateBuildIds : [])
  ].map(buildNumberText).filter(Boolean);
  if (!hints.length) return false;
  const hintSet = new Set(hints);
  return stages.some((stage) => hintSet.has(buildNumberText(stage.buildId)));
}

function buildStageRowsFromStructureDetail(structureDetail = null, item = {}) {
  const parsedStages = parseBuildStructureStages(structureDetail, {
    buildId: item.buildId || item.candidateBuildId,
    targetVersion: item.targetVersion && item.targetVersion !== "-" ? item.targetVersion : ""
  });
  if (!parsedStages.length) return [];
  const matchedBuildHint = structureStagesMatchBuildHint(parsedStages, item);
  if (item.status === "running" && parsedStages.every((stage) => stage.status === "done") && !matchedBuildHint) {
    return [];
  }
  if (item.status === "failed" && parsedStages.every((stage) => stage.status === "done") && !matchedBuildHint) {
    return [];
  }

  return parsedStages.map((stage, index) => {
    const known = buildStageDefinitionForLabel(stage.label, index);
    return {
      id: known.id || stage.id || `structure-stage-${index + 1}`,
      label: stage.label,
      name: known.name || stage.label,
      status: stage.status || "pending",
      detail: structureStageDetailText(stage),
      source: stage.source,
      buildId: stage.buildId,
      buildVersion: stage.buildVersion
    };
  });
}

function buildStructureStageSummary(rows = []) {
  if (!rows.length) return "";
  const failed = rows.find((stage) => stage.status === "failed");
  if (failed) return `平台阶段表显示 ${failed.name || failed.label} 失败或中断`;
  const running = rows.find((stage) => stage.status === "running");
  if (running) return `平台阶段表显示 ${running.name || running.label} 运行中`;
  const doneRows = rows.filter((stage) => stage.status === "done");
  if (doneRows.length && doneRows.length === rows.length) return "平台阶段表显示构建完成";
  const lastDone = doneRows[doneRows.length - 1];
  if (lastDone) return `平台阶段表已完成到 ${lastDone.name || lastDone.label}`;
  return "";
}

function buildLogStageSummary(rows = [], logResult = null) {
  if (!buildLogText(logResult)) return "";
  const failed = rows.find((stage) => stage.status === "failed");
  if (failed) return `${failed.name || failed.label} 失败或中断`;
  const running = rows.find((stage) => stage.status === "running");
  if (running) return `${running.name || running.label} 运行中`;
  const lastDone = [...rows].reverse().find((stage) => stage.status === "done");
  if (lastDone && rows.every((stage) => stage.status === "done")) return "Jenkins 日志显示构建完成";
  if (lastDone) return `已完成到 ${lastDone.name || lastDone.label}`;
  return "";
}

function serviceMatchesLogRequest(item = {}, logRequest = null) {
  if (!item || !logRequest) return false;
  return [item.name, item.imageJenkinsName, item.imageNameEn]
    .filter(Boolean)
    .map(String)
    .includes(String(logRequest.imageJenkinsName || ""));
}

function serviceBuildStageText(item = {}, options = {}) {
  const { logState = {} } = options;
  if (item.structureStageRows?.length) {
    return item.structureStageSummary || "平台阶段表已读取";
  }
  if (logState.rows?.length || logState.result) {
    const logStageSummary = buildLogStageSummary(logState.rows || [], logState.result);
    if (logStageSummary) return logStageSummary;
  }
  if (item.buildId) return "已获得 Jenkins 构建号，可按需读取原始日志阶段";
  if (item.candidateBuildIds?.length) return item.detail || "等待本次构建进入阶段";
  if (item.status === "running") return item.detail || "等待构建平台回写服务状态";
  return item.detail || "等待本次构建进入阶段";
}

function buildServiceStatusRequestForService(record = {}, service = {}, item = {}) {
  const normalized = normalizePipelineRunRecord(record);
  const target = normalized.target || {};
  if (!service || !target.profileId || !target.accountId) return null;
  const imageJenkinsName = service.imageJenkinsName || serviceDisplayName(service);
  if (!imageJenkinsName) return null;
  const candidateBuildIds = Array.isArray(item?.candidateBuildIds)
    ? item.candidateBuildIds.filter(Boolean)
    : [item?.candidateBuildId].filter(Boolean);
  return {
    profileId: target.profileId,
    accountId: target.accountId,
    customerNameEn: target.customerNameEn,
    applicationCode: service.applicationCode || target.appCode,
    codeBranch: service.codeBranch || target.branch,
    imageJenkinsName,
    imageVersion: service.generatedVersion || service.imageVersion || "",
    ...(candidateBuildIds.length ? { candidateBuildIds } : {})
  };
}

function buildLogRequestForRun(record = {}) {
  const normalized = normalizePipelineRunRecord(record);
  const target = normalized.target || {};
  const items = serviceBuildStatusItems(normalized);
  const item = items.find((entry) => entry.buildId || structureBuildIdForLog(entry)) || items.find((entry) => entry.candidateBuildIds?.length) || null;
  if (!item) return null;
  return buildLogRequestForServiceItem(normalized, item);
}

function buildIdFromStructureRecord(record = null) {
  return record?.id || record?.name || record?.buildID || record?.buildId || "";
}

function structureBuildIdForLog(item = {}) {
  const targetVersion = item.targetVersion && item.targetVersion !== "-" ? item.targetVersion : "";
  if (!item.structureDetail || !targetVersion) return "";
  const record = pickBuildStructureRecord(item.structureDetail, {
    buildId: item.buildId,
    targetVersion,
    imageVersion: targetVersion
  });
  if (!record) return "";
  if (record.imageVersion && String(record.imageVersion) !== String(targetVersion)) return "";
  return buildIdFromStructureRecord(record);
}

function buildLogRequestForServiceItem(record = {}, item = {}) {
  const normalized = normalizePipelineRunRecord(record);
  const target = normalized.target || {};
  const service = normalized.serviceSnapshot?.[item.serviceIndex] ||
    normalized.serviceSnapshot?.find((entry) => serviceDisplayName(entry) === item?.name) ||
    normalized.serviceSnapshot?.[0];
  const expectedVersion = item.targetVersion && item.targetVersion !== "-" ? item.targetVersion : "";
  const structureBuildId = structureBuildIdForLog(item);
  const buildId = item?.buildId || structureBuildId;
  const candidateBuildIds = buildId ? [] : item?.candidateBuildIds || [];
  if ((!buildId && !candidateBuildIds.length && !expectedVersion) || !service || !target.profileId || !target.accountId) return null;
  return {
    profileId: target.profileId,
    accountId: target.accountId,
    customerNameEn: target.customerNameEn,
    applicationCode: service.applicationCode || target.appCode,
    codeBranch: service.codeBranch || target.branch,
    imageJenkinsName: service.imageJenkinsName || item.name,
    ...(buildId ? { buildId } : { candidateBuildIds }),
    expectedVersion
  };
}

function shouldApplySignalVersion(service = {}, signal = {}) {
  if (!signal?.version) return false;
  const hasTaskTargetVersion = Boolean(service.generatedVersion || service.imageVersion);
  if (signal.reason === "waiting_for_target_version" && hasTaskTargetVersion) return false;
  return true;
}

function applyBuildSignalsToServices(services = [], signals = []) {
  return services.map((service) => {
    const signal = buildSignalForDisplay(service, signals);
    if (!signal) return service;
    const applySignalVersion = shouldApplySignalVersion(service, signal);
    return {
      ...service,
      ...(applySignalVersion ? {
        generatedVersion: signal.version,
        imageVersion: signal.version
      } : {}),
      buildId: signal.buildId || (signal.status === "running" ? "" : service.buildId)
    };
  });
}

function isProdEnv(env) {
  return /prod|生产|master$/.test(`${env?.label || ""} ${env?.showNameEn || ""}`);
}

function buildPublishEnvironmentLabel(value) {
  if (String(value) === "0") return "公司发布";
  if (String(value) === "1") return "现场发布";
  return "发布";
}

function buildPlatformPublishConfirmText(applyId) {
  return `构建平台发布 ${applyId}`;
}


function findReleaseEnv(profile, envId) {
  return profile?.releaseEnvironments?.find((env) => env.id === envId) || profile?.releaseEnvironments?.[0] || null;
}

function defaultReleaseEnvId(profile, preferredBranch = "mastertest") {
  return releaseEnvIdForBuildBranch(profile, preferredBranch) || profile?.releaseEnvironments?.[0]?.id || "";
}

function defaultBranchForReleaseEnv(profile, envId) {
  return buildBranchForReleaseEnvId(profile, envId) || (isProdEnv(findReleaseEnv(profile, envId)) ? "master" : "mastertest");
}

function workflowItems(profiles = []) {
  return profiles.flatMap((profile) =>
    (profile.accounts || []).map((account) => ({
      id: workflowKey(profile.id, account.id),
      profileId: profile.id,
      accountId: account.id,
      label: `${profile.shortName} · ${account.label}`,
      buttonLabel: account.customWorkflow ? `${profile.shortName} · ${account.label}` : profile.shortName,
      profile,
      account
    }))
  );
}

function workflowKey(profileId, accountId) {
  return profileId && accountId ? `${profileId}:${accountId}` : "";
}

function workflowKeyFromTarget(target = {}) {
  return workflowKey(target.profileId, target.accountId);
}

function runWorkflowKey(record = {}) {
  return workflowKeyFromTarget(record.target || record.context?.target || {});
}

function defaultWorkbenchState(profile = {}, preferredBranch = "mastertest") {
  const releaseEnvId = defaultReleaseEnvId(profile, preferredBranch);
  const branch = releaseEnvId ? defaultBranchForReleaseEnv(profile, releaseEnvId) : preferredBranch;
  return {
    appCode: profile?.applications?.[0]?.code || "emr",
    branch,
    buildStrategy: "prod",
    releaseEnvId,
    serviceSearch: "",
    servicePage: 1,
    servicePageSize: DEFAULT_SERVICE_PAGE_SIZE,
    selectedKeys: []
  };
}

function normalizeWorkbenchState(state = {}, profile = {}) {
  const fallback = defaultWorkbenchState(profile, state.branch || "mastertest");
  const nextBranch = state.branch || fallback.branch;
  const appCode = profile?.applications?.some((item) => item.code === state.appCode)
    ? state.appCode
    : fallback.appCode;
  const releaseEnvId = releaseRequired(nextBranch) && profile?.releaseEnvironments?.length
    ? profile.releaseEnvironments.some((item) => item.id === state.releaseEnvId)
      ? state.releaseEnvId
      : defaultReleaseEnvId(profile, nextBranch)
    : state.releaseEnvId || fallback.releaseEnvId;

  return {
    ...fallback,
    ...state,
    appCode,
    branch: nextBranch,
    buildStrategy: state.buildStrategy || fallback.buildStrategy,
    releaseEnvId,
    servicePage: Number(state.servicePage || fallback.servicePage),
    servicePageSize: Number(state.servicePageSize || fallback.servicePageSize),
    serviceSearch: String(state.serviceSearch || ""),
    selectedKeys: Array.isArray(state.selectedKeys) ? state.selectedKeys : []
  };
}

function sameWorkbenchState(left = {}, right = {}) {
  return left.appCode === right.appCode &&
    left.branch === right.branch &&
    left.buildStrategy === right.buildStrategy &&
    left.releaseEnvId === right.releaseEnvId &&
    left.serviceSearch === right.serviceSearch &&
    left.servicePage === right.servicePage &&
    left.servicePageSize === right.servicePageSize &&
    JSON.stringify(left.selectedKeys || []) === JSON.stringify(right.selectedKeys || []);
}

function defaultPipelineRunState() {
  return {
    schemaVersion: 2,
    started: false,
    templateId: "build-and-release",
    status: "draft",
    phase: "待选择",
    activity: [],
    releaseReason: DEFAULT_RELEASE_REASON,
    releaseNotice: DEFAULT_RELEASE_NOTICE,
    serviceSnapshot: [],
    context: {
      target: {},
      inputs: {
        releaseReason: DEFAULT_RELEASE_REASON,
        releaseNotice: DEFAULT_RELEASE_NOTICE
      },
      data: {}
    },
    commands: [],
    memento: {
      cursor: { commandId: "", index: 0, status: "pending", phase: "待选择", detail: "" },
      order: [],
      commands: {}
    }
  };
}

function defaultRunDraftState(templateId = "build-and-release") {
  return {
    templateId,
    releaseReason: DEFAULT_RELEASE_REASON,
    releaseNotice: DEFAULT_RELEASE_NOTICE
  };
}

function normalizeRunDraftState(state = {}) {
  return {
    ...defaultRunDraftState(state.templateId || "build-and-release"),
    ...state
  };
}

function resolveNextValue(valueOrUpdater, previous) {
  return typeof valueOrUpdater === "function" ? valueOrUpdater(previous) : valueOrUpdater;
}

function findWorkflowTarget(target = {}, profiles = []) {
  const targetProfile = profiles.find((item) => item.id === target.profileId);
  if (!targetProfile) return { ok: false, reason: "missing_profile" };
  const targetAccount = targetProfile.accounts?.find((item) => item.id === target.accountId) || targetProfile.accounts?.[0];
  if (target.accountId && !targetProfile.accounts?.some((item) => item.id === target.accountId)) {
    return { ok: false, reason: "missing_account", profile: targetProfile };
  }
  return { ok: true, profile: targetProfile, account: targetAccount };
}

function runUnavailableMessage(record = {}, profiles = []) {
  const target = record.target || {};
  const found = findWorkflowTarget(target, profiles);
  if (found.ok) return "";
  const workflow = [target.profileId, target.accountId].filter(Boolean).join(":") || "未知 workflow";
  if (found.reason === "missing_account") return `Run 指向的账号已不存在：${workflow}`;
  return `Run 指向的 workflow 已不存在：${workflow}`;
}

function resumableDetachedRunningRun(record = {}, currentRunId = "") {
  const normalized = normalizePipelineRunRecord(record);
  if (normalized.status !== "running" || normalized.id === currentRunId) return normalized;

  const point = inferResumePoint(normalized);
  const commandId = point.commandId;
  const detail = point.detail || "该 Run 不是当前页面正在执行的任务，可从这里继续接管。";
  const memento = {
    ...(normalized.memento || {}),
    cursor: {
      ...(normalized.memento?.cursor || {}),
      commandId,
      status: "blocked",
      phase: point.phase || normalized.phase || "等待处理",
      detail
    },
    commands: {
      ...(normalized.memento?.commands || {}),
      ...(commandId ? {
        [commandId]: {
          ...(normalized.memento?.commands?.[commandId] || {}),
          status: "blocked",
          phase: point.phase || normalized.phase || "等待处理",
          detail
        }
      } : {})
    }
  };

  return normalizePipelineRunRecord({
    ...normalized,
    status: "blocked",
    phase: point.phase || normalized.phase || "等待处理",
    memento
  });
}

function workflowCustomerKey(customer = {}) {
  return String(customer.customerNameEn || customer.value || customer.id || customer.customerNameCh || customer.label || "").trim();
}

function workflowCustomerLabel(customer = {}) {
  const name = customer.customerNameCh || customer.hospitalName || customer.label || workflowCustomerKey(customer);
  const en = customer.customerNameEn || customer.value || customer.id;
  const abbr = customer.customerCodeAbbreviation || customer.shortName;
  return [name, en, abbr].filter(Boolean).join(" / ");
}

function apiFetch(path, body) {
  return fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  }).then((response) => response.json());
}

function apiGet(path) {
  return fetch(path).then((response) => response.json());
}

function apiDelete(path, body = {}) {
  return fetch(path, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  }).then((response) => response.json());
}

async function apiFetchWithRetry(path, body, options = {}) {
  const attempts = Math.max(1, Number(options.attempts || 1));
  const delayMs = Number(options.delayMs || READ_RETRY_DELAY_MS);
  let lastJson = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const json = await apiFetch(path, body);
      const result = json.result || json;
      lastJson = json;
      if (result?.ok || attempt >= attempts || !isRetryableProbeResult(result)) return json;
      if (options.onRetry) {
        options.onRetry({
          attempt,
          attempts,
          result,
          message: summarizeFailure(result)
        });
      }
    } catch (error) {
      const result = {
        ok: false,
        reason: "client_request_failed",
        message: error.message,
        error: error.message
      };
      lastJson = { result };
      if (attempt >= attempts || !isRetryableProbeResult(result)) return lastJson;
      if (options.onRetry) {
        options.onRetry({
          attempt,
          attempts,
          result,
          message: summarizeFailure(result)
        });
      }
    }
    await sleep(delayMs);
  }
  return lastJson;
}

function pipelineById(id) {
  return PIPELINES.find((item) => item.id === id) || PIPELINES[0];
}

function statusVariant(status) {
  if (status === "done") return "success";
  if (status === "failed") return "danger";
  if (status === "blocked") return "warning";
  if (status === "running") return "default";
  return "muted";
}

function statusText(status) {
  const labels = {
    draft: "待启动",
    running: "运行中",
    done: "完成",
    failed: "失败",
    blocked: "暂停",
    cancelled: "已取消",
    pending: "等待",
    default: "记录"
  };
  return labels[status] || status || "-";
}

function compactStructureDetail(structureDetail = null) {
  const avgRows = Array.isArray(structureDetail?.avg) ? structureDetail.avg : [];
  const avg = avgRows
    .map((row) => {
      const stageName = String(row?.stageName || row?.name || row?.label || "").trim();
      if (!stageName) return null;
      const duration = Number(row?.duration ?? row?.durationMillis ?? 0);
      return {
        stageName,
        ...(Number.isFinite(duration) && duration > 0 ? { duration } : {})
      };
    })
    .filter(Boolean);
  if (!avg.length) return null;
  return {
    ...(structureDetail?.code ? { code: structureDetail.code } : {}),
    avg
  };
}

function compactService(service) {
  const structureDetail = compactStructureDetail(service.structureDetail || service.detail?.structureDetail);
  return {
    serviceKey: service.serviceKey,
    customerNameEn: service.customerNameEn,
    imageJenkinsName: service.imageJenkinsName,
    imageNameEn: service.imageNameEn,
    imageVersion: service.generatedVersion || service.imageVersion,
    generatedVersion: service.generatedVersion,
    imageDeployId: service.imageDeployId,
    applicationCode: service.applicationCode,
    codeBranch: service.codeBranch,
    coverageRun: service.coverageRun,
    ...(structureDetail ? { structureDetail } : {})
  };
}

function buildConfirmText(verb, services) {
  if (services.length === 1) return `${verb} ${services[0].imageJenkinsName}`;
  return `${verb} ${services.length} 个服务`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("Workbench render failed", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <main className="grid min-h-screen place-items-center bg-background p-6">
          <Card className="w-full max-w-lg">
            <CardHeader>
              <CardTitle>Workbench 渲染失败</CardTitle>
              <CardDescription>组件树发生异常，刷新后仍失败时查看浏览器控制台。</CardDescription>
            </CardHeader>
            <CardContent>
              <pre className="max-h-48 overflow-auto rounded-lg border border-border bg-muted p-3 text-xs">
                {this.state.error.message}
              </pre>
            </CardContent>
          </Card>
        </main>
      );
    }
    return this.props.children;
  }
}

function App() {
  const [bootstrap, setBootstrap] = useState(null);
  const [activeTab, setActiveTab] = useState("workbench");
  const [activeProfileId, setActiveProfileId] = useState("demob");
  const [activeAccountId, setActiveAccountId] = useState("demo_prod");
  const [workflowStateById, setWorkflowStateById] = useState({});
  const [serviceMeta, setServiceMeta] = useState({});
  const [probes, setProbes] = useState({});
  const [credentialState, setCredentialState] = useState([]);
  const [busyByWorkflowId, setBusyByWorkflowId] = useState({});
  const [refreshingByWorkflowId, setRefreshingByWorkflowId] = useState({});
  const [lastResultByWorkflowId, setLastResultByWorkflowId] = useState({});
  const [runByWorkflowId, setRunByWorkflowId] = useState({});
  const [runDraftByWorkflowId, setRunDraftByWorkflowId] = useState({});
  const [runHistory, setRunHistory] = useState([]);
  const [runHistoryLoaded, setRunHistoryLoaded] = useState(false);
  const [pendingRunAction, setPendingRunAction] = useState(null);
  const [expandedRunIdsByWorkflowId, setExpandedRunIdsByWorkflowId] = useState({});
  const autoRefreshKeys = useRef(new Set());
  const runHistorySaveTimer = useRef(null);

  useEffect(() => {
    fetch("/api/bootstrap")
      .then((response) => response.json())
      .then((data) => {
        setBootstrap(data);
        setCredentialState(data.credentialState || []);
        const localHistory = typeof window === "undefined" ? [] : restorePipelineRunHistory(window.localStorage);
        const nextHistory = mergePipelineRunHistories(data.pipelineRunHistory || [], localHistory);
        setRunHistory(nextHistory);
        setRunHistoryLoaded(true);
        const profile = data.profiles?.find((item) => item.id === activeProfileId) || data.profiles?.[0];
        if (profile) {
          const accountId = profile.accounts?.[0]?.id || "";
          const key = workflowKey(profile.id, accountId);
          setActiveProfileId(profile.id);
          setActiveAccountId(accountId);
          if (key) {
            setWorkflowStateById((current) => ({
              ...current,
              [key]: normalizeWorkbenchState(current[key], profile)
            }));
          }
        }
      })
      .catch((error) => {
        setRunHistory(typeof window === "undefined" ? [] : restorePipelineRunHistory(window.localStorage));
        setRunHistoryLoaded(true);
        setLastResult({ tone: "danger", title: "初始化失败", detail: error.message });
      });
  }, []);

  const profiles = bootstrap?.profiles || [];
  const profile = profiles.find((item) => item.id === activeProfileId) || profiles[0];
  const account = profile?.accounts?.find((item) => item.id === activeAccountId) || profile?.accounts?.[0];
  const workflowEntries = useMemo(() => workflowItems(profiles), [profiles]);
  const activeWorkflowId = profile && account ? workflowKey(profile.id, account.id) : "";
  const activeWorkflowState = useMemo(() => {
    return normalizeWorkbenchState(workflowStateById[activeWorkflowId], profile);
  }, [workflowStateById, activeWorkflowId, profile]);
  const {
    appCode,
    branch,
    buildStrategy,
    releaseEnvId,
    serviceSearch,
    servicePage,
    servicePageSize,
    selectedKeys
  } = activeWorkflowState;
  const run = useMemo(() => {
    return normalizePipelineRunRecord(runByWorkflowId[activeWorkflowId] || defaultPipelineRunState());
  }, [runByWorkflowId, activeWorkflowId]);
  const runDraft = useMemo(() => {
    return normalizeRunDraftState(runDraftByWorkflowId[activeWorkflowId]);
  }, [runDraftByWorkflowId, activeWorkflowId]);
  const busy = activeWorkflowId ? busyByWorkflowId[activeWorkflowId] || "" : "";
  const refreshing = activeWorkflowId ? Boolean(refreshingByWorkflowId[activeWorkflowId]) : false;
  const lastResult = activeWorkflowId ? lastResultByWorkflowId[activeWorkflowId] || null : null;
  const expandedRunIds = activeWorkflowId ? expandedRunIdsByWorkflowId[activeWorkflowId] || [] : [];
  const visibleRunHistory = useMemo(() => {
    return runHistory.filter((record) => runWorkflowKey(record) === activeWorkflowId);
  }, [runHistory, activeWorkflowId]);
  const env = findReleaseEnv(profile, releaseEnvId);
  const probeKey = activeWorkflowId || profile?.id;
  const buildProbe = probes[probeKey]?.build;
  const releaseProbe = probes[probeKey]?.release;
  const profileApplications = profile?.applications || [];
  const buildCustomerApplications = buildProbe?.customerApplications?.rows?.map((item) => ({
    code: item.applicationCode || item.code || item.applicationName,
    name: item.applicationName || item.name || item.applicationCode || item.code
  })).filter((item) => item.code) || [];
  const discoveredApplications = buildProbe?.serviceDiscovery?.map((item) => ({
    code: item.applicationCode,
    name: item.applicationName || item.detail?.applicationName || item.detail?.applicationNameCh || item.applicationCode
  })).filter((item) => item.code) || [];
  const releaseApplications = releaseProbe?.environments?.flatMap((card) => card.apps || []).map((item) => ({
    code: item.applicationCode || item.applicationName,
    name: item.applicationName || item.applicationCode
  })).filter((item) => item.code) || [];
  const availableApplications = useMemo(() => {
    const byCode = new Map();
    for (const item of [...buildCustomerApplications, ...releaseApplications, ...discoveredApplications, ...profileApplications]) {
      if (!item.code) continue;
      byCode.set(item.code, { ...item, name: item.name || item.code });
    }
    return Array.from(byCode.values());
  }, [profileApplications, buildCustomerApplications, releaseApplications, discoveredApplications]);

  const appDiscovery = useMemo(() => {
    return buildProbe?.serviceDiscovery?.find((item) => item.applicationCode === appCode) || null;
  }, [buildProbe, appCode]);

  const branchDiscovery = useMemo(() => {
    return appDiscovery?.branches?.find((item) => item.codeBranch === branch) || null;
  }, [appDiscovery, branch]);

  const serviceRows = useMemo(() => branchDiscovery?.rows || [], [branchDiscovery]);

  useEffect(() => {
    setServicePage(1);
  }, [profile?.id, appCode, branch, serviceSearch]);

  const servicePageData = useMemo(() => {
    return serverPageInfo({
      rows: serviceRows,
      total: branchDiscovery?.total ?? serviceRows.length,
      pageNo: branchDiscovery?.pageNo ?? servicePage,
      pageSize: servicePageSize
    });
  }, [branchDiscovery, serviceRows, servicePage, servicePageSize]);
  const visibleServiceKeys = useMemo(() => {
    if (!profile) return new Set();
    return new Set(servicePageData.rows.map((row) => serviceKey(row, profile, appCode, branch)));
  }, [servicePageData.rows, profile, appCode, branch]);

  function serviceFromRow(row) {
    if (!profile || !row) return null;
    const key = row.serviceKey || serviceKey(row, profile, appCode, branch);
    const name = serviceName(row);
    return {
      ...row,
      serviceKey: key,
      imageJenkinsName: name,
      applicationCode: row.applicationCode || appCode,
      applicationName: row.applicationName || row.applicationCode || appCode,
      codeBranch: row.codeBranch || branch,
      ...(serviceMeta[key] || {})
    };
  }

  const selectedServices = useMemo(() => {
    if (!profile) return [];
    return selectedKeys
      .map((key) => {
        const row = serviceRows.find((item) => serviceKey(item, profile, appCode, branch) === key) || serviceMeta[key];
      return serviceFromRow(row);
    })
      .filter(Boolean);
  }, [selectedKeys, serviceRows, profile, appCode, branch, serviceMeta]);
  const hiddenSelectedServices = useMemo(() => {
    return selectedServices.filter((service) => {
      const key = service.serviceKey || serviceKey(service, profile, appCode, branch);
      return !visibleServiceKeys.has(key);
    });
  }, [selectedServices, visibleServiceKeys, profile, appCode, branch]);

  function patchWorkflowState(workflowId, stateProfile, patchOrUpdater) {
    if (!workflowId || !stateProfile) return;
    setWorkflowStateById((current) => {
      const previous = normalizeWorkbenchState(current[workflowId], stateProfile);
      const patch = resolveNextValue(patchOrUpdater, previous) || {};
      const next = normalizeWorkbenchState({ ...previous, ...patch }, stateProfile);
      if (sameWorkbenchState(previous, next)) return current;
      return { ...current, [workflowId]: next };
    });
  }

  function ensureWorkflowState(workflowId, stateProfile, patch = {}) {
    if (!workflowId || !stateProfile) return;
    setWorkflowStateById((current) => {
      if (current[workflowId]) return current;
      return {
        ...current,
        [workflowId]: normalizeWorkbenchState(patch, stateProfile)
      };
    });
  }

  function patchActiveWorkflowState(patchOrUpdater) {
    patchWorkflowState(activeWorkflowId, profile, patchOrUpdater);
  }

  function setWorkbenchField(field, valueOrUpdater) {
    patchActiveWorkflowState((previous) => ({
      [field]: resolveNextValue(valueOrUpdater, previous[field])
    }));
  }

  function setAppCode(valueOrUpdater) {
    setWorkbenchField("appCode", valueOrUpdater);
  }

  function setBranch(valueOrUpdater) {
    setWorkbenchField("branch", valueOrUpdater);
  }

  function setBuildStrategy(valueOrUpdater) {
    setWorkbenchField("buildStrategy", valueOrUpdater);
  }

  function setReleaseEnvId(valueOrUpdater) {
    setWorkbenchField("releaseEnvId", valueOrUpdater);
  }

  function setServiceSearch(valueOrUpdater) {
    setWorkbenchField("serviceSearch", valueOrUpdater);
  }

  function setServicePage(valueOrUpdater) {
    setWorkbenchField("servicePage", valueOrUpdater);
  }

  function setServicePageSize(valueOrUpdater) {
    setWorkbenchField("servicePageSize", valueOrUpdater);
  }

  function setSelectedKeys(valueOrUpdater) {
    setWorkbenchField("selectedKeys", valueOrUpdater);
  }

  function setBusy(valueOrUpdater, options = {}) {
    const workflowId = options.workflowId || activeWorkflowId;
    if (!workflowId) return;
    setBusyByWorkflowId((current) => ({
      ...current,
      [workflowId]: resolveNextValue(valueOrUpdater, current[workflowId] || "")
    }));
  }

  function setRefreshing(valueOrUpdater, options = {}) {
    const workflowId = options.workflowId || activeWorkflowId;
    if (!workflowId) return;
    setRefreshingByWorkflowId((current) => ({
      ...current,
      [workflowId]: Boolean(resolveNextValue(valueOrUpdater, Boolean(current[workflowId])))
    }));
  }

  function setLastResult(valueOrUpdater, options = {}) {
    const workflowId = options.workflowId || activeWorkflowId;
    if (!workflowId) return;
    setLastResultByWorkflowId((current) => ({
      ...current,
      [workflowId]: resolveNextValue(valueOrUpdater, current[workflowId] || null)
    }));
  }

  function setRun(valueOrUpdater, options = {}) {
    const workflowId = options.workflowId || activeWorkflowId;
    if (!workflowId) return;
    setRunByWorkflowId((current) => {
      const previous = normalizePipelineRunRecord(current[workflowId] || defaultPipelineRunState());
      const rawNext = resolveNextValue(valueOrUpdater, previous);
      const next = normalizePipelineRunRecord(options.touch === false ? rawNext : touchRunRecord(rawNext));
      return { ...current, [workflowId]: next };
    });
  }

  function setRunDraft(valueOrUpdater, options = {}) {
    const workflowId = options.workflowId || activeWorkflowId;
    if (!workflowId) return;
    setRunDraftByWorkflowId((current) => {
      const previous = normalizeRunDraftState(current[workflowId]);
      const next = normalizeRunDraftState(resolveNextValue(valueOrUpdater, previous));
      return { ...current, [workflowId]: next };
    });
  }

  function setExpandedRunIds(valueOrUpdater, options = {}) {
    const workflowId = options.workflowId || activeWorkflowId;
    if (!workflowId) return;
    setExpandedRunIdsByWorkflowId((current) => {
      const previous = current[workflowId] || [];
      const next = resolveNextValue(valueOrUpdater, previous) || [];
      return { ...current, [workflowId]: next };
    });
  }

  useEffect(() => {
    if (!bootstrap) return;
    if (!profiles.length) {
      if (activeProfileId) setActiveProfileId("");
      if (activeAccountId) setActiveAccountId("");
      return;
    }
    const nextProfile = profiles.find((item) => item.id === activeProfileId) || profiles[0];
    const nextAccount = nextProfile.accounts?.find((item) => item.id === activeAccountId) || nextProfile.accounts?.[0];
    if (nextProfile.id !== activeProfileId) setActiveProfileId(nextProfile.id);
    if ((nextAccount?.id || "") !== activeAccountId) setActiveAccountId(nextAccount?.id || "");
    if (!nextProfile.applications?.some((item) => item.code === appCode)) {
      setAppCode(nextProfile.applications?.[0]?.code || "emr");
      setSelectedKeys([]);
    }
    if (releaseRequired(branch) && !nextProfile.releaseEnvironments?.some((item) => item.id === releaseEnvId)) {
      setReleaseEnvId(defaultReleaseEnvId(nextProfile, branch));
    }
  }, [bootstrap, profiles, activeProfileId, activeAccountId, appCode, branch, releaseEnvId]);

  const releaseApp = useMemo(() => {
    return pickReleaseApp(releaseProbe);
  }, [releaseProbe, env, appCode]);

  const selectedLabel = selectedServicesText(selectedServices);
  const flow = buildMode(branch, buildStrategy);
  const running = Boolean(busy);

  useEffect(() => {
    if (!runHistoryLoaded) return undefined;
    if (typeof window !== "undefined") savePipelineRunHistory(window.localStorage, runHistory);
    if (runHistorySaveTimer.current) clearTimeout(runHistorySaveTimer.current);
    runHistorySaveTimer.current = setTimeout(() => {
      apiFetch("/api/pipeline-runs", { runs: runHistory }).catch((error) => {
        setLastResult({ tone: "warning", title: "Run 历史保存失败", detail: `已保留浏览器 fallback：${error.message}` });
      });
    }, 200);
    return () => {
      if (runHistorySaveTimer.current) clearTimeout(runHistorySaveTimer.current);
    };
  }, [runHistory, runHistoryLoaded]);

  useEffect(() => {
    if (!profile || !account || !appCode || !branch) return;
    const key = [profile.id, account.id, appCode, branch].join("::");
    if (autoRefreshKeys.current.has(key)) return;
    autoRefreshKeys.current.add(key);
    refreshServicePage(1, servicePageSize, "");
  }, [profile?.id, account?.id, appCode, branch]);

  useEffect(() => {
    const records = Object.values(runByWorkflowId)
      .filter((item) => item?.id)
      .map((item) => {
        const normalized = normalizePipelineRunRecord(item);
        const terminal = normalized.status === "done" || normalized.status === "failed" || normalized.status === "cancelled";
        return normalizePipelineRunRecord({
          ...normalized,
          updatedAt: new Date().toISOString(),
          completedAt: terminal ? normalized.completedAt || new Date().toISOString() : normalized.completedAt
        });
      });
    if (!records.length) return;
    setRunHistory((current) => records.reduce((history, record) => upsertPipelineRunRecord(history, record), current));
  }, [runByWorkflowId]);

  function buildRunTarget() {
    return {
      profileId: profile?.id || "",
      accountId: account?.id || "",
      customerNameEn: profile?.customerNameEn || "",
      appCode,
      branch,
      buildStrategy,
      releaseEnvId: env?.id || "",
      releaseEnvLabel: env ? `${env.showNameEn || "-"}/${env.environmentFlag || "-"}` : ""
    };
  }

  function hydrateServiceSnapshot(snapshot, target = {}) {
    const targetProfile = profiles.find((item) => item.id === target.profileId) || profile;
    const targetAppCode = target.appCode || appCode;
    const targetBranch = target.branch || branch;
    return (snapshot || []).map((service) => {
      const key = service.serviceKey || serviceKey(service, targetProfile, targetAppCode, targetBranch);
      return {
        ...service,
        serviceKey: key,
        imageJenkinsName: serviceName(service),
        generatedVersion: service.generatedVersion || service.imageVersion,
        applicationCode: service.applicationCode || targetAppCode,
        codeBranch: service.codeBranch || targetBranch,
        ...(serviceMeta[key] || {})
      };
    }).filter((service) => service.imageJenkinsName);
  }

  function runTargetMatches(target = {}) {
    if (target.profileId && activeProfileId !== target.profileId) return false;
    if (target.accountId && activeAccountId !== target.accountId) return false;
    if (target.appCode && appCode !== target.appCode) return false;
    if (target.branch && branch !== target.branch) return false;
    if ((target.branch || branch) === "master" && target.buildStrategy && buildStrategy !== target.buildStrategy) return false;
    if (releaseRequired(target.branch || branch) && target.releaseEnvId && releaseEnvId !== target.releaseEnvId) return false;
    return true;
  }

  function mergeServiceMeta(patch) {
    setServiceMeta((current) => {
      const next = { ...current };
      for (const [key, value] of Object.entries(patch)) {
        next[key] = { ...(next[key] || {}), ...value };
      }
      return next;
    });
  }

  function addActivity(title, detail, tone = "default") {
    setRun((current) => ({
      ...current,
      started: true,
      activity: [{ at: nowText(), title, detail, tone }, ...(current.activity || [])].slice(0, 80)
    }));
  }

  function setRunPhase(phase, status = "running") {
    setRun((current) => ({
      ...current,
      phase,
      status,
      ...(["done", "failed", "cancelled"].includes(status) ? { completedAt: new Date().toISOString() } : {})
    }));
  }

  function patchRun(patch) {
    const { buildSnapshot, buildBaseline, buildSignals, buildApplySignal, ...runPatch } = patch;
    const compactSignals = buildSignals !== undefined ? compactBuildSignals(buildSignals) : undefined;
    setRun((current) => {
      const serviceSnapshot = compactSignals
        ? applyBuildSignalsToServices(runPatch.serviceSnapshot || current.serviceSnapshot || [], compactSignals)
        : runPatch.serviceSnapshot || current.serviceSnapshot || [];
      return normalizePipelineRunRecord({
        ...current,
        ...runPatch,
        serviceSnapshot,
        context: {
          ...(current.context || {}),
          ...(runPatch.context || {}),
          data: {
            ...(current.context?.data || {}),
            ...(runPatch.context?.data || {}),
            ...(buildSnapshot !== undefined ? { buildSnapshot } : {}),
            ...(buildBaseline !== undefined ? { buildBaseline } : {}),
            ...(compactSignals !== undefined ? { buildSignals: compactSignals } : {}),
            ...(buildApplySignal !== undefined ? { buildApplySignal } : {})
          }
        }
      });
    });
  }

  function resetRunDraft(templateId = "build-and-release", options = {}) {
    setRunDraft(defaultRunDraftState(templateId), options);
  }

  function commandIdForLegacyStep(id, status) {
    const aliases = {
      probe: "probe-platforms",
      "build-status": "read-build-status",
      version: "generate-version",
      "create-task": "create-or-reuse-task",
      "build-task": "wait-buildable-task",
      build: "trigger-build",
      "build-observe": "observe-build",
      "build-apply-observe": "observe-build",
      "build-platform-publish": "confirm-build-platform-publish",
      "release-observe": "wait-release-record",
      "release-detail": "read-release-detail",
      release: status === "done" ? "complete-run" : "wait-release-record"
    };
    return aliases[id] || id;
  }

  function eventTypeForStatus(status) {
    if (status === "done") return "done";
    if (status === "blocked") return "block";
    if (status === "failed") return "fail";
    return "run";
  }

  function emitCommandEvent(id, status, detail) {
    setRun((current) => {
      const normalized = normalizePipelineRunRecord(current);
      const commandId = commandIdForLegacyStep(id, status);
      const command = normalized.commands.find((item) => item.id === commandId) || { id: commandId, title: commandId, phase: normalized.phase || "Pipeline" };
      const eventType = eventTypeForStatus(status);
      const display = command.display?.[eventType] || {};
      const event = {
        type: eventType,
        status,
        commandId,
        title: display.title || command.title || commandId,
        phase: display.phase || command.phase || normalized.phase || "Pipeline",
        detail: detail || display.detail || "",
        tone: status === "failed" ? "danger" : status === "blocked" ? "warning" : status === "done" ? "success" : "default",
        at: nowText()
      };
      const memento = applyCommandEventToMemento(normalized.memento, event);
      return normalizePipelineRunRecord({
        ...normalized,
        started: true,
        status: status === "failed" || status === "blocked" ? status : normalized.status === "draft" ? "running" : normalized.status,
        phase: event.phase,
        memento,
        activity: [{
          at: event.at,
          title: event.title,
          detail: event.detail,
          tone: event.tone
        }, ...(normalized.activity || [])].slice(0, 120)
      });
    });
  }

  function applyBootstrapPayload(payload) {
    if (payload.profiles) {
      setBootstrap((current) => ({ ...(current || {}), profiles: payload.profiles }));
    }
    if (payload.credentialState) {
      setCredentialState(payload.credentialState);
    }
  }

  function setProfileContext(nextProfileId, nextAccountId) {
    const next = profiles.find((item) => item.id === nextProfileId);
    if (!next) return;
    const nextAccount = next.accounts?.find((item) => item.id === nextAccountId) || next.accounts?.[0];
    const nextWorkflowId = workflowKey(next.id, nextAccount?.id || "");
    setActiveProfileId(next.id);
    setActiveAccountId(nextAccount?.id || "");
    const nextReleaseEnvId = defaultReleaseEnvId(next, "mastertest");
    const nextBranch = defaultBranchForReleaseEnv(next, nextReleaseEnvId);
    ensureWorkflowState(nextWorkflowId, next, {
      appCode: next.applications?.[0]?.code || "emr",
      branch: nextBranch,
      buildStrategy: "prod",
      releaseEnvId: nextReleaseEnvId,
      serviceSearch: "",
      servicePage: 1,
      selectedKeys: []
    });
  }

  function activateWorkflow(item) {
    setActiveTab("workbench");
    setProfileContext(item.profileId, item.accountId);
  }

  function applyRunTarget(target = {}) {
    const nextProfile = profiles.find((item) => item.id === target.profileId);
    if (!nextProfile) return;
    const nextAccountId = target.accountId || nextProfile.accounts?.[0]?.id || "";
    const nextWorkflowId = workflowKey(nextProfile.id, nextAccountId);
    if (nextProfile) {
      setActiveProfileId(nextProfile.id);
      setActiveAccountId(nextAccountId);
    }
    patchWorkflowState(nextWorkflowId, nextProfile, {
      ...(target.appCode ? { appCode: target.appCode } : {}),
      ...(target.branch ? { branch: target.branch } : {}),
      buildStrategy: target.buildStrategy || "prod",
      ...(target.releaseEnvId ? { releaseEnvId: target.releaseEnvId } : {})
    });
  }

  function syncReleaseEnvForBuildBranch(nextBranch) {
    const mappedReleaseEnvId = releaseEnvIdForBuildBranch(profile, nextBranch);
    if (mappedReleaseEnvId) setReleaseEnvId(mappedReleaseEnvId);
  }

  function syncBuildBranchForReleaseEnv(nextReleaseEnvId) {
    const mappedBranch = buildBranchForReleaseEnvId(profile, nextReleaseEnvId);
    if (mappedBranch && branch !== "develop" && branch !== "release") {
      setBranch(mappedBranch);
      if (mappedBranch !== "master") setBuildStrategy("prod");
    }
  }

  function changeBuildBranch(value) {
    setBranch(value);
    if (value !== "master") setBuildStrategy("prod");
    syncReleaseEnvForBuildBranch(value);
    setSelectedKeys([]);
    resetRunDraft();
  }

  function changeReleaseEnv(value) {
    setReleaseEnvId(value);
    syncBuildBranchForReleaseEnv(value);
    resetRunDraft();
  }

  function keysFromRunServices(snapshot, target = {}) {
    const targetProfile = profiles.find((item) => item.id === target.profileId) || profile;
    return hydrateServiceSnapshot(snapshot, target).map((service) =>
      service.serviceKey || serviceKey(service, targetProfile, target.appCode || appCode, target.branch || branch)
    );
  }

  function loadRunDraft(record, options = {}) {
    const normalized = normalizePipelineRunRecord(record);
    const unavailable = runUnavailableMessage(normalized, profiles);
    if (unavailable) {
      setLastResult({ tone: "warning", title: "Pipeline 未启动", detail: unavailable });
      return;
    }
    const draft = clonePipelineRunDraft(normalized);
    const targetWorkflowId = workflowKeyFromTarget(draft.target);
    applyRunTarget(draft.target);
    patchWorkflowState(targetWorkflowId, profiles.find((item) => item.id === draft.target.profileId), {
      selectedKeys: keysFromRunServices(draft.serviceSnapshot, draft.target),
      serviceSearch: draft.serviceSnapshot[0]?.imageJenkinsName || ""
    });
    setRunDraft({
      templateId: draft.templateId,
      releaseReason: draft.releaseReason,
      releaseNotice: draft.releaseNotice
    }, { workflowId: targetWorkflowId });
    setLastResult({ tone: "success", title: "Pipeline 已复制", detail: "已恢复客户、环境、服务组和发布入参。" }, { workflowId: targetWorkflowId });
    if (options.action) {
      setPendingRunAction({ action: options.action, record: normalized, workflowId: targetWorkflowId });
    }
  }

  function copyRunRecord(record) {
    const cloned = clonePipelineRunRecord(record);
    setRunHistory((current) => upsertPipelineRunRecord(current, cloned));
    setExpandedRunIds((current) => Array.from(new Set([...current, cloned.id])));
    setLastResult({ tone: "success", title: "Pipeline 已复制", detail: `已新增 Run ${cloned.id}，可直接继续或查看配置。` });
  }

  async function clearRunHistoryRecords() {
    const activeRunIds = new Set(visibleRunHistory.map((record) => record.id));
    const preserved = runHistory.filter((record) => {
      if (!activeRunIds.has(record.id)) return true;
      return run.id && run.status === "running" && record.id === run.id;
    });
    setRunHistory(preserved);
    setExpandedRunIds((current) => current.filter((id) => preserved.some((record) => record.id === id)));
    try {
      const json = preserved.length
        ? await apiFetch("/api/pipeline-runs", { runs: preserved })
        : await apiDelete("/api/pipeline-runs");
      if (!json.ok) throw new Error(json.message || json.error || "Run 历史清空失败");
      setLastResult({
        tone: "success",
        title: "Run 历史已清理",
        detail: run.id && run.status === "running"
          ? "已清空当前 workflow 历史，并保留当前运行中的 Pipeline Run。"
          : "当前 workflow 的 Pipeline Run 历史已清空。"
      });
    } catch (error) {
      setLastResult({ tone: "warning", title: "Run 历史清理失败", detail: error.message });
    }
  }

  function viewRunRecord(record) {
    setExpandedRunIds((current) => toggleExpandedRunIds(current, record.id));
  }

  useEffect(() => {
    if (!pendingRunAction || !profile) return;
    if (pendingRunAction.workflowId && pendingRunAction.workflowId !== activeWorkflowId) return;
    const record = pendingRunAction.record;
    if (!runTargetMatches(record.target)) return;
    const services = hydrateServiceSnapshot(record.serviceSnapshot, record.target);
    if (!services.length) {
      setPendingRunAction(null);
      setLastResult({ tone: "warning", title: "Pipeline 未启动", detail: "历史 Run 没有可复制的服务快照。" });
      return;
    }
    setPendingRunAction(null);
    if (pendingRunAction.action === "resume") {
      resumePipeline(record, services);
    } else {
      startPipeline(record.templateId, services, {
        releaseReason: record.releaseReason,
        releaseNotice: record.releaseNotice,
        copiedFromRunId: record.id
      });
    }
  }, [pendingRunAction, activeWorkflowId, activeProfileId, activeAccountId, appCode, branch, buildStrategy, releaseEnvId, profile?.id, serviceMeta]);

  function replaceProbe(profileId, accountId, kind, result) {
    const key = accountId ? `${profileId}:${accountId}` : profileId;
    setProbes((current) => ({
      ...current,
      [key]: {
        ...(current[key] || {}),
        [kind]: result
      }
    }));
  }

  function pickReleaseApp(releaseResult) {
    const card = releaseResult?.environments?.find((item) =>
      item.environment?.showNameEn === env?.showNameEn &&
      item.environment?.environmentFlag === env?.environmentFlag
    );
    return card?.apps?.find((item) => item.applicationCode === appCode) || null;
  }

  async function runProbe(kind, overrides = {}) {
    const targetProfile = profiles.find((item) => item.id === (overrides.profileId || profile?.id));
    const targetAccount = targetProfile?.accounts?.find((item) => item.id === (overrides.accountId || account?.id)) || targetProfile?.accounts?.[0];
    if (!targetProfile || !targetAccount) return null;
    if (!overrides.silentBusy) setBusy(`${kind}-probe`);
    try {
      const payload = {
        profileId: targetProfile.id,
        accountId: targetAccount.id,
        customerNameEn: targetProfile.customerNameEn,
        applicationCode: overrides.applicationCode || appCode,
        codeBranch: overrides.branch || branch,
        environmentId: overrides.environmentId || env?.id,
        showNameEn: overrides.showNameEn || env?.showNameEn,
        environmentFlag: overrides.environmentFlag || env?.environmentFlag,
        applicationVersion: overrides.applicationVersion,
        fast: overrides.fast !== false,
        serviceSearch: overrides.serviceSearch ?? serviceSearch,
        servicePageNumber: overrides.servicePageNumber ?? servicePage,
        servicePageSize: overrides.servicePageSize ?? servicePageSize
      };
      const json = await apiFetchWithRetry(`/api/probe/${kind}`, payload, {
        attempts: overrides.retryAttempts || 1,
        delayMs: overrides.retryDelayMs || READ_RETRY_DELAY_MS,
        onRetry: overrides.onRetry
      });
      applyBootstrapPayload(json);
      const result = json.result || json;
      const currentProbeKey = `${targetProfile.id}:${targetAccount.id}`;
      const keptPrevious = Boolean(probes[currentProbeKey]?.[kind]);
      if (result.ok) {
        replaceProbe(targetProfile.id, targetAccount.id, kind, result);
      }
      setLastResult({
        tone: result.ok ? "success" : "danger",
        title: `${targetProfile.shortName} ${kind === "build" ? "构建探测" : "发布探测"}`,
        detail: result.ok ? "探测完成" : `${summarizeFailure(result)}${keptPrevious ? "；已保留上一次成功数据。" : ""}`
      });
      return result;
    } catch (error) {
      setLastResult({ tone: "danger", title: "探测失败", detail: error.message });
      return { ok: false, error: error.message };
    } finally {
      if (!overrides.silentBusy) setBusy("");
    }
  }

  async function refreshBoth(overrides = {}) {
    setRefreshing(true);
    try {
      const nextOverrides = {
        serviceSearch,
        ...overrides,
        silentBusy: true
      };
      const probes = [runProbe("build", nextOverrides)];
      if (releaseRequired(overrides.branch || branch)) probes.push(runProbe("release", nextOverrides));
      const [build, release = null] = await Promise.all(probes);
      return { build, release };
    } finally {
      setRefreshing(false);
    }
  }

  function refreshServicePage(nextPage = servicePage, nextPageSize = servicePageSize, nextSearch = serviceSearch) {
    setServicePage(nextPage);
    setServicePageSize(nextPageSize);
    setServiceSearch(nextSearch);
    return refreshBoth({
      serviceSearch: nextSearch,
      servicePageNumber: nextPage,
      servicePageSize: nextPageSize
    });
  }

  async function refreshReleaseOnly(overrides = {}) {
    setRefreshing(true);
    try {
      return await runProbe("release", { ...overrides, silentBusy: true, fast: false });
    } finally {
      setRefreshing(false);
    }
  }

  function toggleService(row) {
    const key = serviceKey(row, profile, appCode, branch);
    if (!selectedKeys.includes(key)) {
      const service = serviceFromRow(row);
      if (service) mergeServiceMeta({ [key]: service });
    }
    setSelectedKeys((current) => current.includes(key) ? removeSelectedServiceKey(current, key) : [...current, key]);
  }

  function defaultReleaseReason(services = selectedServices) {
    return runDraft.releaseReason || DEFAULT_RELEASE_REASON;
  }

  function defaultReleaseNotice() {
    return runDraft.releaseNotice || DEFAULT_RELEASE_NOTICE;
  }

  function removeSelectedService(key) {
    setSelectedKeys((current) => removeSelectedServiceKey(current, key));
  }

  function removeHiddenSelectedServices() {
    const hiddenKeys = new Set(hiddenSelectedServices.map((service) => service.serviceKey).filter(Boolean));
    if (!hiddenKeys.size) return;
    setSelectedKeys((current) => current.filter((key) => !hiddenKeys.has(key)));
  }

  function startSelectedPipeline(templateId) {
    if (hiddenSelectedServices.length) {
      setLastResult({
        tone: "warning",
        title: "Pipeline 未启动",
        detail: `当前选择包含不在当前服务页/过滤结果里的隐藏服务：${selectedServicesText(hiddenSelectedServices)}。请先移除隐藏选择，或刷新/切换过滤条件后只保留本次要启动的服务。`
      });
      return;
    }
    startPipeline(templateId, selectedServices);
  }

  function releaseOnlyServiceSnapshot() {
    return {
      serviceKey: `${profile?.id || "profile"}::${appCode}::${env?.showNameEn || "release"}::release-existing`,
      imageJenkinsName: `${appCode} 发布平台待处理服务`,
      imageNameEn: appCode,
      applicationCode: appCode,
      codeBranch: branch,
      releaseOnly: true
    };
  }

function buildImagesFor(services) {
  return services.map((service) => ({
      imageJenkinsName: service.imageJenkinsName,
      imageNameEn: service.imageNameEn,
      imageVersion: service.generatedVersion || service.imageVersion,
      imageDeployId: service.imageDeployId,
    applicationCode: service.applicationCode || appCode,
    coverageRun: service.coverageRun
  })).map((image) => Object.fromEntries(Object.entries(image).filter(([, value]) => value !== undefined && value !== null && value !== "")));
}

  function staleTaskIdsFromBuildResult(build, snapshot) {
    return Array.from(new Set([
      build?.taskId,
      taskIdOf(snapshot?.task),
      snapshot?.task?.structureApplyId,
      snapshot?.task?.applyId
    ].filter(Boolean).map(String)));
  }

  function buildTaskLookupImagesFor(services, options = {}) {
    return buildImagesFor(services).map((image) => {
      if (!options.ignoreVersion) return image;
      const { imageVersion, ...rest } = image;
      return rest;
    });
  }

  async function ensurePlatformReady(templateId) {
    const releaseNeeded = releaseRequired(branch) && templateId !== "build-only";
    if (!buildProbe?.ok && templateId !== "release-existing") {
      addActivity("自动探测构建平台", `${profile.shortName} / ${appCode}`, "default");
      const build = await runProbe("build", { silentBusy: true });
      if (!build?.ok) return { ok: false, error: "build_probe_failed", message: summarizeFailure(build) };
    }
    if (releaseNeeded && !releaseProbe?.ok) {
      addActivity("自动探测发布平台", `${profile.shortName} / ${env?.showNameEn}/${env?.environmentFlag}`, "default");
      const release = await runProbe("release", { silentBusy: true });
      if (!release?.ok) return { ok: false, error: "release_probe_failed", message: summarizeFailure(release) };
    }
    emitCommandEvent("probe", "done", releaseNeeded ? "build+release ready" : "build ready");
    return { ok: true };
  }

  async function readBuildStatusFor(services, options = {}) {
    if (!services.length) return { ok: false, error: "service_not_selected" };
    const logActivity = options.logActivity !== false && !options.quiet;
    if (logActivity) addActivity("读取构建状态", `${selectedServicesText(services)} / ${branch}`);
    const nextMeta = {};
    const updated = [];
    for (const service of services) {
      const payload = {
        profileId: profile.id,
        accountId: account.id,
        customerNameEn: profile.customerNameEn,
        applicationCode: service.applicationCode || appCode,
        codeBranch: service.codeBranch || branch,
        imageJenkinsName: service.imageJenkinsName
      };
      const json = await apiFetchWithRetry("/api/probe/build-service", payload, {
        attempts: options.retryAttempts || 1,
        delayMs: options.retryDelayMs || READ_RETRY_DELAY_MS,
        onRetry: options.logRetryActivity ? ({ attempt, attempts, message }) => {
          addActivity("构建状态读取重试", `${service.imageJenkinsName} 第 ${attempt}/${attempts - 1} 次失败：${message}`, "warning");
        } : null
      });
      const result = json.result || json;
      if (!result.ok) {
        const message = `${service.imageJenkinsName}: ${summarizeFailure(result)}`;
        if (options.logErrors !== false) addActivity("构建状态读取失败", message, "danger");
        if (options.updateOnFailure !== false) emitCommandEvent("build-status", "failed", message);
        return { ok: false, error: "build_status_failed", message };
      }
      nextMeta[service.serviceKey] = { detail: result };
      const currentImageVersion = Array.isArray(result.detail)
        ? result.detail.find((row) => row?.imageVersion)?.imageVersion
        : "";
      updated.push({
        ...service,
        detail: result,
        ...(currentImageVersion ? { imageVersion: currentImageVersion } : {})
      });
    }
    mergeServiceMeta(nextMeta);
    if (options.updateOnSuccess !== false) emitCommandEvent("build-status", "done", "service detail loaded");
    if (logActivity) {
      addActivity("构建状态读取完成", updated.map((service) => `${service.imageJenkinsName}: ${service.detail?.detail?.length || 0} 条`).join(" / "), "success");
    }
    return { ok: true, services: updated };
  }

  async function generateVersionFor(services) {
    if (branch === "develop") return { ok: true, services };
    addActivity("生成版本预检", `${selectedServicesText(services)} / ${flow.structureType || "prod"}`);
    const json = await apiFetch("/api/probe/image-version", {
      profileId: profile.id,
      accountId: account.id,
      customerNameEn: profile.customerNameEn,
      applicationCode: appCode,
      codeBranch: branch,
      structureType: flow.structureType || "prod",
      images: services.map((service) => ({ imageNameEn: service.imageNameEn }))
    });
    const result = json.result || json;
    if (!result.ok) {
      const message = summarizeFailure(result);
      addActivity("版本预检失败", message, "danger");
      emitCommandEvent("version", "failed", message);
      return { ok: false, error: "version_failed", message };
    }
    const versions = result.probe?.versions || {};
    const nextMeta = {};
    const updated = services.map((service) => {
      const generatedVersion = versions[service.imageNameEn] || service.generatedVersion;
      if (generatedVersion) nextMeta[service.serviceKey] = { generatedVersion };
      return { ...service, generatedVersion };
    });
    mergeServiceMeta(nextMeta);
    emitCommandEvent("version", "done", "versions generated");
    addActivity("版本预检完成", updated.map((service) => `${service.imageNameEn || service.imageJenkinsName}: ${service.generatedVersion || "未返回"}`).join(" / "), "success");
    return { ok: true, services: updated };
  }

  async function probeBuildTasksFor(services, options = {}) {
    if (!services.length) return { ok: false, error: "service_not_selected" };
    const primary = services[0];
    const json = await apiFetch("/api/probe/build-tasks", {
      profileId: profile.id,
      accountId: account.id,
      customerNameEn: profile.customerNameEn,
      applicationCode: appCode,
      codeBranch: branch,
      envType: branch,
      imageJenkinsName: primary.imageJenkinsName,
      imageNameEn: primary.imageNameEn,
      imageVersion: options.ignoreVersion ? "" : primary.generatedVersion || "",
      images: buildTaskLookupImagesFor(services, options),
      ignoreVersion: Boolean(options.ignoreVersion),
      maxTaskImageLookups: options.maxTaskImageLookups || 1,
      maxPendingApplyPages: options.maxPendingApplyPages || 1,
      taskPageNumber: options.taskPageNumber || 1,
      taskPageSize: options.taskPageSize || 20,
      taskStatus: options.taskStatus || "0"
    });
    const result = json.result || json;
    if (!result.ok) return { ok: false, error: "build_task_probe_failed", message: summarizeFailure(result), result };
    const snapshot = taskSnapshotFor(result, services, {
      ignoreVersion: options.ignoreVersion,
      preferMatchedTask: options.preferMatchedTask
    });
    return { ok: true, result, snapshot };
  }

  function syncVersionsFromTaskImages(services, images) {
    const nextMeta = {};
    const updated = services.map((service) => {
      const match = images.find((item) =>
        item.imageJenkinsName === service.imageJenkinsName || item.imageNameEn === service.imageNameEn
      );
      if (match?.imageVersion) nextMeta[service.serviceKey] = { generatedVersion: match.imageVersion };
      return match?.imageVersion ? { ...service, generatedVersion: match.imageVersion, imageVersion: match.imageVersion } : service;
    });
    if (Object.keys(nextMeta).length) mergeServiceMeta(nextMeta);
    return updated;
  }

  async function createOrReuseBuildTask(services, inputs = {}) {
    if (branch === "develop") return { ok: true, services, direct: true };
    const excludeTaskIds = new Set((inputs.excludeTaskIds || []).map(String).filter(Boolean));
    const isExcludedTask = (task) => excludeTaskIds.has(String(taskIdOf(task) || ""));
    addActivity("已有构建任务预检", `${selectedServicesText(services)} / ${appCode} / ${branch}`);
    const existing = await probeBuildTasksFor(services, { ignoreVersion: true, maxTaskImageLookups: 1, maxPendingApplyPages: 1 });
    if (!existing.ok) return existing;

    if (existing.result.tasks?.length) {
      if (existing.snapshot.publishStage) {
        addActivity(
          "忽略不可复用旧任务",
          `已有任务 ${taskIdOf(existing.snapshot.task) || "-"} 不在可复用待处理构建任务池，或已进入发布/处理状态（${existing.snapshot.publishStage}），继续新建当前 Pipeline 任务。`,
          "warning"
        );
      } else if (existing.snapshot.allBuildable && isExcludedTask(existing.snapshot.task)) {
        addActivity(
          "跳过过期构建任务",
          `任务 ${taskIdOf(existing.snapshot.task) || "-"} 刚才返回已有新版本构建，重新新建当前 Pipeline 任务。`,
          "warning"
        );
        emitCommandEvent("create-task", "running", "stale task skipped");
      } else if (existing.snapshot.allBuildable) {
        const updated = syncVersionsFromTaskImages(services, existing.snapshot.images);
        addActivity("复用已有构建任务", `${selectedServicesText(services)} 与任务 ${taskIdOf(existing.snapshot.task) || "-"} 服务组完全一致，跳过重复创建。`, "success");
        emitCommandEvent("create-task", "done", "reused existing task");
        return { ok: true, services: updated, reused: true, snapshot: existing.snapshot };
      } else if (existing.snapshot.allMatched) {
        const blocked = existing.snapshot.blockedImages?.map((item) => `${item.imageJenkinsName || item.imageNameEn || "unknown"}: ${buildPowerLabel(item.buildPower)}`).join(" / ");
        addActivity(
          "已有任务未开放构建",
          `任务 ${taskIdOf(existing.snapshot.task) || "-"} 服务组完全一致，但 ${blocked || "未全部开放构建"}；不复用历史不可构建任务，继续为当前 Pipeline 新建任务。`,
          "warning"
        );
        emitCommandEvent("create-task", "running", "服务组一致但未开放构建，继续新建当前 Pipeline 任务。");
      } else {
        const mismatch = serviceGroupMismatchText(existing.snapshot, services);
        addActivity(
          "已有任务不可复用",
          `最新待处理任务 ${taskIdOf(existing.snapshot.task) || "-"} 的服务组与当前选择不一致：${mismatch}。这只表示不能复用旧任务，继续为当前 Pipeline 新建任务。`,
          "warning"
        );
        emitCommandEvent("create-task", "running", "已有任务不可复用，继续新建当前 Pipeline 任务。");
      }
    }

    addActivity("创建构建任务", `${selectedServicesText(services)} / ${flow.label}`);
    const json = await apiFetch("/api/execute/build-task", {
      profileId: profile.id,
      accountId: account.id,
      customerNameEn: profile.customerNameEn,
      applicationCode: appCode,
      applicationName: appCode,
      codeBranch: branch,
      flowMode: flow.mode,
      structureType: flow.structureType,
      deploymentDescribe: inputs.reason,
      deploymentExplain: inputs.notice,
      releaseContent: `${inputs.reason}；${inputs.notice}`,
      buildType: flow.structureType || "release",
      envName: branch,
      buildImages: buildImagesFor(services),
      recoverDuplicateBuildInfo: true,
      confirmText: buildConfirmText("创建构建任务", services)
    });
    const result = json.result || json;
    if (!result.ok) {
      const message = summarizeFailure(result);
      if (result.duplicateBuildInfo || isDuplicateBuildInfoMessage(message)) {
        addActivity("平台提示已有构建信息", `${message}；改为定位并复用已有任务。`, "warning");
        const duplicateExisting = await probeBuildTasksFor(services, {
          ignoreVersion: true,
          maxTaskImageLookups: 1,
          maxPendingApplyPages: 1,
          preferMatchedTask: true
        });
        if (duplicateExisting.ok && duplicateExisting.snapshot.allBuildable && !duplicateExisting.snapshot.publishStage && !isExcludedTask(duplicateExisting.snapshot.task)) {
          const updated = syncVersionsFromTaskImages(services, duplicateExisting.snapshot.images);
          addActivity("复用已有构建任务", `平台拒绝重复创建后，已定位服务组完全一致的任务 ${taskIdOf(duplicateExisting.snapshot.task) || "-"}，跳过重复创建。`, "success");
          emitCommandEvent("create-task", "done", "reused existing task after duplicate build info");
          return { ok: true, services: updated, reused: true, snapshot: duplicateExisting.snapshot };
        }
        const duplicateBlockReason = duplicateExisting.ok && duplicateExisting.snapshot.publishStage
          ? `服务组完全一致的任务 ${taskIdOf(duplicateExisting.snapshot.task) || "-"} 不可复用：${duplicateExisting.snapshot.publishStage}。`
          : duplicateExisting.ok && duplicateExisting.snapshot.allBuildable && isExcludedTask(duplicateExisting.snapshot.task)
          ? `服务组完全一致的任务 ${taskIdOf(duplicateExisting.snapshot.task) || "-"} 刚才返回已有新版本构建，已跳过旧任务。`
          : duplicateExisting.ok && duplicateExisting.snapshot.allMatched
          ? `服务组完全一致的任务 ${taskIdOf(duplicateExisting.snapshot.task) || "-"} 当前未开放全部构建权限。`
          : "";
        const recoverMessage = duplicateExisting.ok
          ? `平台提示已有构建信息，但未定位到可复用的当前服务任务：${duplicateBlockReason || serviceGroupMismatchText(duplicateExisting.snapshot, services)}。`
          : `平台提示已有构建信息，但复用定位失败：${duplicateExisting.message || summarizeFailure(duplicateExisting)}。`;
        addActivity("已有构建信息定位失败", recoverMessage, "danger");
        emitCommandEvent("create-task", "failed", recoverMessage);
        return { ok: false, error: "duplicate_build_info_not_recoverable", message: recoverMessage };
      }
      addActivity("构建任务创建失败", message, "danger");
      emitCommandEvent("create-task", "failed", message);
      return { ok: false, error: "create_task_failed", message };
    }

    let updated = services;
    if (result.versionProbe?.versions) {
      updated = services.map((service) => {
        const generatedVersion = result.versionProbe.versions[service.imageNameEn] || service.generatedVersion;
        return { ...service, generatedVersion };
      });
      const patch = {};
      for (const service of updated) {
        if (service.generatedVersion) patch[service.serviceKey] = { generatedVersion: service.generatedVersion };
      }
      mergeServiceMeta(patch);
    }
    if (result.recovered) {
      const snapshot = taskSnapshotFor({
        matchedTask: result.task || null,
        taskImagesByTask: [{
          task: result.task || null,
          images: result.images || []
        }]
      }, updated, { preferMatchedTask: true });
      emitCommandEvent("create-task", "done", "recovered duplicate apply");
      addActivity(
        "构建申请编辑恢复完成",
        `已将已有申请 ${taskIdOf(result.task) || result.duplicateRecovery?.applyId || "-"} 编辑为当前服务组：${selectedServicesText(updated)}。`,
        "success"
      );
      return { ok: true, services: updated, created: true, recovered: true, snapshot };
    }
    emitCommandEvent("create-task", "done", "created");
    addActivity("构建任务创建完成", result.reused ? "已复用已有任务。" : "构建平台已接受任务创建请求。", "success");
    return { ok: true, services: updated, created: true };
  }

  async function waitForBuildableTask(services, options = {}) {
    const attempts = options.expectCreatedTask ? 8 : 5;
    const maxTaskImageLookups = 1;
    const excludeTaskIds = new Set((options.excludeTaskIds || []).map(String).filter(Boolean));
    const isExcludedSnapshot = (snapshot) => excludeTaskIds.has(String(taskIdOf(snapshot?.task) || ""));
    for (let index = 0; index < attempts; index += 1) {
      const probe = await probeBuildTasksFor(services, { maxTaskImageLookups, preferMatchedTask: true });
      if (!probe.ok) {
        addActivity("定位构建任务失败", probe.message, "danger");
        return probe;
      }
      if (!probe.snapshot.allMatched && !options.expectCreatedTask) {
        const message = `已有任务不可复用：${serviceGroupMismatchText(probe.snapshot, services)}。`;
        addActivity("构建任务不可复用", message, "warning");
        emitCommandEvent("build-task", "blocked", message);
        return { ok: false, error: "task_group_mismatch", message, blocked: true };
      }
      if (probe.snapshot.allBuildable && isExcludedSnapshot(probe.snapshot)) {
        addActivity(
          "跳过过期构建任务",
          `任务 ${taskIdOf(probe.snapshot.task) || "-"} 刚才返回已有新版本构建，继续等待新任务服务行。`,
          "warning"
        );
        emitCommandEvent("build-task", "running", "stale task skipped while waiting buildable task");
        await new Promise((resolve) => setTimeout(resolve, options.expectCreatedTask ? 2000 : 1500));
        continue;
      }
      if (probe.snapshot.allBuildable) {
        addActivity("任务内构建已就绪", `任务 ${taskIdOf(probe.snapshot.task) || "-"} / ${selectedServicesText(services)} 均已开放构建。`, "success");
        emitCommandEvent("build-task", "done", "all services buildable");
        return probe;
      }
      const blocked = probe.snapshot.blockedImages?.map((item) => `${item.imageJenkinsName || item.imageNameEn || "unknown"}: ${buildPowerLabel(item.buildPower)}`).join(" / ");
      const detail = blocked ? `未开放服务：${blocked}` : "未全部开放构建。";
      addActivity("等待任务开放构建", `第 ${index + 1}/${attempts} 次，${detail}`, "warning");
      await new Promise((resolve) => setTimeout(resolve, options.expectCreatedTask ? 2000 : 1500));
    }
    const finalProbe = await probeBuildTasksFor(services, { maxTaskImageLookups, preferMatchedTask: true });
    const mismatch = finalProbe?.ok ? serviceGroupMismatchText(finalProbe.snapshot, services) : "";
    const message = finalProbe?.ok && isExcludedSnapshot(finalProbe.snapshot)
      ? `最新构建任务 ${taskIdOf(finalProbe.snapshot.task) || "-"} 是刚跳过的旧任务，仍未定位到新的可构建任务服务行。`
      : options.expectCreatedTask && finalProbe?.ok && !finalProbe.snapshot.allMatched
      ? `新建构建任务已被平台接受，但当前服务组尚未出现在可构建任务列表中；Workbench 不复用旧任务。最新不可复用任务信息：${mismatch}。`
      : finalProbe?.ok && !finalProbe.snapshot.allMatched
      ? `最新构建任务服务组与当前选择不一致：${mismatch}。`
      : "已有构建任务已定位，但当前服务组还没有全部开放构建；可能任务仍在生成服务行，或平台尚未开放任务内构建。";
    addActivity("任务内构建阻塞", message, "warning");
    emitCommandEvent("build-task", "blocked", message);
    return { ok: false, error: "task_build_not_ready", message, blocked: true };
  }

  async function executeBuildFor(services, snapshot = null) {
    const direct = branch === "develop";
    const images = direct ? buildImagesFor(services) : (snapshot?.images || []).map((item, index) => ({
      imageJenkinsName: item.imageJenkinsName || services[index]?.imageJenkinsName,
      imageNameEn: item.imageNameEn || services[index]?.imageNameEn,
      imageVersion: item.imageVersion || services[index]?.generatedVersion,
      applicationCode: item.applicationCode || services[index]?.applicationCode || appCode,
      coverageRun: item.coverageRun || services[index]?.coverageRun
    }));
    const task = snapshot?.task || {};
    const pendingApply = Boolean(task.pendingApply || task.buildAll || task.source === "structureListPage");
    const applyId = task.structureApplyId || task.applyId || (pendingApply ? taskIdOf(task) : "");
    const taskId = pendingApply ? "" : taskIdOf(task);
    addActivity(
      direct ? "执行开发构建" : "执行任务内构建",
      `${selectedServicesText(services)}${direct ? "" : pendingApply ? ` / apply=${applyId || "-"}` : ` / task=${taskId || "-"}`}`
    );
    const json = await apiFetch("/api/execute/build", {
      profileId: profile.id,
      accountId: account.id,
      customerNameEn: profile.customerNameEn,
      applicationCode: appCode,
      applicationName: appCode,
      codeBranch: branch,
      envType: branch,
      taskId,
      applyId,
      buildAll: pendingApply,
      buildImages: images,
      confirmText: buildConfirmText("执行构建", services)
    });
    const result = json.result || json;
    if (!result.ok) {
      const message = summarizeFailure(result);
      if (direct && isBuildAlreadyRunningResult(result)) {
        const error = "direct_build_already_running";
        const blockedMessage = `${message}；开发环境不接入已有构建，当前 Pipeline 已暂停，稍后点击继续会重新预检。`;
        addActivity("开发构建已暂停", blockedMessage, "warning");
        emitCommandEvent("build", "blocked", blockedMessage);
        return { ok: false, blocked: true, error, message: blockedMessage };
      }
      if (shouldRestartBuildTaskAfterBuildTriggerFailure(result)) {
        addActivity("构建任务版本已过期", `${message}；重新进入构建任务定位，能复用则复用，否则新建当前 Pipeline 任务。`, "warning");
        emitCommandEvent("build-task", "running", "stale build snapshot; reselect task");
        return {
          ok: false,
          error: "build_snapshot_stale",
          staleBuildSnapshot: true,
          taskId: taskId || applyId || "",
          message
        };
      }
      if (shouldObserveAfterBuildTriggerFailure(result)) {
        addActivity("构建触发待确认", `${message}；构建平台可能已接受请求或服务已在构建中，进入构建观察。`, "warning");
        emitCommandEvent("build", "running", "trigger uncertain; observing build status");
        return {
          ok: true,
          uncertain: true,
          result,
          message
        };
      }
      addActivity("构建触发失败", message, "danger");
      emitCommandEvent("build", "failed", message);
      return { ok: false, error: "build_failed", message };
    }
    emitCommandEvent("build", "running", "build triggered");
    addActivity("构建已触发", `${selectedServicesText(services)} 已调用构建平台，平台业务码 ${result.response?.businessCode || "未知"}。`, "success");
    return { ok: true, result };
  }

  async function probeBuildApplyFor(services, snapshot = null, options = {}) {
    if (branch === "develop") return { ok: true, task: null, images: [] };
    const task = snapshot?.task || {};
    const applyId = task.structureApplyId || task.applyId || taskIdOf(task);
    if (!applyId) {
      return {
        ok: false,
        error: "missing_apply_id",
        message: "缺少构建任务 applyId，无法继续执行构建平台发布按钮。"
      };
    }
    const primary = services[0] || {};
    const payload = {
      profileId: profile.id,
      accountId: account.id,
      customerNameEn: profile.customerNameEn,
      applicationCode: appCode,
      codeBranch: branch,
      envType: branch,
      applyId,
      imageJenkinsName: primary.imageJenkinsName,
      imageNameEn: primary.imageNameEn,
      images: buildTaskLookupImagesFor(services, { ignoreVersion: true }),
      ignoreVersion: true,
      maxApplyPages: 5
    };
    const json = await apiFetchWithRetry("/api/probe/build-apply", payload, {
      attempts: options.retryAttempts || 1,
      delayMs: options.retryDelayMs || READ_RETRY_DELAY_MS,
      onRetry: options.logRetryActivity ? ({ attempt, attempts, message }) => {
        addActivity("构建任务状态读取重试", `第 ${attempt}/${attempts - 1} 次失败：${message}`, "warning");
      } : null
    });
    const result = json.result || json;
    if (!result.ok) {
      return { ok: false, error: "build_apply_probe_failed", message: summarizeFailure(result), result };
    }
    return { ok: true, ...result };
  }

  async function confirmBuildPlatformPublishFor(applySignal, services) {
    const applyId = applySignal?.taskId;
    const publishEnvironment = applySignal?.publishEnvironment;
    if (!applyId || publishEnvironment == null || publishEnvironment === "") {
      return {
        ok: false,
        error: "missing_build_platform_publish_params",
        message: "构建平台发布按钮缺少 applyId 或发布环境。"
      };
    }

    const label = buildPublishEnvironmentLabel(publishEnvironment);
    setRunPhase(`构建平台${label}`);
    addActivity(`构建平台${label}`, `apply=${applyId} / ${selectedServicesText(services)}`);
    const json = await apiFetch("/api/execute/build-platform-publish", {
      profileId: profile.id,
      accountId: account.id,
      customerNameEn: profile.customerNameEn,
      applicationCode: appCode,
      applyId,
      publishEnvironment,
      confirmText: buildPlatformPublishConfirmText(applyId)
    });
    const result = json.result || json;
    if (!result.ok) {
      const message = summarizeFailure(result);
      addActivity(`构建平台${label}失败`, message, "danger");
      emitCommandEvent("build-platform-publish", "failed", message);
      return { ok: false, error: "build_platform_publish_failed", message };
    }
    addActivity(`构建平台${label}完成`, `apply=${applyId} 已提交，继续等待发布平台记录。`, "success");
    emitCommandEvent("build-platform-publish", "done", label);
    return { ok: true, result };
  }

  async function probeReleaseDetailFor(app, options = {}) {
    if (!app || !env) return { ok: false, error: "release_target_not_ready" };
    const payload = {
      profileId: profile.id,
      accountId: account.id,
      customerNameEn: profile.customerNameEn,
      environmentId: env.id,
      applicationCode: appCode,
      applicationVersion: app.applicationVersion
    };
    const json = await apiFetchWithRetry("/api/probe/release-detail", payload, {
      attempts: options.retryAttempts || READ_RETRY_ATTEMPTS,
      delayMs: options.retryDelayMs || READ_RETRY_DELAY_MS,
      onRetry: ({ attempt, attempts, message }) => {
        addActivity("发布清单读取重试", `第 ${attempt}/${attempts - 1} 次失败：${message}`, "warning");
      }
    });
    const result = json.result || json;
    if (!result.ok) return { ok: false, error: "release_detail_failed", message: summarizeFailure(result) };
    addActivity("发布清单读取完成", `${appCode} ${app.applicationVersion} / ${env.showNameEn}/${env.environmentFlag}`, "success");
    emitCommandEvent("release-detail", "done", "release detail loaded");
    return { ok: true, result };
  }

  async function publishFor(stage, app, detailResult = null) {
    const label = stage === "spot" ? "现场发布" : "公司发布";
    const stageServices = publishableServicesForStage(detailResult, stage);
    const pendingCount = stageServices ? stageServices.length : Number(app?.toPublishServiceNum || 0);
    if (!app || pendingCount === 0) {
      const message = `${label}没有可发布服务，可能已被合并发布或其他 Pipeline 处理。`;
      addActivity(`${label}无需处理`, message, "success");
      emitCommandEvent(`publish-${stage}`, "done", "no publishable services");
      return { ok: true, skipped: true, reason: "no_publishable_services" };
    }
    addActivity(label, `${profile.shortName} / ${appCode} ${app.applicationVersion} / ${env.showNameEn}/${env.environmentFlag}`);
    const json = await apiFetch("/api/execute/publish", {
      profileId: profile.id,
      accountId: account.id,
      customerNameEn: profile.customerNameEn,
      environmentId: env.id,
      showNameEn: env.showNameEn,
      environmentFlag: env.environmentFlag,
      environment: stage,
      applicationCode: appCode,
      applicationVersion: app.applicationVersion,
      confirmText: `发布 ${profile.shortName} ${appCode} ${env.showNameEn}/${env.environmentFlag}`
    });
    const result = json.result || json;
    if (!result.ok) {
      const message = summarizeFailure(result);
      const blocked = Boolean(result.blocked || isRetryableProbeResult(result) || /^publish_.*(timeout|unavailable|failed)$/i.test(String(result.reason || "")));
      addActivity(`${label}${blocked ? "暂停" : "失败"}`, message, blocked ? "warning" : "danger");
      emitCommandEvent(`publish-${stage}`, blocked ? "blocked" : "failed", message);
      return { ok: false, blocked, error: blocked ? "publish_blocked" : "publish_failed", message };
    }
    const rateText = result.publishRate?.results?.map((item) => `${item.payload?.applicationCode || appCode} ${item.signal?.value ?? "100"}%`).join(" / ");
    addActivity(`${label}完成`, `${appCode} ${app.applicationVersion} 已提交发布平台并确认完成${rateText ? `：${rateText}` : ""}。`, "success");
    emitCommandEvent(`publish-${stage}`, "done", "publish confirmed");
    return { ok: true, result };
  }

  async function observeBuildCompletion(services, options = {}) {
    const intervalMs = options.intervalMs || PIPELINE_OBSERVER_INTERVAL_MS;
    const buildTimeoutMs = options.buildTimeoutMs || PIPELINE_BUILD_OBSERVER_TIMEOUT_MS;
    const buildSnapshot = options.buildSnapshot || null;
    const buildBaseline = options.buildBaseline || null;
    const confirmedBuildPublishes = new Set();
    const buildStartedAt = Date.now();

    for (let attempt = 1; ; attempt += 1) {
      const buildElapsedMs = Date.now() - buildStartedAt;
      setRunPhase("等待构建完成");
      const status = await readBuildStatusFor(services, {
        quiet: true,
        logActivity: false,
        logErrors: false,
        logRetryActivity: true,
        retryAttempts: READ_RETRY_ATTEMPTS,
        retryDelayMs: READ_RETRY_DELAY_MS
      });
      if (!status.ok) {
        const message = `第 ${attempt} 次读取构建状态失败：${status.message || summarizeFailure(status)}。将在构建观察预算内继续重试。`;
        addActivity("观察构建进度", message, "warning");
        emitCommandEvent("build-observe", buildElapsedMs >= buildTimeoutMs ? "blocked" : "running", message);
        if (buildElapsedMs >= buildTimeoutMs) {
          return {
            ok: false,
            error: "build_status_observe_timeout",
            message: `已观察构建 ${durationText(buildElapsedMs)}，超过上限 ${durationText(buildTimeoutMs)}，构建状态接口仍不可用；Pipeline 暂停，可稍后从当前阶段重试。`,
            blocked: true
          };
        }
        await sleep(intervalMs);
        continue;
      }

      const buildSignals = status.services.map((service) => ({
        ...buildSignalForService(service, service.detail, { baseline: directBuildBaselineForService(service, buildBaseline) }),
        structureDetail: service.detail?.structureDetail || null
      }));
      let applySignal = null;
      if (buildSnapshot && branch !== "develop") {
        const applyProbe = await probeBuildApplyFor(services, buildSnapshot, {
          logRetryActivity: true,
          retryAttempts: READ_RETRY_ATTEMPTS,
          retryDelayMs: READ_RETRY_DELAY_MS
        });
        if (!applyProbe.ok) {
          const message = applyProbe.message || "构建任务状态读取失败。";
          if (isRetryableProbeResult(applyProbe) && buildElapsedMs < buildTimeoutMs) {
            const retryMessage = `第 ${attempt} 次读取构建任务状态失败：${message}。将在构建观察预算内继续重试。`;
            addActivity("构建任务状态读取暂不可用", retryMessage, "warning");
            emitCommandEvent("build-apply-observe", "running", retryMessage);
            await sleep(intervalMs);
            continue;
          }
          addActivity("构建任务状态读取失败", message, "danger");
          emitCommandEvent("build-apply-observe", "failed", message);
          return { ok: false, error: "build_apply_probe_failed", message };
        }
        applySignal = buildApplySignal(applyProbe.task);
      }
      patchRun({ buildSignals, buildApplySignal: applySignal });

      const failedBuild = buildSignals.find((item) => item.status === "failed");
      const failedApply = applySignal?.status === "failed" ? applySignal : null;
      if (failedBuild || failedApply) {
        const failedText = failedBuild
          ? `${failedBuild.service} 构建失败（${failedBuild.buildId || "无构建号"}）`
          : `构建任务 ${failedApply.taskId || "-"} 状态失败（${failedApply.reason}）`;
        const message = `${failedText}，Pipeline 停在构建阶段，可修复后重试。`;
        addActivity("构建失败", message, "danger");
        emitCommandEvent("build", "failed", message);
        emitCommandEvent("build-observe", "failed", message);
        return { ok: false, error: "build_failed", message };
      }

      const applyTaskId = applySignal?.taskId || taskIdOf(buildSnapshot?.task) || buildSnapshot?.task?.structureApplyId || "";
      const requiredBuildPublishEnvironments = buildPlatformPublishEnvironmentsFor(branch);
      const confirmedEnvironments = requiredBuildPublishEnvironments.filter((environment) =>
        confirmedBuildPublishes.has(`${applyTaskId}:${environment}`)
      );
      const publishProgress = buildPlatformPublishProgress({
        branch,
        applySignal,
        confirmedEnvironments
      });
      if (publishProgress.status === "failed") {
        const message = `构建任务 ${publishProgress.applySignal?.taskId || applyTaskId || "-"} 状态失败（${publishProgress.reason}），Pipeline 停在构建阶段，可修复后重试。`;
        addActivity("构建失败", message, "danger");
        emitCommandEvent("build", "failed", message);
        emitCommandEvent("build-observe", "failed", message);
        return { ok: false, error: "build_failed", message };
      }
      if (publishProgress.status === "confirm") {
        const confirmed = await confirmBuildPlatformPublishFor({
          ...(applySignal || {}),
          taskId: applyTaskId || applySignal?.taskId,
          publishEnvironment: publishProgress.environment
        }, services);
        if (!confirmed.ok) return confirmed;
        confirmedBuildPublishes.add(`${applyTaskId || applySignal?.taskId}:${publishProgress.environment}`);
        emitCommandEvent("build-platform-publish", "running", `${buildPlatformPublishEnvironmentsFor(branch).length - publishProgress.missingEnvironments.length + 1}/${buildPlatformPublishEnvironmentsFor(branch).length}`);
        await sleep(1000);
        continue;
      }
      if (requiredBuildPublishEnvironments.length && publishProgress.status === "complete") {
        const label = requiredBuildPublishEnvironments.map(buildPublishEnvironmentLabel).join(" + ");
        emitCommandEvent("build-platform-publish", "done", label);
      }
      const decisionApplySignal = requiredBuildPublishEnvironments.length && publishProgress.status === "complete"
        ? buildPlatformPublishSubmittedSignal(applySignal || {}, applyTaskId)
        : applySignal;
      const decision = pipelineObservationDecision({
        buildSignals,
        applySignal: decisionApplySignal,
        releaseSignal: releaseRecordSignal(null),
        attempt,
        elapsedMs: buildElapsedMs,
        timeoutMs: buildTimeoutMs
      });

      if (decision.status === "running" && decision.reason !== "release_record_waiting") {
        const waiting = buildSignals
          .filter((item) => item.status !== "succeeded")
          .map((item) => `${item.service}${item.version ? `/${item.version}` : ""}`)
          .join(" / ");
        const applyText = applySignal?.status && applySignal.status !== "published"
          ? `；构建任务状态 ${applySignal.applyStatus || "-"}`
          : "";
        const message = `第 ${attempt} 次，已等待 ${durationText(buildElapsedMs)} / 上限 ${durationText(buildTimeoutMs)}，构建仍在进行：${waiting || selectedServicesText(services)}${applyText}。`;
        addActivity("观察构建进度", message, "default");
        emitCommandEvent("build-observe", "running", message);
        await sleep(intervalMs);
        continue;
      }

      if (decision.status === "blocked" && decision.reason !== "release_record_timeout") {
        const message = decision.reason === "build_apply_observe_timeout"
          ? `已观察构建任务 ${durationText(buildElapsedMs)}，超过上限 ${durationText(buildTimeoutMs)}，仍未确认发布按钮可用；Pipeline 暂停，可从当前阶段重试。`
          : `已观察构建 ${durationText(buildElapsedMs)}，超过上限 ${durationText(buildTimeoutMs)}，仍未确认成功；Pipeline 暂停，可从当前阶段重试。`;
        addActivity("构建观察超时", message, "warning");
        emitCommandEvent("build-observe", "blocked", message);
        return {
          ok: false,
          error: decision.reason,
          message,
          blocked: true
        };
      }

      emitCommandEvent("build", "done", "build completed");
      emitCommandEvent("build-observe", "done", "build succeeded");
      return { ok: true };
    }
  }

  async function observeBuildAndReleaseReady(services, options = {}) {
    const intervalMs = options.intervalMs || PIPELINE_OBSERVER_INTERVAL_MS;
    const releaseTimeoutMs = options.releaseTimeoutMs || PIPELINE_RELEASE_OBSERVER_TIMEOUT_MS;
    const releaseNoopAfterMs = options.releaseNoopAfterMs ?? PIPELINE_RELEASE_EMPTY_NOOP_AFTER_MS;
    const releaseNoWait = Boolean(options.releaseNoWait);
    const buildResult = await observeBuildCompletion(services, options);
    if (!buildResult.ok) return buildResult;
    const buildSignals = [{ status: "succeeded" }];
    const decisionApplySignal = buildPlatformPublishSubmittedSignal({}, "");
    let releaseStartedAt = null;
    let releaseAttempt = 0;
    let latestApp = null;

    for (;;) {
      setRunPhase("等待发布记录");
      if (!releaseStartedAt) releaseStartedAt = Date.now();
      releaseAttempt += 1;
      const releaseElapsedMs = Date.now() - releaseStartedAt;
      const release = await runProbe("release", {
        silentBusy: true,
        fast: false,
        retryAttempts: READ_RETRY_ATTEMPTS,
        retryDelayMs: READ_RETRY_DELAY_MS,
        onRetry: ({ attempt: retryAttempt, attempts, message }) => {
          addActivity("发布总览读取重试", `第 ${retryAttempt}/${attempts - 1} 次失败：${message}`, "warning");
        }
      });
      if (!release?.ok) {
        const message = `第 ${releaseAttempt} 次，发布记录已等待 ${durationText(releaseElapsedMs)} / 上限 ${durationText(releaseTimeoutMs)}，发布总览暂未拿到 ${appCode} 可发布应用：${summarizeFailure(release)}。`;
        addActivity("观察发布记录", message, "warning");
        emitCommandEvent("release-observe", "running", message);
        if (releaseElapsedMs >= releaseTimeoutMs) {
          return {
            ok: false,
            error: "release_record_timeout",
            message: `构建已完成，但发布平台在 ${durationText(releaseElapsedMs)} 内仍未稳定返回 ${appCode} 待发布记录；Pipeline 暂停，可稍后从发布观察阶段重试。`,
            blocked: true
          };
        }
        await sleep(intervalMs);
        continue;
      }
      latestApp = pickReleaseApp(release);
      const releaseEnvironmentFound = Boolean(release?.environments?.some((item) =>
        item.environment?.showNameEn === env?.showNameEn &&
        item.environment?.environmentFlag === env?.environmentFlag
      ));
      const releaseSignal = releaseRecordSignal(latestApp, { environmentFound: releaseEnvironmentFound, applicationCode: appCode });
      const releaseDecision = pipelineObservationDecision({
        buildSignals,
        applySignal: decisionApplySignal,
        releaseSignal,
        attempt: releaseAttempt,
        elapsedMs: releaseElapsedMs,
        timeoutMs: releaseTimeoutMs
      });

      if (releaseDecision.status === "ready") {
        addActivity("发布记录已出现", `${appCode} 待发布服务 ${releaseSignal.pendingCount} 个，继续执行 ${releasePlanText(branch)}。`, "success");
        emitCommandEvent("release-observe", "done", "release record ready");
        return { ok: true, release, app: latestApp };
      }
      if (releaseDecision.status === "noop" && shouldNoopReleaseRecord({ releaseSignal, releaseNoWait, elapsedMs: releaseElapsedMs, noopAfterMs: releaseNoopAfterMs })) {
        const doneMessage = `${appCode} 在发布平台已无待发布服务，可能已被合并发布或其他 Pipeline 处理，发布段按无需处理结束。`;
        addActivity("发布记录无需处理", doneMessage, "success");
        emitCommandEvent("release-observe", "done", "no publishable release record");
        emitCommandEvent("release", "done", "no publishable release record");
        return {
          ok: true,
          release,
          app: latestApp,
          noPublishable: true
        };
      }

      const waitBudgetText = releaseDecision.status === "noop"
        ? `空记录确认 ${durationText(releaseElapsedMs)} / ${durationText(releaseNoopAfterMs)}`
        : `已等待 ${durationText(releaseElapsedMs)} / 上限 ${durationText(releaseTimeoutMs)}`;
      const message = `第 ${releaseAttempt} 次，发布记录${waitBudgetText}，发布平台还没有 ${appCode} 待发布记录。`;
      addActivity("观察发布记录", message, "warning");
      emitCommandEvent("release-observe", releaseDecision.status === "blocked" ? "blocked" : "running", message);
      if (releaseDecision.status === "blocked") {
        return {
          ok: false,
          error: "release_record_timeout",
          message: `构建已完成，但发布平台在 ${durationText(releaseElapsedMs)} 内仍未出现 ${appCode} 待发布记录；Pipeline 暂停，可稍后从发布观察阶段重试。`,
          blocked: true
        };
      }
      await sleep(intervalMs);
    }

    return {
      ok: false,
      error: "release_record_timeout",
      message: `发布平台当前没有 ${appCode} 待发布记录。`,
      blocked: true,
      app: latestApp
    };
  }

  async function executeReleaseFlow(services, options = {}) {
    const releaseStages = releaseStagesFor(branch);
    if (!releaseStages.length) {
      addActivity("发布策略完成", "develop 环境无需进入发布平台，构建完成即视为复合 Pipeline 的发布段完成。", "success");
      emitCommandEvent("release", "done", "skipped");
      return { ok: true, skipped: true };
    }
    setRunPhase("发布");
    const observed = options.observeBuild === false
      ? null
      : await observeBuildAndReleaseReady(services, {
          buildSnapshot: options.buildSnapshot,
          releaseNoWait: options.releaseNoWait,
          releaseNoopAfterMs: options.releaseNoopAfterMs
        });
    if (observed && !observed.ok) return observed;
    if (observed?.noPublishable) {
      addActivity("发布段完成", "发布平台已无待发布服务，本次 Pipeline 不再重复发布。", "success");
      emitCommandEvent("release", "done", "no publishable services");
      return { ok: true, skipped: true, reason: "no_publishable_services" };
    }
    const release = observed?.release || await runProbe("release", { silentBusy: true, fast: false });
    if (!release?.ok) return { ok: false, error: "release_probe_failed", message: summarizeFailure(release) };
    const app = observed?.app || pickReleaseApp(release);
    if (!releaseStages.includes("company")) {
      addActivity("公司发布跳过", `${branch} 环境策略为 ${releasePlanText(branch)}。`, "success");
      emitCommandEvent("publish-company", "done", "skipped by policy");
    }
    releaseStages.forEach((stage) => {
      emitCommandEvent(`publish-${stage}`, "running", `${releaseStageLabel(stage)} pending`);
    });
    let currentRelease = release;
    let currentApp = app;
    for (const stage of releaseStages) {
      if (stage !== releaseStages[0]) {
        currentRelease = await runProbe("release", { silentBusy: true, fast: false });
        if (!currentRelease?.ok) return { ok: false, error: "release_probe_failed", message: summarizeFailure(currentRelease) };
        currentApp = pickReleaseApp(currentRelease) || currentApp;
      }
      const detail = await probeReleaseDetailFor(currentApp);
      if (!detail.ok) return detail;
      const published = await publishFor(stage, currentApp, detail.result);
      if (!published.ok) return published;
    }
    emitCommandEvent("release", "done", `${releasePlanText(branch)} published`);
    return { ok: true, stages: releaseStages };
  }

  async function startPipeline(templateId, explicitServices = selectedServices, options = {}) {
    const services = explicitServices.filter(Boolean);
    const definition = pipelineById(templateId);
    if (!services.length) {
      setLastResult({ tone: "warning", title: "Pipeline 未启动", detail: "先选择一个或多个服务。" });
      return;
    }
    const reason = options.releaseReason?.trim() || runDraft.releaseReason?.trim() || defaultReleaseReason(services);
    const notice = options.releaseNotice?.trim() || runDraft.releaseNotice?.trim() || defaultReleaseNotice();
    const runId = options.runId || `${Date.now()}`;
    const createdAt = options.createdAt || new Date().toISOString();
    const copiedText = options.copiedFromRunId ? ` / 复制自 ${options.copiedFromRunId}` : "";
    const initialActivity = [{
      at: nowText(),
      title: `${definition.shortLabel} 已启动`,
      detail: `${selectedServicesText(services)} / ${appCode} / ${branch} / ${env?.showNameEn || "-"}${copiedText}`,
      tone: "default"
    }, ...(options.priorActivity || [])].slice(0, 120);
    const target = buildRunTarget();
    setBusy(`pipeline-${templateId}`);
    let initialServices = services;
    let initialBuildStatus = null;
    if (templateId !== "release-existing") {
      try {
        const status = await readBuildStatusFor(services, {
          quiet: true,
          logErrors: false,
          updateOnFailure: false,
          updateOnSuccess: false,
          retryAttempts: 1
        });
        if (status.ok) {
          initialBuildStatus = status;
          initialServices = status.services;
        }
      } catch {
        initialBuildStatus = null;
      }
    }
    const serviceSnapshot = initialServices.map(compactService);
    const runRecord = buildPipelineRun({
      templateId,
      target,
      services: serviceSnapshot,
      inputs: { releaseReason: reason, releaseNotice: notice },
      id: runId,
      now: createdAt
    });
    setExpandedRunIds((current) => Array.from(new Set([...current, runId])));
    setRun(normalizePipelineRunRecord({
      ...runRecord,
      copiedFromRunId: options.copiedFromRunId || "",
      started: true,
      status: "running",
      phase: "准备",
      releaseReason: reason,
      releaseNotice: notice,
      context: {
        ...runRecord.context,
        data: {
          ...(runRecord.context?.data || {}),
          buildSnapshot: null,
          buildBaseline: null
        }
      },
      activity: initialActivity
    }));
    setSelectedKeys([]);
    resetRunDraft();
    try {
      const ready = await ensurePlatformReady(templateId);
      if (!ready.ok) throw new Error(ready.message || ready.error);

      let workingServices = initialServices;
      let buildSnapshot = null;
      let buildBaseline = null;
      if (templateId !== "release-existing") {
        setRunPhase("构建预检");
        const status = initialBuildStatus || await readBuildStatusFor(workingServices, {
          quiet: true,
          logErrors: false,
          updateOnFailure: false,
          retryAttempts: 2
        });
        if (status.ok) {
          workingServices = status.services;
          if (branch === "develop") {
            buildBaseline = directBuildBaselineForServices(workingServices);
            patchRun({ buildBaseline, serviceSnapshot: workingServices.map(compactService) });
          } else {
            patchRun({ serviceSnapshot: workingServices.map(compactService) });
          }
        } else {
          if (branch === "develop") {
            const message = `${status.message || status.error}；开发环境直构建需要先确认服务是否可触发构建，当前 Pipeline 已暂停，稍后点击继续会重新预检。`;
            addActivity("开发构建预检暂停", message, "warning");
            emitCommandEvent("build-status", "blocked", message);
            setRunPhase("构建预检", "blocked");
            setLastResult({ tone: "warning", title: "Pipeline 已暂停", detail: message });
            return;
          } else {
            addActivity("构建状态预读跳过", `${status.message || status.error}；继续创建/复用构建任务，后续观察阶段会继续读取。`, "warning");
            emitCommandEvent("build-status", "running", "预读失败，继续 Pipeline");
          }
        }

        const version = await generateVersionFor(workingServices);
        if (!version.ok) throw new Error(version.message || version.error);
        workingServices = version.services;
        patchRun({ serviceSnapshot: workingServices.map(compactService) });

        setRunPhase("构建");
        const task = await createOrReuseBuildTask(workingServices, { reason, notice, excludeTaskIds: options.excludeTaskIds || [] });
        if (!task.ok) {
          if (task.blocked) {
            setRunPhase("等待处理", "blocked");
            setLastResult({ tone: "warning", title: "Pipeline 已暂停", detail: task.message });
            return;
          }
          throw new Error(task.message || task.error);
        }
        workingServices = task.services || workingServices;
        patchRun({ serviceSnapshot: workingServices.map(compactService), buildSnapshot: task.snapshot || null });

        if (branch === "develop") {
          const direct = await executeBuildFor(workingServices);
          if (!direct.ok) {
            if (direct.blocked) {
              setRunPhase("等待构建完成", "blocked");
              setLastResult({ tone: "warning", title: "Pipeline 已暂停", detail: direct.message });
              return;
            }
            throw new Error(direct.message || direct.error);
          }
        } else {
          const buildable = task.snapshot?.allBuildable
            ? task
            : await waitForBuildableTask(workingServices, { expectCreatedTask: task.created, excludeTaskIds: options.excludeTaskIds || [] });
          if (!buildable.ok) {
            setRunPhase("等待构建任务", "blocked");
            setLastResult({ tone: "warning", title: "Pipeline 已暂停", detail: buildable.message || "任务内构建暂不可用。" });
            return;
          }
          buildSnapshot = buildable.snapshot;
          workingServices = syncVersionsFromTaskImages(workingServices, buildSnapshot.images);
          patchRun({ buildSnapshot, serviceSnapshot: workingServices.map(compactService) });
          const build = await executeBuildFor(workingServices, buildSnapshot);
          if (!build.ok) {
            if (build.staleBuildSnapshot && !options.restartedAfterStaleSnapshot) {
              const excludeTaskIds = [
                ...(options.excludeTaskIds || []),
                ...staleTaskIdsFromBuildResult(build, buildable.snapshot)
              ];
              addActivity("重新定位构建任务", "旧构建任务返回已有新版本构建，回到任务策略层重新复用或新建。", "warning");
              await startPipeline(templateId, workingServices, {
                ...options,
                runId,
                createdAt,
                releaseReason: reason,
                releaseNotice: notice,
                excludeTaskIds,
                restartedAfterStaleSnapshot: true,
                priorActivity: [{
                  at: nowText(),
                  title: "Pipeline 重新定位",
                  detail: "旧构建任务版本已过期，跳过旧任务后重新定位可复用任务或新建任务。",
                  tone: "warning"
                }, ...initialActivity]
              });
              return;
            }
            throw new Error(build.message || build.error);
          }
        }
      }

      if (templateId !== "release-existing" && (templateId === "build-only" || branch === "develop")) {
        const observedBuild = await observeBuildCompletion(workingServices, { buildSnapshot, buildBaseline });
        if (!observedBuild.ok) {
          if (observedBuild.blocked) {
            setRunPhase("等待构建完成", "blocked");
            setLastResult({ tone: "warning", title: "Pipeline 已暂停", detail: observedBuild.message });
            return;
          }
          throw new Error(observedBuild.message || observedBuild.error);
        }
      }

      if (templateId !== "build-only") {
        const release = await executeReleaseFlow(workingServices, {
          observeBuild: templateId !== "release-existing",
          buildSnapshot,
          releaseNoWait: Boolean(options.releaseNoWait),
          releaseNoopAfterMs: options.releaseNoopAfterMs
        });
        if (!release.ok) {
          if (release.blocked) {
            setRunPhase(blockedPhaseForPipelineError(release.error), "blocked");
            setLastResult({ tone: "warning", title: "Pipeline 已暂停", detail: release.message });
            return;
          }
          throw new Error(release.message || release.error);
        }
      }

      setRunPhase("完成", "done");
      addActivity("Pipeline 完成", `${definition.label} 已执行到当前链路终点。`, "success");
      setLastResult({ tone: "success", title: "Pipeline 完成", detail: `${definition.label} / ${selectedServicesText(workingServices)}` });
    } catch (error) {
      setRunPhase("失败", "failed");
      addActivity("Pipeline 失败", error.message, "danger");
      setLastResult({ tone: "danger", title: "Pipeline 失败", detail: error.message });
    } finally {
      setBusy("");
    }
  }

  async function resumePipeline(record, explicitServices = []) {
    const normalized = normalizePipelineRunRecord(record);
    const services = explicitServices.length ? explicitServices : hydrateServiceSnapshot(normalized.serviceSnapshot, normalized.target);
    const startServices = (normalized.status === "draft" || normalized.started === false)
      ? hydrateServiceSnapshot(clonePipelineRunDraft(normalized).serviceSnapshot, normalized.target)
      : services;
    if (!canResumePipelineRun(normalized)) {
      setLastResult({ tone: "warning", title: "Run 不需要恢复", detail: "该 Pipeline Run 已完成或没有可恢复的失败/阻塞阶段。" });
      return;
    }
    if (!startServices.length) {
      setLastResult({ tone: "warning", title: "Run 无法恢复", detail: "历史 Run 缺少服务快照。" });
      return;
    }

    const resumePoint = inferResumePoint(normalized);
    const resumeCommandStage = resumePoint.stage;
    const savedBuildSnapshot = normalized.context?.data?.buildSnapshot || null;
    const savedBuildBaseline = normalized.context?.data?.buildBaseline || null;
    if (!resumePoint.commandId || resumeCommandStage === "start" || resumeCommandStage === "prepare") {
      await startPipeline(normalized.templateId, startServices, {
        runId: normalized.id,
        createdAt: normalized.createdAt,
        releaseReason: normalized.releaseReason,
        releaseNotice: normalized.releaseNotice,
        priorActivity: normalized.activity
      });
      return;
    }
    const resumeDevelopBuildObservation = normalized.target?.branch === "develop" && resumePoint.commandId === "observe-build" && savedBuildBaseline;
    if (resumeCommandStage === "build" && !savedBuildSnapshot && !resumeDevelopBuildObservation) {
      await startPipeline(normalized.templateId, startServices, {
        runId: normalized.id,
        createdAt: normalized.createdAt,
        releaseReason: normalized.releaseReason,
        releaseNotice: normalized.releaseNotice,
        priorActivity: normalized.activity
      });
      return;
    }

    setRun({
      ...normalized,
      status: "running",
      phase: `恢复${resumeCommandStage === "release" ? "发布" : "构建"}`,
      serviceSnapshot: services.map(compactService),
      activity: [{
        at: nowText(),
        title: "Pipeline 恢复",
        detail: `从 ${resumeCommandStage === "release" ? "发布观察/发布" : "构建"} 阶段继续，不重放已完成阶段。`,
        tone: "default"
      }, ...(normalized.activity || [])].slice(0, 120)
    });
    setExpandedRunIds((current) => Array.from(new Set([...current, normalized.id])));
    setBusy(`resume-${normalized.id}`);
    try {
      let result = null;
      if (resumeCommandStage === "build") {
        if (resumePoint.commandId === "observe-build") {
          result = await observeBuildCompletion(services, { buildSnapshot: savedBuildSnapshot, buildBaseline: savedBuildBaseline });
          if (result.ok && normalized.templateId !== "build-only") {
            result = await executeReleaseFlow(services, {
              observeBuild: false,
              buildSnapshot: savedBuildSnapshot,
              releaseNoWait: true
            });
          }
        } else {
          const build = await executeBuildFor(services, savedBuildSnapshot);
          if (!build.ok && build.staleBuildSnapshot) {
            const excludeTaskIds = staleTaskIdsFromBuildResult(build, savedBuildSnapshot);
            await startPipeline(normalized.templateId, services, {
              runId: normalized.id,
              createdAt: normalized.createdAt,
              releaseReason: normalized.releaseReason,
              releaseNotice: normalized.releaseNotice,
              excludeTaskIds,
              restartedAfterStaleSnapshot: true,
              releaseNoWait: true,
              priorActivity: [{
                at: nowText(),
                title: "Pipeline 重新定位",
                detail: "旧构建任务返回已有新版本构建，重新进入任务定位：能复用则复用，否则新建任务。",
                tone: "warning"
              }, ...(normalized.activity || [])]
            });
            return;
          }
          if (!build.ok) {
            if (build.blocked) {
              setRunPhase("等待构建完成", "blocked");
              setLastResult({ tone: "warning", title: "Pipeline 已暂停", detail: build.message });
              return;
            }
            throw new Error(build.message || build.error);
          }
          if (normalized.templateId !== "build-only") {
            result = await executeReleaseFlow(services, {
              observeBuild: normalized.templateId !== "release-existing",
              buildSnapshot: savedBuildSnapshot,
              releaseNoWait: true
            });
          }
        }
      } else if (resumeCommandStage === "release") {
        if (normalized.templateId === "build-only") {
          result = { ok: true, skipped: true };
        } else {
          result = await executeReleaseFlow(services, {
            observeBuild: normalized.templateId !== "release-existing",
            buildSnapshot: savedBuildSnapshot,
            releaseNoWait: true
          });
        }
      }

      if (result && !result.ok) {
        if (result.blocked) {
          setRunPhase(blockedPhaseForPipelineError(result.error), "blocked");
          setLastResult({ tone: "warning", title: "Pipeline 已暂停", detail: result.message });
          return;
        }
        throw new Error(result.message || result.error);
      }

      setRunPhase("完成", "done");
      addActivity("Pipeline 完成", "历史 Run 已从断点继续到当前链路终点。", "success");
      setLastResult({ tone: "success", title: "Pipeline 完成", detail: `${pipelineById(normalized.templateId).label} / ${selectedServicesText(services)}` });
    } catch (error) {
      setRunPhase("失败", "failed");
      addActivity("Pipeline 恢复失败", error.message, "danger");
      setLastResult({ tone: "danger", title: "Pipeline 恢复失败", detail: error.message });
    } finally {
      setBusy("");
    }
  }

  const readBuildStatus = () => readBuildStatusFor(selectedServices);
  const generateVersion = () => generateVersionFor(selectedServices);
  const readBuildTasks = async () => {
    if (!selectedServices.length) return;
    addActivity("读取构建任务", `${appCode} / ${branch} / ${selectedLabel}`);
    const result = await probeBuildTasksFor(selectedServices, { ignoreVersion: true, maxTaskImageLookups: 1 });
    if (!result.ok) {
      addActivity("构建任务读取失败", result.message, "danger");
      emitCommandEvent("build-task", "failed", result.message);
      return;
    }
    const snapshot = result.snapshot;
    const taskMessage = snapshot.allMatched
	        ? snapshot.publishStage
	        ? `已定位服务组完全一致的任务 ${taskIdOf(snapshot.task) || "-"}，但它不在可复用待处理构建任务池，或已进入发布/处理状态（${snapshot.publishStage}），不作为构建复用候选。`
	        : `已定位服务组完全一致的任务 ${taskIdOf(snapshot.task) || "-"}，${snapshot.allBuildable ? "可构建" : "当前未全部开放构建，不会自动复用为新 Pipeline"}。`
      : `任务 ${result.result.tasks?.length || 0} 条，最新任务不可复用：${serviceGroupMismatchText(snapshot, selectedServices)}；一键构建会继续尝试新建任务。`;
    addActivity(
      "构建任务读取完成",
      taskMessage,
      snapshot.allMatched ? "success" : "warning"
    );
    emitCommandEvent("build-task", "done", taskMessage);
  };

  const releaseNeeded = releaseRequired(branch);
  const releasePlan = releasePlanText(branch);
  const selectorGridClass = "[grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr))]";
  const selectorTriggerClass = "h-12 w-full justify-between truncate text-left text-base [&>span]:truncate";
  if (!bootstrap) {
    return (
      <main className="grid min-h-screen place-items-center bg-background">
        <div className="flex items-center gap-3 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>加载 Workbench...</span>
        </div>
      </main>
    );
  }

  const workbenchUnavailable = !profile || !account;

  return (
    <main className="ops-shell min-h-screen">
      <div className="mx-auto flex min-h-screen w-full max-w-[1760px] flex-col gap-4 px-4 py-4 lg:px-6">
        <header className="flex flex-col gap-4 rounded-lg border border-border bg-card/95 p-4 shadow-panel lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-primary font-display text-sm font-bold text-primary-foreground">WB</div>
            <div className="min-w-0">
              <h1 className="font-display text-xl font-semibold tracking-normal">Build & Release Workbench</h1>
              <p className="text-sm text-muted-foreground">选择服务或服务组，点击常用 Pipeline，系统负责串起两个平台。</p>
            </div>
          </div>
          <WorkflowSwitcher
            workflowItems={workflowEntries}
            activeWorkflowId={activeWorkflowId}
            onSelect={activateWorkflow}
            onSettings={() => setActiveTab("settings")}
          />
        </header>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="min-w-0">
          <TabsList className="grid w-full max-w-xl grid-cols-3">
            <TabsTrigger value="workbench">Pipeline</TabsTrigger>
            <TabsTrigger value="settings">系统配置</TabsTrigger>
            <TabsTrigger value="diagnostics">诊断</TabsTrigger>
          </TabsList>

          <TabsContent value="workbench" className="space-y-4">
            {workbenchUnavailable ? (
              <EmptyWorkflowState onSettings={() => setActiveTab("settings")} />
            ) : (
              <>
                <EnvironmentBand
                  profile={profile}
                  appCode={appCode}
                  branch={branch}
                  env={env}
                  releaseNeeded={releaseNeeded}
                  releaseApp={releaseApp}
                  buildProbe={buildProbe}
                  releaseProbe={releaseProbe}
                  releasePlan={releasePlan}
                  selectedLabel={selectedLabel}
                  lastResult={lastResult}
                />

                <section className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_380px]">
              <Card className="min-w-0">
                <CardHeader className="pb-3">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <CardTitle>服务 Pipeline 控制台</CardTitle>
                      <CardDescription>普通入口就是服务行上的按钮；批量服务先勾选，再点顶部组合按钮。</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className={cn("grid gap-3", selectorGridClass)}>
                    <Field label="应用">
                      <Select value={appCode} onValueChange={(value) => { setAppCode(value); setSelectedKeys([]); setServicePage(1); resetRunDraft(); }}>
                        <SelectTrigger className={selectorTriggerClass}><SelectValue /></SelectTrigger>
                        <SelectContent>{availableApplications.map((item) => <SelectItem key={item.code} value={item.code}>{item.code} - {item.name}</SelectItem>)}</SelectContent>
                      </Select>
                    </Field>
                    <Field label="构建环境">
                      <Select value={branch} onValueChange={changeBuildBranch}>
                        <SelectTrigger className={selectorTriggerClass}><SelectValue /></SelectTrigger>
                        <SelectContent>{BASE_BRANCHES.map((item) => <SelectItem key={item.code} value={item.code}>{item.code} - {item.label}</SelectItem>)}</SelectContent>
                      </Select>
                    </Field>
                    {branch === "master" && (
                      <Field label="正式构建策略">
                        <Select value={buildStrategy} onValueChange={(value) => { setBuildStrategy(value); resetRunDraft(); }}>
                          <SelectTrigger className={selectorTriggerClass}><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {MASTER_BUILD_STRATEGIES.map((item) => (
                              <SelectItem key={item.id} value={item.id}>{item.label} - {item.description}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </Field>
                    )}
                    <Field label="发布环境">
                      <Select value={releaseEnvId} onValueChange={changeReleaseEnv} disabled={!releaseRequired(branch)}>
                        <SelectTrigger className={selectorTriggerClass}><SelectValue /></SelectTrigger>
                        <SelectContent>{profile.releaseEnvironments.map((item) => <SelectItem key={item.id} value={item.id}>{item.showNameEn}/{item.environmentFlag} - {item.label}</SelectItem>)}</SelectContent>
                      </Select>
                    </Field>
                  </div>

                  <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
                    <Field label="服务过滤">
                      <div className="relative">
                        <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input className="pl-9" value={serviceSearch} onChange={(event) => setServiceSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") refreshServicePage(1, servicePageSize, event.currentTarget.value); }} placeholder="例如 prescription" />
                      </div>
                    </Field>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="secondary" onClick={() => refreshServicePage(1, servicePageSize, serviceSearch)} disabled={refreshing}>
                        <RefreshCw className={cn("mr-2 h-4 w-4", refreshing && "animate-spin")} />
                        刷新
                      </Button>
                    </div>
                  </div>

                  {selectedServices.length > 0 && (
                    <PipelineActionBar
                      services={selectedServices}
                      hiddenServices={hiddenSelectedServices}
                      flow={flow}
                      running={running}
                      onRemove={removeSelectedService}
                      onRemoveHidden={removeHiddenSelectedServices}
                      onClear={() => setSelectedKeys([])}
                      onStart={startSelectedPipeline}
                    />
                  )}

                  <ServiceList
                    rows={servicePageData.rows}
                    pageInfo={servicePageData}
                    pageSize={servicePageSize}
                    profile={profile}
                    appCode={appCode}
                    branch={branch}
                    selectedKeys={selectedKeys}
                    running={running}
                    onPageChange={(nextPage) => refreshServicePage(nextPage, servicePageSize, serviceSearch)}
                    onPageSizeChange={(nextSize) => {
                      setServicePageSize(nextSize);
                      refreshServicePage(1, nextSize, serviceSearch);
                    }}
                    onToggle={toggleService}
                    onSinglePipeline={(row, templateId) => {
                      const service = serviceFromRow(row);
                      if (!service) return;
                      setSelectedKeys([service.serviceKey]);
                      startPipeline(templateId, [service]);
                    }}
                  />
	                </CardContent>
	              </Card>

              <div className="grid min-w-0 gap-4">
              <ReleaseOnlyPanel
                releaseNeeded={releaseNeeded}
                releasePlan={releasePlan}
                releaseApp={releaseApp}
                running={running}
                refreshing={refreshing}
                onRefresh={() => refreshReleaseOnly()}
                onStart={() => startPipeline("release-existing", selectedServices.length ? selectedServices : [releaseOnlyServiceSnapshot()])}
                canStart={Boolean(releaseNeeded && releaseProbe?.ok && releaseApp && Number(releaseApp.toPublishServiceNum || 0) > 0)}
              />

              <Card className="min-w-0">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <CardTitle>Pipeline 启动参数</CardTitle>
                      <CardDescription>{pipelineById(runDraft.templateId).label} · {selectedServices.length ? selectedLabel : "未选择服务"}</CardDescription>
                    </div>
	                  </div>
	                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-2 rounded-lg border border-border bg-muted/30 p-3 text-sm">
                    <div className="grid gap-2 sm:grid-cols-2">
                      <BandItem label="Pipeline 阶段" value={`${buildMode(branch, buildStrategy).label} / ${releasePlan}`} />
                      <BandItem label="服务目标" value={selectedServices.length ? selectedLabel : "未选择服务"} />
                    </div>
                  </div>

                  <div className="grid gap-3">
                    <Field label="默认发布理由">
                      <Textarea
                        value={runDraft.releaseReason}
                        onChange={(event) => setRunDraft((current) => ({ ...current, releaseReason: event.target.value }))}
                        placeholder={defaultReleaseReason()}
                      />
                    </Field>
                    <Field label="默认注意事项">
                      <Textarea
                        value={runDraft.releaseNotice}
                        onChange={(event) => setRunDraft((current) => ({ ...current, releaseNotice: event.target.value }))}
                        placeholder={defaultReleaseNotice()}
                      />
                    </Field>
                  </div>

                  <div className="rounded-lg border border-cyan-200 bg-cyan-50 p-3 text-sm text-cyan-950">
                    <div className="mb-1 flex items-center gap-2 font-semibold">
                      <ShieldCheck className="h-4 w-4" />
                      启动后进入 Run 表
                    </div>
                    <p>这里仅保存下一次启动需要的入参；真实进度、等待点和日志在下方 Pipeline Run 表展开查看。</p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" onClick={readBuildStatus} disabled={!selectedServices.length || running}>
                      <Server className="mr-2 h-4 w-4" />
                      只读构建状态
                    </Button>
                    <Button variant="secondary" onClick={generateVersion} disabled={!selectedServices.length || branch === "develop" || running}>
                      <ClipboardList className="mr-2 h-4 w-4" />
                      只读版本预检
                    </Button>
                    <Button variant="secondary" onClick={readBuildTasks} disabled={!selectedServices.length || branch === "develop" || running}>
                      <Activity className="mr-2 h-4 w-4" />
                      只读任务定位
                    </Button>
                  </div>
                </CardContent>
              </Card>
              </div>
		            </section>
              </>
            )}

            <PipelineRunTable
              runs={visibleRunHistory}
              historyLimit={bootstrap?.pipelineRunHistoryLimit || PIPELINE_RUN_HISTORY_LIMIT}
              currentRunId={run.id}
              running={running}
              expandedRunIds={expandedRunIds}
              onView={viewRunRecord}
              onCopy={copyRunRecord}
              onClearHistory={clearRunHistoryRecords}
              onResume={(record) => loadRunDraft(record, { action: "resume" })}
              profiles={profiles}
              activeWorkflowId={activeWorkflowId}
            />

          </TabsContent>

          <TabsContent value="settings">
            <SettingsPanel
              profiles={profiles}
              credentialState={credentialState}
              onSaved={applyBootstrapPayload}
              onGo={(profileId, accountId) => {
                setActiveTab("workbench");
                setProfileContext(profileId, accountId);
              }}
            />
          </TabsContent>

          <TabsContent value="diagnostics">
            <Diagnostics probes={probes} lastResult={lastResult} />
          </TabsContent>
        </Tabs>
      </div>
    </main>
  );
}

function Field({ label, children }) {
  return (
    <label className="block min-w-0">
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}

function Metric({ label, value }) {
  return (
    <div className="metric-card">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 break-words font-display text-sm font-semibold">{value || "-"}</div>
    </div>
  );
}

function PhasePill({ item }) {
  const Icon = item.status === "done" ? CheckCircle2 : item.status === "failed" ? XCircle : item.status === "blocked" ? AlertTriangle : Activity;
  return (
    <div className="rounded-lg border border-border bg-muted/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Icon className={cn("h-4 w-4 shrink-0", item.status === "done" ? "text-emerald-600" : item.status === "failed" ? "text-red-600" : item.status === "blocked" ? "text-amber-600" : "text-muted-foreground")} />
          <span className="truncate font-semibold">{item.label}</span>
        </div>
        <Badge variant={statusVariant(item.status)}>{item.status}</Badge>
      </div>
      <div className="mt-2 truncate text-xs text-muted-foreground">{item.value || "-"}</div>
    </div>
  );
}

function ResultNotice({ result }) {
  return (
    <div className={cn("rounded-lg border p-3 text-sm", result.tone === "danger" ? "border-red-200 bg-red-50 text-red-800" : result.tone === "warning" ? "border-amber-200 bg-amber-50 text-amber-800" : "border-emerald-200 bg-emerald-50 text-emerald-800")}>
      <strong>{result.title}</strong>
      <p className="mt-1">{result.tone === "danger" || result.tone === "warning" ? summarizeFailure(result.detail) : result.detail}</p>
    </div>
  );
}

function EnvironmentBand({ profile, appCode, branch, env, releaseNeeded, buildProbe, releaseProbe, releasePlan, selectedLabel, lastResult }) {
  const releaseText = releaseNeeded ? `${env?.showNameEn || "-"}/${env?.environmentFlag || "-"} · ${releasePlan}` : "开发环境跳过";
  return (
    <section className="rounded-lg border border-border bg-card/95 p-4 shadow-sm">
      <div className="grid gap-3 lg:grid-cols-[1.2fr_1fr_1fr_1fr_auto] lg:items-center">
        <BandItem label="医院" value={profile.hospitalName} />
        <BandItem label="应用/构建环境" value={`${appCode} · ${branch}`} />
        <BandItem label="发布目标" value={releaseText} />
        <BandItem label="服务组" value={selectedLabel} />
        <div className="flex flex-wrap gap-2 lg:justify-end">
          <Badge variant={buildProbe?.ok ? "success" : "warning"}>构建平台{buildProbe?.ok ? "已探测" : "待探测"}</Badge>
          <Badge variant={!releaseNeeded || releaseProbe?.ok ? "success" : "warning"}>发布平台{!releaseNeeded ? "跳过" : releaseProbe?.ok ? "已探测" : "待探测"}</Badge>
        </div>
      </div>
      {lastResult && (
        <div className={cn("mt-3 rounded-md border px-3 py-2 text-sm", lastResult.tone === "danger" ? "border-red-200 bg-red-50 text-red-800" : lastResult.tone === "warning" ? "border-amber-200 bg-amber-50 text-amber-800" : "border-emerald-200 bg-emerald-50 text-emerald-800")}>
          <span className="font-semibold">{lastResult.title}</span>
          <span className="ml-2">{lastResult.tone === "danger" || lastResult.tone === "warning" ? summarizeFailure(lastResult.detail) : lastResult.detail}</span>
        </div>
      )}
    </section>
  );
}

function WorkflowSwitcher({ workflowItems, activeWorkflowId, onSelect, onSettings }) {
  const activeItem = workflowItems.find((item) => item.id === activeWorkflowId);
  const primaryItems = workflowItems.slice(0, 2);
  const overflowItems = workflowItems.slice(2);
  const showOverflow = overflowItems.length > 0;
  const overflowActive = overflowItems.some((item) => item.id === activeWorkflowId);
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2 lg:justify-end">
      {primaryItems.map((item) => (
        <Button
          key={item.id}
          variant={item.id === activeWorkflowId ? "default" : "secondary"}
          size="sm"
          onClick={() => onSelect(item)}
          className="max-w-[180px] truncate"
          title={item.label}
        >
          {item.buttonLabel}
        </Button>
      ))}
      {showOverflow && (
        <Select
          value={overflowActive && activeItem ? activeWorkflowId : ""}
          onValueChange={(value) => {
            const item = workflowItems.find((entry) => entry.id === value);
            if (item) onSelect(item);
          }}
        >
          <SelectTrigger className="h-10 w-[190px] max-w-full justify-between">
            <SelectValue placeholder="其他 workflow" />
          </SelectTrigger>
          <SelectContent>
            {overflowItems.map((item) => (
              <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <Button variant="outline" size="sm" onClick={onSettings}>
        <Plus className="mr-2 h-4 w-4" />
        新增 workflow
      </Button>
      <Button variant="outline" size="sm" onClick={onSettings}>
        <Settings className="mr-2 h-4 w-4" />
        系统配置
      </Button>
    </div>
  );
}

function EmptyWorkflowState({ onSettings }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>还没有 workflow</CardTitle>
        <CardDescription>先到系统配置里输入账号和密码，探测构建平台客户后初始化 workflow。</CardDescription>
      </CardHeader>
      <CardContent>
        <Button onClick={onSettings}>
          <Plus className="mr-2 h-4 w-4" />
          新增 workflow
        </Button>
      </CardContent>
    </Card>
  );
}

function BandItem({ label, value }) {
  return (
    <div className="min-w-0">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 break-words font-display text-sm font-semibold">{value || "-"}</div>
    </div>
  );
}

function CurrentRunStatus({ run }) {
  const events = run.activity || [];
  const terminalSuccess = run.status === "done";
  const important = terminalSuccess ? events[0] : events.find((item) => item.tone === "danger" || item.tone === "warning") || events[0];
  const attentionCommand = terminalSuccess ? null : Object.values(run.memento?.commands || {}).find((item) => item.status === "failed" || item.status === "blocked" || item.status === "running");
  const tone = run.status === "failed" || attentionCommand?.status === "failed" ? "danger" : run.status === "blocked" || attentionCommand?.status === "blocked" || important?.tone === "warning" ? "warning" : important?.tone || "default";
  const title = attentionCommand
    ? run.status === "failed" ? "当前失败点" : "当前阻塞点"
    : important
      ? "最近 Run 事件"
      : "等待启动";
  const rawDetail = attentionCommand?.detail || important?.detail || "选择服务后点击 Pipeline 按钮，Run 会在这里显示当前状态和最近日志。";
  const detail = summarizeFailure(rawDetail);
  const recent = events.slice(0, 3);
  return (
    <div className={cn(
      "rounded-lg border p-3 text-sm",
      tone === "danger" ? "border-red-200 bg-red-50 text-red-800" : tone === "warning" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-cyan-200 bg-cyan-50 text-cyan-950"
    )}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold">{title}</div>
          <p className="mt-1 max-h-24 overflow-auto break-words">{detail}</p>
        </div>
        <Badge variant={tone === "danger" ? "danger" : tone === "warning" ? "warning" : "outline"}>{run.phase}</Badge>
      </div>
      {recent.length > 0 && (
        <div className="mt-3 space-y-1 border-t border-current/15 pt-2">
          {recent.map((item, index) => (
            <div key={`${item.at}-${index}`} className="flex gap-2 text-xs">
              <span className="shrink-0 opacity-70">{item.at}</span>
              <span className="min-w-0 break-words">{item.title}：{summarizeFailure(item.detail)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function formatRunTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("zh-CN", { hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function PipelineRunTable({ runs, historyLimit = PIPELINE_RUN_HISTORY_LIMIT, currentRunId, running, expandedRunIds = [], onView, onCopy, onClearHistory, onResume, profiles = [] }) {
  const [runPage, setRunPage] = useState(1);
  const [runPageSize, setRunPageSize] = useState(DEFAULT_RUN_PAGE_SIZE);
  const pageData = useMemo(() => paginateRows(runs, runPage, runPageSize), [runs, runPage, runPageSize]);

  useEffect(() => {
    if (runPage !== pageData.page) setRunPage(pageData.page);
  }, [runPage, pageData.page]);

  return (
    <section>
      <Card className="min-w-0">
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <History className="h-5 w-5 text-primary" />
                Pipeline Run 表
              </CardTitle>
              <CardDescription>服务端持久保存最近 {historyLimit} 条 Run，可查看、复制配置生成新 Run，或从暂停/失败/待启动阶段继续。</CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2 md:justify-end">
              <Badge variant="outline">{runs.length} 条</Badge>
              <Button variant="outline" size="sm" onClick={onClearHistory} disabled={!runs.length}>
                <Trash2 className="mr-1 h-3.5 w-3.5" />
                清空历史
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {!runs.length ? (
            <div className="rounded-lg border border-dashed border-border bg-muted/40 p-6 text-center text-sm text-muted-foreground">
              暂无 Pipeline Run。点击服务行上的常用 Pipeline 按钮后会自动生成记录。
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border border-border">
              <div className="hidden md:grid md:grid-cols-[120px_minmax(160px,1fr)_minmax(180px,1.3fr)_108px_minmax(116px,auto)] gap-3 border-b border-border bg-muted/50 px-3 py-2 text-xs font-semibold text-muted-foreground">
                <div>时间</div>
                <div>Pipeline</div>
                <div>目标/服务组</div>
                <div className="text-center">状态</div>
                <div className="text-right">操作</div>
              </div>
              <div className="divide-y divide-border">
                {pageData.rows.map((record) => {
                  const isCurrent = record.id === currentRunId;
                  const displayRecord = resumableDetachedRunningRun(record, currentRunId);
                  const definition = pipelineById(displayRecord.templateId);
                  const target = displayRecord.target || {};
                  const targetText = `${target.appCode || "-"} / ${target.branch || "-"}${target.releaseEnvLabel ? ` / ${target.releaseEnvLabel}` : ""}`;
                  const servicesText = selectedServicesText(displayRecord.serviceSnapshot || []);
                  const unavailable = runUnavailableMessage(displayRecord, profiles);
                  const resumable = !unavailable && canResumePipelineRun(displayRecord);
                  const expanded = expandedRunIds.includes(displayRecord.id);
                  const continueDisabled = running || (isCurrent && displayRecord.status === "running") || !resumable;
                  return (
                    <React.Fragment key={displayRecord.id}>
                      <div className={cn("grid gap-3 px-3 py-3 text-sm md:grid-cols-[120px_minmax(160px,1fr)_minmax(180px,1.3fr)_108px_minmax(116px,auto)]", isCurrent && "bg-cyan-50/70")}>
                        <div className="min-w-0 text-xs text-muted-foreground">
                          <span className="mb-1 block font-semibold text-foreground md:hidden">时间</span>
                          {formatRunTime(displayRecord.updatedAt || displayRecord.createdAt)}
                        </div>
                        <div className="min-w-0">
                          <span className="mb-1 block text-xs font-semibold text-muted-foreground md:hidden">Pipeline</span>
                          <div className="break-words font-semibold">{definition.label}</div>
                          <div className="break-words text-xs text-muted-foreground">Run {displayRecord.id}</div>
                        </div>
                        <div className="min-w-0">
                          <span className="mb-1 block text-xs font-semibold text-muted-foreground md:hidden">目标/服务组</span>
                          <div className="break-words font-medium">{targetText}</div>
                          <div className="break-words text-xs text-muted-foreground">{servicesText || "-"}</div>
                            {unavailable && <div className="mt-1 break-words text-xs font-semibold text-amber-700">{unavailable}</div>}
                        </div>
                        <div className="flex min-w-0 flex-col items-start justify-center gap-1 text-left md:items-center md:text-center">
                          <span className="mb-1 block text-xs font-semibold text-muted-foreground md:hidden">状态</span>
                          <Badge variant={statusVariant(displayRecord.status)}>{statusText(displayRecord.status)}</Badge>
                          <span className="break-words text-xs text-muted-foreground md:max-w-full md:truncate">{statusText(displayRecord.phase)}</span>
                        </div>
                        <div className="min-w-0">
                          <span className="mb-1 block text-xs font-semibold text-muted-foreground md:hidden">操作</span>
                          <div className="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap sm:justify-start md:justify-end">
                            <Button className="w-full sm:w-auto" variant="outline" size="sm" onClick={() => onView(displayRecord)}>{expanded ? "收起" : "查看"}</Button>
                            <Button className="w-full sm:w-auto" variant="secondary" size="sm" onClick={() => onCopy(record)}>
                              <Copy className="mr-1 h-3.5 w-3.5" />
                              复制
                            </Button>
                            <Button className="w-full sm:w-auto" variant="default" size="sm" onClick={() => onResume(displayRecord)} disabled={continueDisabled} title={unavailable || undefined}>
                              <RotateCcw className="mr-1 h-3.5 w-3.5" />
                              继续
                            </Button>
                          </div>
                        </div>
                      </div>
                      {expanded && <PipelineRunDetailPanel record={displayRecord} />}
                    </React.Fragment>
                  );
                })}
              </div>
              <div className="flex flex-col gap-3 border-t border-border bg-muted/30 px-3 py-3 text-sm text-muted-foreground lg:flex-row lg:items-center lg:justify-between">
                <div>
                  第 {pageData.page} / {pageData.totalPages} 页 · 显示 {pageData.start}-{pageData.end} / 共 {pageData.total} 条 Run
                </div>
                <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                  <span className="font-semibold text-foreground">每页</span>
                  <Select value={String(runPageSize)} onValueChange={(value) => { setRunPageSize(Number(value)); setRunPage(1); }}>
                    <SelectTrigger className="h-9 w-[90px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {RUN_PAGE_SIZE_OPTIONS.map((size) => <SelectItem key={size} value={String(size)}>{size}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Button variant="secondary" size="sm" onClick={() => setRunPage(pageData.page - 1)} disabled={!pageData.hasPrev}>上一页</Button>
                  {paginationItems(pageData.page, pageData.totalPages, { siblingCount: 1 }).map((item) => (
                    typeof item === "number" ? (
                      <Button
                        key={item}
                        variant={item === pageData.page ? "default" : "secondary"}
                        size="sm"
                        onClick={() => setRunPage(item)}
                      >
                        {item}
                      </Button>
                    ) : (
                      <span key={item} className="px-1 text-muted-foreground">...</span>
                    )
                  ))}
                  <Button variant="secondary" size="sm" onClick={() => setRunPage(pageData.page + 1)} disabled={!pageData.hasNext}>下一页</Button>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function PipelineRunDetailPanel({ record }) {
  if (record.status === "draft" && record.started === false) {
    return <PipelineRunDraftDetailPanel record={record} />;
  }
  const cards = phaseCardsForRunRecord(record);
  const progress = progressForPhaseCards(cards);
  return (
    <div className="bg-cyan-50/40 px-3 py-4" data-testid="pipeline-run-detail">
      <div className="grid min-w-0 items-start gap-4 rounded-lg border border-cyan-200 bg-card p-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,.9fr)] xl:items-stretch">
        <div className="min-w-0 space-y-4" data-testid="run-detail-main-column">
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="font-semibold">宏观进度</span>
              <span className="text-muted-foreground">{progress}%</span>
            </div>
            <Progress value={progress} />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {cards.map((item) => (
              <PhasePill key={item.id} item={item} />
            ))}
          </div>
          <BuildStageDetailPanel record={record} />
          <CurrentRunStatus run={record} />
        </div>
        <div className="flex min-h-0 min-w-0 flex-col overflow-hidden xl:self-stretch" data-testid="run-activity-panel">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div>
              <div className="font-semibold">Run 活动日志</div>
              <div className="text-xs text-muted-foreground">展开查看该 Pipeline Run 的阶段证据和失败重试点。</div>
            </div>
            <Badge variant={statusVariant(record.status)}>{statusText(record.status)}</Badge>
          </div>
          <ActivityLog items={record.activity || []} stretch />
        </div>
      </div>
    </div>
  );
}

function PipelineRunDraftDetailPanel({ record }) {
  const definition = pipelineById(record.templateId);
  const target = record.target || {};
  const stages = `${buildMode(target.branch, target.buildStrategy).label} / ${releasePlanText(target.branch)}`;
  const services = selectedServicesText(record.serviceSnapshot || []);
  return (
    <div className="bg-cyan-50/40 px-3 py-4" data-testid="pipeline-run-detail">
      <div className="grid min-w-0 items-start gap-4 rounded-lg border border-cyan-200 bg-card p-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,.9fr)] xl:items-stretch">
        <div className="min-w-0 space-y-3" data-testid="run-detail-main-column">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="font-semibold">待启动配置</div>
              <div className="text-xs text-muted-foreground">复制出来的是下一次启动参数，不代表真实执行进度。</div>
            </div>
            <Badge variant="muted">待启动</Badge>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <BandItem label="Pipeline" value={definition.label} />
            <BandItem label="服务目标" value={services || "-"} />
            <BandItem label="目标环境" value={`${target.appCode || "-"} / ${target.branch || "-"}${target.releaseEnvLabel ? ` / ${target.releaseEnvLabel}` : ""}`} />
            <BandItem label="Pipeline 阶段" value={stages} />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <BandItem label="发布理由" value={record.releaseReason || DEFAULT_RELEASE_REASON} />
            <BandItem label="注意事项" value={record.releaseNotice || DEFAULT_RELEASE_NOTICE} />
          </div>
          <ServiceSnapshotList services={record.serviceSnapshot || []} />
        </div>
        <div className="flex min-h-0 min-w-0 flex-col overflow-hidden xl:self-stretch" data-testid="run-activity-panel">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div>
              <div className="font-semibold">Run 活动日志</div>
              <div className="text-xs text-muted-foreground">点击该行的继续后，才会生成真实阶段进度。</div>
            </div>
            <Badge variant="muted">待启动</Badge>
          </div>
          <ActivityLog items={record.activity || []} stretch />
        </div>
      </div>
    </div>
  );
}

function ServiceSnapshotList({ services = [] }) {
  if (!services.length) return null;
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3">
      <div className="text-xs font-semibold text-muted-foreground">服务清单</div>
      <div className="mt-2 flex flex-wrap gap-2">
        {services.map((service, index) => (
          <span
            key={`${service.imageJenkinsName || service.imageNameEn || index}-${index}`}
            className="inline-flex max-w-full rounded-md border border-border bg-card px-2.5 py-1 text-xs font-semibold text-foreground"
          >
            <span className="break-all">{service.imageJenkinsName || service.imageNameEn || service.serviceName || "unknown-service"}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function buildStageStatusIcon(status) {
  if (status === "done") return CheckCircle2;
  if (status === "failed") return XCircle;
  if (status === "blocked") return AlertTriangle;
  if (status === "running") return Loader2;
  return ClipboardList;
}

function buildStageRowClass(status) {
  if (status === "done") return "border-l-emerald-500";
  if (status === "failed") return "border-l-red-500";
  if (status === "blocked") return "border-l-amber-500";
  if (status === "running") return "border-l-cyan-500";
  return "border-l-border";
}

function stageSkeletonFromStructureDetail(structureDetail = null) {
  const avgRows = Array.isArray(structureDetail?.avg) ? structureDetail.avg : [];
  const labels = avgRows
    .map((row) => String(row.stageName || row.name || "").trim())
    .filter(Boolean);
  if (!labels.length) return BUILD_DETAIL_STAGES;
  return labels.map((label, index) => buildStageDefinitionForLabel(label, index));
}

function stageSkeletonForRows(rows = [], structureDetail = null) {
  const skeleton = stageSkeletonFromStructureDetail(structureDetail);
  const hasNpmBuild = rows.some((row) => normalizeBuildStageLabel(row.label || row.name) === "npm build");
  const hasMavenBuild = rows.some((row) => normalizeBuildStageLabel(row.label || row.name) === "maven build");
  if (skeleton === BUILD_DETAIL_STAGES && hasNpmBuild && !hasMavenBuild) {
    return BUILD_DETAIL_STAGES.map((stage, index) =>
      normalizeBuildStageLabel(stage.label) === "maven build"
        ? buildStageDefinitionForLabel("Npm Build", index)
        : stage
    );
  }
  return skeleton;
}

function pendingBuildStageRows(skeleton = BUILD_DETAIL_STAGES) {
  return skeleton.map((stage) => ({
    ...stage,
    status: "pending",
    detail: "等待本次构建进入该阶段。",
    source: "run-pending"
  }));
}

function mergeBuildStageRowsWithPending(rows = [], skeleton = BUILD_DETAIL_STAGES) {
  const rowByLabel = new Map(rows.map((row) => [normalizeBuildStageLabel(row.label || row.name), row]));
  const knownLabels = new Set(skeleton.map((stage) => normalizeBuildStageLabel(stage.label)));
  const merged = skeleton.map((stage) => {
    const actual = rowByLabel.get(normalizeBuildStageLabel(stage.label));
    if (!actual) {
      return {
        ...stage,
        status: "pending",
        detail: "等待本次构建进入该阶段。",
        source: "run-pending"
      };
    }
    return {
      ...stage,
      ...actual,
      id: stage.id,
      label: stage.label,
      name: stage.name
    };
  });
  const extraRows = rows.filter((row) => !knownLabels.has(normalizeBuildStageLabel(row.label || row.name)));
  return [...merged, ...extraRows];
}

function serviceStageRowsForDisplay(item = {}, logState = {}) {
  if (item.structureStageRows?.length) {
    return mergeBuildStageRowsWithPending(item.structureStageRows, stageSkeletonForRows(item.structureStageRows, item.structureDetail));
  }
  if (logState.rows?.length) {
    return mergeBuildStageRowsWithPending(logState.rows, stageSkeletonForRows(logState.rows, item.structureDetail));
  }
  return pendingBuildStageRows(stageSkeletonForRows([], item.structureDetail));
}

function ServiceBuildProgressList({ items = [], logStates = {}, logRequests = {}, liveStates = {}, onReadLog }) {
  if (!items.length) return null;
  return (
    <div className="min-w-0 space-y-3" data-testid="service-build-progress-list">
      <div className="text-xs font-semibold text-muted-foreground">服务构建进度</div>
      <div className="grid min-w-0 gap-3">
        {items.map((item) => {
          const Icon = buildStageStatusIcon(item.status);
          const logState = logStates[item.key] || {};
          const stageText = serviceBuildStageText(item, { logState });
          const buildIdText = item.buildId || item.candidateBuildIds?.join(", ") || item.candidateBuildId || "-";
          const stageRows = serviceStageRowsForDisplay(item, logState);
          const logText = buildLogDisplayText(logState.result);
          const lockRunSource = ["failed", "blocked"].includes(item.status) && item.source === "Run 阶段";
          const sourceText = lockRunSource ? item.source : item.source || "-";
          const hasLogRequest = Boolean(logRequests[item.key]);
          return (
            <div
              key={item.key}
              className={cn("min-w-0 space-y-3 overflow-hidden rounded-lg border border-l-4 border-border bg-card p-3", buildStageRowClass(item.status))}
              data-testid="service-build-progress-row"
            >
              <div className="grid gap-2 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.4fr)_auto]">
                <div className="flex min-w-0 items-start gap-2">
                  <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", item.status === "running" && "animate-spin")} />
                  <div className="min-w-0">
                    <div className="break-all text-sm font-semibold">{item.name}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{item.applicationCode} / {item.branch}</div>
                  </div>
                </div>
                <div className="min-w-0 text-xs text-muted-foreground">
                  <div className="font-semibold text-foreground">版本 {item.targetVersion || "-"}</div>
                  <div className="mt-1 break-all">构建号 {buildIdText}</div>
                  <div className="mt-1 break-all">来源 {sourceText}</div>
                </div>
                <div className="min-w-0 break-words text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">阶段 </span>{stageText}
                </div>
                <div className="flex flex-wrap items-center gap-2 md:justify-end">
                  <Badge className="w-fit" variant={statusVariant(item.status)}>{item.statusLabel || statusText(item.status)}</Badge>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onReadLog?.(item.key)}
                    disabled={!hasLogRequest || logState.loading}
                  >
                    {logState.loading ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Search className="mr-1 h-3.5 w-3.5" />}
                    {logState.loading ? "读取中" : "日志"}
                  </Button>
                </div>
              </div>
              <div className="grid min-w-0 gap-2" data-testid="service-build-stage-list">
                {stageRows.map((stage) => {
                  const StageIcon = buildStageStatusIcon(stage.status);
                  return (
                    <div
                      key={`${item.key}-${stage.id}`}
                      className={cn("grid min-w-0 gap-3 rounded-md border border-l-4 border-border bg-muted/25 p-3 sm:grid-cols-[minmax(0,170px)_minmax(0,1fr)_auto]", buildStageRowClass(stage.status))}
                      data-testid="service-build-stage-row"
                    >
                      <div className="flex min-w-0 items-start gap-2">
                        <StageIcon className={cn("mt-0.5 h-4 w-4 shrink-0", stage.status === "running" && "animate-spin")} />
                        <div className="min-w-0">
                          <div className="break-words text-sm font-semibold">{stage.name}</div>
                          <div className="mt-1 font-mono text-xs text-muted-foreground">{stage.label}</div>
                        </div>
                      </div>
                      <div className="min-w-0 break-words text-xs text-muted-foreground sm:text-sm">{stage.detail}</div>
                      <Badge className="w-fit" variant={statusVariant(stage.status)}>{statusText(stage.status)}</Badge>
                    </div>
                  );
                })}
              </div>
              {logState.loading && (
                <div className="rounded-md border border-cyan-200 bg-cyan-50 px-3 py-2 text-xs text-cyan-800" data-testid="service-build-log-loading">
                  正在读取该服务的 Jenkins 原始日志。
                </div>
              )}
              {logState.error && (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800" data-testid="service-build-log-error">
                  {logState.error}
                </div>
              )}
              {logState.notice && (
                <div className="rounded-md border border-cyan-200 bg-cyan-50 px-3 py-2 text-xs text-cyan-800" data-testid="service-build-log-notice">
                  {logState.notice}
                </div>
              )}
              {logText && (
                <pre className="max-h-[60vh] min-h-[220px] max-w-full min-w-0 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-background p-3 font-mono text-xs leading-relaxed text-foreground [overflow-wrap:anywhere]" data-testid="service-build-log">
                  {logText}
                </pre>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function buildLogDisplayText(logResult) {
  return buildLogText(logResult).replace(/\r/g, "").trim();
}

function isBuildLogNotReadyResult(result = {}) {
  return result?.reason === "build_log_not_ready" || result?.error === "build_log_not_ready";
}

function BuildStageDetailPanel({ record }) {
  const [liveSignals, setLiveSignals] = useState([]);
  const [liveStates, setLiveStates] = useState({});
  const [serviceLogStates, setServiceLogStates] = useState({});
  const normalizedRecord = useMemo(() => normalizePipelineRunRecord(record), [record]);
  const services = normalizedRecord.serviceSnapshot || [];
  const items = useMemo(() => serviceBuildStatusItems(record, liveSignals), [record, liveSignals]);
  const logRequests = useMemo(() => Object.fromEntries(items
    .map((item) => [item.key, buildLogRequestForServiceItem(record, item)])
    .filter(([, request]) => request)), [record, items]);
  const logRequestKey = useMemo(() => JSON.stringify(logRequests), [logRequests]);
  const serviceStatusRequestKey = useMemo(() => JSON.stringify({
    target: {
      profileId: normalizedRecord.target?.profileId || "",
      accountId: normalizedRecord.target?.accountId || "",
      customerNameEn: normalizedRecord.target?.customerNameEn || "",
      appCode: normalizedRecord.target?.appCode || "",
      branch: normalizedRecord.target?.branch || ""
    },
    services: services.map((service, index) => ({
      key: serviceBuildStatusItemKey(service, index),
      applicationCode: service.applicationCode || "",
      codeBranch: service.codeBranch || "",
      imageJenkinsName: service.imageJenkinsName || serviceDisplayName(service),
      imageVersion: service.generatedVersion || service.imageVersion || "",
      candidateBuildIds: items[index]?.candidateBuildIds || []
    }))
  }), [normalizedRecord, services, items]);

  useEffect(() => {
    const entries = items.map((item) => {
      const service = services[item.serviceIndex] || services.find((entry) => serviceDisplayName(entry) === item.name) || {};
      return {
        key: item.key,
        service,
        request: buildServiceStatusRequestForService(record, service, item),
        baseline: directBuildBaselineForService(service, normalizedRecord.context?.data?.buildBaseline || {})
      };
    }).filter((entry) => entry.request);

    if (!entries.length) {
      setLiveSignals([]);
      setLiveStates({});
      return undefined;
    }

    let cancelled = false;
    let timer = null;

    async function readLiveServiceStatus(silent = false) {
      if (!silent) {
        setLiveStates((current) => ({
          ...current,
          ...Object.fromEntries(entries.map((entry) => [entry.key, {
            ...(current[entry.key] || {}),
            loading: true,
            error: ""
          }]))
        }));
      }

      const nextSignals = [];
      const nextStates = {};
      for (const entry of entries) {
        try {
          const data = await apiFetchWithRetry("/api/probe/build-service", entry.request, {
            attempts: READ_RETRY_ATTEMPTS,
            delayMs: READ_RETRY_DELAY_MS
          });
          if (cancelled) return;
          const result = data.result || data;
          if (!result?.ok) {
            nextStates[entry.key] = {
              loading: false,
              error: summarizeFailure(result),
              updatedAt: Date.now()
            };
            continue;
          }
          const signal = buildSignalForService(entry.service, result, { baseline: entry.baseline });
          nextSignals.push({
            ...signal,
            source: "平台实时读取",
            structureDetail: result.structureDetail || null,
            at: signal.at || Date.now()
          });
          nextStates[entry.key] = {
            loading: false,
            error: "",
            updatedAt: Date.now()
          };
        } catch (error) {
          if (cancelled) return;
          nextStates[entry.key] = {
            loading: false,
            error: error.message || "读取构建状态失败",
            updatedAt: Date.now()
          };
        }
      }

      if (!cancelled) {
        setLiveSignals(nextSignals);
        setLiveStates((current) => ({ ...current, ...nextStates }));
      }
    }

    readLiveServiceStatus(false);
    if (aggregateBuildStatusFromItems(record, items) === "running") {
      timer = window.setInterval(() => readLiveServiceStatus(true), Math.max(PIPELINE_OBSERVER_INTERVAL_MS, 5000));
    }

    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
    };
  }, [serviceStatusRequestKey, record, items]);

  async function readServiceBuildLogs(keys, options = {}) {
    const activeKeys = keys.filter((key) => logRequests[key]);
    if (!activeKeys.length) return;
    const silent = Boolean(options.silent);
    if (!silent) {
      setServiceLogStates((current) => ({
        ...current,
        ...Object.fromEntries(activeKeys.map((key) => [key, {
          ...(current[key] || {}),
          loading: true,
          error: "",
          notice: ""
        }]))
      }));
    }

    for (const key of activeKeys) {
      if (options.cancelled?.()) return;
      try {
        const request = await resolveBuildLogRequestForKey(key);
        const data = await apiFetch("/api/probe/build-log", request);
        if (options.cancelled?.()) return;
        const result = data.result || data;
        if (!result?.ok) {
          if (isBuildLogNotReadyResult(result)) {
            setServiceLogStates((current) => ({
              ...current,
              [key]: {
                ...(current[key] || {}),
                result: null,
                rows: [],
                loading: false,
                error: "",
                notice: "Jenkins 原始日志暂未生成或平台尚未开放读取，后台会随运行中观察继续尝试。"
              }
            }));
            continue;
          }
          setServiceLogStates((current) => ({
            ...current,
            [key]: {
              ...(current[key] || {}),
              result: null,
              rows: [],
              loading: false,
              error: summarizeFailure(result),
              notice: ""
            }
          }));
          continue;
        }
        setServiceLogStates((current) => ({
          ...current,
          [key]: {
            ...(current[key] || {}),
            result,
            rows: buildStageRowsFromLogResult(result),
            loading: false,
            error: "",
            notice: ""
          }
        }));
      } catch (error) {
        if (options.cancelled?.()) return;
        setServiceLogStates((current) => ({
          ...current,
          [key]: {
            ...(current[key] || {}),
            result: null,
            rows: [],
            loading: false,
            error: error.message || "读取原始构建日志失败",
            notice: ""
          }
        }));
      }
    }
  }

  useEffect(() => {
    setServiceLogStates({});
  }, [logRequestKey]);

  async function resolveBuildLogRequestForKey(key) {
    const item = items.find((entry) => entry.key === key);
    const fallbackRequest = logRequests[key];
    if (!item || !fallbackRequest || fallbackRequest.buildId) return fallbackRequest;
    const service = services[item.serviceIndex] || services.find((entry) => serviceDisplayName(entry) === item.name) || {};
    const statusRequest = buildServiceStatusRequestForService(record, service, item);
    if (!statusRequest) return fallbackRequest;
    try {
      const data = await apiFetchWithRetry("/api/probe/build-service", statusRequest, {
        attempts: READ_RETRY_ATTEMPTS,
        delayMs: READ_RETRY_DELAY_MS
      });
      const result = data.result || data;
      if (!result?.ok) return fallbackRequest;
      const signal = buildSignalForService(service, result, {
        baseline: directBuildBaselineForService(service, normalizedRecord.context?.data?.buildBaseline || {})
      });
      setLiveSignals((current) => [
        {
          ...signal,
          source: "平台实时读取",
          structureDetail: result.structureDetail || null,
          at: signal.at || Date.now()
        },
        ...current.filter((entry) => String(entry.service || "") !== String(signal.service || ""))
      ]);
      return buildLogRequestForServiceItem(record, {
        ...item,
        structureDetail: result.structureDetail || item.structureDetail
      }) || fallbackRequest;
    } catch {
      return fallbackRequest;
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-3" data-testid="build-stage-detail-panel" aria-live="polite">
      <ServiceBuildProgressList
        items={items}
        logStates={serviceLogStates}
        logRequests={logRequests}
        liveStates={liveStates}
        onReadLog={(key) => readServiceBuildLogs([key], { silent: false })}
      />
    </div>
  );
}

function ReleaseOnlyPanel({ releaseNeeded, releasePlan, releaseApp, running, refreshing, canStart, onRefresh, onStart }) {
  return (
    <Card className="min-w-0">
      <CardHeader className="pb-3">
        <CardTitle>发布平台待发布</CardTitle>
        <CardDescription>用于已有版本、合并发布或只处理发布平台待处理服务。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
          <div className="font-semibold">{releaseNeeded ? releasePlan : "当前环境无需发布平台"}</div>
          <div className="mt-1 break-words text-muted-foreground">
            {releaseApp
              ? `${releaseApp.applicationCode || "-"} / 版本 ${releaseApp.applicationVersion || "-"} / 待处理服务 ${releaseApp.toPublishServiceNum || 0}`
              : releaseNeeded
                ? "刷新后，会按当前发布环境判断是否有可发布内容。"
                : "开发环境的构建平台链路完成后即结束。"}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={onRefresh} disabled={refreshing}>
            <RefreshCw className={cn("mr-2 h-4 w-4", refreshing && "animate-spin")} />
            刷新
          </Button>
          <Button variant="outline" onClick={onStart} disabled={running || !canStart}>
            <CloudCog className="mr-2 h-4 w-4" />
            处理待发布
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function PipelineActionBar({ services, hiddenServices = [], flow, running, onStart, onRemove, onRemoveHidden, onClear }) {
  const hasHiddenServices = hiddenServices.length > 0;
  return (
    <div className="rounded-lg border border-cyan-200 bg-cyan-50/80 p-3">
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="font-display font-semibold">{services.length} 个服务</div>
            <div className="text-sm text-muted-foreground">同一构建任务服务组 · {flow.label}</div>
          </div>
          <div className="flex flex-wrap gap-2">
            {SERVICE_ROW_PIPELINES.map((item) => {
              const Icon = item.icon;
              return (
                <Button key={item.id} variant={item.tone} size="sm" onClick={() => onStart(item.id)} disabled={running || hasHiddenServices}>
                  {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Icon className="mr-2 h-4 w-4" />}
                  {item.shortLabel}
                </Button>
              );
            })}
            <Button variant="outline" size="sm" onClick={onClear} disabled={running}>清空选择</Button>
          </div>
        </div>
        {hasHiddenServices && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" data-testid="hidden-selection-warning">
            <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
              <div className="flex min-w-0 gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="min-w-0">
                  <div className="font-semibold">已拦截隐藏服务选择</div>
                  <div className="mt-1 break-words">
                    这些服务不在当前服务页或过滤结果中，不会允许批量启动：{selectedServicesText(hiddenServices)}
                  </div>
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={onRemoveHidden} disabled={running}>
                移除隐藏项
              </Button>
            </div>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {services.map((service) => (
            <button
              key={service.serviceKey || service.imageJenkinsName}
              type="button"
              className="inline-flex max-w-full items-center gap-2 rounded-md border border-cyan-200 bg-card px-2.5 py-1.5 text-left text-xs font-semibold text-cyan-950 shadow-sm"
              onClick={() => onRemove(service.serviceKey)}
              disabled={running}
              title="移除该服务"
            >
              <span className="break-all">{service.imageJenkinsName}</span>
              <XCircle className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function ServicePagination({ pageInfo, pageSize, onPageChange, onPageSizeChange }) {
  if (!pageInfo || pageInfo.total <= 0) return null;
  const items = paginationItems(pageInfo.page, pageInfo.totalPages);
  return (
    <div className="flex flex-col gap-3 border-t border-border bg-muted/30 px-3 py-3 text-sm md:flex-row md:items-center md:justify-between">
      <div className="text-muted-foreground">
        第 <span className="font-semibold text-foreground">{pageInfo.page}</span> / {pageInfo.totalPages} 页 ·
        显示 <span className="font-semibold text-foreground">{pageInfo.start}-{pageInfo.end}</span> / 共 {pageInfo.total} 个服务
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-muted-foreground">每页</span>
        <Select value={String(pageSize)} onValueChange={(value) => onPageSizeChange(Number(value))}>
          <SelectTrigger className="h-9 w-[84px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SERVICE_PAGE_SIZE_OPTIONS.map((option) => (
              <SelectItem key={option} value={String(option)}>{option}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={() => onPageChange(pageInfo.page - 1)} disabled={!pageInfo.hasPrev}>上一页</Button>
        <div className="flex flex-wrap items-center gap-1">
          {items.map((item) => typeof item === "number" ? (
            <Button
              key={item}
              variant={item === pageInfo.page ? "default" : "outline"}
              size="sm"
              className="h-9 min-w-9 px-2"
              onClick={() => onPageChange(item)}
              disabled={item === pageInfo.page}
            >
              {item}
            </Button>
          ) : (
            <span key={item} className="px-1 text-muted-foreground">...</span>
          ))}
        </div>
        <Button variant="outline" size="sm" onClick={() => onPageChange(pageInfo.page + 1)} disabled={!pageInfo.hasNext}>下一页</Button>
      </div>
    </div>
  );
}

function ServiceList({ rows, pageInfo, pageSize, profile, appCode, branch, selectedKeys, running, onToggle, onSinglePipeline, onPageChange, onPageSizeChange }) {
  if (!rows.length) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-muted/40 p-8 text-center">
        <Server className="mx-auto h-8 w-8 text-muted-foreground" />
        <div className="mt-3 font-semibold">没有服务数据</div>
        <p className="text-sm text-muted-foreground">正在按当前条件读取平台服务；也可以调整应用、环境和过滤词后刷新。</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="divide-y divide-border">
        {rows.map((row) => {
          const key = serviceKey(row, profile, appCode, branch);
          const selected = selectedKeys.includes(key);
          return (
            <div key={key} className={cn("grid gap-3 p-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center", selected && "bg-cyan-50")}>
              <button type="button" className="flex min-w-0 items-start gap-3 text-left" onClick={() => onToggle(row)}>
                <span className={cn("mt-1 grid h-6 w-6 shrink-0 place-items-center rounded-md border border-border bg-card transition-colors", selected && "border-primary bg-primary text-primary-foreground")}>
                  {selected && <CheckCircle2 className="h-4 w-4" />}
                </span>
                <span className="min-w-0">
                  <span className="block break-all font-mono text-sm font-semibold">{serviceName(row)}</span>
                  <span className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <span>{row.applicationCode || appCode} / {row.codeBranch || branch}</span>
                  </span>
                </span>
              </button>
              <div className="flex flex-wrap gap-2 lg:justify-end">
                {SERVICE_ROW_PIPELINES.map((item) => (
                  <Button key={item.id} variant={item.tone} size="sm" onClick={() => onSinglePipeline(row, item.id)} disabled={running}>
                    {item.shortLabel}
                  </Button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <ServicePagination pageInfo={pageInfo} pageSize={pageSize} onPageChange={onPageChange} onPageSizeChange={onPageSizeChange} />
    </div>
  );
}

function ActivityLog({ items, stretch = false }) {
  if (!items?.length) {
    return (
      <div className={cn("rounded-lg border border-dashed border-border bg-muted/40 p-6 text-center text-sm text-muted-foreground", stretch && "flex h-[360px] min-h-0 flex-none items-center justify-center overflow-hidden xl:h-0 xl:min-h-[360px] xl:flex-1")}>
        点击服务行上的 Pipeline 按钮后，这里会记录预检、构建、发布、失败和重试证据。
      </div>
    );
  }
  return (
    <ScrollArea className={cn("min-w-0 pr-3", stretch ? "h-[360px] min-h-0 flex-none xl:h-0 xl:min-h-[360px] xl:flex-1" : "h-[360px]")}>
      <div className="min-w-0 space-y-2">
        {items.map((item, index) => (
          <div key={`${item.at}-${index}`} className="min-w-0 rounded-lg border border-border bg-card p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-semibold">{item.title}</div>
                <p className="break-words text-sm text-muted-foreground [overflow-wrap:anywhere]">{summarizeFailure(item.detail)}</p>
              </div>
              <Badge variant={item.tone === "danger" ? "danger" : item.tone === "warning" ? "warning" : item.tone === "success" ? "success" : "outline"}>{item.tone}</Badge>
            </div>
            <div className="mt-2 text-xs text-muted-foreground">{item.at}</div>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}

function SettingsPanel({ profiles, credentialState, onSaved, onGo }) {
  const [saving, setSaving] = useState("");
  const [workflowSaving, setWorkflowSaving] = useState(false);
  const [workflowDiscovering, setWorkflowDiscovering] = useState(false);
  const [workflowDeleting, setWorkflowDeleting] = useState("");
  const [workflowDeleteConfirm, setWorkflowDeleteConfirm] = useState("");
  const [workflowDiscovery, setWorkflowDiscovery] = useState(null);
  const [workflowCustomerId, setWorkflowCustomerId] = useState("");
  const [workflowNotice, setWorkflowNotice] = useState(null);
  const [workflowForm, setWorkflowForm] = useState({
    username: "",
    password: ""
  });
  const workflowCustomers = workflowDiscovery?.customers || [];
  const selectedWorkflowCustomer = workflowCustomers.find((item) => workflowCustomerKey(item) === workflowCustomerId);

  async function submit(event, profile, account) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(`${profile.id}:${account.id}`);
    try {
      const response = await fetch("/api/config/credentials", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          profileId: profile.id,
          accountId: account.id,
          username: String(form.get("username") || "").trim(),
          password: String(form.get("password") || "")
        })
      });
      const json = await response.json();
      onSaved(json);
    } finally {
      setSaving("");
    }
  }

  async function submitWorkflow(event) {
    event.preventDefault();
    if (!selectedWorkflowCustomer) return;
    setWorkflowSaving(true);
    setWorkflowNotice(null);
    try {
      const response = await fetch("/api/config/workflows", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username: workflowForm.username,
          password: workflowForm.password,
          customer: selectedWorkflowCustomer
        })
      });
      const json = await response.json();
      if (!response.ok || !json.ok) {
        throw new Error(json.message || json.error || "新增 workflow 失败");
      }
      onSaved(json);
      setWorkflowNotice({
        tone: "success",
        title: "workflow 已新增",
        detail: `${json.profile?.hospitalName || workflowCustomerLabel(selectedWorkflowCustomer)} 已加入 workflow 列表。`
      });
      setWorkflowForm({ username: "", password: "" });
      setWorkflowDiscovery(null);
      setWorkflowCustomerId("");
    } catch (error) {
      setWorkflowNotice({
        tone: "danger",
        title: "新增 workflow 失败",
        detail: error.message
      });
    } finally {
      setWorkflowSaving(false);
    }
  }

  async function discoverWorkflowCustomers() {
    setWorkflowDiscovering(true);
    setWorkflowNotice(null);
    try {
      const response = await fetch("/api/config/workflows/discover-customers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(workflowForm)
      });
      const json = await response.json();
      if (!response.ok || !json.ok) {
        throw new Error(json.message || json.error || "客户探测失败");
      }
      setWorkflowDiscovery(json);
      const first = json.customers?.[0];
      setWorkflowCustomerId(first ? workflowCustomerKey(first) : "");
      setWorkflowNotice({
        tone: first ? "success" : "warning",
        title: first ? "客户探测完成" : "未发现可初始化客户",
        detail: first ? "请选择构建平台客户后新增 workflow。" : "当前账号未返回可初始化客户。"
      });
    } catch (error) {
      setWorkflowDiscovery(null);
      setWorkflowCustomerId("");
      setWorkflowNotice({
        tone: "danger",
        title: "客户探测失败",
        detail: error.message
      });
    } finally {
      setWorkflowDiscovering(false);
    }
  }

  async function deleteWorkflow(profile) {
    if (!profile?.id) return;
    if (workflowDeleteConfirm !== profile.id) {
      setWorkflowDeleteConfirm(profile.id);
      setWorkflowNotice({
        tone: "warning",
        title: "确认删除 workflow",
        detail: `再次点击「确认删除」后，将移除 ${profile.shortName || profile.hospitalName || profile.id}。`
      });
      return;
    }
    setWorkflowDeleting(profile.id);
    setWorkflowNotice(null);
    try {
      const response = await fetch("/api/config/workflows", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ profileId: profile.id })
      });
      const json = await response.json();
      if (!response.ok || !json.ok) {
        throw new Error(json.message || json.error || "删除 workflow 失败");
      }
      onSaved(json);
      setWorkflowNotice({
        tone: "success",
        title: "workflow 已删除",
        detail: `${profile.hospitalName || profile.shortName || profile.id} 已从列表移除。`
      });
    } catch (error) {
      setWorkflowNotice({
        tone: "danger",
        title: "删除 workflow 失败",
        detail: error.message
      });
    } finally {
      setWorkflowDeleting("");
      setWorkflowDeleteConfirm("");
    }
  }

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div>
              <CardTitle>Workflow 账号列表</CardTitle>
              <CardDescription>默认保留演示客户A和演示客户B两个 workflow；新增账号时先探测该账号可见客户，再选择客户初始化 workflow。</CardDescription>
            </div>
            <Badge variant="outline">{profiles.reduce((total, profile) => total + (profile.accounts?.length || 0), 0)} 个 workflow</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <form className="grid gap-3 lg:grid-cols-[minmax(180px,1fr)_minmax(180px,1fr)_auto_minmax(260px,1.4fr)_auto]" onSubmit={submitWorkflow}>
            <Field label="账号">
              <Input value={workflowForm.username} onChange={(event) => { setWorkflowDiscovery(null); setWorkflowCustomerId(""); setWorkflowNotice(null); setWorkflowForm((current) => ({ ...current, username: event.target.value })); }} placeholder="平台登录账号" />
            </Field>
            <Field label="密码">
              <Input value={workflowForm.password} onChange={(event) => { setWorkflowDiscovery(null); setWorkflowCustomerId(""); setWorkflowNotice(null); setWorkflowForm((current) => ({ ...current, password: event.target.value })); }} type="password" placeholder="保存到本地凭据库" />
            </Field>
            <div className="flex items-end">
              <Button type="button" variant="secondary" disabled={workflowDiscovering || !workflowForm.username || !workflowForm.password} onClick={discoverWorkflowCustomers}>
                <Search className="mr-2 h-4 w-4" />
                {workflowDiscovering ? "探测中" : "探测客户"}
              </Button>
            </div>
            <Field label="构建平台客户">
              <Select value={workflowCustomerId} onValueChange={setWorkflowCustomerId} disabled={!workflowCustomers.length}>
                <SelectTrigger><SelectValue placeholder={workflowCustomers.length ? "选择客户初始化" : "先探测客户"} /></SelectTrigger>
                <SelectContent>
                  {workflowCustomers.map((customer) => {
                    const key = workflowCustomerKey(customer);
                    return <SelectItem key={key} value={key}>{workflowCustomerLabel(customer)}</SelectItem>;
                  })}
                </SelectContent>
              </Select>
            </Field>
            <div className="flex items-end">
              <Button type="submit" disabled={workflowSaving || !workflowForm.username || !workflowForm.password || !selectedWorkflowCustomer}>
                <Plus className="mr-2 h-4 w-4" />
                {workflowSaving ? "初始化中" : "新增 workflow"}
              </Button>
            </div>
          </form>
          {workflowNotice && <div className="mt-3"><ResultNotice result={workflowNotice} /></div>}
        </CardContent>
      </Card>
      {profiles.map((profile) => {
        const group = credentialState.find((item) => item.profileId === profile.id);
        return (
          <Card key={profile.id}>
            <CardHeader>
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <CardTitle>{profile.hospitalName}</CardTitle>
                  <CardDescription>{profile.customerNameEn}</CardDescription>
                </div>
                <div className="flex flex-wrap gap-2 md:justify-end">
                  <Button variant="secondary" size="sm" onClick={() => onGo(profile.id, profile.accounts?.[0]?.id)}>进入工作台</Button>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={() => deleteWorkflow(profile)}
                    disabled={workflowDeleting === profile.id}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    {workflowDeleting === profile.id ? "删除中" : workflowDeleteConfirm === profile.id ? "确认删除" : "删除"}
                  </Button>
                  {workflowDeleteConfirm === profile.id && workflowDeleting !== profile.id && (
                    <Button type="button" variant="secondary" size="sm" onClick={() => { setWorkflowDeleteConfirm(""); setWorkflowNotice(null); }}>取消</Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="grid gap-3">
              {profile.accounts.map((account) => {
                const state = group?.accounts?.find((item) => item.accountId === account.id) || {};
                const key = `${profile.id}:${account.id}`;
                return (
                  <form key={key} className="grid gap-3 rounded-lg border border-border p-4 lg:grid-cols-[minmax(180px,.7fr)_minmax(180px,1fr)_minmax(180px,1fr)_auto]" onSubmit={(event) => submit(event, profile, account)}>
                    <div>
                      <div className="font-semibold">{account.label}</div>
                      <div className="mt-1 flex flex-wrap gap-2">
                        <Badge variant={state.configured ? "success" : "warning"}>{state.configured ? "可用" : "缺配置"}</Badge>
                        <Badge variant="outline">{state.source || "profile"}</Badge>
                      </div>
                    </div>
                    <Field label="账号">
                      <Input name="username" defaultValue={state.username || account.username || ""} />
                    </Field>
                    <Field label="密码">
                      <Input name="password" type="password" placeholder={state.configured ? "留空不修改" : "输入后保存到本地凭据库"} />
                    </Field>
                    <div className="flex items-end">
                      <Button type="submit" disabled={saving === key}>{saving === key ? "保存中" : "保存账号"}</Button>
                    </div>
                  </form>
                );
              })}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function Diagnostics({ probes, lastResult }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>诊断</CardTitle>
        <CardDescription>保留原始探测摘要，普通流程不需要进入这里。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {lastResult && <ResultNotice result={lastResult} />}
        <pre className="max-h-[520px] overflow-auto rounded-lg border border-border bg-slate-950 p-4 text-xs text-cyan-50">
          {JSON.stringify(probes, null, 2)}
        </pre>
      </CardContent>
    </Card>
  );
}

export default function AppWithBoundary() {
  return (
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}
