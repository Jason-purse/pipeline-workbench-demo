import assert from "node:assert/strict";

import {
  canResumePipelineRun,
  clonePipelineRunRecord,
  clonePipelineRunDraft,
  DEFAULT_RELEASE_NOTICE,
  DEFAULT_RELEASE_REASON,
  inferResumePoint,
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

const commands = [
  { id: "probe-platforms", title: "平台预检", phase: "构建预检", stage: "prepare" },
  { id: "read-build-status", title: "读取构建状态", phase: "构建预检", stage: "build" },
  { id: "generate-version", title: "生成版本", phase: "版本预检", stage: "build" },
  { id: "create-or-reuse-task", title: "创建或复用构建任务", phase: "创建构建任务", stage: "build" },
  { id: "wait-buildable-task", title: "等待任务开放构建", phase: "等待构建任务", stage: "build" },
  { id: "trigger-build", title: "触发构建", phase: "构建", stage: "build" },
  { id: "observe-build", title: "观察构建", phase: "等待构建完成", stage: "build" },
  { id: "confirm-build-platform-publish", title: "确认构建平台发布", phase: "构建平台发布", stage: "build" },
  { id: "wait-release-record", title: "等待发布记录", phase: "等待发布记录", stage: "release" },
  { id: "read-release-detail", title: "读取发布清单", phase: "发布清单", stage: "release" },
  { id: "publish-company", title: "公司发布", phase: "公司发布", stage: "release" },
  { id: "publish-spot", title: "现场发布", phase: "现场发布", stage: "release" },
  { id: "complete-run", title: "完成 Pipeline", phase: "完成", stage: "complete" }
];

function commandSnapshots(overrides = {}) {
  const snapshots = Object.fromEntries(commands.map((command) => [
    command.id,
    {
      status: "pending",
      phase: command.phase,
      title: command.title,
      detail: ""
    }
  ]));
  return { ...snapshots, ...overrides };
}

function makeRun(overrides = {}) {
  return normalizePipelineRunRecord({
    schemaVersion: 2,
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
      branch: "master",
      buildStrategy: "prod",
      releaseEnvId: "demob-prod-a",
      releaseEnvLabel: "prod/a"
    },
    releaseReason: "reason",
    releaseNotice: "notice",
    serviceSnapshot: [{
      imageJenkinsName: "prescription-mem-ewell-master",
      imageNameEn: "prescription",
      imageVersion: "v1.62.001",
      generatedVersion: "v1.62.009",
      applicationCode: "mem",
      codeBranch: "master",
      buildId: "#122",
      candidateBuildId: "#123",
      candidateBuildIds: ["#123", "#124"]
    }],
    context: {
      target: { appCode: "mem", branch: "master" },
      inputs: { releaseReason: "reason", releaseNotice: "notice" },
      data: { buildSnapshot: { task: { id: "task-1" }, images: [{ imageJenkinsName: "prescription-mem-ewell-master" }] } }
    },
    commands,
    memento: {
      cursor: { commandId: "wait-release-record", index: 8, status: "blocked", phase: "等待发布记录", detail: "waiting release record" },
      order: commands.map((command) => command.id),
      commands: commandSnapshots({
        "probe-platforms": { status: "done", phase: "构建预检", title: "平台预检", detail: "ready" },
        "read-build-status": { status: "done", phase: "构建预检", title: "读取构建状态", detail: "service detail loaded" },
        "generate-version": { status: "done", phase: "版本预检", title: "生成版本", detail: "versions generated" },
        "create-or-reuse-task": { status: "done", phase: "创建构建任务", title: "创建或复用构建任务", detail: "reused" },
        "wait-buildable-task": { status: "done", phase: "等待构建任务", title: "等待任务开放构建", detail: "all services buildable" },
        "trigger-build": { status: "done", phase: "等待构建完成", title: "触发构建", detail: "triggered" },
        "observe-build": { status: "done", phase: "等待构建完成", title: "观察构建", detail: "build succeeded" },
        "confirm-build-platform-publish": { status: "done", phase: "构建平台发布", title: "确认构建平台发布", detail: "submitted" },
        "wait-release-record": { status: "blocked", phase: "等待发布记录", title: "等待发布记录", detail: "waiting release record" }
      })
    },
    activity: [{ at: "2026/5/28 10:00:00", title: "blocked", detail: "waiting", tone: "warning" }],
    ...overrides
  });
}

const baseRun = makeRun();

