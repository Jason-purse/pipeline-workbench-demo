import assert from "node:assert/strict";
import { existsSync } from "node:fs";

const modulePaths = [
  "../src/client/src/lib/pipeline-command.mjs",
  "../src/client/src/lib/pipeline-run-context.mjs",
  "../src/client/src/lib/pipeline-run-memento.mjs",
  "../src/client/src/lib/pipeline-flow-contract.mjs",
  "../src/client/src/lib/pipeline-run-builder.mjs"
];

for (const modulePath of modulePaths) {
  assert.equal(
    existsSync(new URL(modulePath, import.meta.url)),
    true,
    `${modulePath} must exist for the PipelineRun v2 model`
  );
}

const { createPipelineCommand } = await import("../src/client/src/lib/pipeline-command.mjs");
const { createPipelineRunContext } = await import("../src/client/src/lib/pipeline-run-context.mjs");
const {
  createPipelineRunMemento,
  applyCommandEventToMemento,
  resumePointFromMemento
} = await import("../src/client/src/lib/pipeline-run-memento.mjs");
const { createFlowContract } = await import("../src/client/src/lib/pipeline-flow-contract.mjs");
const { buildPipelineRun } = await import("../src/client/src/lib/pipeline-run-builder.mjs");

const target = {
  profileId: "demob",
  accountId: "demo_prod",
  appCode: "mem",
  branch: "master",
  buildStrategy: "prod",
  releaseEnvId: "demob-prod-a",
  releaseEnvLabel: "prod/a"
};
const services = [
  { serviceKey: "mem::a", imageJenkinsName: "patient-mem-ewell-master", imageNameEn: "patient" },
  { serviceKey: "mem::b", imageJenkinsName: "prescription-mem-ewell-master", imageNameEn: "prescription" }
];

const contract = createFlowContract({
  templateId: "build-and-release",
  target,
  services,
  inputs: { releaseReason: "功能更新", releaseNotice: "测试" }
});

assert.equal(contract.schemaVersion, 2);
assert.equal(contract.templateId, "build-and-release");
assert.deepEqual(
  contract.commands.map((command) => command.id),
  [
    "probe-platforms",
    "read-build-status",
    "generate-version",
    "create-or-reuse-task",
    "wait-buildable-task",
    "trigger-build",
    "observe-build",
    "confirm-build-platform-publish",
    "wait-release-record",
    "read-release-detail",
    "publish-company",
    "publish-spot",
    "complete-run"
  ],
  "master build-and-release contract should expose ordered build and release commands"
);
assert.deepEqual(
  createFlowContract({ templateId: "build-only", target, services }).commands.map((command) => command.id),
  [
    "probe-platforms",
    "read-build-status",
    "generate-version",
    "create-or-reuse-task",
    "wait-buildable-task",
    "trigger-build",
    "observe-build",
    "confirm-build-platform-publish",
    "complete-run"
  ],
  "build-only contract must not include release commands"
);
assert.deepEqual(
  createFlowContract({ templateId: "release-existing", target, services }).commands.map((command) => command.id),
  [
    "probe-platforms",
    "wait-release-record",
    "read-release-detail",
    "publish-company",
    "publish-spot",
    "complete-run"
  ],
  "release-existing contract must skip build commands"
);

const run = buildPipelineRun({
  contract,
  target,
  services,
  inputs: { releaseReason: "功能更新", releaseNotice: "测试" },
  id: "run-v2-1",
  now: "2026-06-04T00:00:00.000Z"
});

assert.equal(run.schemaVersion, 2);
assert.equal(run.id, "run-v2-1");
assert.equal(run.status, "draft");
assert.equal(run.phase, "待启动");
assert.equal(run.context.target.appCode, "mem");
assert.equal(run.context.inputs.releaseReason, "功能更新");
assert.equal(run.memento.cursor.commandId, "probe-platforms");
assert.deepEqual(run.commands.map((command) => command.id), contract.commands.map((command) => command.id));
assert.equal("outcomes" in run, false, "PipelineRun v2 records must not carry old outcomes");
assert.equal("resumeStage" in run, false, "PipelineRun v2 records must not carry old resumeStage");

const context = createPipelineRunContext(run.context);
const command = createPipelineCommand({
  id: "trigger-build",
  title: "触发构建",
  display: {
    start: { phase: "构建", detail: "准备触发构建" },
    run: { phase: "构建", detail: "正在触发构建" },
    done: { phase: "等待构建完成", detail: "构建已触发" },
    block: { phase: "等待构建完成", detail: "构建暂不可用" },
    fail: { phase: "构建失败", detail: "构建触发失败" }
  },
  execute: async (ctx) => {
    ctx.set("buildSnapshot", { taskId: "task-1" });
    return { ok: true, detail: "build triggered" };
  }
});
const events = [];
const result = await command.run(context, {
  hook: (event) => events.push(event),
  now: () => "2026-06-04T00:00:01.000Z"
});

assert.equal(result.ok, true);
assert.deepEqual(events.map((event) => event.type), ["start", "run", "done"]);
assert.deepEqual(events.map((event) => event.phase), ["构建", "构建", "等待构建完成"]);
assert.deepEqual(context.get("buildSnapshot"), { taskId: "task-1" });

let memento = createPipelineRunMemento(contract.commands);
for (const event of events) {
  memento = applyCommandEventToMemento(memento, event);
}
assert.equal(memento.commands["trigger-build"].status, "done");
assert.equal(memento.commands["trigger-build"].phase, "等待构建完成");

const blocked = await createPipelineCommand({
  id: "wait-release-record",
  title: "等待发布记录",
  display: {
    start: { phase: "等待发布记录", detail: "开始观察发布平台" },
    run: { phase: "等待发布记录", detail: "正在观察发布平台" },
    done: { phase: "发布", detail: "发布记录已出现" },
    block: { phase: "等待发布记录", detail: "发布记录暂未出现" },
    fail: { phase: "发布失败", detail: "发布记录读取失败" }
  },
  execute: async () => ({ ok: false, blocked: true, detail: "release record timeout" })
}).run(context, {
  hook: (event) => {
    memento = applyCommandEventToMemento(memento, event);
  },
  now: () => "2026-06-04T00:00:02.000Z"
});

assert.equal(blocked.ok, false);
assert.equal(blocked.blocked, true);
assert.equal(memento.commands["wait-release-record"].status, "blocked");
assert.deepEqual(
  resumePointFromMemento(memento),
  {
    commandId: "wait-release-record",
    status: "blocked",
    phase: "等待发布记录",
    detail: "release record timeout"
  },
  "blocked command snapshot is the only resume cursor"
);

const failedEvents = [];
const failed = await createPipelineCommand({
  id: "publish-spot",
  title: "现场发布",
  display: {
    start: { phase: "现场发布", detail: "准备现场发布" },
    run: { phase: "现场发布", detail: "正在现场发布" },
    done: { phase: "完成", detail: "现场发布完成" },
    block: { phase: "现场发布", detail: "现场发布暂停" },
    fail: { phase: "发布失败", detail: "现场发布失败" }
  },
  execute: async () => {
    throw new Error("publish failed");
  }
}).run(context, { hook: (event) => failedEvents.push(event) });

assert.equal(failed.ok, false);
assert.equal(failedEvents.at(-1).type, "fail");
assert.equal(failedEvents.at(-1).phase, "发布失败");
assert.equal(failedEvents.at(-1).detail, "publish failed");

console.log("pipeline run v2 contract checks passed");
