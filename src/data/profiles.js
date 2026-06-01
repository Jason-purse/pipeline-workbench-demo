const defaultProfiles = [
  {
    id: "demoa",
    hospitalName: "演示客户A",
    shortName: "演示客户A",
    customerNameEn: "demo-customer-a",
    customerCodeAbbreviation: "demoa",
    ownerHint: "演示客户A项目构建发布",
    accounts: [
      {
        id: "demo_uat",
        label: "demo_uat",
        username: "demo_uat",
        secretMode: "editable",
        envUsernameKey: "WORKBENCH_DEMO_A_USERNAME",
        envPasswordKey: "WORKBENCH_DEMO_A_PASSWORD",
        staffCode: "demo-uat",
        platforms: ["build", "release"],
        scopeNote: "医院项目账号，覆盖演示客户A构建平台与发布平台。"
      }
    ],
    applications: [
      { code: "emr", name: "emr" },
      { code: "mem", name: "mem" }
    ],
    releaseEnvironments: [
      {
        id: "demoa-uat-a",
        label: "现场测试环境A",
        showNameEn: "mastertest",
        environmentFlag: "a",
        companyAddress: "release-company.example.internal",
        spotAddress: "uat-demo-a.example.com",
        apps: {
          emr: { currentVersion: "1.16.56", spotVersion: "1.16.56" },
          mem: { currentVersion: "1.8.83", spotVersion: "1.8.83" }
        }
      },
      {
        id: "demoa-prod-a",
        label: "生产环境A",
        showNameEn: "master",
        environmentFlag: "a",
        companyAddress: "release-company.example.internal",
        spotAddress: "demo-a.example.com",
        apps: {
          emr: { currentVersion: "1.7.25", spotVersion: "1.7.25" },
          mem: { currentVersion: "1.4.5", spotVersion: "1.4.5" }
        }
      }
    ]
  },
  {
    id: "demob",
    hospitalName: "演示客户B",
    shortName: "演示客户B",
    customerNameEn: "demo-customer-b",
    customerCodeAbbreviation: "demo_prod",
    ownerHint: "演示客户B emr/mem 分类服务",
    accounts: [
      {
        id: "demo_prod",
        label: "demo_prod",
        username: "demo_prod",
        secretMode: "editable",
        envUsernameKey: "WORKBENCH_DEMO_B_USERNAME",
        envPasswordKey: "WORKBENCH_DEMO_B_PASSWORD",
        staffCode: "demo_prod",
        platforms: ["build", "release"],
        scopeNote: "演示客户B账号，覆盖演示客户B构建平台与发布平台。"
      }
    ],
    applications: [
      { code: "emr", name: "emr 分类服务" },
      { code: "mem", name: "mem 分类服务" }
    ],
    releaseEnvironments: [
      {
        id: "demob-uat-a",
        label: "uat-demo-bA",
        showNameEn: "uat-demo-b",
        environmentFlag: "a",
        companyAddress: "release-company.example.internal",
        spotAddress: "demo-b.example.com",
        apps: {
          emr: { currentVersion: "1.3.89", spotVersion: "1.3.89" },
          mem: { currentVersion: "1.2.86", spotVersion: "1.2.86" }
        }
      },
      {
        id: "demob-prod-a",
        label: "prod-demo-bA",
        showNameEn: "prod-demo-b",
        environmentFlag: "a",
        companyAddress: "release-company.example.internal",
        spotAddress: "demo-b.example.com",
        apps: {
          emr: { currentVersion: "1.4.81", spotVersion: "1.4.81" },
          mem: { currentVersion: "1.1.64", spotVersion: "1.1.64" }
        }
      }
    ]
  }
];

const platforms = {
  build: {
    id: "build",
    label: "构建平台",
    host: process.env.WORKBENCH_BUILD_HOST || "build-platform.example.internal",
    apiBase: process.env.WORKBENCH_BUILD_API_BASE || "http://build-platform.example.internal/api",
    appId: process.env.WORKBENCH_BUILD_APP_ID || "OPS0001"
  },
  releaseShell: {
    id: "releaseShell",
    label: "发布 Shell",
    host: process.env.WORKBENCH_RELEASE_SHELL_HOST || "release-shell.example.internal",
    apiBase: process.env.WORKBENCH_RELEASE_SHELL_API_BASE || "https://release-shell.example.internal/api"
  },
  releaseApi: {
    id: "releaseApi",
    label: "发布 iframe API",
    host: process.env.WORKBENCH_RELEASE_API_HOST || "release-api.example.internal",
    apiBase: process.env.WORKBENCH_RELEASE_API_BASE || "https://release-api.example.internal/api"
  }
};

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

const LINKED_BRANCHES = new Set(["mastertest", "master"]);

function textOf(value) {
  return String(value || "").trim();
}

function environmentText(env = {}) {
  return [
    env.buildBranch,
    env.codeBranch,
    env.label,
    env.showName,
    env.showNameEn,
    env.environmentFlag,
    env.id
  ].map(textOf).join(" ").toLowerCase();
}

function isLinkedBuildBranch(branch) {
  return LINKED_BRANCHES.has(String(branch || ""));
}

function buildBranchForReleaseEnvironment(env = {}) {
  const explicit = textOf(env.buildBranch || env.codeBranch);
  if (isLinkedBuildBranch(explicit)) return explicit;

  const text = environmentText(env);
  if (/mastertest|uat|test|测试|现场/.test(text)) return "mastertest";
  if (/master|prod|生产|正式/.test(text)) return "master";
  return null;
}

