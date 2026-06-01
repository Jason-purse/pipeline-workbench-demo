const BASE_BRANCHES = window.PipelineCore.BASE_BRANCHES;
const PIPELINE_DECORATORS = window.PipelineCore.DECORATORS;
const PIPELINE_TEMPLATES = window.PipelineCore.TEMPLATES;
const CHILD_PIPELINES = window.PipelineCore.CHILD_PIPELINES;
const WORKBENCH_STATE_KEY = window.RunStore.WORKBENCH_STATE_KEY;

const state = {
  bootstrap: null,
  activeView: "workbench",
  activeProfileId: "demob",
  activeAccountId: null,
  activeApplicationCode: "emr",
  activeBuildBranch: "mastertest",
  activeReleaseEnvId: null,
  pipeline: {
    runKey: "",
    templateId: "build-and-release",
    executionMode: "manual",
    isRunning: false,
    runStarted: false,
    inspectedStageId: "",
    failedStageId: "",
    activity: [],
    stageOutcomes: {},
    inputs: {
      releaseReason: "",
      releaseNotice: ""
    }
  },
  serviceSearch: "",
  selectedService: null,
  selectedServices: [],
  publishDetails: {},
  buildTasks: {},
  structureConfigs: {},
  probeData: {},
  autoProbeKeys: {},
  evidence: []
};

const API_MATRIX = [
  {
    group: "构建平台认证与权限",
    endpoints: [
      ["POST", "/authority/login", "SHA256(password), appId=OPS0001"],
      ["POST", "/authority/getTreeList", "token + appId + dimenCode + deviceType"],
      ["POST", "/authority/getAuthorityByAppId", "token + appId"],
      ["POST", "/authority/loginTokenVerification", "loginToken"],
      ["POST", "/authority/searchSimpleUserList", "用户搜索"],
      ["POST", "/authority/getMedicalGroupUserList", "groupCode"],
      ["POST", "/authority/changePWD", "旧密码 + 新密码"]
    ]
  },
  {
    group: "构建平台清单读取",
    endpoints: [
      ["POST", "/support/findCustomerList", "客户列表"],
      ["POST", "/support/findCustomerAppList", "应用列表"],
      ["POST", "/support/myApplicationListPage", "userId + customerNameEn + applicationCode + pageNumber/pageSize"],
      ["POST", "/support/findMyApplicationDetail", "customerNameEn + applicationCode"],
      ["POST", "/support/selectNamespaceList", "customerNameEn + applicationCode"],
      ["POST", "/support/selectPublishMicroServiceInfo", "userId + customerNameEn + applicationCode + codeBranch + pageNumber/pageSize"],
      ["POST", "/support/myServiceListPage", "我的微服务列表"],
      ["POST", "/support/getBuildTaskType", "release 提测任务类型"]
    ]
  },
  {
    group: "构建平台构建主流程",
    endpoints: [
      ["POST", "/support/generateImageVersion", "structureType + codeBranch + images[].imageNameEn；Hotfix 可带 extendFlag"],
      ["POST", "/support/buildImages", "develop 直构建；release 创建提测任务；任务内构建带 applyId + imageVersion"],
      ["POST", "/support/applyProdStruct", "mastertest/master 创建构建申请；mastertest 的 applyType 也是 prod"],
      ["POST", "/support/selectBuildTask", "customerNameEn + applicationCode + envType + codeBranch 或 releaseTaskId"],
      ["POST", "/support/selectBuildInfoList", "taskId + staffCode；buildPower=1 才显示构建按钮"],
      ["POST", "/support/getStructureImageDetail", "customerNameEn + applicationName + codeBranch + imageJenkinsName"],
      ["POST", "/support/getStructureDetailList", "customerNameEn + applicationName + codeBranch + imageJenkinsName + imageVersion"],
      ["POST", "/support/getStructureLog", "customerNameEn + applicationName + codeBranch + imageJenkinsName + buildID"],
      ["POST", "/support/stopBuildImages", "customerNameEn + applicationName + codeBranch + imageJenkinsName + buildNum"]
    ]
  },
  {
    group: "构建平台申请/发布记录",
    endpoints: [
      ["POST", "/support/selectReleaseAppList", "customerNameEn + codeBranch + envType + applicationCode"],
      ["POST", "/support/selectImageByEnv", "customerNameEn + applicationCode + codeBranch + structureType/laneNamespace"],
      ["POST", "/support/getRelsInfo", "customerNameEn + codeBranch + applicationcode + envType + releaseStatus"],
      ["POST", "/support/selectCustomerAppPutDetail", "customerNameEn + applicationCode + envType"],
      ["POST", "/support/selectReleaseBuildTaskListPage", "提测记录表分页"],
      ["POST", "/support/publishRecordsPage", "发布记录表分页"],
      ["POST", "/support/findApplyDetail", "applyId"],
      ["POST", "/support/viewProdStructureApplyDetail", "applyId"],
      ["POST", "/support/updateProdStructApplyStatus", "申请状态处理"],
      ["POST", "/support/testComplete", "完成测试任务"],
      ["POST", "/support/confirmPublish", "构建平台侧确认发布"]
    ]
  },
  {
    group: "发布平台读取",
    endpoints: [
      ["POST", "/authority/login", "SHA256(password), appId=\"\""],
      ["POST", "/cloud/getCustomerListAuth", "发布平台客户权限列表"],
      ["POST", "/cloud/getCustomerAppListAuth", "发布平台应用权限列表"],
      ["POST", "/cloud/publishOverviewList", "customerNameEn + userId"],
      ["POST", "/cloud/getCurrentAppPublishDetail", "customerNameEn + showNameEn + environmentFlag + applicationCode + applicationVersion"],
      ["POST", "/cloud/getPublishRecordsPage", "customerNameEn + showNameEn + environmentFlag + applicationCode + pageNumber/pageSize"],
      ["POST", "/cloud/getPublishDetail", "发布详情"],
      ["POST", "/cloud/publishAppRate", "发布进度轮询"]
    ]
  },
  {
    group: "发布平台执行",
    endpoints: [
      ["POST", "/cloud/publishApps", "userId + customerNameEn + showNameEn + environment + environmentFlag + publishApps[]"],
      ["POST", "/cloud/delPublish", "删除/撤销发布"],
      ["POST", "/cloud/configEnvironmentStatus", "启停发布环境"],
      ["POST", "/cloud/configEnvironmentAddress", "配置发布环境地址"],
      ["POST", "/cloud/saveEnvironmentInfo", "保存发布环境信息"],
      ["POST", "/cloud/thirdAppAutoPackages", "第三方应用自动打包"]
    ]
  }
];

const COMMON_PIPELINES = [
  {
    id: "build-and-release",
    title: "一键构建并发布",
    shortTitle: "构建 + 发布",
    description: "创建/触发构建，构建完成后联动发布平台公司发布和现场发布。",
    tone: "primary"
  },
  {
    id: "build-only",
    title: "仅构建服务",
    shortTitle: "仅构建",
    description: "只完成构建平台侧任务创建与构建，不进入发布平台。",
    tone: "secondary"
  },
  {
    id: "release-existing",
    title: "发布已有版本",
    shortTitle: "仅发布",
    description: "不重新构建，直接用发布平台当前应用版本走公司/现场发布。",
    tone: "secondary"
  },
  {
    id: "void-existing",
    title: "作废当前版本",
    shortTitle: "作废",
    description: "已建模，真实作废 API 未完成最终确认前不开放一键执行。",
    tone: "danger",
    disabled: true
  }
];

const els = {
  profileList: document.querySelector("#profileList"),
  currentContext: document.querySelector("#currentContext"),
  operationSummary: document.querySelector("#operationSummary"),
  lastRefresh: document.querySelector("#lastRefresh"),
  targetPicker: document.querySelector("#targetPicker"),
  sessionCards: document.querySelector("#sessionCards"),
  probeResult: document.querySelector("#probeResult"),
  buildProbeState: document.querySelector("#buildProbeState"),
  releaseProbeState: document.querySelector("#releaseProbeState"),
  serviceChooser: document.querySelector("#serviceChooser"),
  buildConsole: document.querySelector("#buildConsole"),
  releaseConsole: document.querySelector("#releaseConsole"),
  operationCard: document.querySelector("#operationCard"),
  pipelineRunner: document.querySelector("#pipelineRunner"),
  evidenceTimeline: document.querySelector("#evidenceTimeline"),
  profileConfigView: document.querySelector("#profileConfigView"),
  systemConfigView: document.querySelector("#systemConfigView"),
  apiDictionaryView: document.querySelector("#apiDictionaryView")
};

