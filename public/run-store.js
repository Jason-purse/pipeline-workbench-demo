(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  root.RunStore = factory(root.PipelineCore);
})(typeof globalThis !== "undefined" ? globalThis : this, function (PipelineCore) {
  const WORKBENCH_STATE_KEY = "hospital-release-workbench-state-v2";
  const LEGACY_STATE_KEY = "hospital-release-workbench-state-v1";

  function normalizeSnapshot(snapshot) {
    const source = snapshot && typeof snapshot === "object" ? snapshot : {};
    const pipeline = source.pipeline && typeof source.pipeline === "object" ? source.pipeline : {};
    const normalizeTemplateId = PipelineCore && PipelineCore.normalizeTemplateId
      ? PipelineCore.normalizeTemplateId
      : (value) => value || "build-and-release";

    return {
      version: 2,
      activeView: source.activeView || "workbench",
      activeProfileId: source.activeProfileId || "gam",
      activeAccountId: source.activeAccountId || null,
      activeApplicationCode: source.activeApplicationCode || "emr",
      activeBuildBranch: source.activeBuildBranch || "mastertest",
      activeReleaseEnvId: source.activeReleaseEnvId || null,
      serviceSearch: source.serviceSearch || "",
      selectedService: source.selectedService || null,
      selectedServices: Array.isArray(source.selectedServices) ? source.selectedServices.slice(0, 30) : [],
      evidence: Array.isArray(source.evidence) ? source.evidence.slice(0, 25) : [],
      lastProbeResult: source.lastProbeResult || null,
      pipeline: {
        runKey: pipeline.runKey || "",
        templateId: normalizeTemplateId(pipeline.templateId || "build-and-release"),
        executionMode: pipeline.executionMode || "manual",
        runStarted: Boolean(pipeline.runStarted),
        inspectedStageId: pipeline.inspectedStageId || "",
        failedStageId: pipeline.failedStageId || "",
        activity: Array.isArray(pipeline.activity) ? pipeline.activity.slice(0, 80) : [],
        stageOutcomes: pipeline.stageOutcomes && typeof pipeline.stageOutcomes === "object" ? pipeline.stageOutcomes : {},
        inputs: {
          releaseReason: pipeline.inputs && pipeline.inputs.releaseReason || "",
          releaseNotice: pipeline.inputs && pipeline.inputs.releaseNotice || ""
        }
      }
    };
  }

  function saveWorkbenchState(snapshot, storage) {
    if (!storage) return;
    storage.setItem(WORKBENCH_STATE_KEY, JSON.stringify(normalizeSnapshot(snapshot)));
  }

  function restoreWorkbenchState(storage) {
    if (!storage) return null;
    const raw = storage.getItem(WORKBENCH_STATE_KEY) || storage.getItem(LEGACY_STATE_KEY);
    if (!raw) return null;
    return normalizeSnapshot(JSON.parse(raw));
  }

  return {
    LEGACY_STATE_KEY,
    WORKBENCH_STATE_KEY,
    normalizeSnapshot,
    restoreWorkbenchState,
    saveWorkbenchState
  };
});
