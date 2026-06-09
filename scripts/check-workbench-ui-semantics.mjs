import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../src/client/src/App.jsx", import.meta.url), "utf8");
const server = readFileSync(new URL("../src/server.js", import.meta.url), "utf8");
const platformClient = readFileSync(new URL("../src/lib/platform-client.js", import.meta.url), "utf8");
const runStore = readFileSync(new URL("../src/client/src/lib/pipeline-run-store.mjs", import.meta.url), "utf8");

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
assert.doesNotMatch(app, /grid grid-cols-\[120px_minmax\(160px,1fr\)_minmax\(180px,1\.3fr\)_108px_minmax\(116px,auto\)\]/, "Pipeline Run table must not use fixed desktop columns on mobile because that clips row action buttons");
assert.match(app, /hidden md:grid md:grid-cols-\[120px_minmax\(160px,1fr\)_minmax\(180px,1\.3fr\)_108px_minmax\(116px,auto\)\]/, "Pipeline Run table header should only use fixed desktop columns from md and up");
assert.match(app, /grid gap-3 px-3 py-3 text-sm md:grid-cols-\[120px_minmax\(160px,1fr\)_minmax\(180px,1\.3fr\)_108px_minmax\(116px,auto\)\]/, "Pipeline Run rows should stack on mobile and switch to the desktop grid from md and up");
assert.match(app, /grid grid-cols-3 gap-2 sm:flex sm:flex-wrap sm:justify-start md:justify-end/, "Pipeline Run row action buttons must stay visible as a three-button mobile action row");
assert.match(app, /apiFetch\("\/api\/pipeline-runs", \{ runs: runHistory \}\)/, "Pipeline Run history must persist through the server API instead of only localStorage");
assert.match(app, /apiDelete\("\/api\/pipeline-runs"\)/, "Pipeline Run history must expose a batch-clear server API action");
assert.match(app, /mergePipelineRunHistories\(data\.pipelineRunHistory \|\| \[\], localHistory\)/, "startup must hydrate server history and migrate same-origin local fallback records");
assert.doesNotMatch(app, /useState\(\(\) =>\s*[\s\S]{0,120}restorePipelineRunHistory\(window\.localStorage\)/, "Pipeline Run history must not initialize exclusively from port-scoped localStorage");
assert.match(server, /WORKBENCH_RUN_HISTORY_PATH/, "server must persist Pipeline Run history outside browser origin storage");
assert.match(server, /pipelineRunHistory:\s*readPipelineRunHistory\(\)/, "bootstrap must hydrate persisted Pipeline Run history");
assert.match(server, /pathname === "\/api\/pipeline-runs"/, "server must expose Pipeline Run history API endpoints");
assert.match(server, /pathname === "\/api\/probe\/build-log"/, "server must expose a read-only build log probe for failed build diagnosis");
assert.match(server, /probeBuildServiceDetail\(credentials,[\s\S]{0,260}imageVersion:\s*body\.imageVersion/, "build-service probe must forward imageVersion so failed-version history is diagnosable");
assert.match(server, /candidateBuildIds:\s*body\.candidateBuildIds/, "build-service probe must forward candidate Jenkins build IDs so live running stage rows can bypass stale versions");
assert.match(platformClient, /structureDetail\s*=\s*structureDetailOf\(history\)/, "build-service probe must parse getStructureDetailList object.msg.pineLines instead of dropping the stage table");
assert.match(platformClient, /structureDetail,\s*\n\s*history:\s*structureDetail\.pineLines/, "build-service probe must expose structureDetail and keep history compatible with platform pineLines");
assert.match(platformClient, /structureDetailHasCandidate\(structureDetail,\s*candidateBuildIds\)/, "build-service probe must detect when a version-scoped stage table missed this Run's candidate build IDs");
assert.match(platformClient, /createWrapper\(\{\s*\n\s*customerNameEn:\s*options\.customerNameEn,[\s\S]{0,280}imageJenkinsName:\s*options\.imageJenkinsName\s*\}\)/, "build-service probe must retry structure-detail without stale imageVersion when candidate build IDs are missing");
assert.match(platformClient, /getStructureDetailList[\s\S]{0,260}imageVersion:\s*expectedVersion/, "build-log probe must resolve the real Jenkins build id from the target-version structure records");
assert.match(platformClient, /addCandidate\(matchedRecord[\s\S]{0,140}\{\s*prefer:\s*true\s*\}/, "build-log probe must try the target-version build id before speculative candidates");
assert.doesNotMatch(app, /<Field label="账号">\s*<Select value=\{activeAccountId\}/, "main Pipeline console should not show a separate account selector");
assert.doesNotMatch(app, /label="医院\/账号"/, "main Pipeline environment band should not display account text");
assert.doesNotMatch(app, /releaseSummary=\{releaseSummary\}/, "workflow band should not receive the detailed release pending summary badge");
assert.match(app, /构建平台\{buildProbe\?\.ok \? "已探测" : "待探测"\}/, "workflow band must expose build platform probe state");
assert.match(app, /发布平台/, "workflow band must expose release platform probe state");
assert.match(app, /items-center justify-center/, "Run status column should center status badge and text");
assert.match(app, /const terminalSuccess = run\.status === "done"/, "completed Run summaries must detect terminal success before choosing an attention event");
assert.match(app, /const important = terminalSuccess \? events\[0\] : events\.find/, "completed Run summaries must show the latest event instead of old fixable errors");
assert.match(app, /const attentionCommand = terminalSuccess \? null : Object\.values/, "completed Run summaries must not surface stale failed or running command state");
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
assert.doesNotMatch(app, /function ServiceBuildStatusPanel/, "expanded Run details must not use a service-card build status panel as the main detail view");
assert.match(app, /const BUILD_DETAIL_STAGES/, "expanded Run details should model the original build page as stages");
assert.match(app, /function buildRunStageRows\(record = \{\}/, "build detail stage rows must be derived from persisted Run state");
assert.match(app, /function BuildStageDetailPanel\(\{ record \}\)/, "expanded Run details should present a stage-centric build detail panel");
assert.match(app, /data-testid="build-stage-detail-panel"/, "build stage detail panel should expose a stable verification hook");
assert.match(app, /data-testid="run-detail-main-column"/, "Pipeline Run detail layout must expose the left detail column used to size the activity log column");
assert.match(app, /xl:grid-cols-\[minmax\(0,1fr\)_minmax\(320px,\.9fr\)\] xl:items-stretch/, "Pipeline Run detail should stretch the right activity column to the left detail column height on desktop");
assert.match(app, /flex min-h-0 min-w-0 flex-col overflow-hidden xl:self-stretch" data-testid="run-activity-panel"/, "Run activity log panel must hide overflow and let its inner log area scroll instead of growing with messages");
assert.match(app, /stretch \? "h-\[360px\] min-h-0 flex-none xl:h-0 xl:min-h-\[360px\] xl:flex-1" : "h-\[360px\]"/, "Run activity log should be fixed-height on stacked layouts and fill the stretched detail column on desktop");
assert.match(app, /break-words text-sm text-muted-foreground \[overflow-wrap:anywhere\]/, "Run activity log messages must wrap long service/version text without widening the panel");
assert.doesNotMatch(app, /原始构建详情/, "build stage detail panel should not show a second generic original-build summary above per-service rows");
assert.doesNotMatch(app, /loadOriginalBuildLog/, "build stage detail panel should not expose a top-level original-log button once per-service log buttons exist");
assert.match(app, /data-testid="service-build-stage-list"/, "each service must own its own build-stage list");
assert.match(app, /data-testid="service-build-stage-row"/, "per-service build stage rows should expose stable verification hooks");
assert.match(app, /function serviceStageRowsForDisplay\(item = \{\}, logState = \{\}\)/, "build stages must be selected per service, not from one global stage row set");
assert.match(app, /function mergeBuildStageRowsWithPending\(rows = \[\], skeleton = BUILD_DETAIL_STAGES\)/, "per-service stage rows must render the full stage skeleton even when the platform has only returned early stages");
assert.match(app, /function stageSkeletonFromStructureDetail\(structureDetail = null\)/, "per-service stage skeleton should be derived from platform stage definitions when available");
assert.match(app, /const avgRows = Array\.isArray\(structureDetail\?\.avg\) \? structureDetail\.avg : \[\]/, "platform avg rows may define stage names but must not be rendered as concrete progress");
assert.match(app, /buildStageDefinitionForLabel\("Npm Build", index\)/, "front-end services must be able to replace Maven Build with Npm Build when platform evidence uses npm stages");
assert.match(app, /function compactStructureDetail\(structureDetail = null\)/, "Run service snapshots must preserve compact platform stage definitions from pre-read details");
assert.match(app, /const structureDetail = compactStructureDetail\(service\.structureDetail \|\| service\.detail\?\.structureDetail\)/, "compact service snapshots must carry pre-read platform stage definitions");
assert.match(app, /\.\.\.\(structureDetail \? \{ structureDetail \} : \{\}\)/, "compact service snapshots should include structureDetail only when platform definitions exist");
assert.match(app, /const structureDetail = signal\?\.structureDetail \|\| service\.structureDetail \|\| service\.detail\?\.structureDetail \|\| null/, "initial build detail rows must fall back to service snapshot stage definitions and terminal locked rows must still keep live structure evidence");
assert.doesNotMatch(app, /function compactStructureDetail[\s\S]{0,520}pineLines/, "snapshot stage definitions must not persist historical pineLines as current Run progress");
assert.match(app, /let initialServices = services;[\s\S]{0,520}updateOnSuccess:\s*false[\s\S]{0,260}initialServices = status\.services/, "new Pipeline Runs should silently preload stage definitions before creating the first service snapshot");
assert.match(app, /const serviceSnapshot = initialServices\.map\(compactService\)/, "the first Pipeline Run snapshot must use preloaded services when stage definitions are available");
assert.match(app, /let workingServices = initialServices;/, "the main Pipeline flow should continue from the same preloaded service details used by the initial snapshot");
assert.match(app, /const status = initialBuildStatus \|\| await readBuildStatusFor\(workingServices/, "build preflight should reuse the initial silent stage-definition read when it already succeeded");
assert.match(app, /skeleton\.map\(\(stage\) => \{[\s\S]{0,420}rowByLabel\.get\(normalizeBuildStageLabel\(stage\.label\)\)/, "known build stages must stay visible and be overlaid with platform/log status");
assert.match(app, /mergeBuildStageRowsWithPending\(item\.structureStageRows,\s*stageSkeletonForRows\(item\.structureStageRows,\s*item\.structureDetail\)\)/, "platform stage rows must be merged into a full pending-to-done skeleton instead of replacing it");
assert.doesNotMatch(app, /structure-average/, "platform avg rows must not be rendered as this Run's concrete stage progress");
assert.doesNotMatch(app, /历史平均耗时/, "build stage UI must not push historical averages as pending current-run stages");
assert.match(app, /data-testid="service-build-progress-list"/, "expanded build details must show service-level build progress while a Run is active");
assert.match(app, /data-testid="service-build-progress-row"/, "each service in the build detail panel needs a stable progress row");
assert.match(app, /function serviceBuildStageText/, "service progress rows must combine observation state with original log stage status");
assert.match(app, /parseBuildStructureStages/, "running build details must consume the platform structure-detail stage table before Jenkins raw logs are ready");
assert.match(app, /structureDetail:\s*result\.structureDetail \|\| null/, "live service build-status signals must carry platform structure-detail rows");
assert.match(app, /buildStageRowsFromStructureDetail\(item\.structureDetail,\s*item\)/, "service rows must derive stage rows from per-service structure-detail data");
assert.match(app, /平台阶段表显示/, "service progress text must identify platform stage-table evidence");
assert.match(app, /function buildServiceStatusRequestForService\(record = \{\}, service = \{\}, item = \{\}\)/, "expanded build details must be able to build per-service live build-status probe requests");
assert.match(app, /imageVersion:\s*service\.generatedVersion \|\| service\.imageVersion \|\| ""/, "live build-status probes must pass the Run target version so running structure stages are fetched before final success");
assert.match(app, /candidateBuildIds\.length \? \{ candidateBuildIds \} : \{\}/, "live build-status probes must pass candidate Jenkins build IDs for develop builds whose new version is only visible after completion");
assert.match(app, /candidateBuildIds:\s*items\[index\]\?\.candidateBuildIds \|\| \[\]/, "live build-status probe keys must include candidate build IDs so polling refreshes when observation discovers Jenkins candidates");
assert.match(app, /const targetVersion = service\.generatedVersion \|\| service\.imageVersion \|\| effectiveSignal\?\.version \|\| "-"/, "running build detail cards must display the Run target version instead of the previous successful platform version");
assert.match(app, /function structureStagesMatchBuildHint\(stages = \[\], item = \{\}\)/, "candidate build IDs must allow matched all-done structure tables to remain visible before observation marks success");
assert.match(app, /parsedStages\.every\(\(stage\) => stage\.status === "done"\) && !matchedBuildHint/, "stale all-done structure tables should be suppressed only when they do not match this Run's build hints");
assert.match(app, /apiFetchWithRetry\("\/api\/probe\/build-service"/, "expanded build details must refresh each service from the platform instead of trusting only stored Run snapshots");
assert.match(app, /source:\s*"平台实时读取"/, "live service build-status rows must identify platform live reads as their source");
assert.match(app, /suppressLiveRunning/, "failed or blocked Run state must not be overwritten by a non-terminal live running signal");
assert.match(app, /suppressTerminalDowngrade/, "completed build stages must not be downgraded by later live running signals");
assert.match(app, /serviceFallback\.status === "done" && signalStatus && signalStatus !== "done"/, "completed Runs must keep done service status when live reads report waiting_for_target_version");
assert.match(app, /lockRunSource/, "failed or blocked Run rows must keep Run-stage source text instead of transient live-read loading text");
assert.match(app, /function serviceFallbackFromRunStage/, "batch build failures must be translated into service-level failed vs not-triggered rows");
assert.match(app, /批量构建在 .* 失败后停止/, "service rows must explain services blocked by another service's batch-trigger failure");
assert.match(app, /buildLogRequestForServiceItem\(record,\s*item\)/, "service build progress rows must own their build-log request instead of sharing one global request");
assert.doesNotMatch(app, /function ServiceBuildProgressList\(\{ items = \[\], logRequest = null/, "service build progress rows must not receive one global build-log request");
assert.match(app, /pickBuildStructureRecord/, "service build log requests must be able to resolve the real Jenkins build id from platform structure-detail records");
assert.match(app, /function structureBuildIdForLog\(item = \{\}\)/, "build logs must prefer the structure-detail build record that matches the target version");
assert.match(app, /const buildId = item\?\.buildId \|\| structureBuildId/, "explicit and structure-derived build ids must be tried before speculative candidate build ids");
assert.match(app, /if \(\(!buildId && !candidateBuildIds\.length && !expectedVersion\)/, "completed service rows with a target version must keep the log action enabled so the backend can resolve the real build id");
assert.match(app, /async function resolveBuildLogRequestForKey\(key\)/, "clicking a log on an existing Run must refresh service structure-detail before falling back to candidate build ids");
assert.match(app, /apiFetchWithRetry\("\/api\/probe\/build-service", statusRequest/, "service log reads must refresh platform stage records when the current Run snapshot lacks pineLines");
assert.match(app, /const request = await resolveBuildLogRequestForKey\(key\)/, "raw log reads must use the refreshed per-service build log request");
assert.match(app, /buildLogDisplayText\(logState\.result\)/, "each service progress row must render its own raw build log state");
assert.match(app, /data-testid="service-build-log-loading"/, "raw build log loading state must render inside the owning service row");
assert.match(app, /data-testid="service-build-log"/, "raw build logs must render inside the owning service row");
assert.match(app, /className="min-w-0 space-y-3" data-testid="service-build-progress-list"/, "service build progress list must allow children to shrink instead of widening the Run detail panel");
assert.match(app, /min-w-0 space-y-3 overflow-hidden rounded-lg[\s\S]{0,120}data-testid="service-build-progress-row"/, "each service build row must contain long Jenkins log lines without widening sibling layout");
assert.match(app, /max-h-\[60vh\] min-h-\[220px\] max-w-full min-w-0 overflow-auto whitespace-pre-wrap break-words[\s\S]{0,120}\[overflow-wrap:anywhere\][\s\S]{0,120}data-testid="service-build-log"/, "raw Jenkins log pre must wrap or scroll long lines without stretching the service card");
assert.match(app, /data-testid="service-build-log-error"/, "per-service build log errors must stay inside the owning service row");
assert.match(app, /\{logState\.loading \? "读取中" : "日志"\}/, "only the clicked service log button should show the log loading action text");
assert.doesNotMatch(app, /if \(logState\.loading\) return "正在读取 Jenkins 原始日志"/, "raw-log loading must not replace the service build-stage summary");
assert.doesNotMatch(app, /平台实时读取中/, "background platform polling must not show as a user-visible service loading state");
assert.doesNotMatch(app, /serviceLogsDisplayText/, "service raw logs must not be merged into one global shared log panel");
assert.doesNotMatch(app, /const logDisplayText =/, "build detail panel must not keep a shared raw-log display state");
assert.doesNotMatch(app, /readServiceBuildLogs\(keys,\s*\{\s*silent:\s*false/, "expanded build details must not auto-read Jenkins raw logs; logs should be explicit per-service evidence");
assert.match(app, /Jenkins 原始日志暂未生成或平台尚未开放读取/, "running build details should show a waiting-for-log state instead of looking empty");
assert.match(app, /apiFetch\("\/api\/probe\/build-log"/, "expanded Run details should provide an explicit original build-log read path");
assert.match(app, /parseBuildLogStages/, "expanded Run details must parse actual Jenkins stages from the original build log");
assert.doesNotMatch(app, /index === 0 \? "running"/, "running build details must not assume Extract is the current stage");
assert.match(app, /candidateBuildIds/, "running build details must poll candidate Jenkins build IDs before final success writes a real buildId");
assert.match(app, /expectedVersion/, "candidate build-log reads must validate the target image version before rendering stages");
assert.match(app, /function isBuildLogNotReadyResult/, "build-log not-ready responses must be classified instead of surfaced as hard failures");
assert.match(app, /isBuildLogNotReadyResult\(result\)[\s\S]{0,260}setServiceLogStates/, "build-log not-ready responses should leave the service stage row waiting without showing a 404-style error");
assert.doesNotMatch(app, /slice\(-16\)/, "the original build log panel must not truncate to the last 16 lines");
assert.doesNotMatch(app, /2600/, "the original build log panel must not cap the displayed log to a small character preview");
assert.match(app, /aria-live="polite"/, "build stage updates should be announced politely as the Run observes build progress");
assert.match(app, /function buildRunStageRows\(record = \{\}\)/, "build stage detail must be derived from persisted Run state");
assert.match(app, /record\.context\?\.data\?\.buildSignals/, "service build status should consume persisted build observation signals when available");
assert.match(app, /patchRun\(\{ buildSignals/, "build observer should persist the latest per-service build signals into the Run context");
assert.match(app, /function compactSignalStructureDetail\(structureDetail = null,\s*signal = \{\}\)/, "persisted build signals must keep compact current-run structure-detail rows");
assert.match(app, /pineLines:\s*selectedRecords\.map\(compactSignalStructureBuildRecord\)/, "persisted build signals should keep only the matching build/candidate pineLines needed for stage rendering");
assert.match(app, /structureDetail:\s*service\.detail\?\.structureDetail \|\| null/, "build observation signals must carry platform structure-detail rows before being compacted into Run history");
assert.match(app, /compactSignalStructureDetail\(signal\.structureDetail/, "compact build signals must preserve current structure-detail evidence instead of status-only signals");
assert.match(app, /applyBuildSignalsToServices\(runPatch\.serviceSnapshot \|\| current\.serviceSnapshot \|\| \[\], compactSignals\)/, "successful build observation signals must update the persisted Run service snapshot version");
assert.doesNotMatch(app, /signal\?\.status !== "succeeded" \|\| !signal\.version/, "running build observation signals must also update the displayed target version instead of waiting for final success");
assert.match(app, /function shouldApplySignalVersion\(service = \{\}, signal = \{\}\)/, "build observation must centralize when a live platform version can overwrite the Run service target");
assert.match(app, /signal\.reason === "waiting_for_target_version" && hasTaskTargetVersion/, "non-develop task target versions must not be overwritten by previous-success live platform versions");
assert.match(app, /workingServices = syncVersionsFromTaskImages\(workingServices, buildSnapshot\.images\)/, "non-develop Runs must sync target versions from the buildable task snapshot before triggering and observing builds");
assert.match(runStore, /function syncServiceSnapshotFromBuildImages\(services = \[\], context = \{\}\)/, "persisted non-develop Run history must repair service target versions from the task build snapshot");
assert.match(runStore, /generatedVersion:\s*match\.imageVersion,[\s\S]{0,80}imageVersion:\s*match\.imageVersion/, "build snapshot target versions must update both display and live-probe version fields");
assert.match(app, /WorkflowSwitcher/, "top workflow entry should be a dedicated dynamic profile/account switcher");
assert.match(app, /setActiveTab\("workbench"\)[\s\S]{0,220}setProfileContext/, "clicking any top workflow must activate the Pipeline tab before switching context");
assert.match(app, /workflowItems/, "top workflow entries must be derived from configured profile accounts instead of hard-coded hospital buttons");
assert.doesNotMatch(app, /const \[appCode,\s*setAppCode\] = useState/, "workbench application state must not be one global state shared across workflows");
assert.doesNotMatch(app, /const \[selectedKeys,\s*setSelectedKeys\] = useState/, "selected services must be scoped per workflow pane");
assert.match(app, /const \[workflowStateById,\s*setWorkflowStateById\] = useState\(\{\}\)/, "workbench controls must be keyed by workflow id");
assert.match(app, /function setWorkbenchField\(field,\s*valueOrUpdater\)[\s\S]{0,260}patchActiveWorkflowState/, "all workbench control setters must write through the active workflow state slice");
assert.match(app, /const \[runByWorkflowId,\s*setRunByWorkflowId\] = useState\(\{\}\)/, "current Pipeline Run state must be keyed by workflow id");
assert.match(app, /function setRun\(valueOrUpdater,[\s\S]{0,280}setRunByWorkflowId/, "Pipeline Run updates must write to the workflow pane that started the action");
assert.match(app, /function touchRunRecord\(record = \{\}\)[\s\S]{0,120}updatedAt:\s*new Date\(\)\.toISOString\(\)/, "active Pipeline Run writes must refresh updatedAt so the live observer is not normalized as stale history");
assert.match(app, /normalizePipelineRunRecord\(options\.touch === false \? rawNext : touchRunRecord\(rawNext\)\)/, "setRun must touch active Run records before normalization");
assert.match(app, /const hiddenSelectedServices = useMemo/, "batch service launches must detect selected services hidden by the current page or filter");
assert.match(app, /data-testid="hidden-selection-warning"/, "hidden selected services must be surfaced before a batch launch can start");
assert.match(app, /disabled=\{running \|\| hasHiddenServices\}/, "batch launch buttons must be disabled while hidden services remain selected");
assert.match(app, /function startSelectedPipeline\(templateId\)[\s\S]{0,420}Pipeline 未启动[\s\S]{0,420}隐藏服务/, "batch launch attempts must be blocked when hidden selected services remain");
assert.doesNotMatch(app, /normalized\.status === "done" \|\| normalized\.status === "failed" \|\| normalized\.status === "blocked"/, "blocked Pipeline Run checkpoints must not be treated as completedAt terminal records");
assert.match(app, /\["done", "failed", "cancelled"\]\.includes\(status\) \? \{ completedAt: new Date\(\)\.toISOString\(\) \} : \{\}/, "done/failed/cancelled phase changes should stamp completedAt explicitly");
assert.match(app, /const \[runDraftByWorkflowId,\s*setRunDraftByWorkflowId\] = useState\(\{\}\)/, "Pipeline draft inputs must be keyed by workflow id");
assert.match(app, /const visibleRunHistory = useMemo\(\(\) => \{[\s\S]{0,180}runWorkflowKey\(record\) === activeWorkflowId/, "Pipeline Run table must show the active workflow pane instead of shared global history");
assert.match(app, /runs=\{visibleRunHistory\}/, "Pipeline Run table props must receive the workflow-filtered run list");
assert.match(app, /runUnavailableMessage\(displayRecord,\s*profiles\)/, "Run continue actions must explain missing workflow targets instead of silently no-oping");
assert.match(app, /function setProfileContext[\s\S]{0,900}ensureWorkflowState\(nextWorkflowId/, "workflow switching must initialize the target workflow slice directly");
assert.match(app, /function ensureWorkflowState[\s\S]{0,220}if \(current\[workflowId\]\) return current;/, "workflow switching must preserve an existing workflow pane state");
assert.match(app, /function applyRunTarget[\s\S]{0,900}patchWorkflowState\(nextWorkflowId/, "loading a copied or resumed Run must write target state into that Run's workflow slice");
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
assert.doesNotMatch(
  app,
  /function PipelineRunDraftDetailPanel\(\{ record \}\)[\s\S]*?<BuildStageDetailPanel record=\{record\} \/>/,
  "copied draft Run details must stay cold and must not render previous build-stage/log state"
);
assert.match(app, /items-start gap-4[\s\S]{0,180}xl:items-stretch/, "expanded Run detail columns should stretch to the same row height on desktop");
assert.match(app, /<ActivityLog items=\{record\.activity \|\| \[\]\} stretch \/>/, "Run activity log should fill the available detail-panel height");
assert.match(app, /h-\[360px\] min-h-0 flex-none xl:h-0 xl:min-h-\[360px\] xl:flex-1/, "Run activity log should keep a bounded stacked height and use remaining vertical space on desktop");
assert.doesNotMatch(app, /onPause|pauseRequested|暂停请求|暂停中/, "Run table should not introduce a pause/continue toggle state machine");
assert.match(app, /function resumableDetachedRunningRun\(record = \{\}, currentRunId = ""\)/, "detached persisted running records should be rendered as resumable checkpoints instead of stuck background observers");
assert.match(app, /const continueDisabled = running \|\| \(isCurrent && displayRecord\.status === "running"\) \|\| !resumable;/, "continue is disabled only for the active in-page running Run or while another pipeline is busy");
assert.match(app, /onResume\(displayRecord\)/, "continue must resume the detached-running display checkpoint, not the stale raw running history row");
assert.match(
  app,
  /const startServices = \(normalized\.status === "draft" \|\| normalized\.started === false\)[\s\S]{0,180}clonePipelineRunDraft\(normalized\)\.serviceSnapshot/,
  "continuing a copied draft must cold-start from config services instead of inherited runtime service snapshots"
);
assert.match(app, /shouldObserveAfterBuildTriggerFailure\(result\)/, "uncertain build trigger failures must enter build observation instead of failing immediately");
assert.match(app, /构建触发待确认/, "the UI should explain that an uncertain trigger is being observed");
assert.doesNotMatch(app, /构建触发失败[\s\S]{0,120}updateOutcome\("build", "failed"[\s\S]{0,120}shouldObserveAfterBuildTriggerFailure/, "build trigger must check uncertain/already-running results before marking build failed");
assert.match(app, /emitCommandEvent\("build-observe",\s*"failed",\s*message\)/, "when observation detects build failure, observe-build must not remain running");
assert.match(app, /shouldRestartBuildTaskAfterBuildTriggerFailure\(result\)/, "stale build snapshots must be detected before marking build failed");
assert.match(app, /staleBuildSnapshot/, "resume logic must carry stale build snapshot state back to task selection");
assert.match(app, /excludeTaskIds/, "restarted task selection must not immediately reuse the stale build task");
assert.match(app, /buildObservationBaselineForService/, "develop direct-build runs must capture pre-trigger build markers before observing completion");
assert.doesNotMatch(app, /function directBuildBlockedByActiveBuild/, "develop direct-build must not block before triggering just because build-service detail reports buildPower=1");
assert.doesNotMatch(app, /directBuildBlockedByActiveBuild\(workingServices\)/, "develop direct-build must call the build API first; already-building should be decided from the trigger response");
assert.match(app, /patchRun\(\{ buildBaseline/, "develop direct-build baseline must be persisted in the PipelineRun context for resume");
assert.match(app, /isBuildAlreadyRunningResult\(result\)[\s\S]{0,260}direct_build_already_running/, "develop direct-build trigger responses that say a service is already building must block instead of observing as this run");
assert.match(app, /const savedBuildBaseline = normalized\.context\?\.data\?\.buildBaseline \|\| null/, "resume must restore the develop direct-build observation baseline");
assert.match(app, /resumePoint\.commandId === "observe-build"[\s\S]{0,420}observeBuildCompletion\(services,\s*\{ buildSnapshot: savedBuildSnapshot,\s*buildBaseline: savedBuildBaseline/, "resuming a blocked build observation must continue observing instead of triggering another build");
assert.match(app, /releaseNoWait:\s*true/, "resumed release observation should not wait a long period after a trusted empty release state");
assert.match(app, /releaseNoopAfterMs/, "new pipeline release observation should have a short empty-release confirmation window");
assert.match(app, /const PIPELINE_RELEASE_OBSERVER_TIMEOUT_MS = 2 \* 60 \* 1000;/, "release record transition should use a short observer budget, not the long build budget");
assert.doesNotMatch(app, /PIPELINE_RELEASE_OBSERVER_TIMEOUT_MS = 20 \* 60 \* 1000/, "release record transition must not wait twenty minutes after the build-platform handoff");
assert.match(app, /releaseRecordSignal\(latestApp,\s*\{\s*environmentFound/, "release observation must distinguish a trusted empty environment from an untrusted missing app");
assert.doesNotMatch(app, /Promise\.all\(releaseStages\.map\(\(stage\) => publishFor\(stage, app, detail\.result\)\)\)/, "master company and spot release-platform stages must not race on one stale detail payload");
assert.match(app, /for \(const stage of releaseStages\)/, "release-platform stages should run in policy order and refresh detail between stages");

console.log("workbench UI semantics checks passed");