function formatTime(date = new Date()) {
  return date.toLocaleString("zh-CN", { hour12: false });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function addEvidence(title, detail, tone = "blue") {
  const item = { at: formatTime(), title, detail, tone };
  if (state.pipeline.runStarted) {
    state.pipeline.activity = [item, ...(state.pipeline.activity || [])].slice(0, 80);
  } else {
    state.evidence.unshift(item);
    state.evidence = state.evidence.slice(0, 25);
  }
  persistWorkbenchState();
  renderEvidence();
}

function setProbeResult(title, payload, tone = "blue") {
  state.lastProbeResult = { title, payload, tone, at: formatTime() };
  persistWorkbenchState();
  els.probeResult.classList.add("visible");
  els.probeResult.innerHTML = `
    <div class="result-head">
      <div>
        <strong>${escapeHtml(title)}</strong>
        <span>完整 token 已隐藏，前端不接触密码。</span>
      </div>
      <span class="status ${tone}">${tone}</span>
    </div>
    <details>
      <summary>查看摘要 JSON</summary>
      <pre>${escapeHtml(JSON.stringify(payload, null, 2))}</pre>
    </details>
  `;
}

function persistWorkbenchState() {
  try {
    const snapshot = {
      version: 2,
      activeView: state.activeView,
      activeProfileId: state.activeProfileId,
      activeAccountId: state.activeAccountId,
      activeApplicationCode: state.activeApplicationCode,
      activeBuildBranch: state.activeBuildBranch,
      activeReleaseEnvId: state.activeReleaseEnvId,
      pipeline: {
        runKey: state.pipeline.runKey,
        templateId: state.pipeline.templateId,
        executionMode: state.pipeline.executionMode,
        inspectedStageId: state.pipeline.inspectedStageId,
        failedStageId: state.pipeline.failedStageId,
        runStarted: Boolean(state.pipeline.runStarted),
        activity: state.pipeline.activity || [],
        stageOutcomes: state.pipeline.stageOutcomes,
        inputs: {
          releaseReason: state.pipeline.inputs.releaseReason,
          releaseNotice: state.pipeline.inputs.releaseNotice
        }
      },
      serviceSearch: state.serviceSearch,
      selectedService: state.selectedService && {
        profileId: state.selectedService.profileId,
        serviceKey: state.selectedService.serviceKey,
        generatedVersion: state.selectedService.generatedVersion
      },
      selectedServices: (state.selectedServices || []).map((item) => ({
        profileId: item.profileId,
        serviceKey: item.serviceKey,
        generatedVersion: item.generatedVersion
      })),
      evidence: state.evidence,
      lastProbeResult: state.lastProbeResult
    };
    window.RunStore.saveWorkbenchState(snapshot, window.localStorage);
  } catch (error) {
    // Local diagnostics are best-effort and must not block operations.
  }
}

function restoreWorkbenchState() {
  try {
    const snapshot = window.RunStore.restoreWorkbenchState(window.localStorage);
    if (!snapshot) return;
    state.activeView = snapshot.activeView || state.activeView;
    if (!["workbench", "settings"].includes(state.activeView)) {
      state.activeView = "workbench";
    }
    state.activeProfileId = snapshot.activeProfileId || state.activeProfileId;
    state.activeAccountId = snapshot.activeAccountId || state.activeAccountId;
    state.activeApplicationCode = snapshot.activeApplicationCode || state.activeApplicationCode;
    state.activeBuildBranch = snapshot.activeBuildBranch || state.activeBuildBranch;
    state.activeReleaseEnvId = snapshot.activeReleaseEnvId || state.activeReleaseEnvId;
    state.pipeline = {
      ...state.pipeline,
      ...(snapshot.pipeline || {}),
      templateId: window.PipelineCore.normalizeTemplateId(snapshot.pipeline && snapshot.pipeline.templateId || state.pipeline.templateId),
      runStarted: Boolean(snapshot.pipeline && snapshot.pipeline.runStarted),
      activity: Array.isArray(snapshot.pipeline && snapshot.pipeline.activity) ? snapshot.pipeline.activity.slice(0, 80) : [],
      inputs: {
        ...state.pipeline.inputs,
        ...(snapshot.pipeline && snapshot.pipeline.inputs || {})
      }
    };
    state.serviceSearch = snapshot.serviceSearch || "";
    state.selectedService = snapshot.selectedService || null;
    state.selectedServices = Array.isArray(snapshot.selectedServices) && snapshot.selectedServices.length
      ? snapshot.selectedServices
      : state.selectedService ? [state.selectedService] : [];
    state.evidence = Array.isArray(snapshot.evidence) ? snapshot.evidence.slice(0, 25) : [];
    state.lastProbeResult = snapshot.lastProbeResult || null;
  } catch (error) {
    state.evidence = [];
  }
}

function credentialConfigFor(profile, account) {
  const groups = state.bootstrap && state.bootstrap.credentialState || [];
  const group = groups.find((item) => item.profileId === profile.id);
  return group && group.accounts.find((item) => item.accountId === account.id);
}

function hasCredentials(profile, account) {
  const item = credentialConfigFor(profile, account);
  return Boolean(item && item.configured);
}

function missingCredentialsEvidence(profile, account) {
  const config = credentialConfigFor(profile, account);
  state.activeView = "settings";
  addEvidence(
    "账号凭据未配置",
    `${profile.shortName} / ${account.label} 需要先在系统配置里保存账号密码，或提供 ${config && config.envPasswordKey || account.envPasswordKey}。`,
    "yellow"
  );
  render();
}

function replaceCredentialState(nextState) {
  if (nextState) {
    state.bootstrap.credentialState = nextState;
  }
}

function getProfile() {
  return state.bootstrap.profiles.find((profile) => profile.id === state.activeProfileId);
}

function getAccount(profile = getProfile()) {
  return profile.accounts.find((account) => account.id === state.activeAccountId) || profile.accounts[0];
}

function getReleaseEnv(profile = getProfile()) {
  return profile.releaseEnvironments.find((env) => env.id === state.activeReleaseEnvId) || profile.releaseEnvironments[0];
}

function getProbe(profileId, kind) {
  return state.probeData[profileId] && state.probeData[profileId][kind];
}

function selectedServiceGroupKey(profile = getProfile()) {
  return getSelectedServices(profile).map((item) => item.serviceKey).sort().join("|");
}

function activePipelineKey(profile = getProfile(), selected = getSelectedService(profile)) {
  const env = getReleaseEnv(profile);
  const groupKey = selectedServiceGroupKey(profile) || selected && selected.serviceKey;
  return [
    profile && profile.id,
    state.activeAccountId,
    state.activeApplicationCode,
    state.activeBuildBranch,
    env && env.showNameEn,
    env && env.environmentFlag,
    groupKey,
    state.pipeline.templateId
  ].filter(Boolean).join("::");
}

function ensurePipelineRun(profile = getProfile()) {
  const key = activePipelineKey(profile);
  if (state.pipeline.runKey === key) return;
  state.pipeline.runKey = key;
  state.pipeline.failedStageId = "";
  state.pipeline.runStarted = false;
  state.pipeline.activity = [];
  state.pipeline.stageOutcomes = {};
  state.pipeline.inspectedStageId = "";
  persistWorkbenchState();
}

function stageOutcome(stageId) {
  return state.pipeline.stageOutcomes[stageId] || null;
}

function stageSucceeded(stageId) {
  const outcome = stageOutcome(stageId);
  return Boolean(outcome && outcome.status === "succeeded");
}

function markPipelineStage(stageId, status, detail) {
  state.pipeline.stageOutcomes = {
    ...state.pipeline.stageOutcomes,
    [stageId]: {
      status,
      detail: detail || null,
      at: formatTime()
    }
  };
  state.pipeline.failedStageId = status === "failed" ? stageId : "";
  persistWorkbenchState();
}

function clearPipelineFromStage(stageId) {
  const plan = createPipelinePlan(getProfile());
  const startIndex = plan.stages.findIndex((stage) => stage.id === stageId);
  if (startIndex < 0) return;
  const cleared = { ...state.pipeline.stageOutcomes };
  for (const stage of plan.stages.slice(startIndex)) {
    delete cleared[stage.id];
  }
  state.pipeline.stageOutcomes = cleared;
  state.pipeline.failedStageId = "";
  state.pipeline.inspectedStageId = stageId;
  addEvidence("Pipeline 重试点已重置", `从 ${stageId} 继续，已完成阶段不会重放。`, "yellow");
  persistWorkbenchState();
  render();
}

function isProdEnv(env) {
  return /prod|生产|master$/.test(`${env.label} ${env.showNameEn}`);
}

function recommendBranchForEnv(env) {
  if (!env) return "mastertest";
  if (isProdEnv(env)) return "master";
  if (/uat|test|测试|mastertest/.test(`${env.label} ${env.showNameEn}`)) return "mastertest";
  return "release";
}

function releaseRequiredForBranch(branchCode) {
  return window.PipelineCore.environmentPolicy(branchCode).releaseRequired;
}

function buildFlowForBranch(branchCode) {
  const policy = window.PipelineCore.environmentPolicy(branchCode);
  return {
    mode: policy.buildMode,
    label: policy.label,
    status: policy.status,
    actionLabel: policy.actionLabel,
    structureType: policy.structureType,
    strategyLocked: policy.strategyLocked,
    description: policy.description
  };
}

function envLabelForPipeline(env) {
  if (!env) return "未选发布环境";
  return `${env.showNameEn}/${env.environmentFlag}`;
}

function pipelineTemplate() {
  return window.PipelineCore.getTemplate(state.pipeline.templateId);
}

function releaseInputPolicy(profile, selected) {
  const env = getReleaseEnv(profile);
  const releaseNeeded = releaseRequiredForBranch(selected && selected.codeBranch || state.activeBuildBranch);
  const required = releaseNeeded;
  const missing = [];
  if (required && !state.pipeline.inputs.releaseReason.trim()) missing.push("发布理由");
  if (required && !state.pipeline.inputs.releaseNotice.trim()) missing.push("注意事项");

  return {
    required,
    missing,
    env,
    reason: state.pipeline.inputs.releaseReason.trim(),
    notice: state.pipeline.inputs.releaseNotice.trim(),
    summary: required
      ? `${envLabelForPipeline(env)} 需要发布理由和注意事项。`
      : "开发环境保留发布段，但发布理由和注意事项不要求填写。"
  };
}

function pipelineScopeNote(profile, plan) {
  const selected = getSelectedService(profile);
  const releaseNeeded = releaseRequiredForBranch(selected && selected.codeBranch || state.activeBuildBranch);
  const env = getReleaseEnv(profile);
  const serviceText = selected ? selected.imageJenkinsName : "尚未选择服务";
  if (plan.scope === "subset") {
    return `当前是基础复合 Pipeline 的子集视图；MVP 默认仍以服务 ${serviceText} 生成完整构建+发布流程。`;
  }
  if (!selected) {
    if (!releaseNeeded) {
      return "先选择服务，Pipeline 会绑定服务生成构建 Stage；当前 develop 环境发布段按策略跳过。";
    }
    return `先选择服务，Pipeline 会绑定服务、${envLabelForPipeline(env)} 和构建分支。`;
  }
  if (!releaseNeeded) {
    return `${serviceText} 已生成完整构建+发布 Pipeline；develop 环境发布段按策略跳过。`;
  }
  return `${serviceText} 已生成完整构建+发布 Pipeline；${envLabelForPipeline(env)} 发布段要求发布理由和注意事项。`;
}

function pipelineDecorators() {
  return window.PipelineCore.decoratorsForMode(state.pipeline.executionMode);
}

function defaultReleaseReason(profile, selected) {
  const env = getReleaseEnv(profile);
  const serviceNameText = selected && selected.imageJenkinsName || "目标服务";
  return `${profile.shortName}${state.activeApplicationCode} ${serviceNameText} ${env ? env.showNameEn : state.activeBuildBranch} 构建完成后发布验证`;
}

function defaultReleaseNotice(profile, selected) {
  const env = getReleaseEnv(profile);
  const target = env ? `${env.showNameEn}/${env.environmentFlag}` : state.activeBuildBranch;
  return `${target} 发布后核对应用版本、服务启动状态和核心接口；异常按原平台回滚流程处理。`;
}

function ensureReleaseInputsForPipeline(profile, selected) {
  const releasePolicy = releaseInputPolicy(profile, selected);
  if (!releasePolicy.required) return releasePolicy;
  if (!state.pipeline.inputs.releaseReason.trim()) {
    state.pipeline.inputs.releaseReason = defaultReleaseReason(profile, selected);
  }
  if (!state.pipeline.inputs.releaseNotice.trim()) {
    state.pipeline.inputs.releaseNotice = defaultReleaseNotice(profile, selected);
  }
  persistWorkbenchState();
  return releaseInputPolicy(profile, selected);
}

function pipelineButtonDisabledReason(action, profile, selected) {
  if (action.disabled) return "MVP 暂未开放真实作废";
  const account = getAccount(profile);
  if (!hasCredentials(profile, account)) return "账号未配置";
  if (!selected) return "先选择服务";
  const releaseRequired = releaseRequiredForBranch(selected.codeBranch || state.activeBuildBranch);
  if (action.id === "release-existing" && !releaseRequired) return "当前分支无发布";
  if (action.id !== "build-only" && releaseRequired && !getReleaseEnv(profile)) {
    return "先选择发布环境";
  }
  if (state.pipeline.isRunning) return "Pipeline 正在执行";
  return "";
}

function serviceFromRow(row, profile = getProfile()) {
  if (!row) return null;
  return {
    profileId: profile.id,
    serviceKey: serviceRowKey(row, profile),
    imageJenkinsName: serviceName(row),
    imageNameEn: row.imageNameEn,
    applicationCode: row.applicationCode || state.activeApplicationCode,
    applicationName: row.applicationName || row.applicationCode || state.activeApplicationCode,
    codeBranch: row.codeBranch || state.activeBuildBranch,
    imageVersion: row.imageVersion,
    imageDeployId: row.imageDeployId,
    kubernetesVersion: row.kubernetesVersion,
    row
  };
}

function selectServiceRow(row, profile = getProfile(), options = {}) {
  const selected = serviceFromRow(row, profile);
  if (!selected) return null;
  if (options.append) {
    const current = getSelectedServices(profile).filter((item) => item.serviceKey !== selected.serviceKey);
    setSelectedServices([...current, selected]);
  } else if (options.toggle) {
    const current = getSelectedServices(profile);
    const exists = current.some((item) => item.serviceKey === selected.serviceKey);
    setSelectedServices(exists
      ? current.filter((item) => item.serviceKey !== selected.serviceKey)
      : [...current, selected]);
  } else {
    setSelectedServices([selected]);
  }
  ensurePipelineRun(profile);
  if (!options.silent) {
    const services = getSelectedServices(profile);
    addEvidence("服务已选中", `${selectedServicesLabel(services)} / ${selected.applicationCode} / ${selected.codeBranch}`, "blue");
  }
  return selected;
}

function servicePipelineLabel(action, profile, service) {
  const branchCode = service && service.codeBranch || state.activeBuildBranch;
  const env = getReleaseEnv(profile);
  const releaseNeeded = releaseRequiredForBranch(branchCode);
  if (action.id === "build-and-release") {
    if (!releaseNeeded) return "构建开发";
    return isProdEnv(env) ? "构建+发布正式" : "构建+发布测试";
  }
  if (action.id === "build-only") return "仅构建";
  if (action.id === "release-existing") return releaseNeeded ? "发布已有" : "无发布";
  if (action.id === "void-existing") return "作废";
  return action.shortTitle;
}

function servicePipelineDisabledReason(action, profile, service) {
  if (action.disabled) return "作废未开放";
  const reason = pipelineButtonDisabledReason(action, profile, service);
  if (reason === "先选择服务") return "";
  return reason;
}

function statusTone(status) {
  if (status === "succeeded") return "green";
  if (status === "failed" || status === "blocked") return "red";
  if (status === "waiting_confirmation" || status === "ready") return "yellow";
  return "blue";
}

function completedStageCount(plan) {
  return plan.stages.filter((stage) => ["succeeded", "skipped"].includes(stage.status)).length;
}

function buildStageCatalog(profile) {
  const account = getAccount(profile);
  const env = getReleaseEnv(profile);
  const selected = getSelectedService(profile);
  const selectedServices = getSelectedServices(profile);
  const flow = buildFlowForBranch(selected && selected.codeBranch || state.activeBuildBranch);
  const releaseNeeded = releaseRequiredForBranch(selected && selected.codeBranch || state.activeBuildBranch);
  const build = getProbe(profile.id, "build");
  const release = getProbe(profile.id, "release");
  const releaseApp = getReleaseApp(profile);
  const publishDetail = state.publishDetails[publishDetailKey(profile, env)];
  const taskState = currentTaskImageSnapshot(profile, selected);
  const taskSnapshot = taskState.taskSnapshot;
  const taskImage = taskState.image;
  const releasePendingCount = Number(releaseApp && releaseApp.toPublishServiceNum || 0);
  const buildPayloadPreview = selected ? buildPayload(profile, selected) : null;
  const releasePayloadPreview = selected && releaseApp ? releasePayload(profile, selected) : null;
  const releaseInputs = releaseInputPolicy(profile, selected);
  const buildConfirm = selected ? buildConfirmText(selected) : "";
  const publishConfirm = publishConfirmText(profile, env);
  const taskReady = Boolean(taskState.allBuildable || taskImage && taskImage.buildPower === "1");
  const allServiceDetailsReady = selectedServices.length > 0 && selectedServices.every((service) => service.detail && service.detail.ok);
  const allVersionsReady = flow.mode === "direct" || selectedServices.length > 0 && selectedServices.every((service) => service.generatedVersion);

  return {
    "target-ready": {
      title: "锁定目标",
      summary: `${profile.shortName} / ${state.activeApplicationCode} / ${state.activeBuildBranch} / ${env ? `${env.showNameEn}/${env.environmentFlag}` : "未选环境"}`,
      kind: "read",
      endpoint: "local state",
      done: Boolean(profile && account && state.activeApplicationCode && state.activeBuildBranch),
      missing: [
        profile ? "" : "profile",
        account ? "" : "account",
        state.activeApplicationCode ? "" : "applicationCode",
        state.activeBuildBranch ? "" : "codeBranch"
      ].filter(Boolean),
      actionLabel: "调整目标选择",
      retryFromStageId: "target-ready"
    },
    "account-ready": {
      title: "账号凭据",
      summary: `${account.label} / 构建平台 + 发布平台`,
      kind: "read",
      endpoint: "/api/config/credentials",
      done: hasCredentials(profile, account),
      missing: hasCredentials(profile, account) ? [] : ["credentials"],
      actionLabel: "进入系统配置",
      retryFromStageId: "account-ready"
    },
    "build-probe": {
      title: "探测构建平台",
      summary: "确认构建能力和服务清单。",
      kind: "read",
      endpoint: "/api/probe/build",
      done: Boolean(build && build.ok),
      failed: Boolean(build && !build.ok),
      missing: build ? [] : ["buildProbe"],
      canRun: hasCredentials(profile, account),
      actionLabel: "探测构建服务",
      retryFromStageId: "build-probe",
      evidence: build && build.ok ? [summarizeServiceDiscovery(build.serviceDiscovery)] : []
    },
    "release-probe": {
      title: "探测发布平台",
      summary: releaseNeeded ? "确认发布能力和环境记录。" : "当前分支不需要发布平台。",
      kind: "read",
      endpoint: "/api/probe/release",
      done: !releaseNeeded || Boolean(release && release.ok),
      skipped: !releaseNeeded,
      failed: Boolean(release && !release.ok),
      missing: !releaseNeeded || release ? [] : ["releaseProbe"],
      canRun: releaseNeeded && hasCredentials(profile, account),
      actionLabel: "探测发布环境",
      retryFromStageId: "release-probe",
      evidence: release && release.ok ? [`环境 ${release.environments.length} 个`] : []
    },
    "service-selected": {
      title: "选择服务",
      summary: selected ? `${selectedServicesLabel(selectedServices)} / ${selected.applicationCode} / ${selected.codeBranch}` : "等待从构建平台服务列表选择。",
      kind: "read",
      endpoint: "local state",
      done: Boolean(selectedServices.length),
      missing: selected ? [] : ["service"],
      actionLabel: "选择服务",
      retryFromStageId: "service-selected"
    },
    "build-status": {
      title: "读取构建状态",
      summary: "确认当前服务可进入构建链路。",
      kind: "read",
      endpoint: "/api/probe/build-service",
      done: allServiceDetailsReady,
      missing: selected ? allServiceDetailsReady ? [] : ["buildServiceDetail"] : ["service"],
      canRun: Boolean(selected),
      actionLabel: "读取构建状态",
      retryFromStageId: "build-status",
      evidence: selected && selected.detail && selected.detail.detail ? [`详情 ${selected.detail.detail.length} 条`] : []
    },
    "version-preflight": {
      title: "生成版本预检",
      summary: flow.mode === "direct" ? "开发直构建不要求任务版本预检。" : "为构建任务准备版本号。",
      kind: "read",
      endpoint: "/api/probe/image-version",
      done: allVersionsReady,
      skipped: flow.mode === "direct",
      missing: flow.mode === "direct" ? [] : allVersionsReady ? [] : ["imageVersion"],
      canRun: flow.mode !== "direct" && Boolean(selected),
      actionLabel: "生成版本预检",
      retryFromStageId: "version-preflight"
    },
    "create-build-task": {
      title: flow.mode === "direct" ? "执行开发构建" : "创建构建任务",
      summary: flow.mode === "direct" ? "直接触发构建 Stage。" : "提交构建 Stage 所需任务。",
      kind: "mutation",
      endpoint: flow.mode === "direct" ? "/api/execute/build" : "/api/execute/build-task",
      done: flow.mode !== "direct" && Boolean(taskState.allMatched || taskSnapshot && taskSnapshot.matchedTask),
      skipped: false,
      missing: selected ? [] : ["service"],
      actionLabel: flow.mode === "direct" ? "执行开发构建" : flow.actionLabel,
      retryFromStageId: "create-build-task",
      confirmText: buildConfirm,
      payloadPreview: buildPayloadPreview
    },
    "locate-build-task": {
      title: "定位任务服务行",
      summary: "读取构建任务并等待任务内构建开放。",
      kind: "read",
      endpoint: "/api/probe/build-tasks",
      done: flow.mode === "direct" || Boolean(taskState.allMatched || taskSnapshot && taskSnapshot.matchedImage),
      skipped: flow.mode === "direct",
      missing: flow.mode === "direct" ? [] : taskSnapshot ? [] : ["buildTaskSnapshot"],
      canRun: flow.mode !== "direct" && Boolean(selected),
      actionLabel: "读取构建任务",
      retryFromStageId: "locate-build-task",
      evidence: taskImage ? [`任务内构建${taskImage.buildPower === "1" ? "已开放" : "未开放"}`] : []
    },
    "task-image-build": {
      title: flow.mode === "direct" ? "开发构建结果" : "任务内构建",
      summary: flow.mode === "direct" ? "开发构建直接由上一阶段执行。" : "从已开放的任务服务行触发构建。",
      kind: "mutation",
      endpoint: "/api/execute/build",
      done: stageSucceeded("task-image-build"),
      skipped: flow.mode === "direct",
      missing: flow.mode === "direct" ? [] : taskReady ? [] : ["buildPower=1"],
      actionLabel: "从任务构建",
      retryFromStageId: "task-image-build",
      confirmText: taskImage ? `执行构建 ${selectedServicesLabel(selectedServices)}` : "",
      payloadPreview: taskImage ? {
        profileId: profile.id,
        accountId: account.id,
        customerNameEn: profile.customerNameEn,
        applicationCode: taskImage.applicationCode || selected.applicationCode,
        codeBranch: taskImage.codeBranch || selected.codeBranch,
        envType: taskImage.envType || selected.codeBranch,
        imageJenkinsName: taskImage.imageJenkinsName || taskImage.imageNameEn,
        buildImages: (taskState.images || []).map((item) => ({
          imageJenkinsName: item.imageJenkinsName || item.imageNameEn,
          imageNameEn: item.imageNameEn,
          imageVersion: item.imageVersion
        })),
        imageVersion: taskImage.imageVersion,
        applyId: taskState.task && taskState.task.structureApplyId
      } : null
    },
    "release-inputs": {
      title: "填充发布入参",
      summary: releaseInputs.summary,
      kind: "read",
      endpoint: "local pipeline inputs",
      done: !releaseNeeded || releaseInputs.missing.length === 0,
      skipped: !releaseNeeded,
      missing: !releaseNeeded ? [] : releaseInputs.missing,
      actionLabel: "填写发布理由/注意事项",
      retryFromStageId: "release-inputs",
      payloadPreview: {
        releaseReason: releaseInputs.reason || null,
        releaseNotice: releaseInputs.notice || null,
        requiredForEnvironment: releaseInputs.required ? envLabelForPipeline(env) : false
      }
    },
    "release-detail": {
      title: "读取发布清单",
      summary: "确认发布 Stage 可执行。",
      kind: "read",
      endpoint: "/api/probe/release-detail",
      done: !releaseNeeded || Boolean(publishDetail && publishDetail.ok),
      skipped: !releaseNeeded,
      missing: !releaseNeeded ? [] : [
        ...(releaseInputs.missing || []),
        ...(releaseApp ? publishDetail ? [] : ["releaseDetail"] : ["releaseApp"])
      ],
      canRun: releaseNeeded && Boolean(selected && releaseApp),
      actionLabel: "读取发布清单",
      retryFromStageId: "release-detail"
    },
    "publish-company": {
      title: "公司发布",
      summary: "发布平台第一段发布确认，仍使用原有强确认文本。",
      kind: "mutation",
      endpoint: "/api/execute/publish",
      done: false,
      skipped: !releaseNeeded,
      missing: !releaseNeeded ? [] : [
        ...(releaseInputs.missing || []),
        ...(releasePendingCount > 0 ? [] : ["toPublishServiceNum>0"])
      ],
      actionLabel: "真正发布",
      retryFromStageId: "publish-company",
      confirmText: publishConfirm,
      payloadPreview: releasePayloadPreview
    },
    "publish-spot": {
      title: "现场发布",
      summary: "公司发布完成后刷新发布平台，再进入现场发布确认。",
      kind: "mutation",
      endpoint: "/api/execute/publish",
      done: false,
      skipped: !releaseNeeded,
      missing: !releaseNeeded ? [] : [
        ...(releaseInputs.missing || []),
        "companyPublishEvidence"
      ],
      actionLabel: "刷新后继续现场发布",
      retryFromStageId: "publish-spot",
      confirmText: publishConfirm,
      payloadPreview: releasePayloadPreview ? { ...releasePayloadPreview, environment: "spot" } : null
    },
    "final-verify": {
      title: "最终核验",
      summary: "刷新 Pipeline 结果并核对医院环境版本。",
      kind: "read",
      endpoint: "/api/probe/*",
      done: false,
      missing: ["finalEvidence"],
      canRun: true,
      actionLabel: "刷新双平台",
      retryFromStageId: "final-verify"
    }
  };
}

function pipelineContext(profile) {
  const account = getAccount(profile);
  const env = getReleaseEnv(profile);
  const selected = getSelectedService(profile);
  const selectedServices = getSelectedServices(profile);
  const build = getProbe(profile.id, "build");
  const release = getProbe(profile.id, "release");
  const releaseApp = getReleaseApp(profile);
  const publishDetail = state.publishDetails[publishDetailKey(profile, env)];
  const taskState = currentTaskImageSnapshot(profile, selected);
  const taskSnapshot = taskState.taskSnapshot;
  const flow = buildFlowForBranch(selected && selected.codeBranch || state.activeBuildBranch);

  return {
    runId: state.pipeline.runKey || activePipelineKey(profile, selected),
    templateId: state.pipeline.templateId,
    mode: state.pipeline.executionMode,
    failedStageId: state.pipeline.failedStageId,
    profileId: profile.id,
    profileShortName: profile.shortName,
    profile,
    accountId: account && account.id,
    customerNameEn: profile.customerNameEn,
    applicationCode: state.activeApplicationCode,
    buildBranch: selected && selected.codeBranch || state.activeBuildBranch,
    releaseEnvironment: env,
    service: selected,
    serviceGroupKey: selectedServiceGroupKey(profile),
    services: selectedServices,
    inputs: {
      releaseReason: state.pipeline.inputs.releaseReason,
      releaseNotice: state.pipeline.inputs.releaseNotice
    },
    capabilities: {
      credentialsReady: hasCredentials(profile, account),
      buildProbeReady: Boolean(build && build.ok),
      releaseProbeReady: Boolean(release && release.ok),
      serviceSelected: Boolean(selectedServices.length),
      buildStatusReady: Boolean(selectedServices.length && selectedServices.every((service) => service.detail && service.detail.ok)),
      versionReady: flow.mode === "direct" || Boolean(selectedServices.length && selectedServices.every((service) => service.generatedVersion)),
      directBuildSucceeded: flow.mode === "direct" && stageSucceeded("create-build-task"),
      buildTaskCreated: stageSucceeded("create-build-task") || Boolean(taskState.allMatched || taskSnapshot && taskSnapshot.matchedTask),
      buildTaskLocated: Boolean(taskState.allMatched || taskSnapshot && taskSnapshot.matchedImage),
      taskBuildSucceeded: stageSucceeded("task-image-build"),
      releaseDetailReady: Boolean(publishDetail && publishDetail.ok),
      companyPublishSucceeded: stageSucceeded("publish-company"),
      spotPublishSucceeded: stageSucceeded("publish-spot"),
      finalVerified: stageSucceeded("final-verify"),
      releaseAppReady: Boolean(releaseApp)
    }
  };
}

function createPipelinePlan(profile) {
  ensurePipelineRun(profile);
  const run = window.PipelineCore.createPipelineRun(pipelineContext(profile));
  const catalog = buildStageCatalog(profile);
  const stages = run.stages.map((coreStage) => {
    const stage = catalog[coreStage.id] || {};
    const outcome = stageOutcome(coreStage.id);
    const mergedMissing = coreStage.missing && coreStage.missing.length ? coreStage.missing : stage.missing || [];
    const mergedCanRun = stage.canRun === undefined ? coreStage.canRun : stage.canRun;
    const missingShouldBlock = mergedMissing.length &&
      !(mergedCanRun && coreStage.kind === "read") &&
      !["succeeded", "skipped", "pending", "failed"].includes(coreStage.status)
    const mergedStatus = coreStage.status === "blocked" && mergedCanRun && coreStage.kind === "read"
      ? "ready"
      : missingShouldBlock ? "blocked" : coreStage.status;
    return {
      ...stage,
      ...coreStage,
      title: stage.title || coreStage.title,
      summary: stage.summary || coreStage.title,
      kind: stage.kind || coreStage.kind,
      endpoint: stage.endpoint || coreStage.actionKey,
      actionLabel: stage.actionLabel || window.PipelineAdapters.actionForStage(coreStage.id).label,
      missing: mergedMissing,
      status: mergedStatus,
      confirmText: stage.confirmText || window.PipelineAdapters.confirmationForStage(coreStage, {
        ...pipelineContext(profile),
        policy: run.policy,
        taskImageName: currentTaskImageSnapshot(profile, getSelectedService(profile)).image &&
          (currentTaskImageSnapshot(profile, getSelectedService(profile)).image.imageJenkinsName ||
            currentTaskImageSnapshot(profile, getSelectedService(profile)).image.imageNameEn)
      }),
      outcome
    };
  });
  const currentStage = stages.find((stage) => !["succeeded", "skipped", "pending"].includes(stage.status)) || null;
  for (const stage of stages) {
    stage.isCurrent = Boolean(currentStage && currentStage.id === stage.id);
  }
  const childPipelines = window.PipelineCore.createChildPipelines(stages);
  const current = currentStage;
  const failedStage = stages.find((stage) => stage.status === "failed") || null;
  const planStatus = failedStage
    ? "failed"
    : current
      ? current.status
      : stages.every((stage) => ["succeeded", "skipped"].includes(stage.status))
        ? "succeeded"
        : run.status;

  return {
    id: run.templateId,
    runId: run.id,
    title: run.title,
    description: run.description,
    scope: run.scope,
    executionMode: run.executionMode,
    decorators: run.decorators,
    childPipelines,
    stages,
    currentStage: current,
    inspectedStage: stages.find((stage) => stage.id === state.pipeline.inspectedStageId) || current,
    failedStage,
    status: planStatus,
    retryFromStageId: run.retryFromStageId
  };
}

function availableBuildBranches(profile) {
  const byCode = new Map(BASE_BRANCHES.map((branch) => [branch.code, branch]));
  const build = getProbe(profile.id, "build");
  const discovery = build && build.serviceDiscovery && build.serviceDiscovery.find((item) => item.applicationCode === state.activeApplicationCode);
  for (const branch of discovery ? discovery.branches || [] : []) {
    if (branch.codeBranch && !byCode.has(branch.codeBranch)) {
      byCode.set(branch.codeBranch, {
        code: branch.codeBranch,
        label: `${branch.codeBranch} 构建分支`,
        releaseRequired: branch.codeBranch !== "develop",
        hint: "来自构建平台命名空间。"
      });
    }
  }

  return Array.from(byCode.values());
}

function normalizeSelections(profile) {
  if (!profile) return;
  if (!profile.accounts.some((account) => account.id === state.activeAccountId)) {
    state.activeAccountId = profile.accounts[0].id;
  }
  if (!profile.applications.some((app) => app.code === state.activeApplicationCode)) {
    state.activeApplicationCode = profile.applications[0].code;
  }
  if (!profile.releaseEnvironments.some((env) => env.id === state.activeReleaseEnvId)) {
    state.activeReleaseEnvId = profile.releaseEnvironments[0] && profile.releaseEnvironments[0].id;
  }
  const branches = availableBuildBranches(profile);
  if (!branches.some((branch) => branch.code === state.activeBuildBranch)) {
    state.activeBuildBranch = recommendBranchForEnv(getReleaseEnv(profile));
  }
  const validSelected = getSelectedServices(profile);
  if ((state.selectedServices || []).length && !validSelected.length) {
    clearSelectedServices();
  }
}

function switchProfile(profileId) {
  state.activeProfileId = profileId;
  const profile = getProfile();
  state.activeAccountId = profile.accounts[0].id;
  state.activeApplicationCode = profile.applications[0].code;
  state.activeReleaseEnvId = profile.releaseEnvironments[0].id;
  state.activeBuildBranch = recommendBranchForEnv(profile.releaseEnvironments[0]);
  state.serviceSearch = "";
  clearSelectedServices();
}

function applyGamPrescriptionProdPreset() {
  state.activeProfileId = "demob";
  const profile = getProfile();
  state.activeAccountId = "demo_prod";
  state.activeApplicationCode = "mem";
  state.activeReleaseEnvId = "demob-prod-a";
  state.activeBuildBranch = "master";
  state.serviceSearch = "prescription";
  clearSelectedServices();
  const branch = getBranchDiscovery(profile);
  const row = branch && (branch.rows || []).find((item) => {
    const name = serviceName(item).toLowerCase();
    return name.includes("prescription") && name.includes("mem") && (item.codeBranch || state.activeBuildBranch) === "master";
  });
  if (row) {
    selectServiceRow(row, profile, { silent: true });
    addEvidence("演示服务已定位", `${serviceName(row)} / mem / master`, "green");
  } else {
    addEvidence("演示服务测试入口", "已切换到演示客户B mem/master/prod-demo-b，并过滤 prescription；若服务未出现，请先等待自动探测或手动刷新构建平台。", "blue");
  }
}

function serviceName(row) {
  return row.imageJenkinsName || row.serviceNameEn || row.microServiceName || row.serviceName || "unknown-service";
}

function getAppDiscovery(profile = getProfile()) {
  const build = getProbe(profile.id, "build");
  if (!build || !build.ok || !Array.isArray(build.serviceDiscovery)) return null;
  return build.serviceDiscovery.find((item) => item.applicationCode === state.activeApplicationCode) || null;
}

function getBranchDiscovery(profile = getProfile()) {
  const app = getAppDiscovery(profile);
  if (!app) return null;
  return (app.branches || []).find((branch) => branch.codeBranch === state.activeBuildBranch) || null;
}

function getBranchNamespace(profile = getProfile()) {
  const app = getAppDiscovery(profile);
  if (!app) return null;
  const namespaceInfo = (app.namespaces || []).find((item) =>
    item.codeBranch === state.activeBuildBranch ||
    item.envType === state.activeBuildBranch ||
    item.showNameEn === state.activeBuildBranch
  );
  return namespaceInfo && namespaceInfo.namespace;
}

function getBranchEnvironment(profile = getProfile()) {
  const app = getAppDiscovery(profile);
  if (!app) return null;
  return (app.namespaces || []).find((item) =>
    item.codeBranch === state.activeBuildBranch ||
    item.envType === state.activeBuildBranch ||
    item.showNameEn === state.activeBuildBranch
  ) || null;
}

function serviceRowKey(row, profile = getProfile()) {
  if (!row) return "";
  return row.serviceKey || [
    row.customerNameEn || profile.customerNameEn,
    row.applicationCode || state.activeApplicationCode,
    row.codeBranch || state.activeBuildBranch,
    serviceName(row)
  ].filter(Boolean).join("::");
}

function findServiceRowByKey(key, profile = getProfile()) {
  const app = getAppDiscovery(profile);
  if (!app || !key) return null;
  for (const branch of app.branches || []) {
    const row = (branch.rows || []).find((item) => serviceRowKey(item, profile) === key);
    if (row) return row;
  }
  return null;
}

function hydrateSelectedService(selected, profile = getProfile()) {
  if (!selected || selected.profileId !== profile.id) return null;
  const row = findServiceRowByKey(selected.serviceKey, profile);
  if (!row) return null;
  return {
    ...selected,
    ...row,
    row,
    serviceKey: selected.serviceKey,
    imageJenkinsName: serviceName(row),
    applicationCode: row.applicationCode || selected.applicationCode || state.activeApplicationCode,
    codeBranch: row.codeBranch || selected.codeBranch || state.activeBuildBranch
  };
}

function getSelectedServices(profile = getProfile()) {
  const source = Array.isArray(state.selectedServices) && state.selectedServices.length
    ? state.selectedServices
    : state.selectedService ? [state.selectedService] : [];
  const seen = new Set();
  return source
    .map((item) => hydrateSelectedService(item, profile))
    .filter((item) => {
      if (!item || seen.has(item.serviceKey)) return false;
      seen.add(item.serviceKey);
      return true;
    });
}

function getSelectedService(profile = getProfile()) {
  return getSelectedServices(profile)[0] || null;
}

function setSelectedServices(services) {
  const normalized = services.filter(Boolean).map((item) => ({
    profileId: item.profileId,
    serviceKey: item.serviceKey,
    generatedVersion: item.generatedVersion,
    detail: item.detail || null
  }));
  state.selectedServices = normalized;
  state.selectedService = normalized[0] || null;
}

function clearSelectedServices() {
  state.selectedServices = [];
  state.selectedService = null;
}

function updateSelectedServiceMeta(serviceKey, patch) {
  state.selectedServices = getSelectedServices().map((item) => {
    if (item.serviceKey !== serviceKey) return {
      profileId: item.profileId,
      serviceKey: item.serviceKey,
      generatedVersion: item.generatedVersion,
      detail: item.detail || null
    };
    return {
      profileId: item.profileId,
      serviceKey: item.serviceKey,
      generatedVersion: patch.generatedVersion !== undefined ? patch.generatedVersion : item.generatedVersion,
      detail: patch.detail !== undefined ? patch.detail : item.detail || null
    };
  });
  state.selectedService = state.selectedServices[0] || null;
}

function selectedServicesLabel(services = getSelectedServices()) {
  if (!services.length) return "未选择服务";
  if (services.length === 1) return services[0].imageJenkinsName;
  return `${services.length} 个服务`;
}

function buildConfirmText(selected = getSelectedService()) {
  const services = Array.isArray(selected) ? selected : getSelectedServices();
  const primary = Array.isArray(selected) ? services[0] : selected;
  const flow = buildFlowForBranch(primary && primary.codeBranch);
  const verb = flow.mode === "direct" ? "执行构建" : "创建构建任务";
  return `${verb} ${selectedServicesLabel(services)}`.trim();
}

function publishConfirmText(profile, env) {
  return `发布 ${profile.shortName} ${state.activeApplicationCode} ${env.showNameEn}/${env.environmentFlag}`;
}

function publishDetailKey(profile = getProfile(), env = getReleaseEnv(profile)) {
  return [profile.id, state.activeApplicationCode, env && env.showNameEn, env && env.environmentFlag].filter(Boolean).join("::");
}

function buildTaskKey(profile = getProfile()) {
  return [profile.id, state.activeApplicationCode, state.activeBuildBranch].filter(Boolean).join("::");
}

function structureConfigKey(profile = getProfile()) {
  return [profile.id, state.activeApplicationCode, state.activeBuildBranch].filter(Boolean).join("::");
}

function getReleaseCard(profile = getProfile()) {
  const release = getProbe(profile.id, "release");
  const env = getReleaseEnv(profile);
  if (!release || !release.ok || !env) return null;
  return (release.environments || []).find((card) => {
    const current = card.environment || {};
    return current.showNameEn === env.showNameEn && current.environmentFlag === env.environmentFlag;
  }) || null;
}

function getReleaseApp(profile = getProfile()) {
  const card = getReleaseCard(profile);
  if (!card) return null;
  return (card.apps || []).find((app) => app.applicationCode === state.activeApplicationCode) || null;
}

function currentTaskImageSnapshot(profile = getProfile(), selected = getSelectedService(profile)) {
  const taskSnapshot = state.buildTasks[buildTaskKey(profile)];
  const services = getSelectedServices(profile);
  if (!taskSnapshot) {
    return {
      taskSnapshot: null,
      taskImages: [],
      task: null,
      image: null,
      images: [],
      missingServices: services.map((item) => item.imageJenkinsName)
    };
  }
  const selectedName = selected && selected.imageJenkinsName;
  const selectedImageNameEn = selected && selected.imageNameEn;
  const selectedVersion = selected && selected.generatedVersion;
  const matchedImage = taskSnapshot.matchedImage || null;
  const matchedTask = taskSnapshot.matchedTask || null;
  const fallbackImages = taskSnapshot.matchedTaskImages && taskSnapshot.matchedTaskImages.length
    ? taskSnapshot.matchedTaskImages
    : taskSnapshot.firstTaskImages || [];
  const groups = Array.isArray(taskSnapshot.taskImagesByTask) && taskSnapshot.taskImagesByTask.length
    ? taskSnapshot.taskImagesByTask
    : [{ task: matchedTask || (taskSnapshot.tasks && taskSnapshot.tasks[0]) || null, images: fallbackImages }];
  const serviceMatches = [];
  let matchedGroup = null;
  for (const group of groups) {
    const images = group.images || [];
    const matches = services.map((service) => images.find((item) =>
      (!service.imageJenkinsName || item.imageJenkinsName === service.imageJenkinsName || item.imageNameEn === service.imageNameEn) &&
      (!service.imageNameEn || item.imageNameEn === service.imageNameEn || item.imageJenkinsName === service.imageJenkinsName || !item.imageNameEn) &&
      (!service.generatedVersion || item.imageVersion === service.generatedVersion)
    ) || null);
    if (services.length && matches.every(Boolean)) {
      matchedGroup = group;
      serviceMatches.push(...matches);
      break;
    }
  }
  const fallbackImage = fallbackImages.find((item) =>
    item.buildPower === "1" &&
    (!selectedName || item.imageJenkinsName === selectedName) &&
    (!selectedImageNameEn || item.imageNameEn === selectedImageNameEn) &&
    (!selectedVersion || item.imageVersion === selectedVersion)
  );
  const images = serviceMatches.length ? serviceMatches : (matchedImage || fallbackImage ? [matchedImage || fallbackImage] : []);
  const missingServices = services.filter((service) => !images.some((item) =>
    item && (item.imageJenkinsName === service.imageJenkinsName || item.imageNameEn === service.imageNameEn) &&
    (!service.generatedVersion || item.imageVersion === service.generatedVersion)
  )).map((service) => service.imageJenkinsName);
  return {
    taskSnapshot,
    taskImages: matchedGroup && matchedGroup.images || fallbackImages,
    task: matchedGroup && matchedGroup.task || matchedTask || (taskSnapshot.tasks && taskSnapshot.tasks[0]) || null,
    image: images[0] || null,
    images,
    missingServices,
    allMatched: Boolean(services.length && !missingServices.length),
    allBuildable: Boolean(services.length && !missingServices.length && images.every((item) => item && item.buildPower === "1"))
  };
}

function field(label, value) {
  return `
    <div class="field-box">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value || "未选择")}</strong>
    </div>
  `;
}

function statusTone(done, warning = false) {
  if (done) return "green";
  if (warning) return "yellow";
  return "gray";
}

function summarizeFailure(result) {
  if (!result) return "未知错误";
  return result.error ||
    result.reason ||
    result.detail && (result.detail.reason || result.detail.error) ||
    result.detail && result.detail.image && `buildPower=${result.detail.image.buildPower || "0"} 不允许构建` ||
    result.businessMessage ||
    result.response && (result.response.businessMessage || result.response.message || result.response.msg || result.response.error) ||
    result.response && result.response.object && (result.response.object.msg || result.response.object.message || result.response.object.errMsg) ||
    result.versionProbe && (result.versionProbe.reason || result.versionProbe.response && result.versionProbe.response.message) ||
    result.versionProbe && result.versionProbe.response && result.versionProbe.response.object && (result.versionProbe.response.object.msg || result.versionProbe.response.object.message) ||
    (result.session && (result.session.error || result.session.reason || result.session.message)) ||
    JSON.stringify(result).slice(0, 240);
}

function summarizeServiceDiscovery(items = []) {
  if (!items.length) return "服务发现未返回数据";
  return items.map((item) => {
    if (item.error) return `${item.applicationCode}: ${item.error}`;
    const branchSummary = (item.branches || [])
      .map((branch) => `${branch.codeBranch}:${branch.total || 0}`)
      .join("/");
    return `${item.applicationCode}: total ${item.microservices ? item.microservices.total : 0}${branchSummary ? ` (${branchSummary})` : ""}`;
  }).join("；");
}

function renderProfiles() {
  els.profileList.innerHTML = "";
  for (const profile of state.bootstrap.profiles) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `profile-card ${profile.id === state.activeProfileId ? "active" : ""}`;
    button.innerHTML = `
      <strong>${escapeHtml(profile.shortName)}</strong>
      <span>${escapeHtml(profile.customerNameEn)}</span>
      <div class="tag-row">
        ${profile.applications.map((app) => `<span class="tag">${escapeHtml(app.code)}</span>`).join("")}
        <span class="tag">${profile.accounts.length} account</span>
      </div>
    `;
    button.addEventListener("click", () => {
      switchProfile(profile.id);
      render();
    });
    els.profileList.append(button);
  }
}

