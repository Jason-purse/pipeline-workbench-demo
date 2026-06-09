import assert from "node:assert/strict";

import {
  canResumePipelineRun,
  clonePipelineRunRecord,
  clonePipelineRunDraft,
  mergePipelineRunHistories,
  normalizePipelineRunRecord,
  phaseCardsForRunRecord,
  progressForPhaseCards,
  upsertPipelineRunRecord
} from "../src/client/src/lib/pipeline-run-store.mjs";

const v2Run = normalizePipelineRunRecord({
  schemaVersion: 2,
  id: "run-v2-1",
  createdAt: "2026-06-04T00:00:00.000Z",
  updatedAt: "2026-06-04T00:01:00.000Z",
  templateId: "build-and-release",
  status: "blocked",
  phase: "等待发布记录",
  target: {
    profileId: "demob",
    accountId: "demo_prod",
    appCode: "mem",
    branch: "mastertest",
    buildStrategy: "prod",
    releaseEnvId: "demob-uat-a",
    releaseEnvLabel: "uat/a"
  },
  serviceSnapshot: [{
    imageJenkinsName: "prescription-mem-ewell-mastertest",
    imageNameEn: "prescription",
    imageVersion: "v1.62.001",
    generatedVersion: "v1.62.009",
    buildId: "#122",
    candidateBuildIds: ["#123"]
  }],
  context: {
    target: { appCode: "mem", branch: "mastertest" },
    inputs: { releaseReason: "功能更新", releaseNotice: "测试" },
    data: { buildSnapshot: { taskId: "task-1" } }
  },
  commands: [
    { id: "probe-platforms", title: "平台预检", phase: "构建预检" },
    { id: "trigger-build", title: "触发构建", phase: "构建" },
    { id: "wait-release-record", title: "等待发布记录", phase: "等待发布记录" }
  ],
  memento: {
    cursor: { commandId: "wait-release-record" },
    commands: {
      "probe-platforms": { status: "done", phase: "构建预检", detail: "ready" },
      "trigger-build": { status: "done", phase: "等待构建完成", detail: "triggered" },
      "wait-release-record": { status: "blocked", phase: "等待发布记录", detail: "release timeout" }
    }
  },
  activity: [{ at: "2026-06-04T00:01:00.000Z", title: "等待发布记录", detail: "release timeout", tone: "warning" }]
});

assert.equal(v2Run.schemaVersion, 2);
assert.equal(v2Run.status, "blocked");
assert.equal(v2Run.phase, "等待发布记录");
assert.equal(v2Run.memento.cursor.commandId, "wait-release-record");
assert.equal(canResumePipelineRun(v2Run), true);
assert.equal("outcomes" in v2Run, false, "normalized v2 records must not expose outcomes");
assert.equal("resumeStage" in v2Run, false, "normalized v2 records must not expose resumeStage");

const legacyRun = normalizePipelineRunRecord({
  id: "legacy-run",
  status: "blocked",
  phase: "等待发布记录",
  target: { appCode: "mem", branch: "mastertest" },
  serviceSnapshot: [{ imageJenkinsName: "legacy-service" }],
  outcomes: { "release-observe": { status: "blocked", detail: "old resume point" } },
  resumeStage: "release"
});

assert.equal(legacyRun.schemaVersion, 2);
assert.equal(legacyRun.status, "cancelled", "old outcomes/resumeStage records are intentionally incompatible");
assert.equal(legacyRun.phase, "历史 Run 格式不兼容");
assert.equal(canResumePipelineRun(legacyRun), false, "legacy v1 records must not be resumable through v2");
assert.equal("outcomes" in legacyRun, false);
assert.equal("resumeStage" in legacyRun, false);

const draft = clonePipelineRunDraft(v2Run);
assert.deepEqual(draft.target, v2Run.target);
assert.equal(draft.context.inputs.releaseReason, "功能更新");
assert.equal(draft.commands, undefined, "draft cloning keeps config but not execution command state");
assert.equal(draft.memento, undefined, "draft cloning keeps config but not execution snapshots");
assert.equal(draft.serviceSnapshot[0].imageVersion, undefined, "draft cloning must strip previous execution image versions");
assert.equal(draft.serviceSnapshot[0].generatedVersion, undefined, "draft cloning must strip generated execution versions");
assert.equal(draft.serviceSnapshot[0].buildId, undefined, "draft cloning must strip previous Jenkins build ids");

const cloned = clonePipelineRunRecord(v2Run, { id: "clone-1", now: "2026-06-04T00:02:00.000Z" });
assert.equal(cloned.id, "clone-1");
assert.equal(cloned.copiedFromRunId, "run-v2-1");
assert.equal(cloned.status, "draft");
assert.equal(cloned.phase, "已复制");
assert.equal(cloned.memento.cursor.commandId, "probe-platforms");
assert.equal(cloned.serviceSnapshot[0].imageVersion, undefined, "copied v2 runs must not inherit the old target image version");
assert.equal(cloned.serviceSnapshot[0].generatedVersion, undefined, "copied v2 runs must not inherit the old generated version");
assert.equal(cloned.serviceSnapshot[0].buildId, undefined, "copied v2 runs must not inherit old Jenkins build ids");
assert.equal(canResumePipelineRun(cloned), true, "copied draft v2 runs can be started from the first command");
assert.equal("outcomes" in cloned, false);
assert.equal("resumeStage" in cloned, false);

let history = [];
history = upsertPipelineRunRecord(history, v2Run, { limit: 2 });
history = upsertPipelineRunRecord(history, { ...v2Run, id: "run-v2-2", updatedAt: "2026-06-04T00:03:00.000Z" }, { limit: 2 });
history = upsertPipelineRunRecord(history, { ...v2Run, id: "run-v2-3", updatedAt: "2026-06-04T00:04:00.000Z" }, { limit: 2 });
assert.deepEqual(history.map((item) => item.id), ["run-v2-3", "run-v2-2"]);
assert.equal(history.some((item) => "outcomes" in item || "resumeStage" in item), false);

const merged = mergePipelineRunHistories(
  [{ ...v2Run, id: "same-run", status: "blocked", updatedAt: "2026-06-04T00:02:00.000Z" }],
  [{ ...v2Run, id: "same-run", status: "done", phase: "完成", updatedAt: "2026-06-04T00:05:00.000Z" }]
);
assert.equal(merged[0].id, "same-run");
assert.equal(merged[0].status, "done");

const cards = phaseCardsForRunRecord(v2Run);
assert.deepEqual(cards.map((card) => card.id), ["target", "probe", "build", "release"]);
assert.equal(cards.find((card) => card.id === "build").status, "done");
assert.equal(cards.find((card) => card.id === "release").status, "blocked");
assert.equal(progressForPhaseCards(cards), 75);

console.log("pipeline run v2 store checks passed");
