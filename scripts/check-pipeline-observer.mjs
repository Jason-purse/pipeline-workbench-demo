import assert from "node:assert";

import {
  buildApplySignal,
  buildPlatformPublishEnvironmentsFor,
  buildPlatformPublishProgress,
  buildPlatformPublishSubmittedSignal,
  buildSignalForService,
  humanizeFailure,
  isRetryableProbeResult,
  pipelineObservationDecision,
  publishableServicesForStage,
  releaseRecordSignal,
  shouldNoopReleaseRecord,
  shouldObserveAfterBuildTriggerFailure,
  shouldRestartBuildTaskAfterBuildTriggerFailure
} from "../src/client/src/lib/pipeline-observer.mjs";

const service = {
  imageJenkinsName: "prescription-mem-ewell-mastertest",
  imageNameEn: "prescription-mem-ewell",
  generatedVersion: "v1.62.001"
};

const runningBuild = buildSignalForService(service, {
  detail: [{
    imageJenkinsName: "prescription-mem-ewell-mastertest",
    imageNameEn: "prescription-mem-ewell",
    imageVersion: "v1.62.001"
  }]
});
assert.strictEqual(runningBuild.status, "running", "build without success/failure timestamp is still running");

const failedBuild = buildSignalForService(service, {
  detail: [{
    imageJenkinsName: "prescription-mem-ewell-mastertest",
    imageNameEn: "prescription-mem-ewell",
    imageVersion: "v1.62.001",
    lastSuccessTime: 10,
    lastFailureTime: 20,
    lastFailureId: "#199"
  }]
});
assert.strictEqual(failedBuild.status, "failed", "newer failure timestamp blocks the pipeline");

const succeededBuild = buildSignalForService(service, {
  detail: [{
    imageJenkinsName: "prescription-mem-ewell-mastertest",
    imageNameEn: "prescription-mem-ewell",
    imageVersion: "v1.62.001",
    lastSuccessTime: 30,
    lastFailureTime: 20,
    lastSuccessId: "#201"
  }]
});
assert.strictEqual(succeededBuild.status, "succeeded", "newer success timestamp completes the build observation");

const waitingRelease = releaseRecordSignal({ applicationCode: "mem", applicationVersion: "1.2.90", toPublishServiceNum: 0 });
assert.strictEqual(waitingRelease.status, "waiting", "zero pending target-app release records are not publishable");
assert.strictEqual(waitingRelease.reason, "release_record_absent", "a found release app with zero pending services is a known no-op state");

const untrustedZeroRelease = releaseRecordSignal({ applicationCode: "mem", toPublishServiceNum: 0 });
assert.strictEqual(untrustedZeroRelease.status, "waiting", "untrusted zero-pending records are not publishable");
assert.strictEqual(untrustedZeroRelease.reason, "release_record_untrusted", "zero pending without a real release version may be an error fallback and must not no-op");

const missingRelease = releaseRecordSignal(null);
assert.strictEqual(missingRelease.reason, "release_app_not_found", "missing target app means the overview did not prove zero pending");

const absentReleaseApp = releaseRecordSignal(null, { environmentFound: true, applicationCode: "mem" });
assert.strictEqual(absentReleaseApp.reason, "release_app_absent", "a successful environment overview with no target app is an empty release record, not an API failure");

const readyRelease = releaseRecordSignal({ applicationCode: "mem", applicationVersion: "1.2.90", toPublishServiceNum: 1 });
assert.strictEqual(readyRelease.status, "ready", "pending release record continues the pipeline");

const releaseDetail = {
  raw: {
    companyPublishFlag: "0",
    companyImages: { publishFlag: "0", buttonFlag: "0", currentServices: [] },
    spotPublishFlag: "0",
    spotImages: { publishFlag: "0", buttonFlag: "0", currentServices: [{ imageNameEn: "prescription-mem-ewell", imageVersion: "v1.62.002" }] }
  }
};
assert.strictEqual(publishableServicesForStage(releaseDetail, "company").length, 0, "empty company list is not publishable");
assert.strictEqual(publishableServicesForStage(releaseDetail, "spot").length, 1, "spot list remains publishable for mastertest");
assert.strictEqual(
  publishableServicesForStage({ raw: { companyImages: null, companyPublishFlag: null } }, "company").length,
  0,
  "null stage images are an explicit no-op, not an unknown fallback to overview pending count"
);
assert.strictEqual(
  publishableServicesForStage({ raw: { spotPublishFlag: "1", spotImages: { currentServices: [{ imageNameEn: "already-published" }] } } }, "spot").length,
  0,
  "published flag makes a stage a no-op even if stale services remain in raw payload"
);
assert.strictEqual(
  publishableServicesForStage({ raw: { spotImages: { publishFlag: "0", buttonFlag: "1", currentServices: [{ imageNameEn: "disabled" }] } } }, "spot").length,
  0,
  "disabled publish button makes a stage a no-op even if stale services remain in raw payload"
);