function renderContext(profile) {
  const build = getProbe(profile.id, "build");
  const release = getProbe(profile.id, "release");
  const account = getAccount(profile);
  const releaseEnv = getReleaseEnv(profile);
  els.currentContext.textContent = `${profile.hospitalName} / ${account.label}`;
  const readiness = build && build.ok && (state.activeBuildBranch === "develop" || release && release.ok)
    ? "双平台就绪"
    : build && build.ok
      ? "构建就绪"
      : "等待探测";
  els.operationSummary.textContent = `${state.activeApplicationCode} · ${state.activeBuildBranch} · ${releaseEnv ? releaseEnv.label : "无发布环境"} · ${readiness}`;
  els.lastRefresh.textContent = `刷新 ${formatTime(new Date(state.bootstrap.generatedAt))}`;
}

function formatStageStatus(status) {
  return window.PipelineCore.formatStageStatus(status);
}

function formatMissingItem(item) {
  const labels = {
    buildProbe: "构建探测",
    releaseProbe: "发布探测",
    service: "服务选择",
    buildServiceDetail: "构建状态",
    imageVersion: "版本预检",
    buildTaskSnapshot: "构建任务",
    "buildPower=1": "任务内构建开放",
    releaseDetail: "发布清单",
    releaseApp: "发布应用",
    "toPublishServiceNum>0": "待发布记录",
    companyPublishEvidence: "公司发布完成",
    finalEvidence: "最终核验"
  };
  return labels[item] || item;
}

function missingNotice(stage) {
  return stage && stage.missing && stage.missing.length
    ? `<div class="notice warn">等待：${escapeHtml(stage.missing.map(formatMissingItem).join(" / "))}</div>`
    : "";
}

