import assert from "node:assert/strict";

import {
  blockedPhaseForPipelineError,
  canResumePipelineRun,
  clonePipelineRunRecord,
  clonePipelineRunDraft,
  DEFAULT_RELEASE_NOTICE,
  DEFAULT_RELEASE_REASON,
  inferResumePoint,
  inferResumeStage,
  mergePipelineRunHistories,
  normalizePipelineRunRecord,
  phaseCardsForRunRecord,
  PIPELINE_RUN_HISTORY_LIMIT,
  progressForPhaseCards,
  releasePendingSummary,
  releaseStagesFor,
  serviceRowPipelineIds,
  toggleExpandedRunIds,
  upsertPipelineRunRecord
} from "../src/client/src/lib/pipeline-run-store.mjs";

const baseRun = normalizePipelineRunRecord({
  id: "run-1",
  createdAt: "2026-05-28T10:00:00.000Z",
  updatedAt: "2026-05-28T10:00:00.000Z",
  templateId: "build-and-release",
  status: "blocked",
  phase: "等待发布记录",
  target: {
    profileId: "demob",
    accountId: "demo_prod",
    appCode: "mem",
    branch: "mastertest",
    buildStrategy: "prod",
    releaseEnvId: "demob-uat-a"
  },
  releaseReason: "reason",
  releaseNotice: "notice",
  serviceSnapshot: [{
    imageJenkinsName: "prescription-mem-ewell-mastertest",
    imageNameEn: "prescription",
    imageVersion: "v1.62.001",
    applicationCode: "mem",
    codeBranch: "mastertest"
  }],
  buildSnapshot: { task: { id: "task-1" }, images: [{ imageJenkinsName: "prescription-mem-ewell-mastertest" }] },
  outcomes: {
    "create-task": { status: "done", detail: "reused" },
    build: { status: "done", detail: "triggered" },
    "release-observe": { status: "blocked", detail: "waiting release record" }
  },
  activity: [{ at: "2026/5/28 10:00:00", title: "blocked", detail: "waiting", tone: "warning" }]
});

assert.equal(baseRun.serviceSnapshot.length, 1);
assert.equal(canResumePipelineRun(baseRun), true);
assert.equal(inferResumeStage(baseRun), "release");
assert.equal(inferResumePoint(baseRun).id, "release-observe", "release-observe blocked runs resume from release observation");
const buildFailedRun = normalizePipelineRunRecord({
  ...baseRun,
  status: "failed",
  phase: "失败",
  outcomes: {
    ...baseRun.outcomes,
    build: { status: "failed", detail: "构建任务 apply-1 状态失败（build_apply_failed）" },
    "build-observe": { status: "running", detail: "之前仍在观察构建" },
    "release-observe": { status: "blocked", detail: "旧的发布观察痕迹" }
  }
});
assert.equal(inferResumePoint(buildFailedRun).id, "build-observe", "build observation failure is the exact resume point");
assert.equal(inferResumeStage(buildFailedRun), "build", "build failure must resume from build even when stale release evidence exists");
assert.equal(buildFailedRun.resumeStage, "build", "stored resumeStage must be corrected to the real blocked build stage");
assert.equal(buildFailedRun.phase, "构建失败", "stale release phase text must be corrected when build is the real failed stage");
assert.equal(
  buildFailedRun.outcomes["build-observe"].status,
  "failed",
  "normalization must reconcile old records where build failed but build-observe was still running"
);
assert.equal(blockedPhaseForPipelineError("build_apply_observe_timeout"), "等待构建完成");
assert.equal(blockedPhaseForPipelineError("release_record_timeout"), "等待发布记录");
assert.equal(blockedPhaseForPipelineError("unknown"), "等待处理");
assert.equal(
  inferResumePoint({ ...baseRun, outcomes: { ...baseRun.outcomes, "build-platform-publish": { status: "failed", detail: "company publish failed" } } }).id,
  "build-platform-publish",
  "build-platform publish failure resumes from that build substep"
);
assert.equal(
  inferResumePoint({ ...baseRun, outcomes: { ...baseRun.outcomes, "release-detail": { status: "failed", detail: "detail failed" } } }).id,
  "release-detail",
  "release-detail failure resumes from release detail loading"
);
assert.equal(
  inferResumePoint({ ...baseRun, target: { ...baseRun.target, branch: "master" }, outcomes: { ...baseRun.outcomes, "publish-company": { status: "failed", detail: "company failed" } } }).id,
  "publish-company",
  "company publish failure resumes from company publish"
);
assert.equal(
  inferResumePoint({ ...baseRun, target: { ...baseRun.target, branch: "master" }, outcomes: { ...baseRun.outcomes, "publish-company": { status: "done" }, "publish-spot": { status: "blocked", detail: "spot blocked" } } }).id,
  "publish-spot",
  "spot publish failure resumes from spot publish without replaying company publish"
);
assert.equal(DEFAULT_RELEASE_REASON, "功能更新");
assert.equal(DEFAULT_RELEASE_NOTICE, "测试");
assert.equal(PIPELINE_RUN_HISTORY_LIMIT, 80, "run history should keep enough recent records while staying bounded");
assert.equal(
  canResumePipelineRun({ ...baseRun, status: "running", outcomes: { "build-observe": { status: "running" } } }),
  false,
  "running records keep the continue action disabled until they become blocked or failed"
);

