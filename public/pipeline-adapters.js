(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  root.PipelineAdapters = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const ACTIONS = {
    "account-ready": {
      kind: "navigation",
      label: "进入系统配置"
    },
    "build-probe": {
      kind: "read",
      label: "探测构建服务"
    },
    "release-probe": {
      kind: "read",
      label: "探测发布环境"
    },
    "build-status": {
      kind: "read",
      label: "读取构建状态"
    },
    "version-preflight": {
      kind: "read",
      label: "生成版本预检"
    },
    "create-build-task": {
      kind: "mutation",
      label: "执行构建阶段"
    },
    "locate-build-task": {
      kind: "read",
      label: "读取构建任务"
    },
    "task-image-build": {
      kind: "mutation",
      label: "从任务构建"
    },
    "release-inputs": {
      kind: "input",
      label: "填写发布理由/注意事项"
    },
    "release-detail": {
      kind: "read",
      label: "读取发布清单"
    },
    "publish-company": {
      kind: "mutation",
      label: "公司发布"
    },
    "publish-spot": {
      kind: "mutation",
      label: "现场发布"
    },
    "void-release": {
      kind: "mutation",
      label: "作废发布记录"
    },
    "final-verify": {
      kind: "read",
      label: "刷新双平台"
    }
  };

  function actionForStage(stageId) {
    return ACTIONS[stageId] || {
      kind: "read",
      label: "查看阶段"
    };
  }

  function isGuardedMutation(stage) {
    return Boolean(stage && (stage.kind === "mutation" || actionForStage(stage.id).kind === "mutation"));
  }

  function canAutoRun(stage) {
    return Boolean(stage && stage.status === "ready" && !isGuardedMutation(stage));
  }

  function confirmationForStage(stage, context = {}) {
    if (!stage) return "";
    const service = context.service || {};
    const profile = context.profile || {};
    const env = context.releaseEnvironment || {};
    const applicationCode = context.applicationCode || service.applicationCode || "";

    if (stage.id === "create-build-task") {
      const policy = context.policy || {};
      const verb = policy.buildTaskRequired ? "创建构建任务" : "执行构建";
      return `${verb} ${service.imageJenkinsName || ""}`.trim();
    }

    if (stage.id === "task-image-build") {
      return `执行构建 ${context.taskImageName || service.imageJenkinsName || ""}`.trim();
    }

    if (stage.id === "publish-company" || stage.id === "publish-spot") {
      return `发布 ${profile.shortName || context.profileShortName || ""} ${applicationCode} ${env.showNameEn || ""}/${env.environmentFlag || ""}`.trim();
    }

    if (stage.id === "void-release") {
      return `作废 ${profile.shortName || context.profileShortName || ""} ${applicationCode} ${env.showNameEn || ""}/${env.environmentFlag || ""}`.trim();
    }

    return "";
  }

  return {
    ACTIONS,
    actionForStage,
    canAutoRun,
    confirmationForStage,
    isGuardedMutation
  };
});