function renderPipelineRunner(profile) {
  if (!els.pipelineRunner) return;
  const plan = createPipelinePlan(profile);
  const inspected = plan.inspectedStage;
  const selected = getSelectedService(profile);
  const selectedServices = getSelectedServices(profile);
  const releasePolicy = releaseInputPolicy(profile, getSelectedService(profile));
  const nextActionLabel = plan.currentStage && plan.currentStage.actionLabel || "等待输入";
  const progressText = `${completedStageCount(plan)}/${plan.stages.length}`;
  const progressValue = plan.stages.length ? Math.round(completedStageCount(plan) / plan.stages.length * 100) : 0;
  const visibleProgressText = selectedServices.length ? progressText : "未启动";
  const visibleProgressValue = selectedServices.length ? progressValue : 0;
  const missing = missingNotice(inspected);
  const confirm = inspected && inspected.confirmText
    ? `<div class="notice danger">确认文本：${escapeHtml(inspected.confirmText)}</div>`
    : "";
  const evidence = inspected && inspected.evidence && inspected.evidence.length
    ? `<div class="pipeline-evidence">${inspected.evidence.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>`
    : "";
  const releaseInputs = selected && releasePolicy.required ? `
    <section class="pipeline-inputs pipeline-quick-inputs">
      <div class="pipeline-input-policy">
        <strong>发布说明</strong>
        <span>构建完成后自动带入发布阶段；留空时按服务和环境生成默认值。</span>
      </div>
      <label>
        发布理由
        <textarea data-input="pipeline-release-reason" rows="2" placeholder="${escapeHtml(defaultReleaseReason(profile, selected))}">${escapeHtml(state.pipeline.inputs.releaseReason)}</textarea>
      </label>
      <label>
        注意事项
        <textarea data-input="pipeline-release-notice" rows="2" placeholder="${escapeHtml(defaultReleaseNotice(profile, selected))}">${escapeHtml(state.pipeline.inputs.releaseNotice)}</textarea>
      </label>
    </section>
  ` : "";
  const currentStage = inspected || plan.currentStage;
  const currentStageCard = currentStage ? `
    <section class="stage-focus-card ${escapeHtml(currentStage.status)}">
      <div>
        <span class="status ${currentStage.status === "succeeded" ? "green" : currentStage.status === "failed" || currentStage.status === "blocked" ? "red" : currentStage.status === "waiting_confirmation" ? "yellow" : "blue"}">${escapeHtml(formatStageStatus(currentStage.status))}</span>
        <strong>${escapeHtml(currentStage.title)}</strong>
        <p>${escapeHtml(currentStage.summary)}</p>
      </div>
      <div class="stage-focus-actions">
        ${missing}
        ${stageActionButton(currentStage)}
      </div>
    </section>
  ` : `
    <section class="stage-focus-card pending">
      <div>
        <span class="status gray">idle</span>
        <strong>等待 Pipeline</strong>
        <p>从服务行启动一个常用 Pipeline。</p>
      </div>
    </section>
  `;
  const runActivity = state.pipeline.activity || [];
  const runActivityHtml = state.pipeline.runStarted ? `
    <section class="run-activity">
      <div class="section-subhead compact">
        <div>
          <strong>Run 活动日志</strong>
          <span>阶段日志属于当前 Pipeline Run，不再混在全局诊断里。</span>
        </div>
      </div>
      <div class="timeline run-timeline">
        ${runActivity.length ? runActivity.slice(0, 12).map((item) => `
          <div class="timeline-item">
            <span>${escapeHtml(item.at)}</span>
            <div>
              <strong>${escapeHtml(item.title)}</strong>
              <p>${escapeHtml(item.detail)}</p>
            </div>
            <em class="status ${escapeHtml(item.tone)}">${escapeHtml(item.tone)}</em>
          </div>
        `).join("") : `
          <div class="timeline-item">
            <span>${escapeHtml(formatTime())}</span>
            <div><strong>Run 已创建</strong><p>等待第一个阶段动作。</p></div>
            <em class="status gray">idle</em>
          </div>
        `}
      </div>
    </section>
  ` : "";
  const stageTrack = selectedServices.length ? `
    <div class="pipeline-grid">
      <div class="pipeline-track">
        <div class="pipeline-child-list">
          ${plan.childPipelines.map((child) => `
            <div class="pipeline-child ${child.status}">
              <strong>${escapeHtml(child.title)}</strong>
              <span>${escapeHtml(formatStageStatus(child.status))} · ${child.stages.length} Stage</span>
            </div>
          `).join("")}
        </div>
        <div class="pipeline-stage-list">
          ${plan.stages.map((stage) => `
            <button class="pipeline-stage ${stage.status} ${stage.isCurrent ? "current" : ""}" type="button" data-pipeline-stage="${escapeHtml(stage.id)}">
              <span>${stage.index + 1}</span>
              <div>
                <strong>${escapeHtml(stage.title)}</strong>
                <small>${escapeHtml(stage.summary)}</small>
              </div>
              <em class="status ${stage.status === "succeeded" ? "green" : stage.status === "blocked" || stage.status === "failed" ? "red" : stage.status === "waiting_confirmation" ? "yellow" : "gray"}">${escapeHtml(formatStageStatus(stage.status))}</em>
            </button>
          `).join("")}
        </div>
      </div>
    </div>
  ` : "";

  els.pipelineRunner.innerHTML = `
    <section class="pipeline-launcher">
      <div class="pipeline-run-state">
        <span class="status ${selected ? state.pipeline.isRunning ? "blue" : statusTone(plan.status) : "gray"}">${escapeHtml(selected ? state.pipeline.isRunning ? "执行中" : formatStageStatus(plan.status) : "待服务")}</span>
        <strong>${escapeHtml(selectedServices.length ? selectedServicesLabel(selectedServices) : "等待服务行启动")}</strong>
        <small>${escapeHtml(selectedServices.length ? `${plan.title} · ${progressText} Stage` : "从服务行直接启动构建、发布或作废 Pipeline。")}</small>
      </div>
      <div class="pipeline-progress">
        <div>
          <strong>${escapeHtml(plan.title)}</strong>
          <span>${escapeHtml(selectedServices.length ? state.pipeline.isRunning ? `正在执行：${nextActionLabel}` : `当前 Stage：${nextActionLabel}` : "尚未创建 Run。")}</span>
        </div>
        <em>${escapeHtml(visibleProgressText)}</em>
        <div class="progress-bar"><span style="width:${visibleProgressValue}%"></span></div>
      </div>
    </section>
    ${releaseInputs}
    ${currentStageCard}
    ${runActivityHtml}
    ${stageTrack}
    <details class="pipeline-debug">
      <summary>Stage 诊断与重试</summary>
      <aside class="pipeline-detail">
        ${inspected ? `
          <div class="pipeline-decorators">
            ${plan.decorators.map((decorator) => `<span title="${escapeHtml(decorator.description)}">${escapeHtml(decorator.title)}</span>`).join("")}
          </div>
          <div class="action-title">
            <div>
              <strong>${escapeHtml(inspected.title)}</strong>
              <p>${escapeHtml(inspected.summary)}</p>
            </div>
            <span class="status ${inspected.kind === "mutation" ? "red" : "blue"}">${escapeHtml(inspected.kind)}</span>
          </div>
          <div class="field-grid compact-fields">
            ${field("重试起点", inspected.retryFromStageId)}
            ${field("动作", inspected.actionLabel)}
            ${field("状态", formatStageStatus(inspected.status))}
          </div>
          ${missing}
          ${confirm}
          ${evidence}
          <div class="button-row">
            ${stageActionButton(inspected)}
            <button class="button button-secondary" data-reset-pipeline-run="1">重建 Pipeline</button>
          </div>
        ` : "<div class='empty-state'><strong>暂无阶段</strong><p>等待 pipeline 生成。</p></div>"}
      </aside>
    </details>
  `;
}

function stageActionButton(stage) {
  if (!stage) return "";
  const attrs = `data-stage-action="${escapeHtml(stage.id)}"`;
  if (stage.status === "failed") {
    return `<button class="button button-danger" data-stage-retry="${escapeHtml(stage.id)}">从此阶段重试</button>`;
  }
  const disabled = stage.status === "blocked" || stage.status === "skipped" ? "disabled" : "";
  if (stage.id === "account-ready") {
    return `<button class="button button-secondary" ${attrs}>进入系统配置</button>`;
  }
  if (stage.id === "build-probe") {
    return `<button class="button button-secondary" ${attrs} ${disabled}>探测构建服务</button>`;
  }
  if (stage.id === "release-probe") {
    return `<button class="button button-secondary" ${attrs} ${disabled}>探测发布环境</button>`;
  }
  if (stage.id === "build-status") {
    return `<button class="button button-secondary" ${attrs} ${disabled}>读取构建状态</button>`;
  }
  if (stage.id === "version-preflight") {
    return `<button class="button button-secondary" ${attrs} ${disabled}>生成版本预检</button>`;
  }
  if (stage.id === "create-build-task") {
    return `<button class="button button-danger" ${attrs} ${disabled}>${escapeHtml(stage.actionLabel)}</button>`;
  }
  if (stage.id === "locate-build-task") {
    return `<button class="button button-secondary" ${attrs} ${disabled}>读取构建任务</button>`;
  }
  if (stage.id === "task-image-build") {
    return `<button class="button button-danger" ${attrs} ${disabled}>从任务构建</button>`;
  }
  if (stage.id === "release-detail") {
    return `<button class="button button-secondary" ${attrs} ${disabled}>读取发布清单</button>`;
  }
  if (stage.id === "release-inputs") {
    return `<button class="button button-secondary" ${attrs} ${disabled}>保存发布入参</button>`;
  }
  if (stage.id === "publish-company" || stage.id === "publish-spot") {
    return `<button class="button button-danger" ${attrs} ${disabled}>真正发布</button>`;
  }
  if (stage.id === "final-verify") {
    return `<button class="button button-primary" ${attrs}>刷新双平台</button>`;
  }
  return `<button class="button button-secondary" ${attrs}>查看阶段</button>`;
}

