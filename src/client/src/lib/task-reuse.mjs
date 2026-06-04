export function selectedServicesText(services) {
  if (!services?.length) return "未选择服务";
  return services
    .map((service) => service?.imageJenkinsName || service?.imageNameEn || service?.serviceNameEn || service?.serviceName)
    .filter(Boolean)
    .join(" / ");
}

export function taskIdOf(task) {
  return task?.id || task?.taskId || task?.buildTaskId || task?.releaseTaskId || "";
}

function hasMeaningfulValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

export function taskPublishStage(task) {
  if (!task) return null;
  if (hasMeaningfulValue(task.reuseBlockedReason)) return task.reuseBlockedReason;
  if (task.pendingApply && hasMeaningfulValue(task.applyStatus) && String(task.applyStatus) !== "0") return `applyStatus=${task.applyStatus}`;
  if (hasMeaningfulValue(task.releaseStatus)) return `releaseStatus=${task.releaseStatus}`;
  if (hasMeaningfulValue(task.publishStatus)) return `publishStatus=${task.publishStatus}`;
  if (hasMeaningfulValue(task.releaseTaskId)) return `releaseTaskId=${task.releaseTaskId}`;
  return null;
}

function imageLabel(image) {
  return image?.imageJenkinsName || image?.imageNameEn || "unknown-service";
}

function imageMatchesService(image, service, options = {}) {
  const sameJenkins = !service.imageJenkinsName ||
    image.imageJenkinsName === service.imageJenkinsName ||
    image.imageNameEn === service.imageJenkinsName;
  const sameImage = !service.imageNameEn ||
    image.imageNameEn === service.imageNameEn ||
    image.imageJenkinsName === service.imageJenkinsName ||
    !image.imageNameEn;
  const sameVersion = options.ignoreVersion || !service.generatedVersion || image.imageVersion === service.generatedVersion;
  return sameJenkins && sameImage && sameVersion;
}

function imageMatchesServiceIdentity(image, service) {
  return imageMatchesService(image, service, { ignoreVersion: true });
}

function serviceVersionOf(service) {
  return service?.generatedVersion || service?.imageVersion || "";
}

function imageMatchesServiceExactVersion(image, service) {
  const expectedVersion = serviceVersionOf(service);
  if (!expectedVersion) return false;
  return (
    imageMatchesServiceIdentity(image, service) &&
    image?.imageVersion === expectedVersion
  );
}

function editableApplyStatus(task) {
  if (!task?.pendingApply) return false;
  return ["0", "4"].includes(String(task.applyStatus ?? ""));
}

export function isBuildPowerEnabled(value) {
  return String(value) === "0";
}

export function evaluateTaskGroup(group, services, options = {}) {
  const images = group?.images || [];
  const identityMatches = services.map((service) => images.find((image) => imageMatchesServiceIdentity(image, service)) || null);
  const versionMatches = services.map((service) => images.find((image) => imageMatchesService(image, service, options)) || null);
  const missingServices = services
    .filter((_, index) => !identityMatches[index])
    .map((service) => service.imageJenkinsName);
  const versionMismatches = services
    .filter((_, index) => identityMatches[index] && !versionMatches[index])
    .map((service) => service.imageJenkinsName);
  const extraServices = images
    .filter((image) => !services.some((service) => imageMatchesServiceIdentity(image, service)))
    .map(imageLabel);
  const selectedServicesPresent = services.length > 0 && missingServices.length === 0;
  const exactServiceGroup = selectedServicesPresent && extraServices.length === 0;
  const allMatched = exactServiceGroup && versionMismatches.length === 0 && versionMatches.every(Boolean);
  const buildableImages = (allMatched ? versionMatches : identityMatches.filter(Boolean))
    .filter((item) => isBuildPowerEnabled(item?.buildPower));
  const blockedImages = (allMatched ? versionMatches : identityMatches.filter(Boolean))
    .filter((item) => item && !isBuildPowerEnabled(item.buildPower));

  return {
    task: group?.task || null,
    images: allMatched ? versionMatches : identityMatches.filter(Boolean),
    buildableImages,
    blockedImages,
    missingServices,
    extraServices,
    versionMismatches,
    publishStage: taskPublishStage(group?.task),
    allMatched,
    allBuildable: allMatched && versionMatches.every((item) => isBuildPowerEnabled(item?.buildPower))
  };
}