assert.strictEqual(isRetryableProbeResult({ reason: "network_timeout", timedOut: true }), true, "network timeouts are retryable during observation");
assert.strictEqual(isRetryableProbeResult({ reason: "release_overview_app_not_found" }), true, "temporary missing release overview app is retryable");
assert.strictEqual(isRetryableProbeResult({ reason: "publish_business_failed" }), false, "publish business rejection is not a read-probe retry");
assert.match(
  humanizeFailure({
    reason: "publish_business_failed",
    response: { businessCode: null, businessMessage: "消息处理成功" }
  }),
  /发布平台未接受发布请求/,
  "publish failure must not show the outer success message as the failure reason"
);
assert.match(
  humanizeFailure({
    reason: "publish_rate_timeout",
    message: "发布请求已受理，但发布进度在 24 次观察内未到 100%；Pipeline 已暂停。"
  }),
  /发布请求已受理/,
  "publish rate timeouts stay as blocked progress uncertainty, not false success"
);
assert.doesNotMatch(
  humanizeFailure({ error: "Command failed: curl --noproxy * http://example curl: (28) Failed to connect after 3075 ms: Timeout was reached" }),
  /curl --noproxy/,
  "long curl commands are summarized for UI display"
);
assert.strictEqual(
  shouldObserveAfterBuildTriggerFailure({
    ok: false,
    reason: "network_timeout",
    timedOut: true,
    message: "平台响应超时（connect=3s, total=12s）。VPN 可能可达，但接口响应超过本地保护阈值。"
  }),
  true,
  "a timeout after /support/buildImages is uncertain because the platform may have accepted the build trigger"
);
assert.strictEqual(
  shouldObserveAfterBuildTriggerFailure({
    ok: false,
    reason: "build_images_business_failed",
    response: { businessMessage: "微服务已在构建中" }
  }),
  true,
  "a platform 'service already building' response should enter build observation instead of failing the pipeline"
);
assert.strictEqual(
  shouldObserveAfterBuildTriggerFailure({
    ok: false,
    reason: "build_images_business_failed",
    response: { businessMessage: "构建权限不足" }
  }),
  false,
  "real business rejection should still fail the build trigger"
);
assert.strictEqual(
  shouldObserveAfterBuildTriggerFailure({
    ok: false,
    reason: "task_build_not_allowed",
    detail: { reason: "request_failed", error: "curl: (28) Timeout was reached" }
  }),
  false,
  "pre-trigger permission check failures must not be treated as an accepted build trigger"
);
assert.strictEqual(
  shouldRestartBuildTaskAfterBuildTriggerFailure({
    ok: false,
    reason: "build_images_business_failed",
    response: { businessMessage: "mastertest环境中prescription-mem-ewell-mastertest微服务已有新版本构建" }
  }),
  true,
  "a stale build snapshot must restart task location/create instead of failing the pipeline"
);
assert.strictEqual(
  shouldRestartBuildTaskAfterBuildTriggerFailure({
    ok: false,
    reason: "build_images_business_failed",
    response: { businessMessage: "构建权限不足" }
  }),
  false,
  "ordinary build business rejection must not restart task creation"
);
assert.strictEqual(
  shouldNoopReleaseRecord({ releaseSignal: waitingRelease, elapsedMs: 12_000, noopAfterMs: 30_000 }),
  false,
  "a new pipeline waits briefly before treating zero pending as no-op"
);
assert.strictEqual(
  shouldNoopReleaseRecord({ releaseSignal: waitingRelease, elapsedMs: 31_000, noopAfterMs: 30_000 }),
  true,
  "a new pipeline no-ops after the short empty-release confirmation window"
);
assert.strictEqual(
  shouldNoopReleaseRecord({ releaseSignal: waitingRelease, releaseNoWait: true, elapsedMs: 0, noopAfterMs: 30_000 }),
  true,
  "a retried pipeline directly no-ops when the platform proves zero pending"
);
assert.strictEqual(
  shouldNoopReleaseRecord({ releaseSignal: absentReleaseApp, releaseNoWait: true, elapsedMs: 0, noopAfterMs: 30_000 }),
  true,
  "a retried pipeline directly no-ops when the target environment has no target app record"
);
assert.strictEqual(
  shouldNoopReleaseRecord({ releaseSignal: untrustedZeroRelease, releaseNoWait: true, elapsedMs: 31_000, noopAfterMs: 30_000 }),
  false,
  "untrusted zero-pending API payloads never no-op"
);
assert.strictEqual(
  shouldNoopReleaseRecord({ releaseSignal: missingRelease, releaseNoWait: true, elapsedMs: 31_000, noopAfterMs: 30_000 }),
  false,
  "missing environment/app evidence remains blocked instead of no-op"
);