function renderTargetPicker(profile) {
  const account = getAccount(profile);
  const releaseEnv = getReleaseEnv(profile);
  const branches = availableBuildBranches(profile);

  els.targetPicker.innerHTML = `
    <div class="target-grid">
      <label>
        账号
        <select data-select="account">
          ${profile.accounts.map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === account.id ? "selected" : ""}>${escapeHtml(item.label)}</option>`).join("")}
        </select>
      </label>
      <label>
        应用分类
        <select data-select="application">
          ${profile.applications.map((item) => `<option value="${escapeHtml(item.code)}" ${item.code === state.activeApplicationCode ? "selected" : ""}>${escapeHtml(item.code)} - ${escapeHtml(item.name)}</option>`).join("")}
        </select>
      </label>
      <label>
        构建分支
        <select data-select="branch">
          ${branches.map((item) => `<option value="${escapeHtml(item.code)}" ${item.code === state.activeBuildBranch ? "selected" : ""}>${escapeHtml(item.code)} - ${escapeHtml(item.label)}</option>`).join("")}
        </select>
      </label>
      <label>
        发布目标环境
        <select data-select="release-env" ${state.activeBuildBranch === "develop" ? "disabled" : ""}>
          ${profile.releaseEnvironments.map((env) => `<option value="${escapeHtml(env.id)}" ${env.id === releaseEnv.id ? "selected" : ""}>${escapeHtml(env.showNameEn)}/${escapeHtml(env.environmentFlag)} - ${escapeHtml(env.label)}</option>`).join("")}
        </select>
      </label>
    </div>
    <div class="branch-hint">
      ${escapeHtml((branches.find((item) => item.code === state.activeBuildBranch) || {}).hint || "")}
    </div>
    <label class="search-field">
      搜索/过滤服务列表
      <input data-input="service-search" value="${escapeHtml(state.serviceSearch)}" placeholder="只过滤构建平台已返回的服务；不会创建手工服务">
    </label>
    ${profile.id === "demob" ? `
      <div class="preset-row">
        <button class="button button-secondary" type="button" data-preset="demob-prescription-prod">演示服务测试入口</button>
        <span>切到 mem / master / prod-demo-b，并过滤 prescription。</span>
      </div>
    ` : ""}
  `;
}

function renderSessions(profile) {
  els.sessionCards.innerHTML = "";
  for (const account of profile.accounts) {
    const configured = hasCredentials(profile, account);
    const config = credentialConfigFor(profile, account) || {};
    const sourceLabel = config.source === "saved" ? "应用内保存" : config.source === "env" ? "环境变量" : "未配置";
    const card = document.createElement("div");
    card.className = "session-card";
    card.innerHTML = `
      <div>
        <strong>${escapeHtml(account.label)}</strong>
        <p>${escapeHtml(account.scopeNote)}</p>
        <div class="tag-row">
        ${account.platforms.map((platform) => `<span class="tag">${platform === "build" ? "构建平台" : "发布平台"}</span>`).join("")}
          <span class="tag ${configured ? "tag-ok" : "tag-warn"}">${configured ? sourceLabel : "缺少凭据"}</span>
        </div>
      </div>
      <div class="button-stack">
        <button class="button button-secondary" data-probe="build" data-account="${escapeHtml(account.id)}" ${configured ? "" : "disabled"}>探测构建服务</button>
        <button class="button button-secondary" data-probe="release" data-account="${escapeHtml(account.id)}" ${configured ? "" : "disabled"}>探测发布环境</button>
        <button class="button button-primary" data-probe="both" data-account="${escapeHtml(account.id)}" ${configured ? "" : "disabled"}>双平台刷新</button>
      </div>
      ${configured ? "" : "<div class='notice warn'>先在系统配置里保存账号密码，或通过环境变量注入，再执行平台探测。</div>"}
    `;
    els.sessionCards.append(card);
  }
}

function renderServiceChooser(profile) {
  const build = getProbe(profile.id, "build");
  const app = getAppDiscovery(profile);
  const branch = getBranchDiscovery(profile);
  const selected = getSelectedService(profile);

  if (!build) {
    els.buildProbeState.className = "status gray";
    els.buildProbeState.textContent = "未探测";
    els.serviceChooser.innerHTML = `
      <div class="empty-state">
        <strong>先探测构建平台</strong>
        <p>拿到当前医院在 emr/mem 下可构建的服务清单后，这里才会出现服务选择。</p>
      </div>
    `;
    return;
  }

  if (!build.ok) {
    els.buildProbeState.className = "status red";
    els.buildProbeState.textContent = "失败";
    els.serviceChooser.innerHTML = `
      <div class="empty-state error-state">
        <strong>构建平台探测失败</strong>
        <p>${escapeHtml(summarizeFailure(build))}</p>
      </div>
    `;
    return;
  }

  els.buildProbeState.className = "status green";
  els.buildProbeState.textContent = "已探测";

  if (!app) {
    els.serviceChooser.innerHTML = `
      <div class="empty-state">
        <strong>当前应用没有返回服务清单</strong>
        <p>${escapeHtml(summarizeServiceDiscovery(build.serviceDiscovery))}</p>
      </div>
    `;
    return;
  }

  if (!branch) {
    const branchButtons = (app.branches || []).map((item) => `
      <button class="branch-switch" data-switch-branch="${escapeHtml(item.codeBranch)}">${escapeHtml(item.codeBranch)} · ${item.total || 0}</button>
    `).join("");
    els.serviceChooser.innerHTML = `
      <div class="empty-state">
        <strong>${escapeHtml(state.activeBuildBranch)} 没有返回服务</strong>
        <p>构建平台当前可用分支如下，点击切换。</p>
        <div class="branch-switch-list">${branchButtons || "<span>无分支数据</span>"}</div>
      </div>
    `;
    return;
  }

  const query = state.serviceSearch.trim().toLowerCase();
  const rows = (branch.rows || []).filter((row) => !query || serviceName(row).toLowerCase().includes(query));
  const selectedServices = getSelectedServices(profile);
  const selectedKeys = new Set(selectedServices.map((item) => item.serviceKey));
  const selectedCount = selectedServices.length;
  const groupActions = COMMON_PIPELINES.filter((action) => action.id !== "void-existing").map((action) => {
    const disabledReason = pipelineButtonDisabledReason(action, profile, getSelectedService(profile));
    const toneClass = action.tone === "primary" ? "button-primary" : "button-secondary";
    return `<button class="button ${toneClass}" data-selected-pipeline="${escapeHtml(action.id)}" ${disabledReason ? "disabled" : ""}>${escapeHtml(disabledReason || action.shortTitle)}</button>`;
  }).join("");
  els.serviceChooser.innerHTML = `
    <div class="chooser-head">
      <div>
        <strong>${escapeHtml(rows.length)} 个可用服务</strong>
        <p>可单服务快速启动，也可勾选多个服务生成同一个环境任务。</p>
      </div>
      ${selectedCount ? `<span class="status blue">已选 ${selectedCount}</span>` : "<span class='status yellow'>待选服务</span>"}
    </div>
    ${selectedCount ? `
      <div class="bulk-pipeline-bar">
        <div>
          <strong>${escapeHtml(selectedServicesLabel(selectedServices))}</strong>
          <span>同一 ${escapeHtml(state.activeApplicationCode)} / ${escapeHtml(state.activeBuildBranch)} 构建任务</span>
        </div>
        <div class="service-actions">${groupActions}</div>
      </div>
    ` : ""}
    <div class="service-list">
      ${rows.map((row) => {
        const name = serviceName(row);
        const key = serviceRowKey(row, profile);
        const active = selectedKeys.has(key);
        const service = serviceFromRow(row, profile);
        const flow = buildFlowForBranch(service.codeBranch);
        const releaseNeeded = releaseRequiredForBranch(service.codeBranch);
        const serviceActions = COMMON_PIPELINES.map((action) => {
          const disabledReason = servicePipelineDisabledReason(action, profile, service);
          const disabled = disabledReason ? "disabled" : "";
          const toneClass = action.tone === "primary" ? "button-primary" : action.tone === "danger" ? "button-danger" : "button-secondary";
          const label = disabledReason || servicePipelineLabel(action, profile, service);
          return `<button class="button ${toneClass}" data-service-pipeline="${escapeHtml(action.id)}" data-service-key="${escapeHtml(key)}" ${disabled}>${escapeHtml(label)}</button>`;
        }).join("");
        return `
          <article class="service-row service-job-row ${active ? "active" : ""}">
            <button class="service-select-button" data-service-select="${escapeHtml(key)}" type="button">
              <span><em class="select-box">${active ? "✓" : ""}</em>${escapeHtml(name)}</span>
              <small>${escapeHtml(releaseNeeded ? "构建 Stage + 发布 Stage" : "构建 Stage")} · 点击加入/移出批量任务</small>
            </button>
            <div class="service-capability">
              <span class="status ${escapeHtml(flow.status)}">${escapeHtml(releaseNeeded ? "2 Stage" : "1 Stage")}</span>
              <em>${escapeHtml(flow.mode === "direct" ? "直连" : "任务")}</em>
            </div>
            <div class="service-actions">
              ${serviceActions}
            </div>
          </article>
        `;
      }).join("") || "<div class='empty-state'><strong>没有匹配服务</strong><p>换一个关键字或切换分支。</p></div>"}
    </div>
  `;
}

function buildImagesForServices(services = getSelectedServices()) {
  return services.map((service) => {
    const row = service.row || service;
    const image = {
      imageJenkinsName: serviceName(row),
      applicationCode: row.applicationCode || service.applicationCode || state.activeApplicationCode,
      imageNameEn: row.imageNameEn || service.imageNameEn,
      imageVersion: service.generatedVersion || service.imageVersion,
      imageDeployId: row.imageDeployId || service.imageDeployId,
      coverageRun: row.coverageRun || service.coverageRun
    };
    return Object.fromEntries(Object.entries(image).filter(([, value]) => value !== undefined && value !== null && value !== ""));
  });
}

function buildPayload(profile, selected) {
  const build = getProbe(profile.id, "build");
  const services = getSelectedServices(profile);
  const primary = selected || services[0];
  const row = primary && (primary.row || primary);
  const branchEnvironment = getBranchEnvironment(profile) || {};
  const applicationCode = row && (row.applicationCode || primary.applicationCode || state.activeApplicationCode);
  const codeBranch = row && (row.codeBranch || primary.codeBranch);
  const flow = buildFlowForBranch(codeBranch);
  const imageVersion = primary && primary.generatedVersion;
  const imageDeployId = row && row.imageDeployId;
  const imageJenkinsName = row && serviceName(row);
  const images = buildImagesForServices(services.length ? services : primary ? [primary] : []);
  const base = {
    customerNameEn: profile.customerNameEn,
    applicationCode,
    applicationName: row && (row.applicationName || applicationCode),
    codeBranch,
    imageJenkinsName,
    imageVersion,
    imageDeployId,
    kubernetesVersion: row && row.kubernetesVersion,
    serviceCount: images.length,
    flowMode: flow.mode
  };

  if (flow.mode === "release-task") {
    return {
      ...base,
      buildPerId: build && build.session && build.session.staffCode,
      structureType: flow.structureType,
      releaseAppSub: "",
      releaseModule: "",
      releaseType: "",
      releaseContent: "",
      buildType: "release",
      buildImages: images,
      gate: "manual_create_build_task_confirmation_required"
    };
  }

  if (flow.mode === "apply-task") {
    return {
      ...base,
      applyBy: build && build.session && build.session.staffCode,
      userNameAuth: build && build.session && build.session.userNameCn,
      branch: codeBranch,
      structureType: flow.structureType,
      deploymentDescribe: "",
      deploymentExplain: "",
      envName: branchEnvironment.envName || codeBranch,
      isFeiShu: "0",
      images,
      gate: "manual_create_build_task_confirmation_required"
    };
  }

  return {
    ...base,
    buildPerId: build && build.session && build.session.staffCode,
    buildImages: images,
    gate: "manual_build_confirmation_required"
  };
}

function readTaskFormValue(name) {
  return document.querySelector(`[data-input='${name}']`)?.value.trim() || "";
}

function taskFormPayload(selected, options = {}) {
  const flow = buildFlowForBranch(selected && selected.codeBranch);
  const branchEnvironment = getBranchEnvironment() || {};
  const autoReason = state.pipeline.inputs.releaseReason.trim() || defaultReleaseReason(getProfile(), selected);
  const autoNotice = state.pipeline.inputs.releaseNotice.trim() || defaultReleaseNotice(getProfile(), selected);
  if (flow.mode === "release-task") {
    return {
      releaseAppSub: readTaskFormValue("task-release-app-sub") || (options.automatic ? state.activeApplicationCode : ""),
      releaseModule: readTaskFormValue("task-release-module") || (options.automatic ? selected && selected.imageJenkinsName : ""),
      releaseType: readTaskFormValue("task-release-type") || (options.automatic ? "release" : ""),
      releaseContent: readTaskFormValue("task-release-content") || (options.automatic ? `${autoReason}；${autoNotice}` : ""),
      buildType: readTaskFormValue("task-build-type") || "release"
    };
  }
  if (flow.mode === "apply-task") {
    const selectedStructureType = flow.strategyLocked
      ? flow.structureType
      : readTaskFormValue("task-structure-type") || flow.structureType;
    const extendFlag = flow.strategyLocked ? "" : readTaskFormValue("task-extend-flag");
    return {
      structureType: selectedStructureType,
      extendFlag: extendFlag ? extendFlag === "true" : undefined,
      deploymentDescribe: readTaskFormValue("task-deployment-describe") || (options.automatic ? autoReason : ""),
      deploymentExplain: readTaskFormValue("task-deployment-explain") || (options.automatic ? autoNotice : ""),
      envName: readTaskFormValue("task-env-name") || branchEnvironment.envName || selected.codeBranch
    };
  }
  return {};
}

function validateTaskFields(flow, fields) {
  if (flow.mode === "release-task" && !fields.releaseContent) {
    return {
      ok: false,
      error: "missing_release_content",
      message: "提测任务需要填写发布内容。"
    };
  }
  if (flow.mode === "apply-task") {
    if (!fields.deploymentDescribe) {
      return {
        ok: false,
        error: "missing_deployment_describe",
        message: "构建申请需要填写构建说明。"
      };
    }
    if (!fields.deploymentExplain) {
      return {
        ok: false,
        error: "missing_deployment_explain",
        message: "构建申请需要填写发布/部署说明。"
      };
    }
  }
  return { ok: true };
}

function releasePayload(profile, selected) {
  const release = getProbe(profile.id, "release");
  const env = getReleaseEnv(profile);
  const app = getReleaseApp(profile);
  const releaseInputs = releaseInputPolicy(profile, selected);
  return {
    userId: release && release.session && release.session.staffCode,
    customerNameEn: profile.customerNameEn,
    showNameEn: env && env.showNameEn,
    environment: "company",
    environmentFlag: env && env.environmentFlag,
    publishApps: [
      {
        applicationCode: state.activeApplicationCode,
        applicationVersion: app && app.applicationVersion
      }
    ],
    sourceService: selected ? selected.imageJenkinsName : null,
    sourceBuildBranch: state.activeBuildBranch,
    releaseReason: releaseInputs.reason || null,
    releaseNotice: releaseInputs.notice || null,
    gate: "manual_publish_confirmation_required"
  };
}

function renderBuildConsole(profile) {
  const selected = getSelectedService(profile);
  if (!selected) {
    els.buildConsole.innerHTML = `
      <div class="empty-state">
        <strong>未选择服务</strong>
        <p>先在左侧服务清单里选中一个服务。选中后会生成构建确认单，并可读取最近构建状态。</p>
      </div>
    `;
    return;
  }

  const details = selected.detail && selected.detail.detail ? selected.detail.detail : [];
  const firstDetail = details[0] || {};
  const branchEnvironment = getBranchEnvironment(profile) || {};
  const payload = buildPayload(profile, selected);
  const confirmText = buildConfirmText(selected);
  const flow = buildFlowForBranch(selected.codeBranch);
  const taskState = currentTaskImageSnapshot(profile, selected);
  const taskSnapshot = taskState.taskSnapshot;
  const taskImages = taskState.taskImages || [];
  const structureConfig = state.structureConfigs[structureConfigKey(profile)];
  const liveStrategies = flow.strategyLocked
    ? [{ structureType: flow.structureType }]
    : structureConfig && structureConfig.configs && structureConfig.configs.length
      ? structureConfig.configs
      : [{ structureType: "prod" }, { structureType: "hotfix" }];
  const buildableTaskImage = taskState.image && taskState.image.buildPower === "1" ? taskState.image : null;
  const strategyField = flow.strategyLocked ? `
        <label>版本策略<input value="${escapeHtml(flow.structureType)} / 固定策略" disabled></label>
      ` : `
        <label>版本策略<select data-input="task-structure-type">
          ${liveStrategies.map((item) => {
            const type = item.structureType || "prod";
            const label = type === "prod" ? "增加主版本 / prod" : type === "hotfix" ? "追加 postfix / hotfix" : `${type} 策略`;
            return `<option value="${escapeHtml(type)}" ${flow.structureType === type ? "selected" : ""}>${escapeHtml(label)}</option>`;
          }).join("")}
        </select></label>
      `;
  const extendField = flow.strategyLocked ? `
        <label>策略来源<input value="页面直跳 applyMaster；不展示策略卡片" disabled></label>
      ` : `
        <label>Hotfix 继承<select data-input="task-extend-flag">
          <option value="">默认</option>
          <option value="true">继承版本</option>
          <option value="false">当前版本</option>
        </select></label>
      `;
  const taskForm = flow.mode === "release-task" ? `
      <div class="task-form">
        <label>所属系统<input data-input="task-release-app-sub" placeholder="例如 emr / mem"></label>
        <label>发布模块<input data-input="task-release-module" placeholder="${escapeHtml(selected.imageJenkinsName)}"></label>
        <label>发布类型<input data-input="task-release-type" placeholder="release"></label>
        <label>构建类型<input data-input="task-build-type" placeholder="release"></label>
        <label class="span-2">生成版本<input value="${escapeHtml(selected.generatedVersion || "")}" placeholder="点击生成版本预检；创建任务时也会自动生成" disabled></label>
        <label class="span-2">发布内容<textarea data-input="task-release-content" rows="3" placeholder="填写本次提测内容"></textarea></label>
      </div>
    ` : flow.mode === "apply-task" ? `
      <div class="task-form">
        <label>环境名称<input data-input="task-env-name" value="${escapeHtml(branchEnvironment.envName || "")}" placeholder="${escapeHtml(selected.codeBranch)}"></label>
        ${strategyField}
        <label>构建说明<input data-input="task-deployment-describe" placeholder="填写本次构建申请说明"></label>
        ${extendField}
        <label class="span-2">生成版本<input value="${escapeHtml(selected.generatedVersion || "")}" placeholder="点击生成版本预检；创建任务时也会自动生成" disabled></label>
        <label class="span-2">发布/部署说明<textarea data-input="task-deployment-explain" rows="3" placeholder="填写测试或生产发布说明"></textarea></label>
      </div>
    ` : "";
  els.buildConsole.innerHTML = `
    <div class="action-card">
      <div class="action-title">
        <div>
          <strong>${escapeHtml(selected.imageJenkinsName)}</strong>
          <p>${escapeHtml(selected.applicationCode)} / ${escapeHtml(selected.codeBranch)} / ${escapeHtml(profile.customerNameEn)}</p>
        </div>
        <span class="status ${escapeHtml(flow.status)}">${escapeHtml(flow.label)}</span>
      </div>
      <div class="notice ${flow.mode === "direct" ? "ok" : "warn"}">${escapeHtml(flow.description)}</div>
      ${flow.mode === "apply-task" && !flow.strategyLocked ? `
        <div class="notice ${structureConfig ? "ok" : "warn"}">
          ${structureConfig
            ? `生产策略来自 /support/getStructureTypeConfigs：${liveStrategies.map((item) => item.structureType).join(" / ")}`
            : "master 分支应先读取生产策略配置；未读取前仅显示默认 prod/hotfix。"}
        </div>
      ` : ""}
      <div class="field-grid">
        ${field("构建权限", firstDetail.buildPower || "待读取")}
        ${field("镜像版本", firstDetail.imageVersion || "待读取")}
        ${field("最后成功", firstDetail.lastSuccessId || "待读取")}
        ${field("部署地址", firstDetail.imageUrl || "待读取")}
      </div>
      ${taskForm}
      <pre>${escapeHtml(JSON.stringify(payload, null, 2))}</pre>
      ${flow.mode !== "direct" && taskSnapshot ? `
        <div class="task-snapshot">
          <div class="task-snapshot-head">
            <strong>构建任务快照</strong>
            <span class="status ${taskSnapshot.matchedTask ? "green" : "blue"}">${escapeHtml(taskSnapshot.matchedTask ? "已定位目标任务" : `${String((taskSnapshot.tasks || []).length)} tasks`)}</span>
          </div>
          <div class="mini-table">
            ${taskImages.slice(0, 6).map((item) => `
              <div class="mini-row">
                <span>${escapeHtml(item.imageJenkinsName || item.imageNameEn)}</span>
                <code>${escapeHtml(item.imageVersion || "无版本")}</code>
                <em>${escapeHtml(`buildPower=${item.buildPower || "0"} status=${item.structureStatus || "未知"}`)}</em>
              </div>
            `).join("") || "<div class='mini-row'><span>当前任务没有服务行</span><code>-</code><em>-</em></div>"}
          </div>
          <div class="notice ${taskImages.some((item) => item.buildPower === "1") ? "ok" : "warn"}">
            ${taskSnapshot.matchedImage
              ? `已定位 ${taskSnapshot.matchedImage.imageJenkinsName || taskSnapshot.matchedImage.imageNameEn} / ${taskSnapshot.matchedImage.imageVersion || "无版本"}，buildPower=${taskSnapshot.matchedImage.buildPower || "0"}。`
              : "任务内构建按钮只应对 buildPower=1 的服务开放；这是构建平台任务页的真实规则。"}
          </div>
          ${buildableTaskImage ? `
            <label class="confirm-line">
              从任务构建确认文本
              <input data-input="task-build-confirm" placeholder="${escapeHtml(`执行构建 ${selectedServicesLabel(getSelectedServices(profile))}`)}">
            </label>
          ` : ""}
        </div>
      ` : ""}
      <label class="confirm-line">
        ${flow.mode === "direct" ? "构建确认文本" : "任务确认文本"}
        <input data-input="build-confirm" placeholder="${escapeHtml(confirmText)}">
      </label>
      <div class="button-row">
        <button class="button button-secondary" data-probe-service-detail="1">读取构建状态</button>
        ${flow.mode === "apply-task" && !flow.strategyLocked ? "<button class='button button-secondary' data-probe-structure-configs='1'>读取生产策略</button>" : ""}
        ${flow.mode !== "direct" ? "<button class='button button-secondary' data-probe-image-version='1'>生成版本预检</button>" : ""}
        ${flow.mode !== "direct" ? "<button class='button button-secondary' data-probe-build-tasks='1'>读取构建任务</button>" : ""}
        <button class="button button-secondary" data-copy-payload="build">复制构建确认单</button>
        ${flow.mode === "direct"
          ? "<button class='button button-danger' data-execute-build='1'>执行开发构建</button>"
          : `<button class="button button-danger" data-create-build-task="1">${escapeHtml(flow.actionLabel)}</button>`}
        ${flow.mode !== "direct"
          ? `<button class="button button-danger" data-execute-task-image-build="1" ${buildableTaskImage ? "" : "disabled"}>从任务构建</button>`
          : ""}
        <button class="button button-secondary" data-clear-service="1">清除服务</button>
      </div>
    </div>
  `;
}

function renderReleaseConsole(profile) {
  const selected = getSelectedService(profile);
  const releaseNeeded = releaseRequiredForBranch(state.activeBuildBranch);
  const release = getProbe(profile.id, "release");
  const env = getReleaseEnv(profile);
  const card = getReleaseCard(profile);
  const app = getReleaseApp(profile);
  const detail = state.publishDetails[publishDetailKey(profile, env)];

  if (!releaseNeeded) {
    els.releaseProbeState.className = "status green";
    els.releaseProbeState.textContent = "跳过";
    els.releaseConsole.innerHTML = `
      <div class="empty-state">
        <strong>开发环境构建后结束</strong>
        <p>当前构建分支是 develop，不进入发布平台。需要发布时切换到 release、mastertest、master 或医院自定义环境分支。</p>
      </div>
    `;
    return;
  }

  if (!release) {
    els.releaseProbeState.className = "status gray";
    els.releaseProbeState.textContent = "未探测";
    els.releaseConsole.innerHTML = `
      <div class="empty-state">
        <strong>先探测发布平台</strong>
        <p>测试和生产环境构建完成后，还需要在发布平台定位同医院、同应用、同环境并点击发布。</p>
      </div>
    `;
    return;
  }

  if (!release.ok) {
    els.releaseProbeState.className = "status red";
    els.releaseProbeState.textContent = "失败";
    els.releaseConsole.innerHTML = `
      <div class="empty-state error-state">
        <strong>发布平台探测失败</strong>
        <p>${escapeHtml(summarizeFailure(release))}</p>
      </div>
    `;
    return;
  }

  if (!selected) {
    els.releaseProbeState.className = "status yellow";
    els.releaseProbeState.textContent = "待服务";
    els.releaseConsole.innerHTML = `
      <div class="empty-state">
        <strong>先选择构建平台服务</strong>
        <p>发布动作必须绑定本次构建选择的服务。选择服务后再读取发布清单或执行真正发布。</p>
      </div>
    `;
    return;
  }

  els.releaseProbeState.className = card ? "status green" : "status yellow";
  els.releaseProbeState.textContent = card ? "已定位" : "未匹配";

  if (!card) {
    els.releaseConsole.innerHTML = `
      <div class="empty-state">
        <strong>没有匹配当前发布目标</strong>
        <p>发布平台已登录，但没有返回 ${escapeHtml(env.showNameEn)}/${escapeHtml(env.environmentFlag)}。请切换发布环境或检查账号权限。</p>
      </div>
    `;
    return;
  }

  if (!app) {
    els.releaseProbeState.className = "status yellow";
    els.releaseProbeState.textContent = "无应用";
    els.releaseConsole.innerHTML = `
      <div class="empty-state">
        <strong>当前发布环境没有匹配应用</strong>
        <p>发布平台已定位环境，但没有返回 ${escapeHtml(state.activeApplicationCode)} 的版本信息。</p>
      </div>
    `;
    return;
  }

  const payload = releasePayload(profile, selected);
  const confirmText = publishConfirmText(profile, env);
  const pendingCount = app ? Number(app.toPublishServiceNum || 0) : 0;
  els.releaseConsole.innerHTML = `
    <div class="action-card ${isProdEnv(env) ? "danger-zone" : ""}">
      <div class="action-title">
        <div>
          <strong>${escapeHtml(env.showNameEn)}/${escapeHtml(env.environmentFlag)} - ${escapeHtml(env.label)}</strong>
          <p>${escapeHtml(profile.customerNameEn)} · ${escapeHtml(state.activeApplicationCode)} · ${selected ? escapeHtml(selected.imageJenkinsName) : "服务未选择"}</p>
        </div>
        <span class="status ${isProdEnv(env) ? "red" : "yellow"}">${isProdEnv(env) ? "生产确认" : "发布确认"}</span>
      </div>
      <div class="field-grid">
        ${field("平台版本", app && app.applicationVersion)}
        ${field("现场版本", app && app.spotAppVersion)}
        ${field("待发布服务", app ? pendingCount : "未知")}
        ${field("镜像平台", card.environment && card.environment.spotAddress)}
      </div>
      ${detail ? `<details open><summary>发布清单摘要</summary><pre>${escapeHtml(JSON.stringify(detail.detail || detail, null, 2))}</pre></details>` : ""}
      <pre>${escapeHtml(JSON.stringify(payload, null, 2))}</pre>
      <label class="confirm-line">
        发布确认文本
        <input data-input="publish-confirm" placeholder="${escapeHtml(confirmText)}">
      </label>
      ${pendingCount === 0 ? "<div class='notice warn'>当前待发布服务数为 0。构建完成并刷新发布平台后，待发布数大于 0 才开放真正发布。</div>" : ""}
      <div class="button-row">
        <a class="button button-secondary" href="https://release-shell.example.internal/login" target="_blank" rel="noreferrer">打开发布平台</a>
        <button class="button button-secondary" data-probe-release-detail="1">读取发布清单</button>
        <button class="button button-secondary" data-copy-payload="release">复制发布确认单</button>
        <button class="button button-danger" data-execute-publish="1" ${pendingCount === 0 ? "disabled" : ""}>真正发布</button>
      </div>
    </div>
  `;
}

function renderOperationCard(profile) {
  const account = getAccount(profile);
  const env = getReleaseEnv(profile);
  const selected = getSelectedService(profile);
  const build = getProbe(profile.id, "build");
  const release = getProbe(profile.id, "release");
  const releaseNeeded = releaseRequiredForBranch(state.activeBuildBranch);
  const releaseApp = getReleaseApp(profile);
  const flow = buildFlowForBranch(state.activeBuildBranch);

  els.operationCard.innerHTML = `
    <div class="operation-fields">
      ${field("医院", profile.shortName)}
      ${field("账号", account.label)}
      ${field("应用", state.activeApplicationCode)}
      ${field("构建分支", state.activeBuildBranch)}
      ${field("构建流程", flow.label)}
      ${field("服务", selected && selected.imageJenkinsName)}
      ${field("发布环境", releaseNeeded ? `${env.showNameEn}/${env.environmentFlag}` : "不需要")}
      ${field("平台版本", releaseApp && releaseApp.applicationVersion)}
      ${field("待发布数", releaseApp ? releaseApp.toPublishServiceNum || 0 : release && release.ok ? "未匹配" : "待探测")}
    </div>
    <div class="notice-stack">
      <div class="notice ${selected ? "ok" : "warn"}">${selected ? "服务已选中，可以进入构建确认。" : "必须先选择服务，才算一次可执行作业。"}</div>
      <div class="notice ${build && build.ok ? "ok" : "warn"}">${build && build.ok ? "构建平台已探测。" : "构建平台未完成探测。"}</div>
      <div class="notice ${!releaseNeeded || release && release.ok ? "ok" : "warn"}">${releaseNeeded ? release && release.ok ? "发布平台已探测。" : "目标环境需要发布平台探测。" : "开发环境跳过发布平台。"}</div>
      ${isProdEnv(env) && releaseNeeded ? "<div class='notice danger'>生产环境必须人工二次确认。</div>" : ""}
    </div>
    <details class="api-matrix">
      <summary>已确认 API 矩阵</summary>
      <div class="api-list">
        ${API_MATRIX.map((group) => `
          <div class="api-group">
            <strong>${escapeHtml(group.group)}</strong>
            ${group.endpoints.map(([method, path, note]) => `
              <div class="api-row">
                <span>${escapeHtml(method)}</span>
                <code>${escapeHtml(path)}</code>
                <em>${escapeHtml(note)}</em>
              </div>
            `).join("")}
          </div>
        `).join("")}
      </div>
    </details>
  `;
}

function renderProfileConfig() {
  if (!els.profileConfigView) return;
  els.profileConfigView.innerHTML = state.bootstrap.profiles.map((profile) => `
    <article class="config-card">
      <div class="config-card-head">
        <div>
          <strong>${escapeHtml(profile.hospitalName)}</strong>
          <p>${escapeHtml(profile.customerNameEn)} / ${escapeHtml(profile.ownerHint)}</p>
        </div>
        <span class="status ${profile.id === state.activeProfileId ? "blue" : "gray"}">${escapeHtml(profile.id)}</span>
      </div>
      <div class="field-grid">
        ${field("应用分类", profile.applications.map((app) => `${app.code}:${app.name}`).join(" / "))}
        ${field("账号", profile.accounts.map((account) => account.label).join(" / "))}
      </div>
      <div class="mini-table">
        ${profile.releaseEnvironments.map((env) => `
          <div class="mini-row">
            <span>${escapeHtml(env.label)}</span>
            <code>${escapeHtml(env.showNameEn)}/${escapeHtml(env.environmentFlag)}</code>
            <em>${escapeHtml(env.spotAddress)}</em>
          </div>
        `).join("")}
      </div>
    </article>
  `).join("");
}

function renderSystemConfig() {
  if (!els.systemConfigView) return;
  els.systemConfigView.innerHTML = state.bootstrap.profiles.map((profile) => `
    <article class="config-card">
      <div class="config-card-head">
        <div>
          <strong>${escapeHtml(profile.shortName)}</strong>
          <p>${escapeHtml(profile.customerNameEn)}</p>
        </div>
        <button class="button button-secondary" data-config-profile="${escapeHtml(profile.id)}">进入活动流</button>
      </div>
      <div class="credential-list">
        ${profile.accounts.map((account) => {
          const configured = hasCredentials(profile, account);
          const config = credentialConfigFor(profile, account) || {};
          const sourceLabel = config.source === "saved" ? "应用内保存" : config.source === "env" ? "环境变量" : "未配置";
          return `
            <form class="credential-form" data-credential-form="${escapeHtml(profile.id)}:${escapeHtml(account.id)}">
              <div>
                <strong>${escapeHtml(account.label)}</strong>
                <p>${escapeHtml(account.scopeNote)}</p>
                <div class="tag-row">
                  ${account.platforms.map((platform) => `<span class="tag">${platform === "build" ? "构建平台" : "发布平台"}</span>`).join("")}
                  <span class="tag ${configured ? "tag-ok" : "tag-warn"}">${configured ? "可用" : "缺配置"}</span>
                  <span class="tag">${escapeHtml(sourceLabel)}</span>
                </div>
              </div>
              <label>
                账号
                <input name="username" value="${escapeHtml(config.username || account.username || "")}" autocomplete="username">
                <span>${escapeHtml(config.envUsernameKey || "profile default")}</span>
              </label>
              <label>
                密码
                <input name="password" type="password" value="" autocomplete="current-password" placeholder="${configured ? "留空不修改当前密码" : "输入后保存到本地凭据库"}">
                <span>${escapeHtml(config.envPasswordKey || account.envPasswordKey)} · ${escapeHtml(sourceLabel)}</span>
              </label>
              <div class="credential-actions">
                <button class="button button-primary" type="submit">保存账号</button>
                <button class="button button-secondary" type="button" data-reset-credential="${escapeHtml(profile.id)}:${escapeHtml(account.id)}">恢复环境变量</button>
                <small>${config.savedAt ? `上次保存 ${escapeHtml(formatTime(new Date(config.savedAt)))}` : "尚未应用内保存"}</small>
              </div>
            </form>
          `;
        }).join("")}
      </div>
    </article>
  `).join("");
}

function renderApiDictionary() {
  if (!els.apiDictionaryView) return;
  els.apiDictionaryView.innerHTML = API_MATRIX.map((group) => `
    <article class="config-card">
      <div class="config-card-head">
        <div>
          <strong>${escapeHtml(group.group)}</strong>
          <p>当前 MVP 已使用或已还原的关键接口。</p>
        </div>
      </div>
      <div class="api-list">
        ${group.endpoints.map(([method, path, note]) => `
          <div class="api-row">
            <span>${escapeHtml(method)}</span>
            <code>${escapeHtml(path)}</code>
            <em>${escapeHtml(note)}</em>
          </div>
        `).join("")}
      </div>
    </article>
  `).join("");
}

function renderNavigation() {
  document.querySelectorAll("[data-workflow-profile]").forEach((button) => {
    button.classList.toggle("active", state.activeView === "workbench" && button.dataset.workflowProfile === state.activeProfileId);
  });
  document.querySelectorAll("[data-view-nav]").forEach((button) => {
    button.classList.toggle("active", state.activeView !== "workbench" && button.dataset.viewNav === state.activeView);
  });
  document.querySelectorAll("[data-view]").forEach((view) => {
    view.classList.toggle("active", view.dataset.view === state.activeView);
  });
}

function renderEvidence() {
  if (!els.evidenceTimeline) return;
  if (!state.evidence.length) {
    els.evidenceTimeline.innerHTML = `
      <div class="timeline-item">
        <span>${escapeHtml(formatTime())}</span>
        <div>
          <strong>全局诊断已加载</strong>
          <p>平台探测、配置保存等非 Run 事件会显示在这里；Pipeline 阶段事件在当前 Run 内查看。</p>
        </div>
        <em class="status gray">idle</em>
      </div>
    `;
    return;
  }
  els.evidenceTimeline.innerHTML = state.evidence.map((item) => `
    <div class="timeline-item">
      <span>${escapeHtml(item.at)}</span>
      <div>
        <strong>${escapeHtml(item.title)}</strong>
        <p>${escapeHtml(item.detail)}</p>
      </div>
      <em class="status ${item.tone}">${escapeHtml(item.tone)}</em>
    </div>
  `).join("");
}

async function runProbe(kind, accountId) {
  const profile = getProfile();
  const account = profile.accounts.find((item) => item.id === accountId) || getAccount(profile);
  if (!hasCredentials(profile, account)) {
    missingCredentialsEvidence(profile, account);
    return { ok: false, error: "credentials_not_configured" };
  }

  if (kind === "both") {
    const buildResult = await runSingleProbe("build", profile, account);
    const releaseResult = await runSingleProbe("release", profile, account);
    return { ok: Boolean(buildResult && buildResult.ok && releaseResult && releaseResult.ok), buildResult, releaseResult };
  }

  return runSingleProbe(kind, profile, account);
}

async function runSingleProbe(kind, profile, account) {
  addEvidence(`${profile.shortName} ${kind === "build" ? "构建服务" : "发布环境"}探测开始`, `账号 ${account.username}`, "blue");

  let json;
  try {
    const response = await fetch(`/api/probe/${kind}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        profileId: profile.id,
        accountId: account.id,
        customerNameEn: profile.customerNameEn
      })
    });
    json = await response.json();
  } catch (error) {
    json = { result: { ok: false, error: error.message } };
  }

  const result = json.result || json;
  state.probeData[profile.id] = {
    ...(state.probeData[profile.id] || {}),
    [kind]: result
  };

  if (!result.ok) {
    addEvidence(`${profile.shortName} ${kind === "build" ? "构建" : "发布"}探测失败`, summarizeFailure(result), "red");
    setProbeResult(`${profile.shortName} ${kind === "build" ? "构建" : "发布"}探测失败`, result, "red");
    render();
    return result;
  }

  if (kind === "build") {
    addEvidence(
      `${profile.shortName} 构建服务探测成功`,
      `客户匹配 ${result.customers.matched.length}/${result.customers.count}；${summarizeServiceDiscovery(result.serviceDiscovery)}。`,
      "green"
    );
    setProbeResult(`${profile.shortName} 构建服务探测`, {
      session: result.session,
      customers: result.customers,
      serviceDiscovery: result.serviceDiscovery
    }, "green");
  } else {
    addEvidence(
      `${profile.shortName} 发布环境探测成功`,
      `客户匹配 ${result.customers.matched.length}/${result.customers.count}；环境 ${result.environments.length} 个。`,
      "green"
    );
    setProbeResult(`${profile.shortName} 发布环境探测`, {
      session: result.session,
      customers: result.customers,
      environments: result.environments
    }, "green");
  }

  normalizeSelections(profile);
  render();
  return result;
}

