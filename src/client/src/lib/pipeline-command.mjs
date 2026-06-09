const EVENT_STATUS = {
  start: "running",
  run: "running",
  done: "done",
  block: "blocked",
  fail: "failed",
  skip: "done"
};

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

function normalizeDisplay(display = {}, fallback = {}) {
  const title = fallback.title || fallback.id || "Pipeline Command";
  const phase = fallback.phase || title;
  return {
    start: { phase, detail: `开始${title}`, ...(display.start || {}) },
    run: { phase, detail: `执行${title}`, ...(display.run || {}) },
    done: { phase, detail: `${title}完成`, ...(display.done || {}) },
    block: { phase, detail: `${title}暂停`, ...(display.block || {}) },
    fail: { phase, detail: `${title}失败`, ...(display.fail || {}) },
    skip: { phase, detail: `${title}跳过`, ...(display.skip || {}) }
  };
}

function eventFrom(command, type, overrides = {}, now = nowIso) {
  const display = command.display[type] || {};
  const detail = overrides.detail || overrides.message || display.detail || "";
  return {
    type,
    status: overrides.status || EVENT_STATUS[type] || "running",
    commandId: command.id,
    title: overrides.title || display.title || command.title,
    phase: overrides.phase || display.phase || command.phase || command.title,
    detail,
    tone: overrides.tone || display.tone || (type === "fail" ? "danger" : type === "block" ? "warning" : type === "done" || type === "skip" ? "success" : "default"),
    at: overrides.at || now(),
    data: cloneJson(overrides.data, undefined)
  };
}

function normalizeExecutionResult(value) {
  if (value == null) return { ok: true };
  if (typeof value === "object" && Object.prototype.hasOwnProperty.call(value, "ok")) return value;
  return { ok: true, value };
}

export function createCommandEvent(command, type, overrides = {}, options = {}) {
  const normalized = normalizePipelineCommand(command);
  return eventFrom(normalized, type, overrides, options.now || nowIso);
}

export function normalizePipelineCommand(definition = {}) {
  const id = definition.id || definition.commandId;
  if (!id) throw new Error("Pipeline command id is required");
  const title = definition.title || id;
  const phase = definition.phase || title;
  return {
    id,
    title,
    phase,
    kind: definition.kind || "command",
    stage: definition.stage || "",
    display: normalizeDisplay(definition.display || {}, { id, title, phase }),
    execute: typeof definition.execute === "function" ? definition.execute : async () => ({ ok: true }),
    meta: cloneJson(definition.meta || {}, {})
  };
}

export function createPipelineCommand(definition = {}) {
  const command = normalizePipelineCommand(definition);
  return {
    ...command,
    async run(context, options = {}) {
      const hook = typeof options.hook === "function" ? options.hook : () => {};
      const now = options.now || nowIso;
      hook(eventFrom(command, "start", {}, now));
      hook(eventFrom(command, "run", {}, now));
      try {
        const result = normalizeExecutionResult(await command.execute(context, options));
        if (result.ok === false) {
          const type = result.blocked ? "block" : "fail";
          hook(eventFrom(command, type, {
            detail: result.detail || result.message || result.error,
            data: result
          }, now));
          return result;
        }
        if (result.skipped) {
          hook(eventFrom(command, "skip", {
            detail: result.detail || result.message || result.reason,
            data: result
          }, now));
          return result;
        }
        hook(eventFrom(command, "done", {
          detail: result.detail || result.message,
          data: result
        }, now));
        return result;
      } catch (error) {
        const result = { ok: false, error: error.message, message: error.message };
        hook(eventFrom(command, "fail", { detail: error.message, data: result }, now));
        return result;
      }
    }
  };
}