const buildStillRunning = buildApplySignal({ id: "apply-1", applyStatus: "1" });
assert.strictEqual(buildStillRunning.status, "running", "applyStatus=1 means the build task is still running");

const buildPublishReady = buildApplySignal({ id: "apply-1", applyStatus: "2", publishEnvironment: "1" });
assert.strictEqual(buildPublishReady.status, "publish_ready", "applyStatus=2 exposes the build-platform publish button");
assert.strictEqual(buildPublishReady.publishEnvironment, "1", "publish environment is carried into the confirm publish action");

assert.deepStrictEqual(buildPlatformPublishEnvironmentsFor("develop"), [], "develop does not need build-platform publish confirmation");
assert.deepStrictEqual(buildPlatformPublishEnvironmentsFor("mastertest"), ["1"], "mastertest needs the build-platform spot publish confirmation");
assert.deepStrictEqual(buildPlatformPublishEnvironmentsFor("master"), ["0", "1"], "master needs both build-platform company and spot confirmations");

const buildCompanyPublishReady = buildApplySignal({ id: "apply-2", applyStatus: "2", publishEnvironment: "0" });
const buildSpotPublishReady = buildApplySignal({ id: "apply-2", applyStatus: "2", publishEnvironment: "1" });
assert.deepStrictEqual(
  buildPlatformPublishProgress({ branch: "master", applySignal: buildCompanyPublishReady, confirmedEnvironments: [] }),
  { status: "confirm", environment: "0", missingEnvironments: ["0", "1"] },
  "master confirms the company build-platform publish button first when the platform exposes it"
);
assert.deepStrictEqual(
  buildPlatformPublishProgress({ branch: "master", applySignal: buildSpotPublishReady, confirmedEnvironments: ["0"] }),
  { status: "confirm", environment: "1", missingEnvironments: ["1"] },
  "master must continue to confirm the spot build-platform publish button after company is done"
);
assert.deepStrictEqual(
  buildPlatformPublishProgress({ branch: "master", applySignal: buildCompanyPublishReady, confirmedEnvironments: ["0"] }),
  { status: "waiting", missingEnvironments: ["1"] },
  "master must keep observing until the platform exposes the spot build-platform publish button"
);
assert.deepStrictEqual(
  buildPlatformPublishProgress({ branch: "master", applySignal: buildCompanyPublishReady, confirmedEnvironments: ["0", "1"] }),
  { status: "complete", missingEnvironments: [] },
  "master build-platform publish is complete only after both company and spot were confirmed"
);

const buildApplyFailed = buildApplySignal({ id: "apply-1", applyStatus: "3" });
assert.strictEqual(buildApplyFailed.status, "failed", "applyStatus=3 blocks the pipeline at build task failure");

const buildAlreadyPublished = buildApplySignal({ id: "apply-1", applyStatus: "5" });
assert.strictEqual(buildAlreadyPublished.status, "published", "applyStatus=5 means the build-platform publish stage is already done");

const submittedPublish = buildPlatformPublishSubmittedSignal({ taskId: "apply-1", status: "publish_ready", applyStatus: "2" });
assert.deepStrictEqual(
  submittedPublish,
  {
    status: "published",
    reason: "build_platform_publish_submitted",
    taskId: "apply-1",
    applyStatus: "2"
  },
  "after clicking the build-platform publish button the observer must treat the build-platform segment as done"
);

assert.deepStrictEqual(
  pipelineObservationDecision({
    buildSignals: [runningBuild],
    applySignal: buildStillRunning,
    releaseSignal: waitingRelease,
    elapsedMs: 14 * 60 * 1000,
    timeoutMs: 45 * 60 * 1000
  }),
  { status: "running", reason: "build_running" },
  "a long frontend build that is still running after 14 minutes must not be blocked by a fixed attempt count"
);

