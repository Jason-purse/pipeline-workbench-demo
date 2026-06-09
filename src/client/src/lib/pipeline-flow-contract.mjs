function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function releaseStagesForBranch(branch) {
  if (branch === "develop") return [];
  if (branch === "master") return ["company", "spot"];
  return ["spot"];
}

function buildModeFor(branch, strategy = "prod") {
  if (branch === "develop") return { mode: "direct", label: "开发直构建", structureType: null };
  if (branch === "release") return { mode: "release-task", label: "提测申请+构建", structureType: "release" };
  if (branch === "master") {
    const structureType = strategy === "hotfix" ? "hotfix" : "prod";
    return {
      mode: "apply-task",
      label: structureType === "hotfix" ? "Hotfix 申请+构建" : "生产申请+构建",
      structureType
    };
  }
  return { mode: "apply-task", label: "申请+构建", structureType: "prod" };
}

function command(id, title, phase, stage, display = {}) {
  return {
    id,
    title,
    phase,
    stage,
    display: {
      start: { phase, detail: `开始${title}` },
      run: { phase, detail: `正在${title}` },
      done: { phase, detail: `${title}完成` },
      block: { phase, detail: `${title}暂停` },
      fail: { phase: `${phase.replace(/中$/, "")}失败`, detail: `${title}失败` },
      skip: { phase, detail: `${title}跳过` },
      ...display
    }
  };
}

function buildCommands(target = {}) {
  const branch = target.branch || "";
  const mode = buildModeFor(branch, target.buildStrategy);
  const commands = [
    command("read-build-status", "读取构建状态", "构建预检", "build"),
    command("generate-version", "生成版本", "版本预检", "build"),
    command("create-or-reuse-task", "创建或复用构建任务", "创建构建任务", "build"),
    command("wait-buildable-task", "等待任务开放构建", "等待构建任务", "build"),
    command("trigger-build", "触发构建", "构建", "build", {
      done: { phase: "等待构建完成", detail: "构建已触发" },
      block: { phase: "等待构建完成", detail: "构建暂不可用" }
    }),
    command("observe-build", "观察构建", "等待构建完成", "build")
  ];
  if (mode.mode !== "direct") {
    commands.push(command("confirm-build-platform-publish", "确认构建平台发布", "构建平台发布", "build"));
  }
  return commands;
}

function releaseCommands(target = {}) {
  const stages = releaseStagesForBranch(target.branch || "");
  const commands = [
    command("wait-release-record", "等待发布记录", "等待发布记录", "release"),
    command("read-release-detail", "读取发布清单", "发布清单", "release")
  ];
  if (stages.includes("company")) commands.push(command("publish-company", "公司发布", "公司发布", "release"));
  if (stages.includes("spot")) commands.push(command("publish-spot", "现场发布", "现场发布", "release"));
  return commands;
}

export function createFlowContract({ templateId = "build-and-release", target = {}, services = [], inputs = {} } = {}) {
  const normalizedTarget = { ...target };
  const commands = [command("probe-platforms", "平台预检", "构建预检", "prepare")];
  if (templateId !== "release-existing") commands.push(...buildCommands(normalizedTarget));
  if (templateId !== "build-only") commands.push(...releaseCommands(normalizedTarget));
  commands.push(command("complete-run", "完成 Pipeline", "完成", "complete"));

  return {
    schemaVersion: 2,
    templateId,
    target: normalizedTarget,
    inputs: { ...inputs },
    serviceCount: asArray(services).length,
    commands
  };
}
