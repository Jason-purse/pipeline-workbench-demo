function numberValue(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function hasText(value) {
  return value != null && String(value).trim() !== "";
}

export function isSuccessLikeMessage(message) {
  return /^(消息处理成功|处理成功|success|ok|successful)$/i.test(String(message || "").trim());
}

function compactMessage(message, maxLength = 220) {
  const text = String(message || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

export function humanizeFailure(result, fallback = "平台请求失败") {
  if (!result) return "未知错误";
  if (typeof result === "string") {
    return humanizeFailure({ message: result }, fallback);
  }

  const response = result.response || {};
  const responseBusinessMessage = response.businessMessage || response.message || response.msg || response.error;
  const rawMessage = result.message ||
    responseBusinessMessage ||
    result.detail?.businessMessage ||
    result.detail?.message ||
    result.detail?.error ||
    result.detail?.reason ||
    result.error ||
    result.reason ||
    "";
  const text = String(rawMessage || "");

  if (result.reason === "publish_business_failed") {
    const codeText = response.businessCode ? `业务码 ${response.businessCode}` : "未返回成功业务码";
    const detail = responseBusinessMessage && !isSuccessLikeMessage(responseBusinessMessage)
      ? `：${compactMessage(responseBusinessMessage)}`
      : "。发布平台返回了外层成功文案，但发布动作未被确认；请刷新发布详情，确认该版本是否仍可发布或已被处理。";
    return `发布平台未接受发布请求（${codeText}）${detail}`;
  }

  if (/^publish_rate_/.test(String(result.reason || ""))) {
    return compactMessage(result.message || "发布请求已受理，但发布进度未确认完成；Pipeline 已暂停，可稍后继续或刷新发布详情确认平台状态。");
  }

  if (result.reason === "network_timeout" || result.timedOut || /curl:\s*\(28\)|Failed to connect|Timeout was reached|Operation timed out|timed out/i.test(text)) {
    return result.message && !/^Command failed:/i.test(result.message)
      ? compactMessage(result.message)
      : "平台连接或响应超时，可能是 VPN/路由暂不可达，或接口超过本地保护阈值。";
  }

  if (/^Command failed:/i.test(text)) {
    return `${fallback}：${compactMessage(text.replace(/^Command failed:\s*/i, ""))}`;
  }

  if (isSuccessLikeMessage(text)) {
    return result.reason
      ? `${fallback}：平台返回成功文案，但当前动作未完成（${result.reason}）。`
      : `${fallback}：平台返回成功文案，但当前动作未完成。`;
  }

  return compactMessage(text || JSON.stringify(result).slice(0, 260) || fallback);
}

export function isRetryableProbeResult(result) {
  if (!result) return true;
  const reason = String(result.reason || result.error || "");
  const message = `${result.message || ""} ${result.error || ""}`;
  return Boolean(
    result.timedOut ||
    ["network_timeout", "request_failed", "release_overview_failed", "release_overview_app_not_found"].includes(reason) ||
    /超时|暂不可用|未匹配|无法连接|Failed to connect|Timeout was reached|Operation timed out|curl:\s*\(28\)/i.test(message)
  );
}

function failureText(result) {
  if (!result) return "";
  if (typeof result === "string") return result;
  const response = result.response || {};
  const detail = result.detail || {};
  return [
    result.message,
    result.error,
    result.reason,
    response.businessMessage,
    response.message,
    response.msg,
    response.error,
    detail.businessMessage,
    detail.message,
    detail.error,
    detail.reason
  ].filter(Boolean).join(" ");
}

export function isBuildAlreadyRunningResult(result) {
  return /微服务.*构建中|服务.*构建中|正在构建中|已在构建|构建进行中|build.*already.*running|already.*build/i.test(failureText(result));
}

export function shouldRestartBuildTaskAfterBuildTriggerFailure(result) {
  return /已有新版本构建|存在新版本构建|新版本.*构建|newer.*build|new version.*build/i.test(failureText(result));
}

export function isBuildTriggerUncertainResult(result) {
  const text = failureText(result);
  const reason = String(result?.reason || result?.error || "");
  if (reason === "task_build_not_allowed") return false;
  return Boolean(
    result?.timedOut ||
    reason === "network_timeout" ||
    /curl:\s*\(28\)|Failed to connect|Timeout was reached|Operation timed out|timed out|平台连接或响应超时|平台响应超时/i.test(text)
  );
}

export function shouldObserveAfterBuildTriggerFailure(result) {
  return isBuildAlreadyRunningResult(result) || isBuildTriggerUncertainResult(result);
}

function serviceNameOf(service) {
  return service?.imageJenkinsName || service?.imageNameEn || "unknown-service";
}

function buildDetailRowForService(service, detailResult) {
  const rows = Array.isArray(detailResult?.detail) ? detailResult.detail : [];
  return rows.find((item) =>
    item.imageJenkinsName === service?.imageJenkinsName ||
    item.imageNameEn === service?.imageNameEn
  ) || rows[0] || null;
}

function markerIsNew(currentAt, baselineAt, currentId, baselineId) {
  if (currentAt <= 0) return false;
  if (currentAt > baselineAt) return true;
  return currentAt === baselineAt && hasText(currentId) && hasText(baselineId) && String(currentId) !== String(baselineId);
}

function buildIdNumber(value) {
  const match = String(value || "").match(/#?\s*(\d+)/);
  const numeric = match ? Number(match[1]) : 0;
  return Number.isFinite(numeric) ? numeric : 0;
}

function buildIdLabel(value) {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) && numeric > 0 ? `#${numeric}` : "";
}

function candidateBuildIdsFromMarkers(row, baseline, count = 3) {
  const latest = Math.max(
    buildIdNumber(row?.lastSuccessId),
    buildIdNumber(row?.lastFailureId),
    buildIdNumber(baseline?.lastSuccessId),
    buildIdNumber(baseline?.lastFailureId)
  );
  if (!latest) return [];
  return Array.from({ length: count }, (_, index) => buildIdLabel(latest + index + 1));
}

export function buildObservationBaselineForService(service, detailResult) {
  const row = buildDetailRowForService(service, detailResult);
  return {
    imageVersion: row?.imageVersion || "",
    lastSuccessTime: numberValue(row?.lastSuccessTime),
    lastFailureTime: numberValue(row?.lastFailureTime),
    lastSuccessId: row?.lastSuccessId || "",
    lastFailureId: row?.lastFailureId || ""
  };
}

export const BUILD_APPLY_STATUS = {
  pending: "0",
  running: "1",
  publishReady: "2",
  failed: "3",
  returned: "4",
  published: "5"
};

export function buildApplySignal(task) {
  if (!task) {
    return {
      status: "missing",
      reason: "build_apply_not_found"
    };
  }

  const applyStatus = task.applyStatus == null ? "" : String(task.applyStatus);
  const taskId = task.id || task.taskId || task.buildTaskId || task.structureApplyId || "";
  const publishEnvironment = task.publishEnvironment == null ? "" : String(task.publishEnvironment);

  if (applyStatus === BUILD_APPLY_STATUS.failed) {
    return {
      status: "failed",
      reason: "build_apply_failed",
      taskId,
      applyStatus
    };
  }

  if (applyStatus === BUILD_APPLY_STATUS.publishReady) {
    return {
      status: "publish_ready",
      reason: "build_platform_publish_ready",
      taskId,
      applyStatus,
      publishEnvironment
    };
  }

  if (applyStatus === BUILD_APPLY_STATUS.published) {
    return {
      status: "published",
      reason: "build_platform_publish_done",
      taskId,
      applyStatus
    };
  }

  if (applyStatus === BUILD_APPLY_STATUS.returned) {
    return {
      status: "failed",
      reason: "build_apply_returned",
      taskId,
      applyStatus
    };
  }

  return {
    status: applyStatus === BUILD_APPLY_STATUS.running ? "running" : "pending",
    reason: applyStatus === BUILD_APPLY_STATUS.running ? "build_apply_running" : "build_apply_pending",
    taskId,
    applyStatus
  };
}

export function buildPlatformPublishSubmittedSignal(applySignal = {}, fallbackTaskId = "") {
  return {
    status: "published",
    reason: "build_platform_publish_submitted",
    taskId: applySignal.taskId || fallbackTaskId || "",
    applyStatus: applySignal.applyStatus || ""
  };
}

export function buildPlatformPublishEnvironmentsFor(branch) {
  if (branch === "develop") return [];
  if (branch === "master") return ["0", "1"];
  return ["1"];
}

export function buildPlatformPublishProgress({ branch, applySignal, confirmedEnvironments = [] } = {}) {
  const required = buildPlatformPublishEnvironmentsFor(branch);
  if (!required.length) return { status: "complete", missingEnvironments: [] };
  const confirmed = new Set(confirmedEnvironments.map((item) => String(item)));
  const missingEnvironments = required.filter((environment) => !confirmed.has(environment));
  if (!missingEnvironments.length) return { status: "complete", missingEnvironments: [] };
  if (applySignal?.status === "failed") {
    return {
      status: "failed",
      reason: applySignal.reason || "build_apply_failed",
      missingEnvironments,
      applySignal
    };
  }
  if (applySignal?.status !== "publish_ready" && applySignal?.status !== "published") {
    return { status: "waiting", missingEnvironments };
  }
  if (applySignal.status === "published" && !confirmed.size) {
    return { status: "complete", missingEnvironments: [] };
  }
  const exposed = String(applySignal.publishEnvironment || "");
  if (!missingEnvironments.includes(exposed)) return { status: "waiting", missingEnvironments };
  return {
    status: "confirm",
    environment: exposed,
    missingEnvironments
  };
}

export function buildSignalForService(service, detailResult, options = {}) {
  const row = buildDetailRowForService(service, detailResult);
  const targetVersion = service?.generatedVersion || service?.imageVersion || "";
  const actualVersion = row?.imageVersion || "";
  const successAt = numberValue(row?.lastSuccessTime);
  const failureAt = numberValue(row?.lastFailureTime);
  const baseline = options.baseline || null;
  const baselineSuccessAt = baseline ? numberValue(baseline.lastSuccessTime) : 0;
  const baselineFailureAt = baseline ? numberValue(baseline.lastFailureTime) : 0;
  const successIsCurrent = baseline
    ? markerIsNew(successAt, baselineSuccessAt, row?.lastSuccessId, baseline.lastSuccessId)
    : successAt > 0;
  const failureIsCurrent = baseline
    ? markerIsNew(failureAt, baselineFailureAt, row?.lastFailureId, baseline.lastFailureId)
    : failureAt > 0;
  const postBaselineVersion = baseline && actualVersion && actualVersion !== baseline.imageVersion && (successIsCurrent || failureIsCurrent);
  const versionMatches = !targetVersion || actualVersion === targetVersion || postBaselineVersion;
  const candidateBuildIds = candidateBuildIdsFromMarkers(row, baseline);

  if (!row) {
    return {
      service: serviceNameOf(service),
      status: "running",
      reason: "missing_build_detail",
      candidateBuildId: candidateBuildIds[0] || "",
      candidateBuildIds
    };
  }

  if (versionMatches && failureIsCurrent && failureAt > successAt) {
    return {
      service: serviceNameOf(service),
      status: "failed",
      version: actualVersion,
      buildId: row.lastFailureId,
      at: failureAt,
      reason: "last_failure_newer_than_success"
    };
  }

  if (versionMatches && successIsCurrent) {
    return {
      service: serviceNameOf(service),
      status: "succeeded",
      version: actualVersion,
      buildId: row.lastSuccessId,
      at: successAt
    };
  }

  return {
    service: serviceNameOf(service),
    status: "running",
    version: actualVersion,
    reason: versionMatches ? "waiting_for_success" : "waiting_for_target_version",
    candidateBuildId: candidateBuildIds[0] || "",
    candidateBuildIds
  };
}

export function releaseRecordSignal(app, options = {}) {
  if (!app) {
    if (options.environmentFound && options.applicationCode) {
      return {
        status: "waiting",
        pendingCount: 0,
        reason: "release_app_absent",
        applicationCode: options.applicationCode,
        environmentFound: true
      };
    }
    return {
      status: "waiting",
      pendingCount: 0,
      reason: "release_app_not_found"
    };
  }
  const rawPendingCount = app.toPublishServiceNum;
  const pendingCount = numberValue(rawPendingCount);
  const hasExplicitPendingCount = rawPendingCount != null && String(rawPendingCount).trim() !== "" && Number.isFinite(Number(rawPendingCount));
  const hasStableAppIdentity = hasText(app.applicationCode) && hasText(app.applicationVersion);
  if (!hasExplicitPendingCount || !hasStableAppIdentity) {
    return {
      status: "waiting",
      pendingCount,
      reason: "release_record_untrusted",
      applicationCode: app.applicationCode,
      applicationVersion: app.applicationVersion
    };
  }
  return {
    status: pendingCount > 0 ? "ready" : "waiting",
    pendingCount,
    reason: pendingCount > 0 ? "release_record_ready" : "release_record_absent",
    applicationCode: app.applicationCode,
    applicationVersion: app.applicationVersion
  };
}

export function shouldNoopReleaseRecord({ releaseSignal, releaseNoWait = false, elapsedMs = 0, noopAfterMs = 0 } = {}) {
  const trustedEmpty = releaseSignal?.reason === "release_record_absent" || releaseSignal?.reason === "release_app_absent";
  if (!trustedEmpty) return false;
  if (releaseNoWait) return true;
  return Number(elapsedMs || 0) >= Number(noopAfterMs || 0);
}

export function publishableServicesForStage(detailResult, stage) {
  const raw = detailResult?.raw || {};
  const imagesKey = stage === "company" ? "companyImages" : "spotImages";
  const flagKey = stage === "company" ? "companyPublishFlag" : "spotPublishFlag";
  if (Object.prototype.hasOwnProperty.call(raw, imagesKey) && raw[imagesKey] == null) return [];
  const images = raw[imagesKey] || {};
  if (raw[flagKey] === "1") return [];
  if (images.publishFlag != null && String(images.publishFlag) !== "0") return [];
  if (images.buttonFlag != null && String(images.buttonFlag) !== "0") return [];
  const currentServices = images.currentServices;
  return Array.isArray(currentServices) ? currentServices : null;
}

function isObservationTimedOut({ elapsedMs, timeoutMs, attempt = 1, maxAttempts = 1 }) {
  if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
    return Number(elapsedMs || 0) >= timeoutMs;
  }
  return attempt >= maxAttempts;
}

export function pipelineObservationDecision({ buildSignals = [], applySignal, releaseSignal, attempt = 1, maxAttempts = 1, elapsedMs, timeoutMs }) {
  const timedOut = isObservationTimedOut({ elapsedMs, timeoutMs, attempt, maxAttempts });
  const failedBuild = buildSignals.find((item) => item.status === "failed");
  if (failedBuild) {
    return {
      status: "failed",
      reason: "build_failed",
      failedBuild
    };
  }

  if (applySignal?.status === "failed") {
    return {
      status: "failed",
      reason: applySignal.reason || "build_apply_failed",
      applySignal
    };
  }
  if (applySignal?.status === "publish_ready") {
    return {
      status: "confirm_build_publish",
      reason: "build_platform_publish_ready",
      applySignal
    };
  }

  const buildPlatformSegmentDone = applySignal?.status === "published";
  const allBuildsSucceeded = buildPlatformSegmentDone || (buildSignals.length > 0 && buildSignals.every((item) => item.status === "succeeded"));
  if (!allBuildsSucceeded) {
    return timedOut
      ? { status: "blocked", reason: "build_observe_timeout" }
      : { status: "running", reason: "build_running" };
  }

  if (applySignal && !["published"].includes(applySignal.status)) {
    return timedOut
      ? { status: "blocked", reason: "build_apply_observe_timeout", applySignal }
      : { status: "running", reason: "build_apply_waiting", applySignal };
  }

  if (releaseSignal?.status === "ready") {
    return {
      status: "ready",
      reason: "release_record_ready"
    };
  }
  if (releaseSignal?.reason === "release_record_absent" || releaseSignal?.reason === "release_app_absent") {
    return {
      status: "noop",
      reason: releaseSignal.reason,
      releaseSignal
    };
  }

  return timedOut
    ? { status: "blocked", reason: "release_record_timeout" }
    : { status: "running", reason: "release_record_waiting" };
}