assert.deepStrictEqual(
  pipelineObservationDecision({
    buildSignals: [runningBuild],
    applySignal: buildStillRunning,
    releaseSignal: waitingRelease,
    elapsedMs: 46 * 60 * 1000,
    timeoutMs: 45 * 60 * 1000
  }),
  { status: "blocked", reason: "build_observe_timeout" },
  "a still-running build only pauses after the configured build observation timeout"
);

assert.deepStrictEqual(
  pipelineObservationDecision({
    buildSignals: [runningBuild],
    applySignal: buildPublishReady,
    releaseSignal: waitingRelease,
    elapsedMs: 12 * 60 * 1000,
    timeoutMs: 45 * 60 * 1000
  }),
  { status: "confirm_build_publish", reason: "build_platform_publish_ready", applySignal: buildPublishReady },
  "applyStatus=2 is authoritative for the build-platform publish button even if service detail has not refreshed yet"
);

assert.deepStrictEqual(
  pipelineObservationDecision({
    buildSignals: [succeededBuild],
    applySignal: buildPublishReady,
    releaseSignal: waitingRelease,
    attempt: 2,
    maxAttempts: 5
  }),
  { status: "confirm_build_publish", reason: "build_platform_publish_ready", applySignal: buildPublishReady },
  "build-platform publish button is part of the atomic build+release pipeline before release-platform polling"
);

assert.deepStrictEqual(
  pipelineObservationDecision({
    buildSignals: [runningBuild],
    applySignal: submittedPublish,
    releaseSignal: waitingRelease,
    elapsedMs: 12 * 60 * 1000,
    timeoutMs: 45 * 60 * 1000
  }),
  { status: "noop", reason: "release_record_absent", releaseSignal: waitingRelease },
  "submitted build-platform publish no-ops when release overview has the target app but no pending services"
);

assert.deepStrictEqual(
  pipelineObservationDecision({
    buildSignals: [runningBuild],
    applySignal: buildAlreadyPublished,
    releaseSignal: waitingRelease,
    elapsedMs: 12 * 60 * 1000,
    timeoutMs: 45 * 60 * 1000
  }),
  { status: "noop", reason: "release_record_absent", releaseSignal: waitingRelease },
  "applyStatus=5 also no-ops when release overview has the target app but no pending services"
);

assert.deepStrictEqual(
  pipelineObservationDecision({
    buildSignals: [succeededBuild],
    applySignal: buildAlreadyPublished,
    releaseSignal: waitingRelease,
    attempt: 2,
    maxAttempts: 5
  }),
  { status: "noop", reason: "release_record_absent", releaseSignal: waitingRelease },
  "a successful release overview with the target app but zero pending services is a no-op, not a wait"
);

assert.deepStrictEqual(
  pipelineObservationDecision({
    buildSignals: [succeededBuild],
    releaseSignal: readyRelease,
    attempt: 2,
    maxAttempts: 5
  }),
  { status: "ready", reason: "release_record_ready" },
  "release record readiness continues to publish stage"
);

assert.deepStrictEqual(
  pipelineObservationDecision({
    buildSignals: [succeededBuild],
    releaseSignal: waitingRelease,
    attempt: 5,
    maxAttempts: 5
  }),
  { status: "noop", reason: "release_record_absent", releaseSignal: waitingRelease },
  "zero pending target app still no-ops at timeout instead of blocking"
);

assert.deepStrictEqual(
  pipelineObservationDecision({
    buildSignals: [succeededBuild],
    releaseSignal: missingRelease,
    attempt: 2,
    maxAttempts: 5
  }),
  { status: "running", reason: "release_record_waiting" },
  "missing target app keeps observing because platform errors can look like zero pending in the UI"
);

assert.deepStrictEqual(
  pipelineObservationDecision({
    buildSignals: [succeededBuild],
    releaseSignal: missingRelease,
    attempt: 5,
    maxAttempts: 5
  }),
  { status: "blocked", reason: "release_record_timeout" },
  "missing target app blocks at timeout instead of silently no-oping"
);

assert.deepStrictEqual(
  pipelineObservationDecision({
    buildSignals: [succeededBuild],
    releaseSignal: untrustedZeroRelease,
    attempt: 5,
    maxAttempts: 5
  }),
  { status: "blocked", reason: "release_record_timeout" },
  "untrusted zero-pending records block at timeout because the release API did not prove a stable target app state"
);

assert.strictEqual(
  pipelineObservationDecision({
    buildSignals: [failedBuild],
    releaseSignal: waitingRelease,
    attempt: 1,
    maxAttempts: 5
  }).status,
  "failed",
  "build failure stops observation immediately"
);

console.log("pipeline observer checks passed");
