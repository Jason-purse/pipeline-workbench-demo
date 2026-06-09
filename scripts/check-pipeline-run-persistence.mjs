import assert from "node:assert/strict";
import { request } from "node:http";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), "workbench-run-history-"));

process.env.WORKBENCH_CACHE_DIR = tmp;
process.env.WORKBENCH_RUN_HISTORY_PATH = join(tmp, "pipeline-run-history.json");
process.env.WORKBENCH_SECRETS_PATH = join(tmp, "secrets.json");

const { startServer } = require("../src/server.js");

const commands = [
  { id: "probe-platforms", title: "平台预检", phase: "构建预检", stage: "prepare" },
  { id: "complete-run", title: "完成 Pipeline", phase: "完成", stage: "complete" }
];

function endpoint(baseUrl, pathname) {
  return new URL(pathname, baseUrl).toString();
}

function requestJson(baseUrl, pathname, options = {}) {
  const url = new URL(pathname, baseUrl);
  const body = options.body == null ? "" : JSON.stringify(options.body);
  return new Promise((resolve, reject) => {
    const req = request({
      hostname: url.hostname,
      port: url.port,
      path: `${url.pathname}${url.search}`,
      method: options.method || "GET",
      headers: body
        ? {
            "content-type": "application/json",
            "content-length": Buffer.byteLength(body)
          }
        : undefined
    }, (res) => {
      let content = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        content += chunk;
      });
      res.on("end", () => {
        try {
          resolve(JSON.parse(content || "{}"));
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function makeRun(index) {
  const suffix = String(index).padStart(2, "0");
  const createdAt = new Date(Date.UTC(2026, 5, 2, 0, 0, index)).toISOString();
  const updatedAt = new Date(Date.UTC(2026, 5, 2, 0, 1, index)).toISOString();
  return {
    schemaVersion: 2,
    id: `run-${suffix}`,
    createdAt,
    updatedAt,
    templateId: "build-and-release",
    status: "done",
    phase: "完成",
    target: {
      profileId: "demo",
      accountId: "demo",
      appCode: "mem",
      branch: "mastertest",
      releaseEnvId: "uat-a"
    },
    serviceSnapshot: [{ imageJenkinsName: `service-${suffix}` }],
    context: {
      target: { appCode: "mem", branch: "mastertest" },
      inputs: { releaseReason: "功能更新", releaseNotice: "测试" },
      data: {}
    },
    commands,
    memento: {
      cursor: { commandId: "", index: commands.length, status: "done", phase: "完成", detail: "done" },
      order: commands.map((command) => command.id),
      commands: Object.fromEntries(commands.map((command) => [
        command.id,
        { status: "done", phase: command.phase, title: command.title, detail: "done", updatedAt }
      ]))
    },
    activity: [{ at: updatedAt, title: "done", detail: "done" }]
  };
}

let server = await startServer({ host: "127.0.0.1", port: 0 });

try {
  const runs = Array.from({ length: 90 }, (_, index) => makeRun(index));
  const saved = await requestJson(server.url, "/api/pipeline-runs", {
    method: "POST",
    body: { runs }
  });
  assert.equal(saved.ok, true);
  assert.equal(saved.limit, 80);
  assert.equal(saved.runs.length, 80, "server should keep a bounded recent-run queue");
  assert.equal(saved.runs[0].id, "run-89", "newest run should be first");
  assert.equal(saved.runs.at(-1).id, "run-10", "oldest overflow runs should be evicted");

  const persisted = JSON.parse(readFileSync(process.env.WORKBENCH_RUN_HISTORY_PATH, "utf8"));
  assert.equal(persisted.runs.length, 80, "run history should be written to the configured server-side file");
  assert.equal(persisted.runs.some((run) => "outcomes" in run || "resumeStage" in run), false, "persisted run history must not keep v1 outcomes/resumeStage");

  const bootstrap = await requestJson(server.url, "/api/bootstrap");
  assert.equal(bootstrap.pipelineRunHistoryLimit, 80);
  assert.equal(bootstrap.pipelineRunHistory.length, 80, "bootstrap should hydrate persisted run history");
  assert.equal(bootstrap.pipelineRunHistory.some((run) => "outcomes" in run || "resumeStage" in run), false, "bootstrap must hydrate v2-shaped run records only");

  await new Promise((resolve) => server.server.close(resolve));
  server = await startServer({ host: "127.0.0.1", port: 0 });
  const restartedBootstrap = await requestJson(server.url, "/api/bootstrap");
  assert.equal(restartedBootstrap.pipelineRunHistory.length, 80, "history should survive a server restart with a new local port");
  assert.equal(restartedBootstrap.pipelineRunHistory[0].id, "run-89");

  const legacySaved = await requestJson(server.url, "/api/pipeline-runs", {
    method: "POST",
    body: {
      run: {
        id: "legacy-v1-run",
        createdAt: "2026-06-02T02:00:00.000Z",
        updatedAt: "2026-06-02T02:01:00.000Z",
        status: "blocked",
        phase: "等待发布记录",
        target: { appCode: "mem", branch: "mastertest" },
        outcomes: { "release-observe": { status: "blocked", detail: "old resume point" } },
        resumeStage: "release"
      }
    }
  });
  const legacyRecord = legacySaved.runs.find((run) => run.id === "legacy-v1-run");
  assert.equal(legacyRecord?.schemaVersion, 2);
  assert.equal(legacyRecord?.status, "cancelled", "server must not re-save v1 outcomes/resumeStage records as resumable v2 records");
  assert.equal(legacyRecord?.phase, "历史 Run 格式不兼容");
  assert.equal("outcomes" in legacyRecord, false);
  assert.equal("resumeStage" in legacyRecord, false);

  const deletedOne = await requestJson(server.url, "/api/pipeline-runs", {
    method: "DELETE",
    body: { ids: ["run-89"] }
  });
  assert.equal(deletedOne.ok, true);
  assert.equal(deletedOne.runs.some((run) => run.id === "run-89"), false, "DELETE should support batch removal by id");

  const cleared = await requestJson(server.url, "/api/pipeline-runs", {
    method: "DELETE",
    body: {}
  });
  assert.equal(cleared.ok, true);
  assert.equal(cleared.runs.length, 0, "DELETE without ids should clear the persisted history");

  console.log("pipeline run persistence checks passed");
} finally {
  await new Promise((resolve) => server.server.close(resolve));
  rmSync(tmp, { recursive: true, force: true });
}
