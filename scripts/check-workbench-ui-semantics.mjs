import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../src/client/src/App.jsx", import.meta.url), "utf8");
const server = readFileSync(new URL("../src/server.js", import.meta.url), "utf8");

assert.doesNotMatch(
  app,
  /releaseSignal,\s*attempt,/,
  "release observation must not reference an out-of-scope attempt variable"
);
assert.match(
  app,
  /releaseSignal,\s*attempt:\s*releaseAttempt,/,
  "release observation decisions must use the releaseAttempt counter"
);
assert.doesNotMatch(
  app,
  /if \(!latestApp\)\s*\{[\s\S]*?no release task for current app[\s\S]*?ok:\s*true/,
  "missing target release app must keep observing/blocking because platform failures can render as zero pending"
);
assert.match(
  app,
  /releaseSignal\s*=\s*releaseRecordSignal\(latestApp,\s*\{\s*environmentFound/,
  "release observation must always route the picked app through releaseRecordSignal"
);

assert.doesNotMatch(app, />draft</, "user-facing Run panels must not expose raw draft wording");
assert.doesNotMatch(app, /刷新发布平台/, "release platform refresh button should be labelled 刷新");
assert.doesNotMatch(app, /onClick=\{\(\) => onCopy\(record\)\}\s+disabled=\{running\}/, "copy is a local config clone and must not be disabled by a running pipeline");
assert.doesNotMatch(app, /function ServicePagination\([^)]*running/, "pagination is read/navigation state and must not depend on pipeline running state");
assert.doesNotMatch(app, /disabled=\{running \|\| !pageInfo\.hasPrev\}/, "previous page button must not be disabled by pipeline running state");
assert.doesNotMatch(app, /disabled=\{running \|\| !pageInfo\.hasNext\}/, "next page button must not be disabled by pipeline running state");
assert.match(app, /function PipelineRunTable\([^)]*\)[\s\S]*paginateRows\(runs,\s*runPage,\s*runPageSize\)/, "Pipeline Run table must page the local run history instead of rendering all rows");
assert.match(app, /pageData\.rows\.map\(\(record\)/, "Pipeline Run table must render only the current page rows");
assert.match(app, /第 \{pageData\.page\} \/ \{pageData\.totalPages\} 页 · 显示 \{pageData\.start\}-\{pageData\.end\} \/ 共 \{pageData\.total\} 条 Run/, "Pipeline Run table must show front-end pagination summary");
assert.match(app, /RUN_PAGE_SIZE_OPTIONS\.map/, "Pipeline Run table must expose selectable page sizes");
assert.match(app, /服务端持久保存最近 \{historyLimit\} 条 Run/, "Pipeline Run table must explain server-side persisted bounded history");
assert.match(app, /apiFetch\("\/api\/pipeline-runs", \{ runs: runHistory \}\)/, "Pipeline Run history must persist through the server API instead of only localStorage");
assert.match(app, /apiDelete\("\/api\/pipeline-runs"\)/, "Pipeline Run history must expose a batch-clear server API action");
assert.match(app, /mergePipelineRunHistories\(data\.pipelineRunHistory \|\| \[\], localHistory\)/, "startup must hydrate server history and migrate same-origin local fallback records");
assert.doesNotMatch(app, /useState\(\(\) =>\s*[\s\S]{0,120}restorePipelineRunHistory\(window\.localStorage\)/, "Pipeline Run history must not initialize exclusively from port-scoped localStorage");
assert.match(server, /WORKBENCH_RUN_HISTORY_PATH/, "server must persist Pipeline Run history outside browser origin storage");
assert.match(server, /pipelineRunHistory:\s*readPipelineRunHistory\(\)/, "bootstrap must hydrate persisted Pipeline Run history");
assert.match(server, /pathname === "\/api\/pipeline-runs"/, "server must expose Pipeline Run history API endpoints");
assert.match(server, /pathname === "\/api\/probe\/build-log"/, "server must expose a read-only build log probe for failed build diagnosis");
assert.match(server, /probeBuildServiceDetail\(credentials,[\s\S]{0,260}imageVersion:\s*body\.imageVersion/, "build-service probe must forward imageVersion so failed-version history is diagnosable");
assert.doesNotMatch(app, /<Field label="账号">\s*<Select value=\{activeAccountId\}/, "main Pipeline console should not show a separate account selector");
assert.doesNotMatch(app, /label="医院\/账号"/, "main Pipeline environment band should not display account text");
assert.doesNotMatch(app, /releaseSummary=\{releaseSummary\}/, "workflow band should not receive the detailed release pending summary badge");
assert.match(app, /构建平台\{buildProbe\?\.ok \? "已探测" : "待探测"\}/, "workflow band must expose build platform probe state");
assert.match(app, /发布平台/, "workflow band must expose release platform probe state");
assert.match(app, /items-center justify-center/, "Run status column should center status badge and text");
assert.match(
  app,
  /auto-fit,\s*minmax\(min\(100%,\s*240px\),\s*1fr\)/,
  "selector controls should use responsive auto-fit columns instead of fixed minimum columns that overflow beside the activity panel"
);
assert.match(app, /serverPageInfo/, "Workbench service inventory must render platform-returned page metadata instead of local fake pagination");
assert.match(app, /servicePageNumber:\s*overrides\.servicePageNumber\s*\?\?\s*servicePage/, "service discovery payload must pass pageNumber through to the platform API");
assert.match(app, /servicePageSize:\s*overrides\.servicePageSize\s*\?\?\s*servicePageSize/, "service discovery payload must pass pageSize through to the platform API");
assert.doesNotMatch(app, /serviceListPageInfo/, "Workbench service search must not filter only the current local rows");
assert.doesNotMatch(app, /platformApplications/, "application selector must not expose the build platform's global application dictionary");
assert.match(app, /buildCustomerApplications\s*=\s*buildProbe\?\.customerApplications\?\.rows/, "application selector should consume the original build-page customer app list");
assert.match(app, /\[\.\.\.buildCustomerApplications,\s*\.\.\.releaseApplications,\s*\.\.\.discoveredApplications,\s*\.\.\.profileApplications\]/, "application selector should be customer-scoped: build customer apps, release apps, verified build discovery, then profile fallback");
assert.match(app, /构建状态预读跳过/, "build-status pre-read failures should not kill multi-service pipelines before the real build task flow");
assert.match(app, /ServiceSnapshotList/, "expanded Run details should list the complete service group");
assert.match(app, /WorkflowSwitcher/, "top workflow entry should be a dedicated dynamic profile/account switcher");
assert.match(app, /setActiveTab\("workbench"\)[\s\S]{0,220}setProfileContext/, "clicking any top workflow must activate the Pipeline tab before switching context");
assert.match(app, /workflowItems/, "top workflow entries must be derived from configured profile accounts instead of hard-coded hospital buttons");
assert.match(app, /\/api\/config\/workflows/, "settings UI must call the workflow-account creation endpoint");
assert.match(app, /新增 workflow/, "settings UI must expose a visible add-workflow entry");
assert.match(app, /客户探测失败/, "settings UI must show customer discovery failures");
assert.match(app, /新增 workflow 失败/, "settings UI must show workflow creation failures");
assert.match(app, /删除 workflow 失败/, "settings UI must show workflow deletion failures");
assert.match(app, /workflow 已删除/, "settings UI must show workflow deletion success");
assert.match(app, /确认删除 workflow/, "settings UI must use an in-page delete confirmation state");
assert.match(app, /确认删除/, "settings UI must expose the second delete confirmation action");
assert.doesNotMatch(app, /window\.confirm/, "workflow deletion should not depend on a native browser confirm dialog");
assert.match(app, /fetch\("\/api\/config\/workflows"[\s\S]{0,180}method:\s*"DELETE"/, "settings UI must delete workflow profiles through the config API");
assert.doesNotMatch(app, /客户 \{workflowCustomers\.length\}/, "workflow discovery should not show meaningless customer-count badges");
assert.doesNotMatch(app, /应用 按客户初始化读取/, "workflow discovery should not show meaningless app-initialization badges");
assert.match(app, /bg-cyan-50\/40 px-3 py-4/, "expanded Pipeline Run details should have balanced top and bottom padding");
assert.match(app, /data-testid="pipeline-run-detail"/, "expanded Pipeline Run details should expose a stable verification hook");
assert.match(app, /data-testid="run-activity-panel"/, "Run activity panel should expose a stable verification hook");
assert.match(app, /items-stretch gap-4/, "expanded Run detail columns should stretch to the same row height");
assert.match(app, /<ActivityLog items=\{record\.activity \|\| \[\]\} stretch \/>/, "Run activity log should fill the available detail-panel height");
assert.match(app, /min-h-\[360px\] flex-1/, "Run activity log should keep a minimum height and use remaining vertical space");
assert.doesNotMatch(app, /onPause|pauseRequested|暂停请求|暂停中/, "Run table should not introduce a pause/continue toggle state machine");
assert.match(app, /record\.status === "running"/, "running Run rows must explicitly disable the continue action");
assert.match(app, /disabled=\{running \|\| record\.status === "running" \|\| !resumable\}/, "continue is disabled while any pipeline is running or the row itself is running");
assert.match(app, /shouldObserveAfterBuildTriggerFailure\(result\)/, "uncertain build trigger failures must enter build observation instead of failing immediately");
assert.match(app, /构建触发待确认/, "the UI should explain that an uncertain trigger is being observed");
assert.doesNotMatch(app, /构建触发失败[\s\S]{0,120}updateOutcome\("build", "failed"[\s\S]{0,120}shouldObserveAfterBuildTriggerFailure/, "build trigger must check uncertain/already-running results before marking build failed");
assert.match(app, /updateOutcome\("build-observe",\s*"failed",\s*message\)/, "when observation detects build failure, build-observe must not remain running");
assert.match(app, /shouldRestartBuildTaskAfterBuildTriggerFailure\(result\)/, "stale build snapshots must be detected before marking build failed");
assert.match(app, /staleBuildSnapshot/, "resume logic must carry stale build snapshot state back to task selection");
assert.match(app, /excludeTaskIds/, "restarted task selection must not immediately reuse the stale build task");
assert.match(app, /releaseNoWait:\s*true/, "resumed release observation should not wait a long period after a trusted empty release state");
assert.match(app, /releaseNoopAfterMs/, "new pipeline release observation should have a short empty-release confirmation window");
assert.match(app, /const PIPELINE_RELEASE_OBSERVER_TIMEOUT_MS = 2 \* 60 \* 1000;/, "release record transition should use a short observer budget, not the long build budget");
assert.doesNotMatch(app, /PIPELINE_RELEASE_OBSERVER_TIMEOUT_MS = 20 \* 60 \* 1000/, "release record transition must not wait twenty minutes after the build-platform handoff");
assert.match(app, /releaseRecordSignal\(latestApp,\s*\{\s*environmentFound/, "release observation must distinguish a trusted empty environment from an untrusted missing app");
assert.doesNotMatch(app, /Promise\.all\(releaseStages\.map\(\(stage\) => publishFor\(stage, app, detail\.result\)\)\)/, "master company and spot release-platform stages must not race on one stale detail payload");
assert.match(app, /for \(const stage of releaseStages\)/, "release-platform stages should run in policy order and refresh detail between stages");

console.log("workbench UI semantics checks passed");
