export function buildLogText(logResult) {
  const log = logResult?.log ?? logResult;
  if (!log) return "";
  if (typeof log === "string") return log;
  const text = log.consoleText || log.text || log.log || log.msg || log.message || log.content;
  if (typeof text === "string") return text;
  try {
    return JSON.stringify(log);
  } catch {
    return "";
  }
}

export function buildLogOutcome(logText) {
  if (/Finished:\s*SUCCESS/i.test(logText)) return "done";
  if (/Finished:\s*(FAILURE|FAILED|ABORTED|UNSTABLE)/i.test(logText)) return "failed";
  return "";
}

export function normalizeBuildStageLabel(label = "") {
  return String(label).trim().replace(/\s+/g, " ").toLowerCase();
}

function buildStageId(label, index) {
  const slug = normalizeBuildStageLabel(label)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug ? `log-${slug}` : `log-stage-${index + 1}`;
}

export function parseBuildLogStages(logText) {
  const text = buildLogText(logText);
  if (!text) return [];

  const stages = [];
  let currentIndex = -1;
  const lines = text.replace(/\r/g, "").split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const startMatch = line.match(/\[Pipeline\]\s*\{\s*\(([^)]+)\)/);
    if (startMatch) {
      if (currentIndex >= 0 && stages[currentIndex]?.status === "running") {
        stages[currentIndex] = {
          ...stages[currentIndex],
          status: "done",
          completedLine: index
        };
      }
      const label = startMatch[1].trim();
      currentIndex = stages.length;
      stages.push({
        id: buildStageId(label, currentIndex),
        label,
        status: "running",
        startedLine: index,
        completedLine: null
      });
      continue;
    }

    if (/\[Pipeline\]\s*\/\/\s*stage\b/.test(line) && currentIndex >= 0 && stages[currentIndex]?.status === "running") {
      stages[currentIndex] = {
        ...stages[currentIndex],
        status: "done",
        completedLine: index
      };
      currentIndex = -1;
    }
  }

  const outcome = buildLogOutcome(text);
  if (outcome === "done") {
    return stages.map((stage) => ({ ...stage, status: "done" }));
  }

  if (outcome === "failed" && stages.length) {
    const runningIndex = stages.findIndex((stage) => stage.status === "running");
    const failedIndex = runningIndex >= 0 ? runningIndex : stages.length - 1;
    return stages.map((stage, index) => ({
      ...stage,
      status: index === failedIndex ? "failed" : stage.status === "running" ? "done" : stage.status
    }));
  }

  return stages;
}

function numericValue(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function structureDetailPayload(value) {
  if (!value || typeof value !== "object") return {};
  if (value.structureDetail && typeof value.structureDetail === "object") return value.structureDetail;
  if (value.msg && typeof value.msg === "object") return value.msg;
  if (value.object?.msg && typeof value.object.msg === "object") return value.object.msg;
  return value;
}

function normalizeBuildNumber(value) {
  const match = String(value || "").match(/#?\s*(\d+)/);
  return match ? match[1] : "";
}

export function normalizeStructureStageStatus(status = "") {
  const value = String(status || "").trim().toUpperCase();
  if (["SUCCESS", "DONE", "COMPLETED", "FINISHED"].includes(value)) return "done";
  if (["FAILED", "FAILURE", "ERROR", "ABORTED"].includes(value)) return "failed";
  if (["IN_PROGRESS", "RUNNING", "ANIME", "ACTIVE"].includes(value)) return "running";
  return "pending";
}

export function buildStructureRecords(structureDetail = {}) {
  const payload = structureDetailPayload(structureDetail);
  return Array.isArray(payload.pineLines) ? payload.pineLines : [];
}

export function pickBuildStructureRecord(structureDetail = {}, options = {}) {
  const records = buildStructureRecords(structureDetail);
  if (!records.length) return null;

  const buildId = normalizeBuildNumber(options.buildId || options.buildID);
  if (buildId) {
    const byId = records.find((record) =>
      normalizeBuildNumber(record.id || record.name || record.buildID || record.buildId) === buildId
    );
    if (byId) return byId;
  }

  const targetVersion = String(options.targetVersion || options.imageVersion || "").trim();
  if (targetVersion) {
    const byVersion = records.find((record) => String(record.imageVersion || "").trim() === targetVersion);
    if (byVersion) return byVersion;
  }

  return records[0] || null;
}

export function parseBuildStructureStages(structureDetail = {}, options = {}) {
  const payload = structureDetailPayload(structureDetail);
  const record = pickBuildStructureRecord(payload, options);
  const stages = Array.isArray(record?.stages) ? record.stages : [];
  return stages.map((stage, index) => {
    const label = String(stage.stageName || stage.name || `Stage ${index + 1}`).trim();
    return {
      id: stage.id ? `structure-${stage.id}` : buildStageId(label, index),
      label,
      status: normalizeStructureStageStatus(stage.status),
      durationMillis: numericValue(stage.durationMillis || stage.duration),
      startedAt: numericValue(stage.startTimeMillis),
      buildId: record.name || (record.id ? `#${record.id}` : ""),
      buildVersion: record.imageVersion || "",
      source: "structure-detail"
    };
  });
}