function environmentLinksForReleaseEnvironments(releaseEnvironments = []) {
  const links = [];
  const seen = new Set();
  for (const env of Array.isArray(releaseEnvironments) ? releaseEnvironments : []) {
    const branch = buildBranchForReleaseEnvironment(env);
    if (!isLinkedBuildBranch(branch) || !env.id || seen.has(branch)) continue;
    links.push({ branch, releaseEnvId: env.id });
    seen.add(branch);
  }
  return links.sort((a, b) => {
    const order = { mastertest: 1, master: 2 };
    return (order[a.branch] || 99) - (order[b.branch] || 99);
  });
}

function normalizeProfile(profile = {}) {
  const releaseEnvironments = Array.isArray(profile.releaseEnvironments) ? profile.releaseEnvironments : [];
  const environmentLinks = Array.isArray(profile.environmentLinks) && profile.environmentLinks.length
    ? profile.environmentLinks.filter((item) => isLinkedBuildBranch(item.branch) && item.releaseEnvId)
    : environmentLinksForReleaseEnvironments(releaseEnvironments);
  return {
    ...profile,
    accounts: Array.isArray(profile.accounts) ? profile.accounts : [],
    applications: Array.isArray(profile.applications) ? profile.applications : [],
    releaseEnvironments,
    environmentLinks
  };
}

function customWorkflowAccounts(source = {}) {
  const accounts = Array.isArray(source.customWorkflowAccounts)
    ? source.customWorkflowAccounts
    : Array.isArray(source.workflows)
      ? source.workflows
      : [];
  return accounts
    .filter((item) => item && item.profileId && item.id)
    .map((item) => ({
      profileId: String(item.profileId),
      id: String(item.id),
      label: String(item.label || item.id),
      username: String(item.username || item.id),
      secretMode: "editable",
      staffCode: item.staffCode ? String(item.staffCode) : undefined,
      platforms: Array.isArray(item.platforms) && item.platforms.length ? item.platforms : ["build", "release"],
      scopeNote: item.scopeNote || "本地新增 workflow 账号。",
      createdAt: item.createdAt,
      customWorkflow: true
    }));
}

function customWorkflowProfiles(source = {}) {
  const profiles = Array.isArray(source.customWorkflowProfiles) ? source.customWorkflowProfiles : [];
  return profiles
    .filter((item) => item && item.id && item.customerNameEn)
    .map((item) => normalizeProfile({
      ...item,
      id: String(item.id),
      hospitalName: String(item.hospitalName || item.shortName || item.customerNameEn),
      shortName: String(item.shortName || item.hospitalName || item.customerNameEn),
      customerNameEn: String(item.customerNameEn),
      customerCodeAbbreviation: String(item.customerCodeAbbreviation || item.customerNameEn),
      ownerHint: String(item.ownerHint || "本地初始化 workflow。"),
      accounts: (Array.isArray(item.accounts) ? item.accounts : []).map((account) => ({
        id: String(account.id || account.username || account.label),
        label: String(account.label || account.username || account.id),
        username: String(account.username || account.id || account.label),
        secretMode: "editable",
        staffCode: account.staffCode ? String(account.staffCode) : undefined,
        platforms: Array.isArray(account.platforms) && account.platforms.length ? account.platforms : ["build", "release"],
        scopeNote: account.scopeNote || "本地初始化 workflow 账号。",
        createdAt: account.createdAt,
        customWorkflow: true
      })).filter((account) => account.id && account.username)
	    }));
}

function hiddenWorkflowProfileIds(source = {}) {
  const ids = Array.isArray(source.hiddenWorkflowProfileIds)
    ? source.hiddenWorkflowProfileIds
    : Array.isArray(source.deletedWorkflowProfileIds)
      ? source.deletedWorkflowProfileIds
      : [];
  return new Set(ids.map((id) => String(id)).filter(Boolean));
}

function materializeProfiles(source = {}) {
  const extras = customWorkflowAccounts(source);
  const hiddenProfileIds = hiddenWorkflowProfileIds(source);
  const baseProfiles = cloneJson(defaultProfiles)
    .filter((profile) => !hiddenProfileIds.has(profile.id))
    .map(normalizeProfile);
  const dynamicProfiles = customWorkflowProfiles(source)
    .filter((profile) => !hiddenProfileIds.has(profile.id));
  const mergedProfiles = [...baseProfiles, ...dynamicProfiles];
  return mergedProfiles.map((profile) => {
    const existing = new Set(profile.accounts.map((account) => account.id));
    const extraAccounts = extras
      .filter((account) => account.profileId === profile.id && !existing.has(account.id))
      .map(({ profileId, ...account }) => account);
    return normalizeProfile({
      ...profile,
      accounts: [...profile.accounts, ...extraAccounts]
    });
  });
}

const profiles = materializeProfiles();

function getProfile(profileId, source = {}) {
  return materializeProfiles(source).find((profile) => profile.id === profileId);
}

module.exports = {
  customWorkflowAccounts,
  customWorkflowProfiles,
  environmentLinksForReleaseEnvironments,
  getProfile,
  hiddenWorkflowProfileIds,
  materializeProfiles,
  platforms,
  profiles
};