assert.equal(baseRun.schemaVersion, 2);
assert.equal(baseRun.serviceSnapshot.length, 1);
assert.equal(canResumePipelineRun(baseRun), true);
assert.equal(inferResumePoint(baseRun).id, "wait-release-record", "blocked release command is the resume cursor");
assert.equal(inferResumePoint(baseRun).stage, "release");
assert.equal("outcomes" in baseRun, false);
assert.equal("resumeStage" in baseRun, false);

const taskVersionRun = makeRun({
  serviceSnapshot: [{
    imageJenkinsName: "outpatweb-mem-ewell-mastertest",
    imageNameEn: "outpatweb",
    imageVersion: "v1.57.004",
    generatedVersion: "v1.57.004",
    applicationCode: "mem",
    codeBranch: "mastertest"
  }],
  context: {
    target: { appCode: "mem", branch: "mastertest" },
    inputs: { releaseReason: "reason", releaseNotice: "notice" },
    data: {
      buildSnapshot: {
        task: { id: "task-2" },
        images: [{
          imageJenkinsName: "outpatweb-mem-ewell-mastertest",
          imageNameEn: "outpatweb",
          imageVersion: "v1.57.005"
        }]
      }
    }
  }
});
assert.equal(taskVersionRun.serviceSnapshot[0].generatedVersion, "v1.57.005", "non-develop Run display/resume must prefer the build task target version");
assert.equal(taskVersionRun.serviceSnapshot[0].imageVersion, "v1.57.005", "non-develop Run probes must not keep the previous successful platform version");

const buildFailedRun = makeRun({
  status: "failed",
  phase: "构建失败",
  memento: {
    cursor: { commandId: "observe-build", index: 6, status: "failed", phase: "等待构建完成", detail: "构建任务 apply-1 状态失败（build_apply_failed）" },
    order: commands.map((command) => command.id),
    commands: commandSnapshots({
      "probe-platforms": { status: "done", phase: "构建预检", title: "平台预检", detail: "ready" },
      "create-or-reuse-task": { status: "done", phase: "创建构建任务", title: "创建或复用构建任务", detail: "reused" },
      "trigger-build": { status: "done", phase: "等待构建完成", title: "触发构建", detail: "triggered" },
      "observe-build": { status: "failed", phase: "等待构建完成", title: "观察构建", detail: "构建任务 apply-1 状态失败（build_apply_failed）" },
      "wait-release-record": { status: "pending", phase: "等待发布记录", title: "等待发布记录", detail: "" }
    })
  }
});
assert.equal(inferResumePoint(buildFailedRun).id, "observe-build", "build observation failure is the exact resume point");
assert.equal(inferResumePoint(buildFailedRun).stage, "build", "build failure resumes from build-stage command state");
assert.equal(buildFailedRun.phase, "构建失败");

const buildPlatformFailedRun = makeRun({
  status: "failed",
  memento: {
    cursor: { commandId: "confirm-build-platform-publish", index: 7, status: "failed", phase: "构建平台发布", detail: "company publish failed" },
    order: commands.map((command) => command.id),
    commands: commandSnapshots({
      "confirm-build-platform-publish": { status: "failed", phase: "构建平台发布", title: "确认构建平台发布", detail: "company publish failed" }
    })
  }
});
assert.equal(inferResumePoint(buildPlatformFailedRun).id, "confirm-build-platform-publish");

const spotBlockedRun = makeRun({
  target: { ...baseRun.target, branch: "master" },
  memento: {
    cursor: { commandId: "publish-spot", index: 11, status: "blocked", phase: "现场发布", detail: "spot blocked" },
    order: commands.map((command) => command.id),
    commands: commandSnapshots({
      "publish-company": { status: "done", phase: "公司发布", title: "公司发布", detail: "company done" },
      "publish-spot": { status: "blocked", phase: "现场发布", title: "现场发布", detail: "spot blocked" }
    })
  }
});
assert.equal(inferResumePoint(spotBlockedRun).id, "publish-spot", "spot publish failure resumes from spot command without replaying company publish");

assert.equal(DEFAULT_RELEASE_REASON, "功能更新");
assert.equal(DEFAULT_RELEASE_NOTICE, "测试");
assert.equal(PIPELINE_RUN_HISTORY_LIMIT, 80, "run history should keep enough recent records while staying bounded");
assert.equal(canResumePipelineRun({ ...baseRun, status: "running", updatedAt: new Date().toISOString() }), false, "running records keep the continue action disabled until blocked or failed");

