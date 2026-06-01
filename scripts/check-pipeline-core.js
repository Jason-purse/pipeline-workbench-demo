const assert = require("assert");

const core = require("../public/pipeline-core");

function stageById(run, id) {
  return run.stages.find((stage) => stage.id === id);
}

function makeContext(overrides = {}) {
  return {
    profileId: "demob",
    accountId: "demo_prod",
    customerNameEn: "demo-customer-b",
    applicationCode: "emr",
    buildBranch: "mastertest",
    releaseEnvironment: {
      id: "demob-uat-a",
      showNameEn: "uat-demo-b",
      environmentFlag: "a",
      label: "uat-demo-bA"
    },
    service: {
      serviceKey: "demo-customer-b::emr::mastertest::prescription-mem-ewell-master",
      imageJenkinsName: "prescription-mem-ewell-master",
      applicationCode: "emr",
      codeBranch: "mastertest"
    },
    capabilities: {
      credentialsReady: true,
      buildProbeReady: true,
      releaseProbeReady: true,
      buildStatusReady: true,
      versionReady: true,
      buildTaskCreated: true,
      buildTaskLocated: true,
      taskBuildSucceeded: true,
      releaseDetailReady: true,
      companyPublishSucceeded: true,
      spotPublishSucceeded: true,
      finalVerified: true
    },
    inputs: {
      releaseReason: "测试发布",
      releaseNotice: "关注回滚"
    },
    ...overrides
  };
}

function testDevelopSkipsReleaseStages() {
  const run = core.createPipelineRun(makeContext({
    buildBranch: "develop",
    service: {
      serviceKey: "svc",
      imageJenkinsName: "doccisweb-emr-ewell-develop",
      applicationCode: "emr",
      codeBranch: "develop"
    },
    capabilities: {
      credentialsReady: true,
      buildProbeReady: true,
      releaseProbeReady: false,
      buildStatusReady: true,
      directBuildSucceeded: true,
      finalVerified: true
    },
    inputs: {}
  }));

  assert.strictEqual(core.environmentPolicy("develop").releaseRequired, false);
  assert.strictEqual(stageById(run, "release-probe").status, "skipped");
  assert.strictEqual(stageById(run, "release-inputs").status, "skipped");
  assert.strictEqual(stageById(run, "publish-company").status, "skipped");
  assert.strictEqual(stageById(run, "publish-spot").status, "skipped");
  assert.strictEqual(run.status, "succeeded");
}

function testMastertestUsesSpotOnlyRelease() {
  const run = core.createPipelineRun(makeContext({
    capabilities: {
      credentialsReady: true,
      buildProbeReady: true,
      releaseProbeReady: true,
      buildStatusReady: true,
      versionReady: true,
      buildTaskCreated: true,
      buildTaskLocated: true,
      taskBuildSucceeded: true,
      releaseDetailReady: true,
      companyPublishSucceeded: false,
      spotPublishSucceeded: false,
      finalVerified: true
    }
  }));

  assert.deepStrictEqual(core.environmentPolicy("mastertest").releaseStages, ["spot"]);
  assert.strictEqual(stageById(run, "publish-company").status, "skipped");
  assert.strictEqual(stageById(run, "publish-spot").status, "waiting_confirmation");
  assert.deepStrictEqual(stageById(run, "publish-spot").missing, []);
  assert.strictEqual(run.currentStage.id, "publish-spot");
}

function testMasterUsesCompanyThenSpotAndKeepsStrategyOpen() {
  const policy = core.environmentPolicy("master");
  assert.deepStrictEqual(policy.releaseStages, ["company", "spot"]);
  assert.strictEqual(policy.strategyLocked, false);

  const run = core.createPipelineRun(makeContext({
    buildBranch: "master",
    service: {
      serviceKey: "demo-customer-b::emr::master::prescription-mem-ewell-master",
      imageJenkinsName: "prescription-mem-ewell-master",
      applicationCode: "emr",
      codeBranch: "master"
    },
    capabilities: {
      credentialsReady: true,
      buildProbeReady: true,
      releaseProbeReady: true,
      buildStatusReady: true,
      versionReady: true,
      buildTaskCreated: true,
      buildTaskLocated: true,
      taskBuildSucceeded: true,
      releaseDetailReady: true,
      companyPublishSucceeded: false,
      spotPublishSucceeded: false,
      finalVerified: true
    }
  }));

  assert.strictEqual(stageById(run, "publish-company").status, "waiting_confirmation");
  assert.strictEqual(stageById(run, "publish-spot").status, "pending");
  assert.deepStrictEqual(stageById(run, "publish-spot").missing, ["companyPublishEvidence"]);
  assert.strictEqual(run.currentStage.id, "publish-company");
}

function testReleaseInputsBlockMastertest() {
  const run = core.createPipelineRun(makeContext({
    inputs: {
      releaseReason: "",
      releaseNotice: ""
    }
  }));

  assert.strictEqual(core.environmentPolicy("mastertest").releaseRequired, true);
  assert.strictEqual(stageById(run, "release-inputs").status, "blocked");
  assert.deepStrictEqual(stageById(run, "release-inputs").missing, ["发布理由", "注意事项"]);
  assert.strictEqual(run.currentStage.id, "release-inputs");
}

function testMutationStagesWaitForConfirmation() {
  const run = core.createPipelineRun(makeContext({
    capabilities: {
      credentialsReady: true,
      buildProbeReady: true,
      releaseProbeReady: true,
      buildStatusReady: true,
      versionReady: true
    }
  }));

  assert.strictEqual(stageById(run, "create-build-task").status, "waiting_confirmation");
  assert.strictEqual(run.currentStage.id, "create-build-task");
  assert.strictEqual(run.currentStage.kind, "mutation");
}

function testRetryResetsFailedStageAndLaterStages() {
  const failedRun = core.createPipelineRun(makeContext({
    failedStageId: "task-image-build",
    capabilities: {
      credentialsReady: true,
      buildProbeReady: true,
      releaseProbeReady: true,
      buildStatusReady: true,
      versionReady: true,
      buildTaskCreated: true,
      buildTaskLocated: true
    }
  }));

  assert.strictEqual(stageById(failedRun, "task-image-build").status, "failed");
  const retried = core.resetFromStage(failedRun, "task-image-build");
  assert.strictEqual(stageById(retried, "create-build-task").status, "succeeded");
  assert.strictEqual(stageById(retried, "task-image-build").status, "waiting_confirmation");
  assert.strictEqual(stageById(retried, "release-detail").status, "pending");
}

function testAutoModeStopsAtMutation() {
  const run = core.createPipelineRun(makeContext({
    mode: "auto",
    capabilities: {
      credentialsReady: true,
      buildProbeReady: true,
      releaseProbeReady: true,
      buildStatusReady: true,
      versionReady: true
    }
  }));

  assert.strictEqual(run.executionMode, "auto");
  assert.strictEqual(run.currentStage.id, "create-build-task");
  assert.strictEqual(run.currentStage.status, "waiting_confirmation");
}

testDevelopSkipsReleaseStages();
testMastertestUsesSpotOnlyRelease();
testMasterUsesCompanyThenSpotAndKeepsStrategyOpen();
testReleaseInputsBlockMastertest();
testMutationStagesWaitForConfirmation();
testRetryResetsFailedStageAndLaterStages();
testAutoModeStopsAtMutation();

console.log("pipeline core checks passed");