const draft = clonePipelineRunDraft(baseRun);
assert.deepEqual(draft.target, baseRun.target);
assert.equal(draft.releaseReason, "reason");
assert.equal(draft.releaseNotice, "notice");
assert.equal(draft.serviceSnapshot[0].imageJenkinsName, "prescription-mem-ewell-mastertest");
assert.equal(draft.id, undefined);
assert.equal(draft.activity, undefined);

const clonedRun = clonePipelineRunRecord(baseRun, { id: "clone-1", now: "2026-05-28T14:00:00.000Z" });
assert.equal(clonedRun.id, "clone-1");
assert.equal(clonedRun.copiedFromRunId, "run-1");
assert.equal(clonedRun.status, "draft");
assert.equal(clonedRun.phase, "已复制");
assert.deepEqual(clonedRun.target, baseRun.target);
assert.equal(clonedRun.serviceSnapshot[0].imageJenkinsName, "prescription-mem-ewell-mastertest");
assert.deepEqual(clonedRun.outcomes, {});
assert.equal(clonedRun.activity[0].title, "Pipeline 已复制");
assert.equal(canResumePipelineRun(clonedRun), true, "copied draft runs can be continued from the run table");

const staleRunningRun = normalizePipelineRunRecord({
  ...baseRun,
  id: "stale-running",
  status: "running",
  phase: "等待发布记录",
  updatedAt: "2000-01-01T00:00:00.000Z",
  outcomes: {
    ...baseRun.outcomes,
    "release-observe": { status: "running", detail: "等待发布记录" }
  },
  activity: []
});
assert.equal(staleRunningRun.status, "blocked", "stale persisted running runs become resumable after reload");
assert.equal(staleRunningRun.outcomes["release-observe"].status, "blocked", "running outcome is converted to blocked for stale runs");
assert.equal(canResumePipelineRun(staleRunningRun), true, "stale running runs can be continued");
assert.match(staleRunningRun.activity[0].title, /状态修复/, "stale migration leaves an activity breadcrumb");

let records = [];
records = upsertPipelineRunRecord(records, baseRun, { limit: 2 });
records = upsertPipelineRunRecord(records, { ...baseRun, id: "run-2", createdAt: "2026-05-28T11:00:00.000Z", updatedAt: "2026-05-28T11:00:00.000Z" }, { limit: 2 });
records = upsertPipelineRunRecord(records, { ...baseRun, id: "run-3", createdAt: "2026-05-28T12:00:00.000Z", updatedAt: "2026-05-28T12:00:00.000Z" }, { limit: 2 });
assert.deepEqual(records.map((item) => item.id), ["run-3", "run-2"]);

records = upsertPipelineRunRecord(records, { ...records[1], status: "done", updatedAt: "2026-05-28T13:00:00.000Z" }, { limit: 2 });
assert.equal(records.length, 2);
assert.equal(records[0].id, "run-2");
assert.equal(records[0].status, "done");

const mergedHistory = mergePipelineRunHistories(
  [{ ...baseRun, id: "server-run", updatedAt: "2026-05-28T10:00:00.000Z" }],
  [{ ...baseRun, id: "local-run", updatedAt: "2026-05-28T12:00:00.000Z" }],
  [{ ...baseRun, id: "server-run", status: "done", updatedAt: "2026-05-28T13:00:00.000Z" }]
);
assert.deepEqual(mergedHistory.map((item) => item.id), ["server-run", "local-run"], "server and legacy local histories merge by id and newest update wins");
assert.equal(mergedHistory[0].status, "done");

assert.equal(canResumePipelineRun({ ...baseRun, status: "done", outcomes: { release: { status: "done" } } }), false);

assert.deepEqual(toggleExpandedRunIds([], "run-1"), ["run-1"], "view opens one run row");
assert.deepEqual(toggleExpandedRunIds(["run-1"], "run-2").sort(), ["run-1", "run-2"], "view buttons are per-row and can keep multiple rows open");
assert.deepEqual(toggleExpandedRunIds(["run-1", "run-2"], "run-1"), ["run-2"], "view toggles only the clicked row");