const legacyRun = normalizePipelineRunRecord({
  id: "legacy-run",
  status: "blocked",
  outcomes: { "release-observe": { status: "blocked", detail: "legacy" } },
  resumeStage: "release"
});
assert.equal(legacyRun.status, "cancelled", "old outcomes/resumeStage history is intentionally incompatible");
assert.equal(canResumePipelineRun(legacyRun), false);
assert.equal("outcomes" in legacyRun, false);
assert.equal("resumeStage" in legacyRun, false);

const draft = clonePipelineRunDraft(baseRun);
assert.deepEqual(draft.target, baseRun.target);
assert.equal(draft.releaseReason, "reason");
assert.equal(draft.releaseNotice, "notice");
assert.equal(draft.serviceSnapshot[0].imageJenkinsName, "prescription-mem-ewell-master");
assert.equal(draft.serviceSnapshot[0].imageVersion, undefined, "copied drafts must not keep the source Run target version");
assert.equal(draft.serviceSnapshot[0].generatedVersion, undefined, "copied drafts must not keep a generated version from the source execution");
assert.equal(draft.serviceSnapshot[0].buildId, undefined, "copied drafts must not keep the source Jenkins build id");
assert.equal(draft.serviceSnapshot[0].candidateBuildIds, undefined, "copied drafts must not keep source candidate Jenkins build ids");
assert.equal(draft.id, undefined);
assert.equal(draft.activity, undefined);
assert.equal(draft.memento, undefined);

const clonedRun = clonePipelineRunRecord(baseRun, { id: "clone-1", now: "2026-05-28T14:00:00.000Z" });
assert.equal(clonedRun.id, "clone-1");
assert.equal(clonedRun.copiedFromRunId, "run-1");
assert.equal(clonedRun.status, "draft");
assert.equal(clonedRun.phase, "已复制");
assert.deepEqual(clonedRun.target, baseRun.target);
assert.equal(clonedRun.serviceSnapshot[0].imageJenkinsName, "prescription-mem-ewell-master");
assert.equal(clonedRun.serviceSnapshot[0].imageVersion, undefined, "copied Run records are cold config artifacts, not previous build snapshots");
assert.equal(clonedRun.serviceSnapshot[0].generatedVersion, undefined, "copied Run records must generate or read the next version in a fresh execution");
assert.equal(clonedRun.serviceSnapshot[0].buildId, undefined, "copied Run records must not expose the source build log");
assert.equal(clonedRun.serviceSnapshot[0].candidateBuildId, undefined, "copied Run records must not poll source candidate build logs");
assert.equal(clonedRun.memento.cursor.commandId, "probe-platforms");
assert.equal(canResumePipelineRun(clonedRun), true, "copied draft runs can be continued from the run table");

const coldStartedFalseRun = normalizePipelineRunRecord({
  ...clonedRun,
  status: "running",
  started: false,
  memento: {
    ...clonedRun.memento,
    cursor: { commandId: "probe-platforms", index: 0, status: "running", phase: "构建预检", detail: "stale local draft state" },
    commands: {
      ...clonedRun.memento.commands,
      "probe-platforms": {
        ...clonedRun.memento.commands["probe-platforms"],
        status: "running"
      }
    }
  }
});
assert.equal(coldStartedFalseRun.status, "draft", "started:false runs must remain cold drafts even if stale local memento says running");
assert.deepEqual(
  phaseCardsForRunRecord(coldStartedFalseRun).map((card) => [card.id, card.status]),
  [
    ["target", "done"],
    ["probe", "pending"],
    ["build", "pending"],
    ["release", "pending"]
  ],
  "cold copied Run phase cards must not show inherited done/running state before the fresh execution starts"
);

const staleRunningRun = makeRun({
  id: "stale-running",
  status: "running",
  phase: "等待发布记录",
  updatedAt: "2000-01-01T00:00:00.000Z",
  memento: {
    cursor: { commandId: "wait-release-record", index: 8, status: "running", phase: "等待发布记录", detail: "等待发布记录" },
    order: commands.map((command) => command.id),
    commands: commandSnapshots({
      "wait-release-record": { status: "running", phase: "等待发布记录", title: "等待发布记录", detail: "等待发布记录" }
    })
  },
  activity: []
});
assert.equal(staleRunningRun.status, "blocked", "stale persisted running runs become resumable after reload");
assert.equal(staleRunningRun.memento.commands["wait-release-record"].status, "blocked", "running command is converted to blocked for stale runs");
assert.equal(canResumePipelineRun(staleRunningRun), true, "stale running runs can be continued");
assert.match(staleRunningRun.activity[0].title, /状态修复/, "stale migration leaves an activity breadcrumb");