export function serviceGroupMismatchText(snapshot, services) {
  const parts = [];
  if (snapshot.missingServices?.length) parts.push(`缺少 ${snapshot.missingServices.join(" / ")}`);
  if (snapshot.extraServices?.length) parts.push(`多出 ${snapshot.extraServices.join(" / ")}`);
  if (snapshot.versionMismatches?.length) parts.push(`版本不一致 ${snapshot.versionMismatches.join(" / ")}`);
  return parts.join("；") || `当前选择 ${selectedServicesText(services)} 与已有任务服务组不一致`;
}

export function recoverableEditBlockerFor(group, services) {
  const task = group?.task || null;
  const images = group?.images || [];
  const targetServices = services
    .map((service) => service?.imageJenkinsName || service?.imageNameEn)
    .filter(Boolean);
  const extraServices = images
    .filter((image) => !services.some((service) => imageMatchesServiceIdentity(image, service)))
    .map(imageLabel);
  const matchedBlockerServices = services
    .filter((service) => images.some((image) => imageMatchesServiceExactVersion(image, service)))
    .map((service) => service.imageJenkinsName || service.imageNameEn)
    .filter(Boolean);
  const missingTargetServices = services
    .filter((service) => !images.some((image) => imageMatchesServiceIdentity(image, service)))
    .map((service) => service.imageJenkinsName || service.imageNameEn)
    .filter(Boolean);
  const recoverable = editableApplyStatus(task) && matchedBlockerServices.length > 0;
  const reason = recoverable
    ? "editable_exact_version_blocker"
    : !editableApplyStatus(task)
    ? "task_not_editable"
    : "no_exact_version_blocker";

  return {
    task,
    images,
    recoverable,
    reason,
    matchedBlockerServices,
    missingTargetServices,
    extraServices,
    targetServices
  };
}

export function taskSnapshotFor(result, services, options = {}) {
  const empty = {
    taskSnapshot: result || null,
    task: null,
    images: [],
    buildableImages: [],
    blockedImages: [],
    missingServices: services.map((item) => item.imageJenkinsName),
    extraServices: [],
    versionMismatches: [],
    publishStage: null,
    allMatched: false,
    allBuildable: false
  };
  if (!result) return empty;
  const fallbackImages = result.matchedTaskImages?.length ? result.matchedTaskImages : result.firstTaskImages || [];
  const groups = Array.isArray(result.taskImagesByTask) && result.taskImagesByTask.length
    ? result.taskImagesByTask
    : [{ task: result.matchedTask || result.tasks?.[0] || null, images: fallbackImages }];

  const matchedTaskId = options.preferMatchedTask ? taskIdOf(result.matchedTask) : "";
  const matchedGroup = matchedTaskId
    ? groups.find((group) => taskIdOf(group.task) === matchedTaskId) || { task: result.matchedTask, images: result.matchedTaskImages || [] }
    : null;
  const latest = evaluateTaskGroup(matchedGroup || groups[0], services, options);
  return {
    ...empty,
    task: latest.task || result.tasks?.[0] || null,
    images: latest.images,
    buildableImages: latest.buildableImages,
    blockedImages: latest.blockedImages,
    missingServices: latest.missingServices,
    extraServices: latest.extraServices,
    versionMismatches: latest.versionMismatches,
    publishStage: latest.publishStage,
    allMatched: latest.allMatched,
    allBuildable: !latest.publishStage && latest.allBuildable
  };
}
