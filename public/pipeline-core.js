(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  root.PipelineCore = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const BASE_BRANCHES = [
    { code: "develop", label: "开发环境构建", releaseRequired: false, hint: "构建完成后通常不进入发布平台。" },
    { code: "release", label: "提测构建", releaseRequired: true, hint: "构建完成后需要到发布平台发布测试环境。" },
    { code: "mastertest", label: "现场测试构建", releaseRequired: true, hint: "构建完成后需要到发布平台发布测试/准生产环境。" },
    { code: "master", label: "生产构建", releaseRequired: true, hint: "构建完成后需要到发布平台发布生产环境。" }
  ];

  const DECORATORS = {
    CompositePipeline: {
      id: "CompositePipeline",
      title: "组合 Pipeline",
      description: "把基础流程顺序组合，并把上游 output 作为下游 input。"
    },
    ManualPipelineDecorator: {
      id: "ManualPipelineDecorator",
      title: "手动推进",
      description: "每个阶段完成后停住，由用户点击下一步。"
    },
    AutoPipelineDecorator: {
      id: "AutoPipelineDecorator",
      title: "自动只读推进",
      description: "只读探测阶段可自动推进，构建/发布 mutation 仍必须确认。"
    },
    GuardedMutationDecorator: {
      id: "GuardedMutationDecorator",
      title: "变更保护",
      description: "构建、发布、作废等 mutation 前必须展示 payload 和确认文本。"
    },
    RetryablePipelineDecorator: {
      id: "RetryablePipelineDecorator",
      title: "失败续跑",
      description: "失败后从当前阶段继续，不重放已完成动作。"
    },
    ObservablePipelineDecorator: {
      id: "ObservablePipelineDecorator",
      title: "过程观测",
      description: "把阶段证据、错误、payload 摘要和下一步动作记录在同一个 run。"
    }
  };

  const TEMPLATES = [
    {
      id: "build-and-release",
      legacyIds: ["build-then-release"],
      title: "完整基础 Pipeline：构建 + 发布",
      description: "以服务为作业对象生成完整流程；开发环境保留发布段但按策略跳过，测试/生产环境要求发布入参。",
      scope: "full",
      stageIds: [
        "target-ready",
        "account-ready",
        "build-probe",
        "release-probe",
        "service-selected",
        "build-status",
        "version-preflight",
        "create-build-task",
        "locate-build-task",
        "task-image-build",
        "release-inputs",
        "release-detail",
        "publish-company",
        "publish-spot",
        "final-verify"
      ]
    },
    {
      id: "build-only",
      title: "子集 Pipeline：仅构建",
      description: "完整基础 Pipeline 的构建子集；用于只验证构建平台能力，不代表最终默认模型。",
      scope: "subset",
      stageIds: [
        "target-ready",
        "account-ready",
        "build-probe",
        "service-selected",
        "build-status",
        "version-preflight",
        "create-build-task",
        "locate-build-task",
        "task-image-build",
        "final-verify"
      ]
    },
    {
      id: "release-existing",
      title: "子集 Pipeline：发布已有版本",
      description: "完整基础 Pipeline 的发布子集；复用当前发布平台版本进入两段发布确认。",
      scope: "subset",
      stageIds: [
        "target-ready",
        "account-ready",
        "release-probe",
        "service-selected",
        "release-inputs",
        "release-detail",
        "publish-company",
        "publish-spot",
        "final-verify"
      ]
    },
    {
      id: "void-existing",
      title: "子集 Pipeline：作废已有版本",
      description: "作废能力先纳入模型；真实作废必须先验证发布平台 delPublish endpoint。",
      scope: "subset",
      disabledReason: "MVP 仅建模，不默认开放真实作废。",
      stageIds: [
        "target-ready",
        "account-ready",
        "release-probe",
        "service-selected",
        "release-detail",
        "void-release",
        "final-verify"
      ]
    }
  ];

  const CHILD_PIPELINES = [
    { id: "target-context", title: "目标上下文", stageIds: ["target-ready", "account-ready"] },
    { id: "build-service", title: "构建服务", stageIds: ["build-probe", "service-selected", "build-status", "version-preflight", "create-build-task", "locate-build-task", "task-image-build"] },
    { id: "release-platform", title: "发布平台", stageIds: ["release-probe", "release-inputs", "release-detail", "publish-company", "publish-spot", "void-release"] },
    { id: "final-verification", title: "最终核验", stageIds: ["final-verify"] }
  ];

  const STAGE_CAPABILITY_KEYS = {
    "account-ready": "credentialsReady",
    "build-probe": "buildProbeReady",
    "release-probe": "releaseProbeReady",
    "service-selected": "serviceSelected",
    "build-status": "buildStatusReady",
    "version-preflight": "versionReady",
    "create-build-task": "buildTaskCreated",
    "locate-build-task": "buildTaskLocated",
    "task-image-build": "taskBuildSucceeded",
    "release-inputs": "releaseInputsReady",
    "release-detail": "releaseDetailReady",
    "publish-company": "companyPublishSucceeded",
    "publish-spot": "spotPublishSucceeded",
    "void-release": "voidSucceeded",
    "final-verify": "finalVerified"
  };

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function normalizeTemplateId(templateId) {
    const found = TEMPLATES.find((item) => item.id === templateId || (item.legacyIds || []).includes(templateId));
    return (found || TEMPLATES[0]).id;
  }

  function getTemplate(templateId) {
    const id = normalizeTemplateId(templateId);
    return TEMPLATES.find((item) => item.id === id) || TEMPLATES[0];
  }

  function isProdBranch(branchCode = "") {
    return branchCode === "master" || /prod|生产/.test(branchCode);
  }

  function environmentPolicy(branchCode = "mastertest") {
    if (branchCode === "develop") {
      return {
        branchCode,
        buildMode: "direct",
        releaseRequired: false,
        releaseStages: [],
        buildTaskRequired: false,
        structureType: null,
        actionLabel: "执行开发构建",
        label: "开发直构建",
        status: "green",
        description: "develop 分支不创建构建任务，直接调用 /support/buildImages。"
      };
    }

    if (branchCode === "release") {
      return {
        branchCode,
        buildMode: "release-task",
        releaseRequired: true,
        releaseStages: ["spot"],
        buildTaskRequired: true,
        structureType: "release",
        actionLabel: "创建提测构建任务",
        label: "提测任务构建",
        status: "yellow",
        description: "release 分支从 applyRelease 表单创建构建任务，本质调用 /support/buildImages 并带发布说明字段。"
      };
    }

    return {
      branchCode,
      buildMode: "apply-task",
      releaseRequired: true,
      releaseStages: branchCode === "master" ? ["company", "spot"] : ["spot"],
      buildTaskRequired: true,
      structureType: "prod",
      strategyLocked: branchCode !== "master",
      actionLabel: "创建构建任务",
      label: isProdBranch(branchCode) ? "生产构建申请" : "构建申请",
      status: isProdBranch(branchCode) ? "red" : "yellow",
      description: branchCode === "mastertest"
        ? "mastertest 直接进入 applyMaster，固定 codeBranch=mastertest + structureType=prod。"
        : "该分支先调用 /support/applyProdStruct 创建任务，再到任务页选择服务构建。"
    };
  }

  function decoratorsForMode(mode = "manual") {
    return [
      DECORATORS.CompositePipeline,
      mode === "auto" ? DECORATORS.AutoPipelineDecorator : DECORATORS.ManualPipelineDecorator,
      DECORATORS.GuardedMutationDecorator,
      DECORATORS.RetryablePipelineDecorator,
      DECORATORS.ObservablePipelineDecorator
    ];
  }

  function requiredReleaseInputs(context, policy) {
    if (!policy.releaseRequired) return [];
    const inputs = context.inputs || {};
    const missing = [];
    if (!String(inputs.releaseReason || "").trim()) missing.push("发布理由");
    if (!String(inputs.releaseNotice || "").trim()) missing.push("注意事项");
    return missing;
  }

  function stageDefinitions(context, policy) {
    const capabilities = context.capabilities || {};
    const releaseInputMissing = requiredReleaseInputs(context, policy);
    const releaseStages = policy.releaseStages || (policy.releaseRequired ? ["company", "spot"] : []);
    const hasCompanyPublish = releaseStages.includes("company");
    const hasSpotPublish = releaseStages.includes("spot");
    return {
      "target-ready": {
        title: "锁定目标",
        group: "target",
        kind: "read",
        done: Boolean(context.profileId && context.accountId && context.applicationCode && context.buildBranch),
        missing: [
          context.profileId ? "" : "profileId",
          context.accountId ? "" : "accountId",
          context.applicationCode ? "" : "applicationCode",
          context.buildBranch ? "" : "buildBranch"
        ].filter(Boolean)
      },
      "account-ready": {
        title: "账号凭据",
        group: "target",
        kind: "read",
        done: Boolean(capabilities.credentialsReady),
        missing: capabilities.credentialsReady ? [] : ["credentials"]
      },
      "build-probe": {
        title: "探测构建平台",
        group: "build",
        kind: "read",
        done: Boolean(capabilities.buildProbeReady),
        canRun: Boolean(capabilities.credentialsReady),
        missing: capabilities.buildProbeReady ? [] : ["buildProbe"]
      },
      "release-probe": {
        title: "探测发布平台",
        group: "release",
        kind: "read",
        skipped: !policy.releaseRequired,
        done: !policy.releaseRequired || Boolean(capabilities.releaseProbeReady),
        canRun: policy.releaseRequired && Boolean(capabilities.credentialsReady),
        missing: !policy.releaseRequired || capabilities.releaseProbeReady ? [] : ["releaseProbe"]
      },
      "service-selected": {
        title: "选择服务",
        group: "target",
        kind: "read",
        done: Boolean(context.service || capabilities.serviceSelected),
        missing: context.service || capabilities.serviceSelected ? [] : ["service"]
      },
      "build-status": {
        title: "读取构建状态",
        group: "build",
        kind: "read",
        done: Boolean(capabilities.buildStatusReady),
        canRun: Boolean(context.service),
        missing: capabilities.buildStatusReady ? [] : ["buildServiceDetail"]
      },
      "version-preflight": {
        title: "生成版本预检",
        group: "build",
        kind: "read",
        skipped: !policy.buildTaskRequired,
        done: !policy.buildTaskRequired || Boolean(capabilities.versionReady),
        canRun: policy.buildTaskRequired && Boolean(context.service),
        missing: !policy.buildTaskRequired || capabilities.versionReady ? [] : ["imageVersion"]
      },
      "create-build-task": {
        title: policy.buildTaskRequired ? "创建构建任务" : "执行开发构建",
        group: "build",
        kind: "mutation",
        done: policy.buildTaskRequired ? Boolean(capabilities.buildTaskCreated) : Boolean(capabilities.directBuildSucceeded),
        canRun: Boolean(context.service),
        missing: context.service ? [] : ["service"]
      },
      "locate-build-task": {
        title: "定位任务服务行",
        group: "build",
        kind: "read",
        skipped: !policy.buildTaskRequired,
        done: !policy.buildTaskRequired || Boolean(capabilities.buildTaskLocated),
        canRun: policy.buildTaskRequired && Boolean(context.service),
        missing: !policy.buildTaskRequired || capabilities.buildTaskLocated ? [] : ["buildTaskSnapshot"]
      },
      "task-image-build": {
        title: "任务内构建",
        group: "build",
        kind: "mutation",
        skipped: !policy.buildTaskRequired,
        done: !policy.buildTaskRequired || Boolean(capabilities.taskBuildSucceeded),
        canRun: policy.buildTaskRequired && Boolean(context.service),
        missing: !policy.buildTaskRequired || capabilities.buildTaskLocated ? [] : ["buildPower=0"]
      },
      "release-inputs": {
        title: "填充发布入参",
        group: "release",
        kind: "read",
        skipped: !policy.releaseRequired,
        done: !policy.releaseRequired || releaseInputMissing.length === 0,
        missing: releaseInputMissing
      },
      "release-detail": {
        title: "读取发布清单",
        group: "release",
        kind: "read",
        skipped: !policy.releaseRequired,
        done: !policy.releaseRequired || Boolean(capabilities.releaseDetailReady),
        canRun: policy.releaseRequired && Boolean(context.service),
        missing: !policy.releaseRequired || capabilities.releaseDetailReady ? [] : ["releaseDetail"]
      },
      "publish-company": {
        title: "公司发布",
        group: "release",
        kind: "mutation",
        skipped: !policy.releaseRequired || !hasCompanyPublish,
        done: !policy.releaseRequired || !hasCompanyPublish || Boolean(capabilities.companyPublishSucceeded),
        canRun: policy.releaseRequired && hasCompanyPublish && Boolean(context.service),
        missing: !policy.releaseRequired || !hasCompanyPublish ? [] : releaseInputMissing
      },
      "publish-spot": {
        title: "现场发布",
        group: "release",
        kind: "mutation",
        skipped: !policy.releaseRequired || !hasSpotPublish,
        done: !policy.releaseRequired || !hasSpotPublish || Boolean(capabilities.spotPublishSucceeded),
        canRun: policy.releaseRequired && hasSpotPublish && Boolean(context.service) && (!hasCompanyPublish || Boolean(capabilities.companyPublishSucceeded)),
        missing: !policy.releaseRequired || !hasSpotPublish
          ? []
          : releaseInputMissing.concat(hasCompanyPublish && !capabilities.companyPublishSucceeded ? ["companyPublishEvidence"] : [])
      },
      "void-release": {
        title: "作废发布记录",
        group: "release",
        kind: "mutation",
        done: Boolean(capabilities.voidSucceeded),
        canRun: Boolean(capabilities.releaseDetailReady),
        missing: capabilities.releaseDetailReady ? ["delPublishEndpointVerification"] : ["releaseDetail"]
      },
      "final-verify": {
        title: "最终核验",
        group: "verify",
        kind: "read",
        done: Boolean(capabilities.finalVerified),
        canRun: true,
        missing: capabilities.finalVerified ? [] : ["finalEvidence"]
      }
    };
  }

  function stageStatus(stage, index, currentIndex, failedStageId) {
    const missing = stage.missing || [];
    if (stage.skipped) return "skipped";
    if (stage.id === failedStageId) return "failed";
    if (stage.done) return "succeeded";
    if (index > currentIndex) return "pending";
    if (missing.length > 0) return "blocked";
    if (stage.canRun === false) return "blocked";
    if (stage.kind === "mutation") return "waiting_confirmation";
    return "ready";
  }

  function createChildPipelines(stages) {
    return CHILD_PIPELINES
      .map((child) => {
        const childStages = stages.filter((stage) => child.stageIds.includes(stage.id));
        if (!childStages.length) return null;
        const active = childStages.some((stage) => stage.isCurrent);
        const blocked = childStages.some((stage) => stage.status === "failed" || stage.status === "blocked");
        const succeeded = childStages.every((stage) => ["succeeded", "skipped"].includes(stage.status));
        return {
          ...child,
          status: blocked ? "blocked" : active ? "active" : succeeded ? "succeeded" : "pending",
          stages: childStages
        };
      })
      .filter(Boolean);
  }

  function runStatus(stages, currentStage, failedStage) {
    if (failedStage) return "failed";
    if (currentStage && currentStage.status === "blocked") return "blocked";
    if (currentStage && currentStage.status === "waiting_confirmation") return "waiting_confirmation";
    if (stages.length && stages.every((stage) => ["succeeded", "skipped"].includes(stage.status))) return "succeeded";
    if (currentStage) return currentStage.status;
    return "draft";
  }

  function createPipelineRun(context = {}) {
    const template = getTemplate(context.templateId);
    const branchCode = context.buildBranch || context.service && context.service.codeBranch || "mastertest";
    const policy = environmentPolicy(branchCode);
    const definitions = stageDefinitions(context, policy);
    const failedStageId = context.failedStageId || "";
    const runId = context.runId || [
      context.profileId,
      context.accountId,
      context.applicationCode,
      branchCode,
      context.releaseEnvironment && context.releaseEnvironment.showNameEn,
      context.serviceGroupKey,
      context.service && (context.service.serviceKey || context.service.imageJenkinsName),
      template.id
    ].filter(Boolean).join("::") || `pipeline-${Date.now()}`;

    const rawStages = template.stageIds.map((stageId, index) => ({
      id: stageId,
      index,
      retryFromStageId: stageId,
      actionKey: stageId,
      ...(definitions[stageId] || {
        title: stageId,
        group: "unknown",
        kind: "read",
        done: false,
        missing: []
      })
    }));

    const currentIndex = rawStages.findIndex((stage) => !stage.skipped && !stage.done || stage.id === failedStageId);
    const normalizedCurrentIndex = currentIndex === -1 ? rawStages.length : currentIndex;
    const stages = rawStages.map((stage, index) => {
      const next = {
        ...stage,
        status: stageStatus(stage, index, normalizedCurrentIndex, failedStageId),
        isCurrent: false
      };
      return next;
    });
    const currentStage = stages.find((stage) => !["succeeded", "skipped", "pending"].includes(stage.status)) || null;
    for (const stage of stages) {
      stage.isCurrent = Boolean(currentStage && currentStage.id === stage.id);
    }
    const failedStage = stages.find((stage) => stage.status === "failed") || null;

    return {
      id: runId,
      templateId: template.id,
      title: template.title,
      description: template.description,
      scope: template.scope,
      executionMode: context.mode || context.executionMode || "manual",
      status: runStatus(stages, currentStage, failedStage),
      currentStage,
      failedStage,
      retryFromStageId: (failedStage || currentStage) && (failedStage || currentStage).retryFromStageId,
      stages,
      childPipelines: createChildPipelines(stages),
      decorators: decoratorsForMode(context.mode || context.executionMode || "manual"),
      policy,
      context: clone(context)
    };
  }

  function resetFromStage(run, stageId) {
    const index = run.stages.findIndex((stage) => stage.id === stageId);
    if (index < 0) return run;
    const context = clone(run.context || {});
    context.failedStageId = "";
    context.capabilities = { ...(context.capabilities || {}) };
    for (const stage of run.stages.slice(index)) {
      const key = STAGE_CAPABILITY_KEYS[stage.id];
      if (key && key !== "releaseInputsReady") {
        delete context.capabilities[key];
      }
    }
    return createPipelineRun(context);
  }

  function formatStageStatus(status) {
    const labels = {
      blocked: "阻塞",
      failed: "失败",
      pending: "等待",
      planned: "已规划",
      ready: "可执行",
      skipped: "跳过",
      succeeded: "完成",
      waiting_confirmation: "等待确认",
      active: "当前"
    };
    return labels[status] || status || "-";
  }

  return {
    BASE_BRANCHES,
    CHILD_PIPELINES,
    DECORATORS,
    STAGE_CAPABILITY_KEYS,
    TEMPLATES,
    createChildPipelines,
    createPipelineRun,
    decoratorsForMode,
    environmentPolicy,
    formatStageStatus,
    getTemplate,
    normalizeTemplateId,
    requiredReleaseInputs,
    resetFromStage
  };
});