let records = [];
records = upsertPipelineRunRecord(records, baseRun, { limit: 2 });
records = upsertPipelineRunRecord(records, { ...baseRun, id: "run-2", createdAt: "2026-05-28T11:00:00.000Z", updatedAt: "2026-05-28T11:00:00.000Z" }, { limit: 2 });
records = upsertPipelineRunRecord(records, { ...baseRun, id: "run-3", createdAt: "2026-05-28T12:00:00.000Z", updatedAt: "2026-05-28T12:00:00.000Z" }, { limit: 2 });
assert.deepEqual(records.map((item) => item.id), ["run-3", "run-2"]);
assert.equal(records.some((item) => "outcomes" in item || "resumeStage" in item), false);

records = upsertPipelineRunRecord(records, { ...records[1], status: "done", updatedAt: "2026-05-28T13:00:00.000Z" }, { limit: 2 });
assert.equal(records.length, 2);
assert.equal(records[0].id, "run-2");
assert.equal(records[0].status, "done");

const mergedHistory = mergePipelineRunHistories(
  [{ ...baseRun, id: "server-run", updatedAt: "2026-05-28T10:00:00.000Z" }],
  [{ ...baseRun, id: "local-run", updatedAt: "2026-05-28T12:00:00.000Z" }],
  [{ ...baseRun, id: "server-run", status: "done", updatedAt: "2026-05-28T13:00:00.000Z" }]
);
assert.deepEqual(mergedHistory.map((item) => item.id), ["server-run", "local-run"], "server and local histories merge by id and newest update wins");
assert.equal(mergedHistory[0].status, "done");

assert.equal(canResumePipelineRun({ ...baseRun, status: "done" }), false);
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

const freshRunningUpdatedAt = new Date().toISOString();

const runningBuildCards = phaseCardsForRunRecord(makeRun({
  status: "running",
  updatedAt: freshRunningUpdatedAt,
  phase: "等待构建完成",
  memento: {
    cursor: { commandId: "observe-build", index: 6, status: "running", phase: "等待构建完成", detail: "still building" },
    order: commands.map((command) => command.id),
    commands: commandSnapshots({
      "probe-platforms": { status: "done", phase: "构建预检", title: "平台预检", detail: "ready" },
      "create-or-reuse-task": { status: "done", phase: "创建构建任务", title: "创建或复用构建任务", detail: "reused" },
      "wait-buildable-task": { status: "done", phase: "等待构建任务", title: "等待任务开放构建", detail: "all buildable" },
      "trigger-build": { status: "done", phase: "等待构建完成", title: "触发构建", detail: "triggered" },
      "observe-build": { status: "running", phase: "等待构建完成", title: "观察构建", detail: "still building" }
    })
  }
}));
assert.equal(runningBuildCards.find((card) => card.id === "build").status, "running", "build macro stage stays running while build observation is running");
assert.match(runningBuildCards.find((card) => card.id === "build").value, /生产申请\+构建/, "build macro text reflects request plus build");

const resumedBuildObservationRun = makeRun({
  status: "running",
  updatedAt: freshRunningUpdatedAt,
  phase: "等待构建完成",
  memento: {
    cursor: { commandId: "observe-build", index: 6, status: "running", phase: "等待构建完成", detail: "current observation is polling" },
    order: commands.map((command) => command.id),
    commands: commandSnapshots({
      "generate-version": { status: "blocked", phase: "版本预检", title: "生成版本", detail: "old stale blocked state" },
      "trigger-build": { status: "running", phase: "构建", title: "触发构建", detail: "old stale running state" },
      "observe-build": { status: "running", phase: "等待构建完成", title: "观察构建", detail: "current observation is polling" }
    })
  }
});
assert.equal(inferResumePoint(resumedBuildObservationRun).id, "observe-build", "current cursor wins over stale earlier blocked commands after a resumed Run advances");
assert.equal(phaseCardsForRunRecord(resumedBuildObservationRun).find((card) => card.id === "build").status, "running", "macro build state follows the current observation instead of stale earlier blocked commands");