function autoProbeKey(profile, account) {
  const env = getReleaseEnv(profile);
  return [
    profile.id,
    account && account.id,
    state.activeApplicationCode,
    state.activeBuildBranch,
    env && env.id
  ].filter(Boolean).join("::");
}

async function autoWarmActiveProfile() {
  if (!state.bootstrap || state.activeView !== "workbench" || state.pipeline.isRunning) return;
  const profile = getProfile();
  const account = getAccount(profile);
  if (!profile || !account || !hasCredentials(profile, account)) return;

  const key = autoProbeKey(profile, account);
  const build = getProbe(profile.id, "build");
  const release = getProbe(profile.id, "release");
  const releaseNeeded = releaseRequiredForBranch(state.activeBuildBranch);
  const needsBuild = !(build && build.ok);
  const needsRelease = releaseNeeded && !(release && release.ok);

  if (!needsBuild && !needsRelease) return;
  if (state.autoProbeKeys[key]) return;
  state.autoProbeKeys[key] = true;

  addEvidence("自动只读探测启动", `${profile.shortName} / ${state.activeApplicationCode} / ${state.activeBuildBranch}`, "blue");
  if (needsBuild) {
    await runSingleProbe("build", profile, account);
  }
  if (needsRelease) {
    await runSingleProbe("release", profile, account);
  }
}

function scheduleAutoWarm() {
  window.clearTimeout(scheduleAutoWarm.timer);
  scheduleAutoWarm.timer = window.setTimeout(() => {
    autoWarmActiveProfile().catch((error) => addEvidence("自动只读探测失败", error.message, "red"));
  }, 0);
}

async function probeSelectedServiceDetail() {
  const profile = getProfile();
  const services = getSelectedServices(profile);
  if (!services.length) return { ok: false, error: "service_not_selected" };

  const account = getAccount(profile);
  if (!hasCredentials(profile, account)) {
    missingCredentialsEvidence(profile, account);
    return { ok: false, error: "credentials_not_configured" };
  }

  addEvidence("构建状态读取开始", `${selectedServicesLabel(services)} / ${services[0].codeBranch}`, "blue");
  const results = [];
  for (const selected of services) {
    let json;
    try {
      const response = await fetch("/api/probe/build-service", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          profileId: profile.id,
          accountId: account.id,
          customerNameEn: profile.customerNameEn,
          applicationCode: selected.applicationCode,
          codeBranch: selected.codeBranch,
          imageJenkinsName: selected.imageJenkinsName
        })
      });
      json = await response.json();
    } catch (error) {
      json = { result: { ok: false, error: error.message } };
    }
    const result = json.result || json;
    results.push({ service: selected, result });
    if (!result.ok) {
      addEvidence("构建状态读取失败", `${selected.imageJenkinsName}: ${summarizeFailure(result)}`, "red");
      return result;
    }
    updateSelectedServiceMeta(selected.serviceKey, { detail: result });
  }
  addEvidence("构建状态读取成功", results.map(({ service, result }) => `${service.imageJenkinsName}:${result.detail.length}`).join(" / "), "green");
  render();
  return { ok: true, results };
}

async function probeBuildTasks(options = {}) {
  const profile = getProfile();
  const selected = getSelectedService(profile);
  const services = getSelectedServices(profile);
  if (!selected || !services.length) return null;

  const account = getAccount(profile);
  if (!hasCredentials(profile, account)) {
    missingCredentialsEvidence(profile, account);
    return null;
  }

  const targetVersion = options.ignoreGeneratedVersion ? "" : options.imageVersion || selected.generatedVersion || "";
  const lookupCount = options.maxTaskImageLookups || (targetVersion ? 10 : services.length > 1 ? 15 : 3);
  addEvidence(
    options.title || "构建任务读取开始",
    `${selected.applicationCode} / ${selected.codeBranch} / ${selectedServicesLabel(services)}${targetVersion ? ` / ${targetVersion}` : ""}`,
    "blue"
  );
  let json;
  try {
    const response = await fetch("/api/probe/build-tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        profileId: profile.id,
        accountId: account.id,
        customerNameEn: profile.customerNameEn,
        applicationCode: selected.applicationCode,
        codeBranch: selected.codeBranch,
        envType: selected.codeBranch,
        imageJenkinsName: selected.imageJenkinsName,
        imageNameEn: selected.imageNameEn || selected.row && selected.row.imageNameEn,
        imageVersion: targetVersion,
        images: buildImagesForServices(services),
        maxTaskImageLookups: lookupCount
      })
    });
    json = await response.json();
  } catch (error) {
    json = { result: { ok: false, error: error.message } };
  }

  const result = json.result || json;
  if (!result.ok) {
    addEvidence("构建任务读取失败", summarizeFailure(result), "red");
    setProbeResult("构建任务读取失败", result, "red");
    return null;
  }

  state.buildTasks[buildTaskKey(profile)] = result;
  const taskState = currentTaskImageSnapshot(profile, selected);
  const buildPowerOk = taskState.allBuildable || result.matchedImage && result.matchedImage.buildPower === "1";
  addEvidence(
    "构建任务读取成功",
    taskState.allMatched
      ? `已定位同一构建任务：${selectedServicesLabel(services)}，${buildPowerOk ? "全部 buildPower=1。" : "仍有服务未开放构建。"}`
      : result.matchedImage
        ? `已定位目标任务：${result.matchedImage.imageJenkinsName || result.matchedImage.imageNameEn} / ${result.matchedImage.imageVersion || "无版本"} / buildPower=${result.matchedImage.buildPower || "0"}。${buildPowerOk ? "下一步可执行任务内构建。" : "平台当前还不允许任务内构建。"}`
        : `任务 ${result.tasks.length} 条，已检查 ${result.taskImagesByTask ? result.taskImagesByTask.length : 0} 个任务，未定位当前服务组：${taskState.missingServices.join(" / ") || "无" }。`,
    buildPowerOk ? "green" : "yellow"
  );
  setProbeResult("构建任务列表", result, buildPowerOk ? "green" : "yellow");
  render();
  return result;
}

async function probeBuildTasksUntilBuildable(options = {}) {
  let latestResult = null;
  const attempts = options.attempts || 5;
  const intervalMs = options.intervalMs || 1500;
  for (let index = 0; index < attempts; index += 1) {
    latestResult = await probeBuildTasks({
      title: index === 0 ? "自动构建定位任务" : "自动构建重试定位任务",
      imageVersion: options.imageVersion,
      maxTaskImageLookups: options.maxTaskImageLookups || 15
    });
    const taskState = latestResult ? currentTaskImageSnapshot(getProfile(), getSelectedService(getProfile())) : null;
    if (taskState && taskState.allBuildable || latestResult && latestResult.matchedImage && latestResult.matchedImage.buildPower === "1") {
      return latestResult;
    }
    if (index < attempts - 1) {
      const buildPower = latestResult && latestResult.matchedImage && latestResult.matchedImage.buildPower || "未定位";
      addEvidence("等待任务开放构建", `第 ${index + 1}/${attempts} 次未拿到 buildPower=1，当前 buildPower=${buildPower}。`, "yellow");
      await delay(intervalMs);
    }
  }
  return latestResult;
}

async function probeImageVersion() {
  const profile = getProfile();
  const selected = getSelectedService(profile);
  const services = getSelectedServices(profile);
  if (!services.length) return { ok: false, error: "service_not_selected" };

  const account = getAccount(profile);
  if (!hasCredentials(profile, account)) {
    missingCredentialsEvidence(profile, account);
    return { ok: false, error: "credentials_not_configured" };
  }

  const flow = buildFlowForBranch(selected.codeBranch);
  const taskFields = taskFormPayload(selected);
  const structureType = taskFields.structureType || flow.structureType || "prod";
  const imageNameEn = selected.imageNameEn || selected.row && selected.row.imageNameEn;
  const images = services.map((service) => ({ imageNameEn: service.imageNameEn || service.row && service.row.imageNameEn }));
  addEvidence("镜像版本生成预检开始", `${selectedServicesLabel(services)} / ${selected.codeBranch} / ${structureType}`, "blue");

  let json;
  try {
    const response = await fetch("/api/probe/image-version", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        profileId: profile.id,
        accountId: account.id,
        customerNameEn: profile.customerNameEn,
        applicationCode: selected.applicationCode,
        codeBranch: selected.codeBranch,
        structureType,
        extendFlag: taskFields.extendFlag,
        imageNameEn,
        images
      })
    });
    json = await response.json();
  } catch (error) {
    json = { result: { ok: false, error: error.message } };
  }

  const result = json.result || json;
  if (!result.ok) {
    addEvidence("镜像版本生成预检失败", summarizeFailure(result), "red");
    setProbeResult("镜像版本生成预检失败", result, "red");
    return result;
  }

  const versions = result.probe && result.probe.versions || {};
  for (const service of getSelectedServices(profile)) {
    const key = service.imageNameEn || service.row && service.row.imageNameEn;
    if (key && versions[key]) {
      updateSelectedServiceMeta(service.serviceKey, { generatedVersion: versions[key] });
    }
  }
  const versionSummary = getSelectedServices(profile)
    .map((service) => `${service.imageNameEn || service.imageJenkinsName}:${service.generatedVersion || versions[service.imageNameEn] || "已返回"}`)
    .join(" / ");
  addEvidence("镜像版本生成预检成功", versionSummary || `${imageNameEn} -> 已返回版本映射`, "green");
  setProbeResult("镜像版本生成预检", result, "green");
  render();
  return result;
}

