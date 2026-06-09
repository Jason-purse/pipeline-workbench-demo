const EVENT_TO_STATUS = {
  start: "running",
  run: "running",
  done: "done",
  block: "blocked",
  fail: "failed",
  skip: "done"
};
const ACTIVE_STATUSES = new Set(["failed", "blocked", "running"]);

function cloneJson(value, fallback) {
  if (value == null) return fallback;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return fallback;
  }
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeCommands(commands = []) {
  return asArray(commands).map((command) => ({
    id: command.id || command.commandId,
    title: command.title || command.id || command.commandId,
    phase: command.phase || command.title || command.id || command.commandId,
    stage: command.stage || ""
  })).filter((command) => command.id);
}

function isActiveStatus(status) {
  return ACTIVE_STATUSES.has(status);
}

function settleEarlierActiveCommands(memento = {}) {
  const order = asArray(memento.order);
  const cursor = memento.cursor || {};
  const cursorId = cursor.commandId;
  const cursorIndex = order.indexOf(cursorId);
  if (!cursorId || cursorIndex <= 0) return memento;

  const cursorSnapshot = memento.commands?.[cursorId] || {};
  const cursorStatus = cursor.status || cursorSnapshot.status;
  if (!isActiveStatus(cursorStatus)) return memento;

  const commands = { ...(memento.commands || {}) };
  for (const id of order.slice(0, cursorIndex)) {
    const snapshot = commands[id];
    if (!snapshot || !isActiveStatus(snapshot.status)) continue;
    commands[id] = {
      ...snapshot,
      status: "done",
      detail: snapshot.supersededBy === cursorId
        ? snapshot.detail || ""
        : [snapshot.detail, "已被后续阶段覆盖。"].filter(Boolean).join("；"),
      supersededBy: cursorId
    };
  }

  return {
    ...memento,
    commands
  };
}

export function createPipelineRunMemento(commands = []) {
  const ordered = normalizeCommands(commands);
  const commandState = {};
  for (const command of ordered) {
    commandState[command.id] = {
      status: "pending",
      phase: command.phase,
      detail: "",
      title: command.title,
      updatedAt: ""
    };
  }
  return {
    cursor: {
      commandId: ordered[0]?.id || "",
      index: 0,
      status: ordered.length ? "pending" : "done",
      phase: ordered[0]?.phase || "待启动",
      detail: ""
    },
    order: ordered.map((command) => command.id),
    commands: commandState
  };
}

export function normalizePipelineRunMemento(memento = {}, commands = []) {
  const base = createPipelineRunMemento(commands);
  const sourceCommands = cloneJson(memento.commands || {}, {});
  const mergedCommands = { ...base.commands };
  for (const [id, snapshot] of Object.entries(sourceCommands)) {
    if (!mergedCommands[id]) continue;
    mergedCommands[id] = {
      ...mergedCommands[id],
      ...snapshot,
      status: snapshot.status || mergedCommands[id].status
    };
  }
  const order = base.order.length ? base.order : asArray(memento.order);
  const cursor = {
    ...base.cursor,
    ...(memento.cursor || {})
  };
  return settleEarlierActiveCommands({
    cursor,
    order,
    commands: mergedCommands
  });
}

export function applyCommandEventToMemento(memento = {}, event = {}) {
  const next = cloneJson(memento, createPipelineRunMemento([]));
  const commandId = event.commandId;
  if (!commandId) return next;
  const previous = next.commands?.[commandId] || {};
  const status = event.status || EVENT_TO_STATUS[event.type] || "running";
  next.commands = {
    ...(next.commands || {}),
    [commandId]: {
      ...previous,
      status,
      title: event.title || previous.title || commandId,
      phase: event.phase || previous.phase || event.title || commandId,
      detail: event.detail || previous.detail || "",
      updatedAt: event.at || previous.updatedAt || "",
      lastEvent: event.type || previous.lastEvent || ""
    }
  };

  const order = asArray(next.order);
  const index = Math.max(0, order.indexOf(commandId));
  const nextCommandId = status === "done" ? order[index + 1] || "" : commandId;
  const cursorCommand = next.commands[nextCommandId] || next.commands[commandId] || {};
  next.cursor = {
    commandId: nextCommandId,
    index: nextCommandId ? Math.max(0, order.indexOf(nextCommandId)) : order.length,
    status: nextCommandId ? cursorCommand.status || "pending" : "done",
    phase: nextCommandId ? cursorCommand.phase || event.phase || "" : event.phase || "完成",
    detail: nextCommandId ? cursorCommand.detail || "" : event.detail || ""
  };
  return settleEarlierActiveCommands(next);
}

export function resumePointFromMemento(memento = {}) {
  const order = asArray(memento.order);
  for (const id of order) {
    const snapshot = memento.commands?.[id];
    if (!snapshot) continue;
    if (snapshot.status === "failed" || snapshot.status === "blocked" || snapshot.status === "running") {
      return {
        commandId: id,
        status: snapshot.status,
        phase: snapshot.phase || "",
        detail: snapshot.detail || ""
      };
    }
  }
  const cursor = memento.cursor || {};
  if (cursor.commandId) {
    return {
      commandId: cursor.commandId,
      status: cursor.status || "pending",
      phase: cursor.phase || "",
      detail: cursor.detail || ""
    };
  }
  return {
    commandId: "",
    status: "done",
    phase: "完成",
    detail: ""
  };
}