const completedBuildCards = phaseCardsForRunRecord(makeRun({
  status: "running",
  updatedAt: freshRunningUpdatedAt,
  memento: {
    cursor: { commandId: "wait-release-record", index: 8, status: "running", phase: "等待发布记录", detail: "waiting release" },
    order: commands.map((command) => command.id),
    commands: commandSnapshots({
      "probe-platforms": { status: "done", phase: "构建预检", title: "平台预检", detail: "ready" },
      "read-build-status": { status: "done", phase: "构建预检", title: "读取构建状态", detail: "service detail loaded" },
      "generate-version": { status: "done", phase: "版本预检", title: "生成版本", detail: "versions generated" },
      "create-or-reuse-task": { status: "done", phase: "创建构建任务", title: "创建或复用构建任务", detail: "reused" },
      "wait-buildable-task": { status: "done", phase: "等待构建任务", title: "等待任务开放构建", detail: "all buildable" },
      "trigger-build": { status: "done", phase: "等待构建完成", title: "触发构建", detail: "triggered" },
      "observe-build": { status: "done", phase: "等待构建完成", title: "观察构建", detail: "build succeeded" },
      "confirm-build-platform-publish": { status: "done", phase: "构建平台发布", title: "确认构建平台发布", detail: "submitted" },
      "wait-release-record": { status: "running", phase: "等待发布记录", title: "等待发布记录", detail: "waiting release" }
    })
  }
}));
assert.equal(completedBuildCards.find((card) => card.id === "build").status, "done", "build macro stage is done only after build observation succeeds");

assert.deepEqual(releaseStagesFor("master"), ["company", "spot"], "master release has independent company and spot publish stages");
const parallelReleaseCards = phaseCardsForRunRecord(makeRun({
  status: "running",
  updatedAt: freshRunningUpdatedAt,
  memento: {
    cursor: { commandId: "publish-spot", index: 11, status: "running", phase: "现场发布", detail: "publishing" },
    order: commands.map((command) => command.id),
    commands: commandSnapshots({
      "probe-platforms": { status: "done", phase: "构建预检", title: "平台预检", detail: "ready" },
      "trigger-build": { status: "done", phase: "等待构建完成", title: "触发构建", detail: "triggered" },
      "observe-build": { status: "done", phase: "等待构建完成", title: "观察构建", detail: "build succeeded" },
      "confirm-build-platform-publish": { status: "done", phase: "构建平台发布", title: "确认构建平台发布", detail: "submitted" },
      "wait-release-record": { status: "done", phase: "等待发布记录", title: "等待发布记录", detail: "ready" },
      "read-release-detail": { status: "done", phase: "发布清单", title: "读取发布清单", detail: "detail loaded" },
      "publish-company": { status: "done", phase: "公司发布", title: "公司发布", detail: "no-op" },
      "publish-spot": { status: "running", phase: "现场发布", title: "现场发布", detail: "publishing" }
    })
  }
}));
assert.equal(parallelReleaseCards.find((card) => card.id === "release").status, "running", "release macro stage remains running until both company and spot settle");

const noOpReleaseCards = phaseCardsForRunRecord(makeRun({
  status: "done",
  phase: "完成",
  memento: {
    cursor: { commandId: "", index: commands.length, status: "done", phase: "完成", detail: "done" },
    order: commands.map((command) => command.id),
    commands: commandSnapshots(Object.fromEntries(commands.map((command) => [
      command.id,
      { status: "done", phase: command.phase, title: command.title, detail: "done" }
    ])))
  }
}));
assert.equal(noOpReleaseCards.find((card) => card.id === "release").status, "done", "release macro stage is done after both independent stages are done or no-op");
assert.equal(noOpReleaseCards.find((card) => card.id === "target").label, "服务目标");
assert.equal(noOpReleaseCards.find((card) => card.id === "probe").status, "done");
assert.notEqual(noOpReleaseCards.find((card) => card.id === "probe").value, "待刷新", "completed run details never show stale draft probe text");
assert.equal(progressForPhaseCards(noOpReleaseCards), 100, "all macro stages done yields 100% progress");

const multiServiceCards = phaseCardsForRunRecord(makeRun({
  serviceSnapshot: [
    { imageJenkinsName: "prescription-mem-ewell-master" },
    { imageJenkinsName: "patient-mem-ewell-master" },
    { imageJenkinsName: "pay-mem-ewell-master" }
  ]
}));
const multiServiceTarget = multiServiceCards.find((card) => card.id === "target").value;
assert.match(multiServiceTarget, /prescription-mem-ewell-master/);
assert.match(multiServiceTarget, /patient-mem-ewell-master/);
assert.match(multiServiceTarget, /pay-mem-ewell-master/);
assert.doesNotMatch(multiServiceTarget, /\+\d|3 个服务/, "macro target card must preserve full multi-service names");

console.log("pipeline run store checks passed");