assert.deepEqual(serviceRowPipelineIds(), ["build-and-release", "build-only"], "service rows expose only build+release and build-only actions");

assert.deepEqual(
  releasePendingSummary({ releaseNeeded: true, releaseProbeOk: true, releaseApp: { toPublishServiceNum: 1 } }),
  { text: "发布平台待处理 1 个服务", variant: "warning" },
  "pending count describes release-platform services, not hospital pull count"
);
assert.deepEqual(
  releasePendingSummary({ releaseNeeded: true, releaseProbeOk: true, releaseApp: { toPublishServiceNum: 0 } }),
  { text: "发布平台无待处理服务", variant: "success" },
  "zero pending release app is explicit"
);
assert.deepEqual(
  releasePendingSummary({ releaseNeeded: false, releaseProbeOk: false, releaseApp: null }),
  { text: "开发环境无发布段", variant: "success" },
  "develop-style environments do not show pending release counts"
);

const runningBuildCards = phaseCardsForRunRecord({
  ...baseRun,
  status: "running",
  phase: "等待构建完成",
  outcomes: {
    probe: { status: "done" },
    "create-task": { status: "done" },
    "build-task": { status: "done" },
    build: { status: "done", detail: "legacy triggered marker without observer" },
    "build-observe": { status: "running", detail: "still building" }
  }
});
assert.equal(runningBuildCards.find((card) => card.id === "build").status, "running", "build macro stage stays running while build observation is running");
assert.match(runningBuildCards.find((card) => card.id === "build").value, /申请\+构建/, "build macro text reflects request plus build");

const completedBuildCards = phaseCardsForRunRecord({
  ...baseRun,
  status: "running",
  outcomes: {
    probe: { status: "done" },
    build: { status: "done" },
    "build-observe": { status: "done" },
    "release-observe": { status: "running" }
  }
});
assert.equal(completedBuildCards.find((card) => card.id === "build").status, "done", "build macro stage is done only after build observation succeeds");

assert.deepEqual(releaseStagesFor("master"), ["company", "spot"], "master release has independent company and spot publish stages");
const parallelReleaseCards = phaseCardsForRunRecord({
  ...baseRun,
  target: { ...baseRun.target, branch: "master" },
  status: "running",
  outcomes: {
    probe: { status: "done" },
    build: { status: "done" },
    "build-observe": { status: "done" },
    "release-detail": { status: "done" },
    "publish-company": { status: "done", detail: "no-op" },
    "publish-spot": { status: "running", detail: "publishing" }
  }
});
assert.equal(parallelReleaseCards.find((card) => card.id === "release").status, "running", "release macro stage remains running until both company and spot settle");

const noOpReleaseCards = phaseCardsForRunRecord({
  ...baseRun,
  target: { ...baseRun.target, branch: "master" },
  status: "done",
  outcomes: {
    probe: { status: "done" },
    build: { status: "done" },
    "build-observe": { status: "done" },
    "publish-company": { status: "done", detail: "no-op" },
    "publish-spot": { status: "done", detail: "published" },
    release: { status: "done" }
  }
});
assert.equal(noOpReleaseCards.find((card) => card.id === "release").status, "done", "release macro stage is done after both independent stages are done or no-op");
assert.equal(noOpReleaseCards.find((card) => card.id === "target").label, "服务目标");
assert.equal(noOpReleaseCards.find((card) => card.id === "probe").status, "done");
assert.notEqual(noOpReleaseCards.find((card) => card.id === "probe").value, "待刷新", "completed run details never show stale draft probe text");
assert.equal(progressForPhaseCards(noOpReleaseCards), 100, "all macro stages done yields 100% progress");

const multiServiceCards = phaseCardsForRunRecord({
  ...baseRun,
  serviceSnapshot: [
    { imageJenkinsName: "prescription-mem-ewell-mastertest" },
    { imageJenkinsName: "patient-mem-ewell-mastertest" },
    { imageJenkinsName: "pay-mem-ewell-mastertest" }
  ]
});
const multiServiceTarget = multiServiceCards.find((card) => card.id === "target").value;
assert.match(multiServiceTarget, /prescription-mem-ewell-mastertest/);
assert.match(multiServiceTarget, /patient-mem-ewell-mastertest/);
assert.match(multiServiceTarget, /pay-mem-ewell-mastertest/);
assert.doesNotMatch(multiServiceTarget, /\+\d|3 个服务/, "macro target card must preserve full multi-service names");

console.log("pipeline run store checks passed");