async function probeStructureConfigs() {
  const profile = getProfile();
  const selected = getSelectedService(profile);
  if (!selected) return;

  const account = getAccount(profile);
  if (!hasCredentials(profile, account)) {
    missingCredentialsEvidence(profile, account);
    return;
  }

  const namespace = getBranchNamespace(profile);
  if (!namespace) {
    addEvidence("生产策略读取失败", `${state.activeBuildBranch} 没有命名空间信息，请先探测构建平台。`, "yellow");
    return;
  }

  addEvidence("生产策略读取开始", `${profile.shortName} / ${namespace}`, "blue");
  let json;
  try {
    const response = await fetch("/api/probe/structure-configs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        profileId: profile.id,
        accountId: account.id,
        customerNameEn: profile.customerNameEn,
        applicationCode: selected.applicationCode,
        namespace
      })
    });
    json = await response.json();
  } catch (error) {
    json = { result: { ok: false, error: error.message } };
  }

  const result = json.result || json;
  if (!result.ok) {
    addEvidence("生产策略读取失败", summarizeFailure(result), "red");
    setProbeResult("生产策略读取失败", result, "red");
    return;
  }

  state.structureConfigs[structureConfigKey(profile)] = result;
  addEvidence("生产策略读取成功", `${namespace}: ${result.configs.map((item) => item.structureType).join(" / ") || "无策略"}`, "green");
  setProbeResult("生产策略配置", result, "green");
  render();
}

async function probeReleaseDetail() {
  const profile = getProfile();
  const selected = getSelectedService(profile);
  const app = getReleaseApp(profile);
  const env = getReleaseEnv(profile);
  if (!selected || !app || !env) return { ok: false, error: "release_target_not_ready" };

  const account = getAccount(profile);
  if (!hasCredentials(profile, account)) {
    missingCredentialsEvidence(profile, account);
    return { ok: false, error: "credentials_not_configured" };
  }

  addEvidence("发布清单读取开始", `${profile.shortName} / ${state.activeApplicationCode} / ${env.showNameEn}/${env.environmentFlag}`, "blue");
  let json;
  try {
    const response = await fetch("/api/probe/release-detail", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        profileId: profile.id,
        accountId: account.id,
        customerNameEn: profile.customerNameEn,
        environmentId: env.id,
        applicationCode: state.activeApplicationCode,
        applicationVersion: app.applicationVersion
      })
    });
    json = await response.json();
  } catch (error) {
    json = { result: { ok: false, error: error.message } };
  }

  const result = json.result || json;
  if (!result.ok) {
    addEvidence("发布清单读取失败", summarizeFailure(result), "red");
    return result;
  }

  state.publishDetails[publishDetailKey(profile, env)] = result;
  addEvidence("发布清单读取成功", `${state.activeApplicationCode} ${app.applicationVersion} 已返回发布明细。`, "green");
  render();
  return result;
}

async function copyPayload(type) {
  const profile = getProfile();
  const selected = getSelectedService(profile);
  const basePayload = type === "build" ? buildPayload(profile, selected) : releasePayload(profile, selected);
  const payload = type === "build" && selected
    ? { ...basePayload, ...taskFormPayload(selected) }
    : basePayload;
  try {
    await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    addEvidence(type === "build" ? "构建确认单已复制" : "发布确认单已复制", JSON.stringify(payload), "green");
  } catch (error) {
    addEvidence("复制失败", error.message, "red");
  }
}

async function executeBuild(options = {}) {
  const profile = getProfile();
  const selected = getSelectedService(profile);
  const services = getSelectedServices(profile);
  if (!selected || !services.length) return { ok: false, error: "service_not_selected" };
  const flow = buildFlowForBranch(selected.codeBranch);

  if (flow.mode !== "direct") {
    addEvidence("构建流程需要任务", `${selected.codeBranch} 需要先创建或选择构建任务。`, "yellow");
    return { ok: false, error: "build_task_required" };
  }

  const expectedConfirmText = buildConfirmText(selected);
  const confirmText = options.automatic
    ? expectedConfirmText
    : document.querySelector("[data-input='build-confirm']")?.value.trim() || "";
  if (!options.automatic && confirmText !== expectedConfirmText) {
    addEvidence("构建确认文本不匹配", `需要输入：${expectedConfirmText}`, "yellow");
    setProbeResult("构建确认文本不匹配", {
      ok: false,
      error: "confirmation_required",
      expectedConfirmText
    }, "yellow");
    return { ok: false, error: "confirmation_required", expectedConfirmText };
  }

  const account = getAccount(profile);
  if (!hasCredentials(profile, account)) {
    missingCredentialsEvidence(profile, account);
    return { ok: false, error: "credentials_not_configured" };
  }

  addEvidence("构建执行请求提交", `${selectedServicesLabel(services)} / ${selected.codeBranch}`, "blue");
  let json;
  try {
    const response = await fetch("/api/execute/build", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        profileId: profile.id,
        accountId: account.id,
        customerNameEn: profile.customerNameEn,
        applicationCode: selected.applicationCode,
        applicationName: selected.applicationName || selected.applicationCode,
        codeBranch: selected.codeBranch,
        imageJenkinsName: selected.imageJenkinsName,
        imageNameEn: selected.imageNameEn || selected.row && selected.row.imageNameEn,
        buildImages: buildImagesForServices(services),
        kubernetesVersion: selected.kubernetesVersion,
        confirmText
      })
    });
    json = await response.json();
  } catch (error) {
    json = { ok: false, error: error.message };
  }

  const result = json.result || json;
  if (!json.result && result.error === "confirmation_required") {
    addEvidence("构建确认文本不匹配", `需要输入：${result.expectedConfirmText}`, "yellow");
    setProbeResult("构建确认文本不匹配", result, "yellow");
    return result;
  }
  if (!result.ok) {
    addEvidence("构建执行失败", summarizeFailure(result), "red");
    setProbeResult("构建执行失败", result, "red");
    return result;
  }

  addEvidence("构建执行已确认", `${selectedServicesLabel(services)} 已调用 /support/buildImages，平台业务码 ${result.response && result.response.businessCode || "未知"}。`, "green");
  setProbeResult("构建执行响应", result, "green");
  return result;
}

function syncSelectedVersionsFromTaskImages(images = []) {
  for (const service of getSelectedServices()) {
    const match = images.find((item) =>
      item && item.imageJenkinsName === service.imageJenkinsName &&
      (!service.imageNameEn || item.imageNameEn === service.imageNameEn || !item.imageNameEn)
    );
    if (match && match.imageVersion) {
      updateSelectedServiceMeta(service.serviceKey, { generatedVersion: match.imageVersion });
    }
  }
}

async function createBuildTask(options = {}) {
  const profile = getProfile();
  const selected = getSelectedService(profile);
  const services = getSelectedServices(profile);
  if (!selected || !services.length) return { ok: false, error: "service_not_selected" };
  const flow = buildFlowForBranch(selected.codeBranch);

  if (flow.mode === "direct") {
    addEvidence("开发分支不创建任务", "develop 分支直接执行构建。", "yellow");
    return { ok: false, error: "direct_build_required" };
  }

  const expectedConfirmText = buildConfirmText(selected);
  const confirmText = options.automatic
    ? expectedConfirmText
    : document.querySelector("[data-input='build-confirm']")?.value.trim() || "";
  if (!options.automatic && confirmText !== expectedConfirmText) {
    addEvidence("任务确认文本不匹配", `需要输入：${expectedConfirmText}`, "yellow");
    setProbeResult("任务确认文本不匹配", {
      ok: false,
      error: "confirmation_required",
      expectedConfirmText
    }, "yellow");
    return { ok: false, error: "confirmation_required", expectedConfirmText };
  }

  const account = getAccount(profile);
  if (!hasCredentials(profile, account)) {
    missingCredentialsEvidence(profile, account);
    return { ok: false, error: "credentials_not_configured" };
  }

  const taskFields = taskFormPayload(selected, options);
  const fieldValidation = validateTaskFields(flow, taskFields);
  if (!fieldValidation.ok) {
    addEvidence("构建任务表单未完成", fieldValidation.message, "yellow");
    setProbeResult("构建任务表单未完成", fieldValidation, "yellow");
    return fieldValidation;
  }

  const existing = await probeBuildTasks({
    title: "已有构建任务预检",
    ignoreGeneratedVersion: true,
    maxTaskImageLookups: 20
  });
  if (existing && Array.isArray(existing.tasks) && existing.tasks.length) {
    const existingTaskState = currentTaskImageSnapshot(profile, selected);
    if (existingTaskState.allMatched) {
      syncSelectedVersionsFromTaskImages(existingTaskState.images);
      addEvidence(
        "复用已有构建任务",
        `${selectedServicesLabel(services)} 已存在于待构建任务中，跳过重复创建，继续定位任务内构建。`,
        "green"
      );
      return {
        ok: true,
        reused: true,
        message: "existing_build_task_reused",
        task: existingTaskState.task,
        images: existingTaskState.images
      };
    }
    const message = `构建平台已有 ${existing.tasks.length} 个待处理任务，但未包含当前服务组：${existingTaskState.missingServices.join(" / ") || selectedServicesLabel(services)}。为避免底层 API 的“已有待构建任务”失败，Pipeline 停在此处，请先处理原任务或改选任务内服务。`;
    addEvidence("已有构建任务冲突", message, "yellow");
    setProbeResult("已有构建任务冲突", { ok: false, error: "existing_build_task_conflict", message, existing }, "yellow");
    return { ok: false, error: "existing_build_task_conflict", message, existing };
  }

  const imageVersion = selected.generatedVersion;
  const buildImages = buildImagesForServices(services);
  addEvidence("构建任务创建请求提交", `${selectedServicesLabel(services)} / ${selected.codeBranch}`, "blue");
  let json;
  try {
    const response = await fetch("/api/execute/build-task", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        profileId: profile.id,
        accountId: account.id,
        customerNameEn: profile.customerNameEn,
        applicationCode: selected.applicationCode,
        applicationName: selected.applicationName || selected.applicationCode,
        codeBranch: selected.codeBranch,
        flowMode: flow.mode,
        structureType: flow.structureType,
        imageJenkinsName: selected.imageJenkinsName,
        imageNameEn: selected.imageNameEn || selected.row && selected.row.imageNameEn,
        imageVersion,
        imageDeployId: selected.imageDeployId || selected.row && selected.row.imageDeployId,
        buildImages,
        coverageRun: selected.coverageRun,
        confirmText,
        ...taskFields
      })
    });
    json = await response.json();
  } catch (error) {
    json = { ok: false, error: error.message };
  }

  const result = json.result || json;
  if (!result.ok) {
    addEvidence("构建任务创建失败", summarizeFailure(result), "red");
    setProbeResult("构建任务创建失败", result, "red");
    return result;
  }

  addEvidence("构建任务创建已确认", `${selectedServicesLabel(services)} 已通过 ${result.endpoint || "构建平台任务接口"}，平台业务码 ${result.response && result.response.businessCode || "未知"}。`, "green");
  setProbeResult("构建任务创建响应", result, "green");
  const createdVersion = result.payload && result.payload.images && result.payload.images[0] && result.payload.images[0].imageVersion
    || result.payload && result.payload.buildImages && result.payload.buildImages[0] && result.payload.buildImages[0].imageVersion
    || result.versionProbe && result.versionProbe.versions && result.versionProbe.versions[selected.imageNameEn || selected.row && selected.row.imageNameEn];
  if (createdVersion) {
    updateSelectedServiceMeta(selected.serviceKey, { generatedVersion: createdVersion });
  }
  if (result.versionProbe && result.versionProbe.versions) {
    for (const service of services) {
      const key = service.imageNameEn || service.row && service.row.imageNameEn;
      if (key && result.versionProbe.versions[key]) {
        updateSelectedServiceMeta(service.serviceKey, { generatedVersion: result.versionProbe.versions[key] });
      }
    }
  }
  if (state.pipeline.executionMode === "auto" || options.automatic) {
    addEvidence(
      "自动只读推进",
      `${selected.imageJenkinsName} 任务已创建，开始定位任务内服务行；真正任务构建仍会停在确认门。`,
      "blue"
    );
    await probeBuildTasksUntilBuildable({
      imageVersion: createdVersion,
      attempts: 5,
      maxTaskImageLookups: 15
    });
  }
  return result;
}

async function executeTaskImageBuild(options = {}) {
  const profile = getProfile();
  const selected = getSelectedService(profile);
  const services = getSelectedServices(profile);
  if (!selected) return null;
  const taskState = currentTaskImageSnapshot(profile, selected);
  const latestTask = taskState.task;
  const buildableImages = taskState.allBuildable
    ? taskState.images
    : taskState.image && taskState.image.buildPower === "1" ? [taskState.image] : [];
  const buildableImage = buildableImages[0] || null;

  if (!latestTask || !buildableImage) {
    const message = "没有定位到当前服务/版本对应的 buildPower=1 任务服务行。先点“读取构建任务”，确认创建后的任务已经出现。";
    addEvidence(options.automatic ? "自动构建未触发" : "任务内构建不可用", message, "yellow");
    return { ok: false, error: "task_build_not_ready", message };
  }

  const taskServiceName = buildableImage.imageJenkinsName || buildableImage.imageNameEn;
  const expectedConfirmText = `执行构建 ${selectedServicesLabel(services)}`;
  const confirmText = options.automatic
    ? expectedConfirmText
    : document.querySelector("[data-input='task-build-confirm']")?.value.trim() || "";
  if (!options.automatic && confirmText !== expectedConfirmText) {
    addEvidence("任务构建确认文本不匹配", `需要输入：${expectedConfirmText}`, "yellow");
    setProbeResult("任务构建确认文本不匹配", {
      ok: false,
      error: "confirmation_required",
      expectedConfirmText
    }, "yellow");
    return { ok: false, error: "confirmation_required", expectedConfirmText };
  }

  const account = getAccount(profile);
  if (!hasCredentials(profile, account)) {
    missingCredentialsEvidence(profile, account);
    return null;
  }

  const taskId = latestTask.id || latestTask.taskId || latestTask.buildTaskId;
  addEvidence(
    options.automatic ? "自动任务构建请求提交" : "任务内构建请求提交",
    `${selectedServicesLabel(services)} / task=${taskId}`,
    "blue"
  );
  let json;
  try {
    const response = await fetch("/api/execute/build", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        profileId: profile.id,
        accountId: account.id,
        customerNameEn: profile.customerNameEn,
        applicationCode: buildableImage.applicationCode || selected.applicationCode,
        applicationName: buildableImage.applicationName || selected.applicationName || selected.applicationCode,
        codeBranch: buildableImage.codeBranch || selected.codeBranch,
        envType: buildableImage.envType || selected.codeBranch,
        taskId,
        applyId: latestTask.structureApplyId,
        imageJenkinsName: taskServiceName,
        imageNameEn: buildableImage.imageNameEn || selected.imageNameEn,
        imageVersion: buildableImage.imageVersion,
        buildImages: buildableImages.map((item) => ({
          imageJenkinsName: item.imageJenkinsName || item.imageNameEn,
          imageNameEn: item.imageNameEn,
          imageVersion: item.imageVersion,
          applicationCode: item.applicationCode || selected.applicationCode,
          coverageRun: item.coverageRun
        })),
        confirmText
      })
    });
    json = await response.json();
  } catch (error) {
    json = { ok: false, error: error.message };
  }

  const result = json.result || json;
  if (!result.ok) {
    addEvidence(options.automatic ? "自动任务构建失败" : "任务内构建失败", summarizeFailure(result), "red");
    setProbeResult(options.automatic ? "自动任务构建失败" : "任务内构建失败", result, "red");
    return result;
  }

  addEvidence(
    options.automatic ? "自动任务构建已确认" : "任务内构建已确认",
    `${selectedServicesLabel(services)} 已调用 /support/buildImages，平台业务码 ${result.response && result.response.businessCode || "未知"}。`,
    "green"
  );
  setProbeResult(options.automatic ? "自动任务构建响应" : "任务内构建响应", result, "green");
  return result;
}

async function executePublish(stageId = "publish-company", options = {}) {
  const profile = getProfile();
  const selected = getSelectedService(profile);
  const app = getReleaseApp(profile);
  const env = getReleaseEnv(profile);
  if (!selected || !app || !env || Number(app.toPublishServiceNum || 0) === 0) {
    return { ok: false, error: "release_target_not_ready" };
  }

  const releasePolicy = releaseInputPolicy(profile, selected);
  if (releasePolicy.required && releasePolicy.missing.length) {
    addEvidence("发布入参未完成", `缺少：${releasePolicy.missing.join(" / ")}`, "yellow");
    setProbeResult("发布入参未完成", {
      ok: false,
      error: "missing_release_inputs",
      missing: releasePolicy.missing
    }, "yellow");
    return { ok: false, error: "missing_release_inputs", missing: releasePolicy.missing };
  }

  const expectedConfirmText = publishConfirmText(profile, env);
  const confirmText = options.automatic
    ? expectedConfirmText
    : document.querySelector("[data-input='publish-confirm']")?.value.trim() || "";
  if (!options.automatic && confirmText !== expectedConfirmText) {
    addEvidence("发布确认文本不匹配", `需要输入：${expectedConfirmText}`, "yellow");
    setProbeResult("发布确认文本不匹配", {
      ok: false,
      error: "confirmation_required",
      expectedConfirmText
    }, "yellow");
    return { ok: false, error: "confirmation_required", expectedConfirmText };
  }

  const account = getAccount(profile);
  if (!hasCredentials(profile, account)) {
    missingCredentialsEvidence(profile, account);
    return { ok: false, error: "credentials_not_configured" };
  }

  addEvidence("真正发布请求提交", `${profile.shortName} / ${state.activeApplicationCode} / ${env.showNameEn}/${env.environmentFlag}`, "blue");
  let json;
  try {
    const response = await fetch("/api/execute/publish", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        profileId: profile.id,
        accountId: account.id,
        customerNameEn: profile.customerNameEn,
        environmentId: env.id,
        showNameEn: env.showNameEn,
        environmentFlag: env.environmentFlag,
        environment: stageId === "publish-spot" ? "spot" : "company",
        applicationCode: state.activeApplicationCode,
        applicationVersion: app.applicationVersion,
        imageJenkinsName: selected.imageJenkinsName,
        confirmText
      })
    });
    json = await response.json();
  } catch (error) {
    json = { ok: false, error: error.message };
  }

  const result = json.result || json;
  if (!json.result && result.error === "confirmation_required") {
    addEvidence("发布确认文本不匹配", `需要输入：${result.expectedConfirmText}`, "yellow");
    setProbeResult("发布确认文本不匹配", result, "yellow");
    return result;
  }
  if (!result.ok) {
    addEvidence("真正发布失败", summarizeFailure(result), "red");
    setProbeResult("真正发布失败", result, "red");
    return result;
  }

  addEvidence("真正发布已确认", `${state.activeApplicationCode} ${app.applicationVersion} 已调用 /cloud/publishApps，平台业务码 ${result.response && result.response.businessCode || "未知"}。`, "green");
  setProbeResult("真正发布响应", result, "green");
  return result;
}

