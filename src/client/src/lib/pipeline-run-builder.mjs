import { createFlowContract } from "./pipeline-flow-contract.mjs";
import { normalizePipelineRunContext } from "./pipeline-run-context.mjs";
import { createPipelineRunMemento } from "./pipeline-run-memento.mjs";

function cloneJson(value, fallback) {
  if (value == null) return fallback;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return fallback;
  }
}

function nowIso() {
  return new Date().toISOString();
}

export function buildPipelineRun({
  contract,
  templateId = "build-and-release",
  target = {},
  services = [],
  inputs = {},
  id,
  now
} = {}) {
  const createdAt = now || nowIso();
  const flowContract = contract || createFlowContract({ templateId, target, services, inputs });
  const context = normalizePipelineRunContext({
    target: cloneJson(target || flowContract.target, {}),
    inputs: cloneJson(inputs || flowContract.inputs, {}),
    data: {}
  });
  const commands = cloneJson(flowContract.commands || [], []);
  return {
    schemaVersion: 2,
    id: id || `${Date.now()}`,
    createdAt,
    updatedAt: createdAt,
    completedAt: "",
    copiedFromRunId: "",
    started: false,
    templateId: flowContract.templateId || templateId,
    status: "draft",
    phase: "待启动",
    target: cloneJson(target, {}),
    serviceSnapshot: cloneJson(services, []),
    context,
    commands,
    memento: createPipelineRunMemento(commands),
    activity: []
  };
}