function shouldMarkStageFailure(result) {
  if (!result || result.ok) return false;
  return ![
    "confirmation_required",
    "credentials_not_configured",
    "missing_release_inputs",
    "missing_release_content",
    "missing_deployment_describe",
    "missing_deployment_explain",
    "release_target_not_ready",
    "service_not_selected"
  ].includes(result.error);
}

async function finishStageAction(stageId, action) {
  const result = await action();
  if (result && result.ok) {
    markPipelineStage(stageId, "succeeded", result.response || result.message || result.reason || null);
    render();
    await continueAutoPipeline();
    return result;
  }
  if (shouldMarkStageFailure(result)) {
    markPipelineStage(stageId, "failed", summarizeFailure(result));
    render();
  }
  return result;
}

async function continueAutoPipeline() {
  if (state.pipeline.executionMode !== "auto") return;
  for (let index = 0; index < 6; index += 1) {
    const plan = createPipelinePlan(getProfile());
    const stage = plan.currentStage;
    if (!window.PipelineAdapters.canAutoRun(stage)) return;
    await runPipelineStageAction(stage.id, { automatic: true });
  }
}

async function runPipelineStageAction(stageId, options = {}) {
  const profile = getProfile();
  const account = getAccount(profile);
  if (getSelectedServices(profile).length && !state.pipeline.runStarted) {
    state.pipeline.runStarted = true;
    state.pipeline.activity = [];
  }
  if (stageId === "account-ready") {
    state.activeView = "settings";
    render();
    return;
  }
  if (stageId === "build-probe") {
    return finishStageAction(stageId, () => runProbe("build", account.id));
  }
  if (stageId === "release-probe") {
    return finishStageAction(stageId, () => runProbe("release", account.id));
  }
  if (stageId === "build-status") {
    return finishStageAction(stageId, () => probeSelectedServiceDetail());
  }
  if (stageId === "version-preflight") {
    return finishStageAction(stageId, () => probeImageVersion());
  }
  if (stageId === "create-build-task") {
    const selected = getSelectedService(profile);
    const flow = buildFlowForBranch(selected && selected.codeBranch);
    if (flow.mode === "direct") {
      return finishStageAction(stageId, () => executeBuild(options));
    }
    return finishStageAction(stageId, () => createBuildTask(options));
  }
  if (stageId === "locate-build-task") {
    return finishStageAction(stageId, () => probeBuildTasks());
  }
  if (stageId === "task-image-build") {
    return finishStageAction(stageId, () => executeTaskImageBuild(options));
  }
  if (stageId === "release-inputs") {
    if (options.automatic) {
      ensureReleaseInputsForPipeline(profile, getSelectedService(profile));
    }
    const releasePolicy = releaseInputPolicy(profile, getSelectedService(profile));
    if (releasePolicy.missing.length) {
      addEvidence("发布入参未完成", `缺少：${releasePolicy.missing.join(" / ")}`, "yellow");
      return { ok: false, error: "missing_release_inputs", missing: releasePolicy.missing };
    }
    markPipelineStage(stageId, "succeeded", "release inputs ready");
    addEvidence("发布入参已保存", `${releasePolicy.reason} / ${releasePolicy.notice}`, "green");
    render();
    await continueAutoPipeline();
    return { ok: true };
  }
  if (stageId === "release-detail") {
    return finishStageAction(stageId, () => probeReleaseDetail());
  }
  if (stageId === "publish-company" || stageId === "publish-spot") {
    return finishStageAction(stageId, () => executePublish(stageId, options));
  }
  if (stageId === "final-verify") {
    const verifyKind = state.pipeline.templateId === "build-only"
      ? "build"
      : state.pipeline.templateId === "release-existing" || state.pipeline.templateId === "void-existing"
        ? "release"
        : "both";
    return finishStageAction(stageId, () => runProbe(verifyKind, account.id));
  }
  addEvidence("Pipeline 阶段", `${stageId} 当前只作为计划/上下文阶段展示。`, "blue");
}

function resetPipelineOutcomesForLaunch(templateId) {
  state.pipeline.templateId = window.PipelineCore.normalizeTemplateId(templateId);
  state.pipeline.executionMode = "auto";
  state.pipeline.failedStageId = "";
  state.pipeline.stageOutcomes = {};
  state.pipeline.inspectedStageId = "";
  state.pipeline.runStarted = true;
  state.pipeline.activity = [];
  ensurePipelineRun(getProfile());
  state.pipeline.runStarted = true;
}

async function waitForReleasePending(profile, options = {}) {
  const attempts = options.attempts || 12;
  const intervalMs = options.intervalMs || 5000;
  for (let index = 0; index < attempts; index += 1) {
    const app = getReleaseApp(profile);
    if (Number(app && app.toPublishServiceNum || 0) > 0) {
      return { ok: true, app };
    }
    addEvidence("等待发布平台生成待发布记录", `第 ${index + 1}/${attempts} 次刷新 ${state.activeApplicationCode}，当前待发布数仍为 0。`, "yellow");
    await runProbe("release", getAccount(profile).id);
    await probeReleaseDetail();
    if (Number(getReleaseApp(profile) && getReleaseApp(profile).toPublishServiceNum || 0) > 0) {
      return { ok: true, app: getReleaseApp(profile) };
    }
    if (index < attempts - 1) {
      await delay(intervalMs);
    }
  }
  return {
    ok: false,
    error: "release_pending_not_ready",
    message: "构建已触发，但发布平台还没有出现待发布服务。Pipeline 停在发布阶段，可稍后从这里重试。"
  };
}

async function runCommonPipeline(templateId) {
  const profile = getProfile();
  const selected = getSelectedService(profile);
  const services = getSelectedServices(profile);
  const action = COMMON_PIPELINES.find((item) => item.id === templateId) || COMMON_PIPELINES[0];
  const disabledReason = pipelineButtonDisabledReason(action, profile, selected);
  if (disabledReason) {
    addEvidence("Pipeline 未启动", disabledReason, action.disabled ? "yellow" : "red");
    render();
    return;
  }

  resetPipelineOutcomesForLaunch(templateId);
  ensureReleaseInputsForPipeline(profile, selected);
  state.pipeline.isRunning = true;
  addEvidence("Pipeline 一键启动", `${action.title}：${selectedServicesLabel(services)} / ${selected.codeBranch}`, "blue");
  render();

  try {
    for (let index = 0; index < 40; index += 1) {
      const nextPlan = createPipelinePlan(getProfile());
      const stage = nextPlan.currentStage;

      if (!stage) {
        addEvidence("Pipeline 已完成", `${action.title} 已没有待执行阶段。`, "green");
        break;
      }

      state.pipeline.inspectedStageId = stage.id;
      persistWorkbenchState();
      render();

      if (stage.status === "blocked" && stage.id === "task-image-build" && (stage.missing || []).includes("buildPower=1")) {
        const selectedNow = getSelectedService(getProfile());
        const taskResult = await probeBuildTasksUntilBuildable({
          imageVersion: selectedNow && selectedNow.generatedVersion,
          attempts: 8,
          intervalMs: 3000,
          maxTaskImageLookups: 15
        });
        const taskState = taskResult ? currentTaskImageSnapshot(getProfile(), getSelectedService(getProfile())) : null;
        if (taskState && taskState.allBuildable || taskResult && taskResult.matchedImage && taskResult.matchedImage.buildPower === "1") {
          continue;
        }
        addEvidence("Pipeline 暂停", "构建任务还没有开放 buildPower=1，可稍后从任务内构建阶段重试。", "yellow");
        break;
      }

      if (stage.status === "blocked" && stage.id === "publish-company" && (stage.missing || []).includes("toPublishServiceNum>0")) {
        const pending = await waitForReleasePending(getProfile());
        if (pending.ok) {
          continue;
        }
        addEvidence("Pipeline 暂停", pending.message, "yellow");
        break;
      }

      if (stage.status === "blocked") {
        addEvidence("Pipeline 暂停", `${stage.title} 缺少：${(stage.missing || []).join(" / ") || "前置条件"}`, "yellow");
        break;
      }

      const result = await runPipelineStageAction(stage.id, { automatic: true, pipelineRun: true });
      if (result && result.ok === false) {
        if (!shouldMarkStageFailure(result)) {
          addEvidence("Pipeline 暂停", summarizeFailure(result), "yellow");
        }
        break;
      }
      if (state.pipeline.failedStageId) {
        break;
      }

      if (stage.id === "publish-company") {
        await runProbe("release", getAccount(getProfile()).id);
        await probeReleaseDetail();
      }
    }
  } finally {
    state.pipeline.isRunning = false;
    persistWorkbenchState();
    render();
  }
}

function attachEvents() {
  document.body.addEventListener("submit", async (event) => {
    const form = event.target.closest("[data-credential-form]");
    if (!form) return;
    event.preventDefault();
    const [profileId, accountId] = form.dataset.credentialForm.split(":");
    const formData = new FormData(form);
    let json;
    try {
      const response = await fetch("/api/config/credentials", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          profileId,
          accountId,
          username: String(formData.get("username") || "").trim(),
          password: String(formData.get("password") || "")
        })
      });
      json = await response.json();
    } catch (error) {
      json = { ok: false, error: error.message };
    }
    if (!json.ok) {
      addEvidence("账号保存失败", json.error || "unknown_error", "red");
      return;
    }
    replaceCredentialState(json.credentialState);
    const profile = state.bootstrap.profiles.find((item) => item.id === profileId);
    addEvidence("账号配置已保存", `${profile ? profile.shortName : profileId} / ${accountId} 已写入本地凭据库。`, "green");
    render();
  });

  document.body.addEventListener("change", (event) => {
    const releaseReasonInput = event.target.closest("[data-input='pipeline-release-reason']");
    if (releaseReasonInput) {
      state.pipeline.inputs.releaseReason = releaseReasonInput.value;
      persistWorkbenchState();
      return;
    }

    const releaseNoticeInput = event.target.closest("[data-input='pipeline-release-notice']");
    if (releaseNoticeInput) {
      state.pipeline.inputs.releaseNotice = releaseNoticeInput.value;
      persistWorkbenchState();
      return;
    }

    const select = event.target.closest("[data-select]");
    if (!select) return;
    const profile = getProfile();
    if (select.dataset.select === "account") {
      state.activeAccountId = select.value;
    }
    if (select.dataset.select === "application") {
      state.activeApplicationCode = select.value;
      clearSelectedServices();
    }
    if (select.dataset.select === "branch") {
      state.activeBuildBranch = select.value;
      clearSelectedServices();
    }
    if (select.dataset.select === "release-env") {
      state.activeReleaseEnvId = select.value;
    }
    if (select.dataset.select === "pipeline-template") {
      state.pipeline.templateId = select.value;
      state.pipeline.inspectedStageId = "";
    }
    if (select.dataset.select === "pipeline-mode") {
      state.pipeline.executionMode = select.value;
    }
    normalizeSelections(profile);
    render();
  });

  document.body.addEventListener("input", (event) => {
    const releaseReasonInput = event.target.closest("[data-input='pipeline-release-reason']");
    if (releaseReasonInput) {
      state.pipeline.inputs.releaseReason = releaseReasonInput.value;
      persistWorkbenchState();
      return;
    }

    const releaseNoticeInput = event.target.closest("[data-input='pipeline-release-notice']");
    if (releaseNoticeInput) {
      state.pipeline.inputs.releaseNotice = releaseNoticeInput.value;
      persistWorkbenchState();
      return;
    }

    const input = event.target.closest("[data-input='service-search']");
    if (!input) return;
    state.serviceSearch = input.value;
    renderServiceChooser(getProfile());
  });

  document.body.addEventListener("click", (event) => {
    const navButton = event.target.closest("[data-view-nav]");
    if (navButton) {
      state.activeView = navButton.dataset.viewNav;
      render();
      return;
    }

    const workflowProfileButton = event.target.closest("[data-workflow-profile]");
    if (workflowProfileButton) {
      switchProfile(workflowProfileButton.dataset.workflowProfile);
      state.activeView = "workbench";
      render();
      return;
    }

    const configProfileButton = event.target.closest("[data-config-profile]");
    if (configProfileButton) {
      switchProfile(configProfileButton.dataset.configProfile);
      state.activeView = "workbench";
      render();
      return;
    }

    const resetCredentialButton = event.target.closest("[data-reset-credential]");
    if (resetCredentialButton) {
      const [profileId, accountId] = resetCredentialButton.dataset.resetCredential.split(":");
      fetch("/api/config/credentials", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ profileId, accountId })
      })
        .then((response) => response.json())
        .then((json) => {
          if (!json.ok) {
            addEvidence("账号恢复失败", json.error || "unknown_error", "red");
            return;
          }
          replaceCredentialState(json.credentialState);
          addEvidence("账号配置已恢复", `${profileId} / ${accountId} 已切回环境变量或默认配置。`, "yellow");
          render();
        })
        .catch((error) => addEvidence("账号恢复失败", error.message, "red"));
      return;
    }

    const probeButton = event.target.closest("[data-probe]");
    if (probeButton) {
      runProbe(probeButton.dataset.probe, probeButton.dataset.account);
      return;
    }

    const presetButton = event.target.closest("[data-preset]");
    if (presetButton) {
      if (presetButton.dataset.preset === "demob-prescription-prod") {
        applyGamPrescriptionProdPreset();
        render();
      }
      return;
    }

    const pipelineStageButton = event.target.closest("[data-pipeline-stage]");
    if (pipelineStageButton) {
      state.pipeline.inspectedStageId = pipelineStageButton.dataset.pipelineStage;
      persistWorkbenchState();
      render();
      return;
    }

    const stageActionButton = event.target.closest("[data-stage-action]");
    if (stageActionButton) {
      runPipelineStageAction(stageActionButton.dataset.stageAction);
      return;
    }

    const stageRetryButton = event.target.closest("[data-stage-retry]");
    if (stageRetryButton) {
      clearPipelineFromStage(stageRetryButton.dataset.stageRetry);
      return;
    }

    if (event.target.closest("[data-reset-pipeline-run]")) {
      state.pipeline.runKey = "";
      state.pipeline.failedStageId = "";
      state.pipeline.stageOutcomes = {};
      state.pipeline.inspectedStageId = "";
      ensurePipelineRun(getProfile());
      addEvidence("Pipeline 已重建", "当前选择项已生成新的 Pipeline Run，历史阶段输出已清空。", "yellow");
      render();
      return;
    }

    const branchButton = event.target.closest("[data-switch-branch]");
    if (branchButton) {
      state.activeBuildBranch = branchButton.dataset.switchBranch;
      clearSelectedServices();
      render();
      return;
    }

    const selectedPipelineButton = event.target.closest("[data-selected-pipeline]");
    if (selectedPipelineButton) {
      const services = getSelectedServices(getProfile());
      if (!services.length) {
        addEvidence("Pipeline 未启动", "先选择一个或多个服务。", "yellow");
        return;
      }
      runCommonPipeline(selectedPipelineButton.dataset.selectedPipeline);
      return;
    }

    const servicePipelineButton = event.target.closest("[data-service-pipeline]");
    if (servicePipelineButton) {
      const profile = getProfile();
      const row = findServiceRowByKey(servicePipelineButton.dataset.serviceKey, profile);
      if (!row) {
        addEvidence("服务选择失败", "当前服务不在构建平台返回列表中。", "red");
        return;
      }
      selectServiceRow(row, profile, { silent: true });
      runCommonPipeline(servicePipelineButton.dataset.servicePipeline);
      return;
    }

    const serviceButton = event.target.closest("[data-service-select]");
    if (serviceButton) {
      const profile = getProfile();
      const row = findServiceRowByKey(serviceButton.dataset.serviceSelect, profile);
      if (!row) {
        addEvidence("服务选择失败", "当前服务不在构建平台返回列表中。", "red");
        return;
      }
      selectServiceRow(row, profile, { toggle: true });
      render();
      return;
    }

    if (event.target.closest("[data-probe-service-detail]")) {
      probeSelectedServiceDetail();
      return;
    }

    if (event.target.closest("[data-probe-build-tasks]")) {
      probeBuildTasks();
      return;
    }

    if (event.target.closest("[data-probe-image-version]")) {
      probeImageVersion();
      return;
    }

    if (event.target.closest("[data-probe-structure-configs]")) {
      probeStructureConfigs();
      return;
    }

    if (event.target.closest("[data-probe-release-detail]")) {
      probeReleaseDetail();
      return;
    }

    const copyButton = event.target.closest("[data-copy-payload]");
    if (copyButton) {
      copyPayload(copyButton.dataset.copyPayload);
      return;
    }

    if (event.target.closest("[data-execute-build]")) {
      runPipelineStageAction("create-build-task");
      return;
    }

    if (event.target.closest("[data-create-build-task]")) {
      runPipelineStageAction("create-build-task");
      return;
    }

    if (event.target.closest("[data-execute-task-image-build]")) {
      runPipelineStageAction("task-image-build");
      return;
    }

    if (event.target.closest("[data-execute-publish]")) {
      runPipelineStageAction("publish-company");
      return;
    }

    if (event.target.closest("[data-clear-service]")) {
      clearSelectedServices();
      render();
    }
  });
}

function render() {
  if (!state.bootstrap) return;
  const profile = getProfile() || state.bootstrap.profiles[0];
  normalizeSelections(profile);
  renderNavigation();
  renderProfiles();
  renderContext(profile);
  renderPipelineRunner(profile);
  renderTargetPicker(profile);
  renderSessions(profile);
  renderServiceChooser(profile);
  renderBuildConsole(profile);
  renderReleaseConsole(profile);
  renderOperationCard(profile);
  renderProfileConfig();
  renderSystemConfig();
  renderApiDictionary();
  renderEvidence();
  if (state.lastProbeResult) {
    setProbeResult(state.lastProbeResult.title, state.lastProbeResult.payload, state.lastProbeResult.tone);
  }
  scheduleAutoWarm();
}

async function loadBootstrap() {
  const response = await fetch("/api/bootstrap");
  state.bootstrap = await response.json();
  restoreWorkbenchState();
  if (!state.bootstrap.profiles.some((profile) => profile.id === state.activeProfileId)) {
    state.activeProfileId = state.bootstrap.profiles[0].id;
  }
  const profile = getProfile();
  state.activeAccountId = profile.accounts.some((account) => account.id === state.activeAccountId)
    ? state.activeAccountId
    : profile.accounts[0].id;
  state.activeApplicationCode = profile.applications.some((app) => app.code === state.activeApplicationCode)
    ? state.activeApplicationCode
    : profile.applications[0].code;
  state.activeReleaseEnvId = profile.releaseEnvironments.some((env) => env.id === state.activeReleaseEnvId)
    ? state.activeReleaseEnvId
    : profile.releaseEnvironments[0].id;
  state.activeBuildBranch = state.activeBuildBranch || recommendBranchForEnv(profile.releaseEnvironments[0]);
  addEvidence("工作台初始化", `加载 ${state.bootstrap.profiles.length} 个医院 Profile；默认进入 ${profile.shortName}。`, "green");
  render();
}

attachEvents();
loadBootstrap();
