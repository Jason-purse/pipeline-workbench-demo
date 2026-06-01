const http = require("http");
const fs = require("fs");
const path = require("path");

const ENV_PATH = path.join(__dirname, "..", ".env");

function loadDotEnv(filePath = ENV_PATH) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const key = match[1];
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] == null) {
      process.env[key] = value;
    }
  }
}

loadDotEnv();

const { customWorkflowAccounts, environmentLinksForReleaseEnvironments, getProfile, materializeProfiles, platforms } = require("./data/profiles");
const { stateLabels, tasks } = require("./data/tasks");
const {
  executeBuildPlatformPublish,
  executeBuildImages,
  executeBuildTask,
  executePublishApps,
  discoverBuildWorkflowCustomers,
  getCurrentAppPublishDetail,
  listBuildTasks,
  probeBuildApply,
  probeBuildPlatform,
  probeImageVersion,
  probeStructureTypeConfigs,
  probeBuildServiceDetail,
  probeReleasePlatform,
  verifyTaskBuildPermission
} = require("./lib/platform-client");

const PORT = Number(process.env.PORT || 4173);
const PUBLIC_DIR = path.join(__dirname, "..", "public");
const SECRETS_PATH = process.env.WORKBENCH_SECRETS_PATH || path.join(__dirname, "..", ".workbench-secrets.json");

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

function readSecrets() {
  if (!fs.existsSync(SECRETS_PATH)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(SECRETS_PATH, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    return {};
  }
}

function writeSecrets(secrets) {
  const previous = readSecrets();
  const next = {
    version: 1,
    updatedAt: new Date().toISOString(),
    accounts: secrets.accounts || previous.accounts || {},
    customWorkflowProfiles: Array.isArray(secrets.customWorkflowProfiles)
      ? secrets.customWorkflowProfiles
      : Array.isArray(previous.customWorkflowProfiles)
        ? previous.customWorkflowProfiles
        : [],
    customWorkflowAccounts: Array.isArray(secrets.customWorkflowAccounts)
      ? secrets.customWorkflowAccounts
      : Array.isArray(previous.customWorkflowAccounts)
        ? previous.customWorkflowAccounts
        : Array.isArray(previous.workflows)
          ? previous.workflows
          : [],
    hiddenWorkflowProfileIds: Array.isArray(secrets.hiddenWorkflowProfileIds)
      ? secrets.hiddenWorkflowProfileIds
      : Array.isArray(previous.hiddenWorkflowProfileIds)
        ? previous.hiddenWorkflowProfileIds
        : []
  };
  fs.mkdirSync(path.dirname(SECRETS_PATH), { recursive: true, mode: 0o700 });
  fs.writeFileSync(SECRETS_PATH, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
}

function activeProfiles() {
  return materializeProfiles(readSecrets());
}

function activeProfile(profileId) {
  return getProfile(profileId, readSecrets());
}

function accountSecretKey(profileId, accountId) {
  return `${profileId}:${accountId}`;
}

function getStoredAccount(profileId, accountId) {
  const secrets = readSecrets();
  return secrets.accounts && secrets.accounts[accountSecretKey(profileId, accountId)] || null;
}

function setStoredAccount(profileId, accountId, value) {
  const secrets = readSecrets();
  const accounts = { ...(secrets.accounts || {}) };
  const previous = accounts[accountSecretKey(profileId, accountId)] || {};
  accounts[accountSecretKey(profileId, accountId)] = {
    ...previous,
    username: value.username,
    password: value.password,
    source: "saved",
    updatedAt: new Date().toISOString()
  };
  writeSecrets({ accounts });
  return accounts[accountSecretKey(profileId, accountId)];
}

function deleteStoredAccount(profileId, accountId) {
  const secrets = readSecrets();
  const accounts = { ...(secrets.accounts || {}) };
  delete accounts[accountSecretKey(profileId, accountId)];
  writeSecrets({ accounts });
}

function workflowAccountId(value) {
  const base = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || `workflow-${Date.now()}`;
}

function workflowProfileId(value) {
  const base = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || `workflow-profile-${Date.now()}`;
}

function uniqueWorkflowProfileId(customerNameEn) {
  const existing = new Set(activeProfiles().map((profile) => profile.id));
  const base = workflowProfileId(customerNameEn);
  const seed = `${base}-${Date.now()}`;
  if (!existing.has(seed)) return seed;
  let index = 2;
  while (existing.has(`${seed}-${index}`)) index += 1;
  return `${seed}-${index}`;
}

function uniqueWorkflowAccountId(profile, requestedId) {
  const existing = new Set((profile.accounts || []).map((account) => account.id));
  const base = workflowAccountId(requestedId);
  if (!existing.has(base)) return base;
  let index = 2;
  while (existing.has(`${base}-${index}`)) index += 1;
  return `${base}-${index}`;
}

function setCustomWorkflowAccount(value) {
  const secrets = readSecrets();
  const profile = activeProfile(value.profileId);
  if (!profile) return null;
  const label = String(value.label || value.username || "").trim();
  const username = String(value.username || "").trim();
  const password = String(value.password || "");
  if (!label || !username || !password) {
    const error = new Error("missing_workflow_account_fields");
    error.code = "missing_workflow_account_fields";
    throw error;
  }
  const id = uniqueWorkflowAccountId(profile, value.accountId || username || label);
  const accounts = [
    ...customWorkflowAccounts(secrets).filter((account) => !(account.profileId === profile.id && account.id === id)),
    {
      profileId: profile.id,
      id,
      label,
      username,
      secretMode: "editable",
      staffCode: value.staffCode ? String(value.staffCode).trim() : undefined,
      platforms: ["build", "release"],
      scopeNote: String(value.scopeNote || "本地新增 workflow 账号。"),
      createdAt: new Date().toISOString()
    }
  ];
  writeSecrets({ ...secrets, customWorkflowAccounts: accounts });
  setStoredAccount(profile.id, id, { username, password });
  const nextProfile = activeProfile(profile.id);
  return nextProfile.accounts.find((account) => account.id === id);
}

function customerField(customer = {}, keys = []) {
  for (const key of keys) {
    const value = customer[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return "";
}

function releaseEnvironmentsFromProbe(profileId, releaseResult) {
  return (releaseResult.environments || [])
    .map((card, index) => {
      const env = card.environment || {};
      const showNameEn = String(env.showNameEn || "").trim();
      const environmentFlag = String(env.environmentFlag || "").trim();
      if (!showNameEn && !env.showName && !environmentFlag) return null;
      const id = workflowProfileId(`${profileId}-${showNameEn || env.showName || "env"}-${environmentFlag || index + 1}`);
      const apps = {};
      for (const app of card.apps || []) {
        const code = app.applicationCode || app.applicationName;
        if (!code) continue;
        apps[code] = {
          currentVersion: app.applicationVersion || "",
          spotVersion: app.spotAppVersion || ""
        };
      }
      return {
        id,
        label: env.showName || env.showNameEn || id,
        showNameEn,
        environmentFlag,
        companyAddress: env.companyAddress,
        spotAddress: env.spotAddress,
        apps
      };
    })
    .filter(Boolean);
}

function applicationsFromProbes(buildResult, releaseEnvironments) {
  const byCode = new Map();
  const customerApps = buildResult.customerApplications?.rows || [];
  for (const item of customerApps) {
    const code = item.applicationCode || item.code || item.applicationName;
    if (!code) continue;
    byCode.set(code, { code, name: item.applicationName || item.name || code });
  }
  for (const env of releaseEnvironments || []) {
    for (const code of Object.keys(env.apps || {})) {
      if (!byCode.has(code)) byCode.set(code, { code, name: code });
    }
  }
  const discoveredApps = buildResult.serviceDiscovery || [];
  for (const item of discoveredApps) {
    const code = item.applicationCode || item.applicationName;
    if (!code || byCode.has(code)) continue;
    byCode.set(code, { code, name: item.applicationName || code });
  }
  return Array.from(byCode.values());
}

function saveInitializedWorkflowProfile(profile, account, credentials) {
  const secrets = readSecrets();
  const dynamicProfiles = Array.isArray(secrets.customWorkflowProfiles) ? secrets.customWorkflowProfiles : [];
  const hiddenProfileIds = new Set((secrets.hiddenWorkflowProfileIds || []).map(String));
  hiddenProfileIds.delete(profile.id);
  const nextProfiles = [
    ...dynamicProfiles.filter((item) => item.id !== profile.id),
    {
      ...profile,
      accounts: [
        ...((profile.accounts || []).filter((item) => item.id !== account.id)),
        account
      ]
    }
  ];
  writeSecrets({ ...secrets, customWorkflowProfiles: nextProfiles, hiddenWorkflowProfileIds: Array.from(hiddenProfileIds) });
  setStoredAccount(profile.id, account.id, credentials);
}

function codedError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function deleteWorkflowProfile(profileId) {
  const id = String(profileId || "").trim();
  if (!id) throw codedError("请选择要删除的 workflow。", "missing_workflow_profile_id");

  const currentProfiles = activeProfiles();
  const profile = currentProfiles.find((item) => item.id === id);
  if (!profile) throw codedError("workflow 不存在或已删除。", "workflow_not_found");
  if (currentProfiles.length <= 1) throw codedError("至少保留一个 workflow。", "workflow_delete_last_forbidden");

  const secrets = readSecrets();
  const dynamicProfiles = Array.isArray(secrets.customWorkflowProfiles) ? secrets.customWorkflowProfiles : [];
  const dynamicProfileIds = new Set(dynamicProfiles.map((item) => String(item.id)));
  const hiddenProfileIds = new Set((secrets.hiddenWorkflowProfileIds || []).map(String));
  if (!dynamicProfileIds.has(id)) hiddenProfileIds.add(id);

  const accounts = { ...(secrets.accounts || {}) };
  for (const key of Object.keys(accounts)) {
    if (key === id || key.startsWith(`${id}:`)) delete accounts[key];
  }

  writeSecrets({
    ...secrets,
    accounts,
    customWorkflowProfiles: dynamicProfiles.filter((item) => String(item.id) !== id),
    customWorkflowAccounts: customWorkflowAccounts(secrets).filter((account) => account.profileId !== id),
    hiddenWorkflowProfileIds: Array.from(hiddenProfileIds)
  });

  return {
    deletedProfileId: id,
    profiles: activeProfiles(),
    credentialState: credentialState()
  };
}

function initializeCustomWorkflow(body = {}) {
  const username = String(body.username || "").trim();
  const password = String(body.password || "");
  const customer = body.customer || {};
  const customerNameEn = customerField(customer, ["customerNameEn", "value", "id"]);
  if (!username || !password || !customerNameEn) {
    const error = new Error("请输入账号、密码并选择构建平台客户。");
    error.code = "missing_workflow_init_fields";
    throw error;
  }

  const credentials = { username, password };
  const buildResult = probeBuildPlatform(credentials, { customerNameEn, fast: false });
  if (!buildResult.ok) {
    const error = new Error(buildResult.message || buildResult.error || "构建平台客户初始化失败");
    error.code = buildResult.reason || "build_workflow_probe_failed";
    throw error;
  }
  const releaseResult = probeReleasePlatform(credentials, { customerNameEn, fast: true });
  if (!releaseResult.ok) {
    const error = new Error(releaseResult.message || releaseResult.error || "发布平台环境初始化失败");
    error.code = releaseResult.reason || "release_workflow_probe_failed";
    throw error;
  }

  const profileId = uniqueWorkflowProfileId(customerNameEn);
  const releaseEnvironments = releaseEnvironmentsFromProbe(profileId, releaseResult);
  if (!releaseEnvironments.length) {
    const error = new Error("发布平台未返回该客户的环境，无法建立构建/发布环境映射。");
    error.code = "release_environments_not_found";
    throw error;
  }
  const accountId = uniqueWorkflowAccountId({ accounts: [] }, username);
  const account = {
    id: accountId,
    label: username,
    username,
    secretMode: "editable",
    staffCode: releaseResult.session?.staffCode || buildResult.session?.staffCode,
    platforms: ["build", "release"],
    scopeNote: "本地初始化 workflow 账号。",
    createdAt: new Date().toISOString(),
    customWorkflow: true
  };
  const profile = {
    id: profileId,
    hospitalName: customerField(customer, ["customerNameCh", "hospitalName", "label", "name"]) || customerNameEn,
    shortName: customerField(customer, ["customerCodeAbbreviation", "shortName", "customerNameCh", "label"]) || customerNameEn,
    customerNameEn,
    customerCodeAbbreviation: customerField(customer, ["customerCodeAbbreviation", "shortName"]) || customerNameEn,
    ownerHint: "本地初始化 workflow。",
    accounts: [account],
    applications: applicationsFromProbes(buildResult, releaseEnvironments),
    releaseEnvironments,
    environmentLinks: environmentLinksForReleaseEnvironments(releaseEnvironments)
  };

  saveInitializedWorkflowProfile(profile, account, credentials);
  return {
    profile: activeProfile(profile.id),
    account,
    buildResult,
    releaseResult
  };
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(payload, null, 2));
}

function sendText(res, statusCode, message) {
  res.writeHead(statusCode, { "content-type": "text/plain; charset=utf-8" });
  res.end(message);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error("request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error("invalid json body"));
      }
    });
    req.on("error", reject);
  });
}

function resolveAccount(profile, body) {
  const accountId = body.accountId || (profile.accounts[0] && profile.accounts[0].id);
  const account = profile.accounts.find((item) => item.id === accountId);
  if (!account) return null;
  const stored = getStoredAccount(profile.id, account.id);
  const envUsername = account.envUsernameKey && process.env[account.envUsernameKey];
  const envPassword = account.envPasswordKey && process.env[account.envPasswordKey];
  const username = stored && stored.username || envUsername || account.username;
  const password = stored && stored.password || envPassword;
  const configured = Boolean(username && password);
  if (!configured) {
    return {
      account,
      missing: true,
      username,
      envUsernameKey: account.envUsernameKey,
      envPasswordKey: account.envPasswordKey
    };
  }

  return {
    username,
    password
  };
}

function credentialStateForAccount(profile, account) {
  const stored = getStoredAccount(profile.id, account.id);
  const envUsername = account.envUsernameKey && process.env[account.envUsernameKey];
  const envPassword = account.envPasswordKey && process.env[account.envPasswordKey];
  const username = stored && stored.username || envUsername || account.username;
  const passwordConfigured = Boolean(stored && stored.password || envPassword);
  const source = stored && stored.password ? "saved" : envPassword ? "env" : "missing";
  const usernameFrom = stored && stored.username ? "saved" : envUsername ? "env" : "profile";
  return {
    profileId: profile.id,
    accountId: account.id,
    label: account.label,
    username,
    usernameFrom,
    configured: Boolean(username && passwordConfigured),
    secretMode: account.secretMode || "editable",
    source,
    envUsernameKey: account.envUsernameKey,
    envPasswordKey: account.envPasswordKey,
    passwordConfigured,
    savedAt: stored && stored.updatedAt,
    platforms: account.platforms,
    scopeNote: account.scopeNote
  };
}

function credentialState() {
  return activeProfiles().map((profile) => ({
    profileId: profile.id,
    shortName: profile.shortName,
    customerNameEn: profile.customerNameEn,
    accounts: profile.accounts.map((account) => credentialStateForAccount(profile, account))
  }));
}

function sendMissingCredentials(res, profile, credentials) {
  sendJson(res, 409, {
    ok: false,
    error: "credentials_not_configured",
    profileId: profile.id,
    accountId: credentials && credentials.account && credentials.account.id,
    envUsernameKey: credentials && credentials.envUsernameKey,
    envPasswordKey: credentials && credentials.envPasswordKey
  });
}

function allowedApplication(profile, applicationCode) {
  return Boolean(applicationCode);
}

function findReleaseEnvironment(profile, body) {
  return profile.releaseEnvironments.find((env) =>
    env.id === body.environmentId ||
    (env.showNameEn === body.showNameEn && env.environmentFlag === body.environmentFlag)
  );
}

function pickReleaseOverviewApp(overviewResult, env, applicationCode) {
  if (!overviewResult || !overviewResult.ok) return null;
  const card = (overviewResult.environments || []).find((item) =>
    item.environment?.showNameEn === env?.showNameEn &&
    item.environment?.environmentFlag === env?.environmentFlag
  );
  return card?.apps?.find((app) => app.applicationCode === applicationCode) || null;
}

function releaseDetailAsProbeResult(profile, env, applicationCode, detailResult, options = {}) {
  const raw = detailResult.raw || {};
  const companyPending = raw.companyPublishFlag === "1" ? 0 : (raw.companyImages && Array.isArray(raw.companyImages.currentServices) ? raw.companyImages.currentServices.length : 0);
  const spotPending = raw.spotPublishFlag === "1" ? 0 : (raw.spotImages && Array.isArray(raw.spotImages.currentServices) ? raw.spotImages.currentServices.length : 0);
  const detailPending = companyPending + spotPending;
  const overviewApp = options.overviewApp || null;
  const overviewPending = Number(overviewApp && overviewApp.toPublishServiceNum);
  const pendingTotal = detailPending > 0
    ? detailPending
    : (Number.isFinite(overviewPending) && overviewPending > 0 ? overviewPending : detailPending);
  const applicationVersion = raw.applicationVersion || overviewApp?.applicationVersion || "";
  const spotAppVersion = raw.spotAppVersion || overviewApp?.spotAppVersion || "";
  return {
    ok: detailResult.ok,
    session: detailResult.session,
    reason: detailResult.reason,
    message: detailResult.message || detailResult.session && (detailResult.session.message || detailResult.session.login && detailResult.session.login.message),
    fast: true,
    source: overviewApp ? "overview+current-app-detail" : "current-app-detail",
    overviewApp,
    platform: {
      shell: platforms.releaseShell,
      api: platforms.releaseApi
    },
    customers: {
      count: 0,
      matched: [{
        customerNameCh: profile.hospitalName,
        customerNameEn: profile.customerNameEn,
        customerCodeAbbreviation: profile.customerCodeAbbreviation
      }]
    },
    apps: {
      count: 1
    },
    environments: [{
      customerEnvKey: `${profile.customerNameEn}${env.showNameEn}${env.environmentFlag}`,
      customer: {
        customerNameCh: profile.hospitalName,
        customerNameEn: profile.customerNameEn,
        customerCodeAbbreviation: profile.customerCodeAbbreviation
      },
      environment: {
        id: env.id,
        showName: env.label,
        showNameEn: env.showNameEn,
        environmentFlag: env.environmentFlag,
        companyAddress: env.companyAddress,
        spotAddress: env.spotAddress
      },
      apps: [{
        applicationName: raw.applicationName || overviewApp?.applicationName || applicationCode,
        applicationCode,
        applicationVersion,
        spotAppVersion,
        toPublishServiceNum: pendingTotal,
        publishStatus: pendingTotal > 0 ? 1 : -1,
        createTime: raw.createTime || overviewApp?.createTime
      }]
    }],
    detail: detailResult.detail,
    payload: detailResult.payload
  };
}

function normalizeBuildImages(body) {
  const source = Array.isArray(body.buildImages) && body.buildImages.length
    ? body.buildImages
    : Array.isArray(body.images) && body.images.length
      ? body.images
      : [{
          imageJenkinsName: body.imageJenkinsName,
          applicationCode: body.applicationCode,
          imageNameEn: body.imageNameEn,
          imageVersion: body.imageVersion,
          imageDeployId: body.imageDeployId,
          coverageRun: body.coverageRun
        }];
  return source
    .map((item) => ({
      imageJenkinsName: item.imageJenkinsName,
      applicationCode: item.applicationCode || body.applicationCode,
      imageNameEn: item.imageNameEn,
      imageVersion: item.imageVersion,
      imageDeployId: item.imageDeployId,
      coverageRun: item.coverageRun
    }))
    .filter((item) => item.imageJenkinsName);
}

function buildConfirmText(verb, buildImages) {
  if (buildImages.length === 1) return `${verb} ${buildImages[0].imageJenkinsName}`;
  return `${verb} ${buildImages.length} 个服务`;
}

function buildPlatformPublishConfirmText(body) {
  return `构建平台发布 ${body.applyId || body.taskId || body.structureApplyId}`;
}

async function handleApi(req, res, pathname) {
  if (req.method === "GET" && pathname === "/api/bootstrap") {
    sendJson(res, 200, {
      generatedAt: new Date().toISOString(),
      mode: "pipeline-workbench-mvp",
      platforms,
      profiles: activeProfiles(),
      credentialState: credentialState(),
      stateLabels,
      tasks
    });
    return;
  }

  if (req.method === "GET" && pathname === "/api/config/credentials") {
    sendJson(res, 200, {
      generatedAt: new Date().toISOString(),
      credentials: credentialState()
    });
    return;
  }

  if (req.method === "POST" && pathname === "/api/config/credentials") {
    const body = await readBody(req);
    const profile = activeProfile(body.profileId);
    if (!profile) {
      sendJson(res, 404, { ok: false, error: "profile_not_found" });
      return;
    }
    const account = profile.accounts.find((item) => item.id === body.accountId);
    if (!account) {
      sendJson(res, 404, { ok: false, error: "account_not_found" });
      return;
    }
    const username = String(body.username || account.username || "").trim();
    const password = String(body.password || "");
    if (!username || !password) {
      sendJson(res, 400, { ok: false, error: "missing_credentials" });
      return;
    }
    setStoredAccount(profile.id, account.id, { username, password });
    sendJson(res, 200, {
      ok: true,
      credentialState: credentialState()
    });
    return;
  }

  if (req.method === "POST" && pathname === "/api/config/workflows/discover-customers") {
    const body = await readBody(req);
    const username = String(body.username || "").trim();
    const password = String(body.password || "");
    if (!username || !password) {
      sendJson(res, 400, { ok: false, error: "missing_credentials", message: "请输入账号和密码后再探测客户。" });
      return;
    }
    const result = discoverBuildWorkflowCustomers({ username, password });
    if (!result.ok) {
      sendJson(res, 502, { ok: false, error: result.reason || "workflow_customer_discovery_failed", message: result.message || result.error || "构建平台客户探测失败", result });
      return;
    }
    sendJson(res, 200, {
      ok: true,
      customers: result.customers,
      apps: result.apps,
      session: result.session
    });
    return;
  }

  if (req.method === "POST" && pathname === "/api/config/workflows") {
    const body = await readBody(req);
    try {
      const initialized = initializeCustomWorkflow(body);
      sendJson(res, 200, {
        ok: true,
        profile: initialized.profile,
        account: initialized.account,
        profileId: initialized.profile?.id,
        accountId: initialized.account?.id,
        profiles: activeProfiles(),
        credentialState: credentialState()
      });
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error.code || "workflow_account_failed", message: error.message });
    }
    return;
  }

  if (req.method === "DELETE" && pathname === "/api/config/workflows") {
    const body = await readBody(req);
    try {
      const result = deleteWorkflowProfile(body.profileId);
      sendJson(res, 200, { ok: true, ...result });
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error.code || "workflow_delete_failed", message: error.message });
    }
    return;
  }

  if (req.method === "DELETE" && pathname === "/api/config/credentials") {
    const body = await readBody(req);
    const profile = activeProfile(body.profileId);
    if (!profile) {
      sendJson(res, 404, { ok: false, error: "profile_not_found" });
      return;
    }
    const account = profile.accounts.find((item) => item.id === body.accountId);
    if (!account) {
      sendJson(res, 404, { ok: false, error: "account_not_found" });
      return;
    }
    deleteStoredAccount(profile.id, account.id);
    sendJson(res, 200, {
      ok: true,
      credentialState: credentialState()
    });
    return;
  }

  if (req.method === "POST" && pathname === "/api/probe/build") {
    const body = await readBody(req);
    const profile = activeProfile(body.profileId);
    if (!profile) {
      sendJson(res, 404, { ok: false, error: "profile_not_found" });
      return;
    }
    const credentials = resolveAccount(profile, body);
    if (!credentials) {
      sendJson(res, 404, { ok: false, error: "account_not_found" });
      return;
    }
    if (credentials.missing) {
      sendMissingCredentials(res, profile, credentials);
      return;
    }
    if (body.applicationCode && !allowedApplication(profile, body.applicationCode)) {
      sendJson(res, 400, { ok: false, error: "application_not_allowed" });
      return;
    }
    sendJson(res, 200, {
      profileId: profile.id,
      accountId: body.accountId,
      result: probeBuildPlatform(credentials, {
        customerNameEn: body.customerNameEn || profile.customerNameEn,
        applicationCodes: body.applicationCode ? [body.applicationCode] : profile.applications.map((app) => app.code),
        codeBranch: body.codeBranch,
        fast: body.fast !== false,
        serviceSearch: body.serviceSearch
      })
    });
    return;
  }

  if (req.method === "POST" && pathname === "/api/probe/build-service") {
    const body = await readBody(req);
    const profile = activeProfile(body.profileId);
    if (!profile) {
      sendJson(res, 404, { ok: false, error: "profile_not_found" });
      return;
    }
    const credentials = resolveAccount(profile, body);
    if (!credentials) {
      sendJson(res, 404, { ok: false, error: "account_not_found" });
      return;
    }
    if (credentials.missing) {
      sendMissingCredentials(res, profile, credentials);
      return;
    }
    if (!allowedApplication(profile, body.applicationCode)) {
      sendJson(res, 400, { ok: false, error: "application_not_allowed" });
      return;
    }
    sendJson(res, 200, {
      profileId: profile.id,
      accountId: body.accountId,
      result: probeBuildServiceDetail(credentials, {
        customerNameEn: body.customerNameEn || profile.customerNameEn,
        applicationCode: body.applicationCode,
        codeBranch: body.codeBranch,
        imageJenkinsName: body.imageJenkinsName
      })
    });
    return;
  }

  if (req.method === "POST" && pathname === "/api/probe/build-tasks") {
    const body = await readBody(req);
    const profile = activeProfile(body.profileId);
    if (!profile) {
      sendJson(res, 404, { ok: false, error: "profile_not_found" });
      return;
    }
    const credentials = resolveAccount(profile, body);
    if (!credentials) {
      sendJson(res, 404, { ok: false, error: "account_not_found" });
      return;
    }
    if (credentials.missing) {
      sendMissingCredentials(res, profile, credentials);
      return;
    }
    if (!allowedApplication(profile, body.applicationCode)) {
      sendJson(res, 400, { ok: false, error: "application_not_allowed" });
      return;
    }
    sendJson(res, 200, {
      profileId: profile.id,
      accountId: body.accountId,
      result: listBuildTasks(credentials, {
        customerNameEn: body.customerNameEn || profile.customerNameEn,
        applicationCode: body.applicationCode,
        codeBranch: body.codeBranch,
        envType: body.envType || body.codeBranch,
        releaseTaskId: body.releaseTaskId,
        imageJenkinsName: body.imageJenkinsName,
        imageNameEn: body.imageNameEn,
        imageVersion: body.imageVersion,
        images: normalizeBuildImages(body),
        ignoreVersion: Boolean(body.ignoreVersion),
        maxTaskImageLookups: body.maxTaskImageLookups,
        maxPendingApplyPages: body.maxPendingApplyPages,
        taskPageNumber: body.taskPageNumber,
        taskPageSize: body.taskPageSize,
        taskStatus: body.taskStatus
      })
    });
    return;
  }

  if (req.method === "POST" && pathname === "/api/probe/build-apply") {
    const body = await readBody(req);
    const profile = activeProfile(body.profileId);
    if (!profile) {
      sendJson(res, 404, { ok: false, error: "profile_not_found" });
      return;
    }
    const credentials = resolveAccount(profile, body);
    if (!credentials) {
      sendJson(res, 404, { ok: false, error: "account_not_found" });
      return;
    }
    if (credentials.missing) {
      sendMissingCredentials(res, profile, credentials);
      return;
    }
    if (!allowedApplication(profile, body.applicationCode)) {
      sendJson(res, 400, { ok: false, error: "application_not_allowed" });
      return;
    }
    sendJson(res, 200, {
      profileId: profile.id,
      accountId: body.accountId,
      result: probeBuildApply(credentials, {
        applyId: body.applyId,
        taskId: body.taskId,
        structureApplyId: body.structureApplyId,
        customerNameEn: body.customerNameEn || profile.customerNameEn,
        applicationCode: body.applicationCode,
        codeBranch: body.codeBranch,
        envType: body.envType || body.codeBranch,
        imageJenkinsName: body.imageJenkinsName,
        imageNameEn: body.imageNameEn,
        images: normalizeBuildImages(body),
        ignoreVersion: Boolean(body.ignoreVersion),
        maxApplyPages: body.maxApplyPages
      })
    });
    return;
  }

  if (req.method === "POST" && pathname === "/api/probe/image-version") {
    const body = await readBody(req);
    const profile = activeProfile(body.profileId);
    if (!profile) {
      sendJson(res, 404, { ok: false, error: "profile_not_found" });
      return;
    }
    const credentials = resolveAccount(profile, body);
    if (!credentials) {
      sendJson(res, 404, { ok: false, error: "account_not_found" });
      return;
    }
    if (credentials.missing) {
      sendMissingCredentials(res, profile, credentials);
      return;
    }
    if (!allowedApplication(profile, body.applicationCode)) {
      sendJson(res, 400, { ok: false, error: "application_not_allowed" });
      return;
    }

    sendJson(res, 200, {
      profileId: profile.id,
      accountId: body.accountId,
      result: probeImageVersion(credentials, {
        customerNameEn: body.customerNameEn || profile.customerNameEn,
        applicationCode: body.applicationCode,
        codeBranch: body.codeBranch,
        structureType: body.structureType || "prod",
        laneNamespace: body.laneNamespace,
        extendFlag: body.extendFlag,
        images: Array.isArray(body.images) && body.images.length
          ? body.images
          : [{ imageNameEn: body.imageNameEn }]
      })
    });
    return;
  }

  if (req.method === "POST" && pathname === "/api/probe/structure-configs") {
    const body = await readBody(req);
    const profile = activeProfile(body.profileId);
    if (!profile) {
      sendJson(res, 404, { ok: false, error: "profile_not_found" });
      return;
    }
    const credentials = resolveAccount(profile, body);
    if (!credentials) {
      sendJson(res, 404, { ok: false, error: "account_not_found" });
      return;
    }
    if (credentials.missing) {
      sendMissingCredentials(res, profile, credentials);
      return;
    }
    if (!allowedApplication(profile, body.applicationCode)) {
      sendJson(res, 400, { ok: false, error: "application_not_allowed" });
      return;
    }
    sendJson(res, 200, {
      profileId: profile.id,
      accountId: body.accountId,
      result: probeStructureTypeConfigs(credentials, {
        customerNameEn: body.customerNameEn || profile.customerNameEn,
        namespace: body.namespace
      })
    });
    return;
  }

  if (req.method === "POST" && pathname === "/api/probe/release-detail") {
    const body = await readBody(req);
    const profile = activeProfile(body.profileId);
    if (!profile) {
      sendJson(res, 404, { ok: false, error: "profile_not_found" });
      return;
    }
    const credentials = resolveAccount(profile, body);
    if (!credentials) {
      sendJson(res, 404, { ok: false, error: "account_not_found" });
      return;
    }
    if (credentials.missing) {
      sendMissingCredentials(res, profile, credentials);
      return;
    }
    if (!allowedApplication(profile, body.applicationCode)) {
      sendJson(res, 400, { ok: false, error: "application_not_allowed" });
      return;
    }
    const env = findReleaseEnvironment(profile, body);
    if (!env) {
      sendJson(res, 400, { ok: false, error: "environment_not_allowed" });
      return;
    }
    sendJson(res, 200, {
      profileId: profile.id,
      accountId: body.accountId,
      result: getCurrentAppPublishDetail(credentials, {
        customerNameEn: body.customerNameEn || profile.customerNameEn,
        showNameEn: env.showNameEn,
        environmentFlag: env.environmentFlag,
        applicationCode: body.applicationCode,
        applicationVersion: body.applicationVersion
      })
    });
    return;
  }

  if (req.method === "POST" && pathname === "/api/probe/release") {
    const body = await readBody(req);
    const profile = activeProfile(body.profileId);
    if (!profile) {
      sendJson(res, 404, { ok: false, error: "profile_not_found" });
      return;
    }
    const credentials = resolveAccount(profile, body);
    if (!credentials) {
      sendJson(res, 404, { ok: false, error: "account_not_found" });
      return;
    }
    if (credentials.missing) {
      sendMissingCredentials(res, profile, credentials);
      return;
    }
    if (body.applicationCode && !allowedApplication(profile, body.applicationCode)) {
      sendJson(res, 400, { ok: false, error: "application_not_allowed" });
      return;
    }
    const env = body.applicationCode ? findReleaseEnvironment(profile, body) : null;
    if (body.applicationCode && env) {
      let overviewResult = probeReleasePlatform(credentials, {
        customerNameEn: body.customerNameEn || profile.customerNameEn,
        fast: true
      });
      let overviewApp = pickReleaseOverviewApp(overviewResult, env, body.applicationCode);
      if (overviewResult.ok && !overviewApp) {
        overviewResult = probeReleasePlatform(credentials, {
          customerNameEn: body.customerNameEn || profile.customerNameEn,
          fast: true
        });
        overviewApp = pickReleaseOverviewApp(overviewResult, env, body.applicationCode);
      }
      if (!overviewResult.ok || !overviewApp) {
        sendJson(res, 200, {
          profileId: profile.id,
          accountId: body.accountId,
          result: {
            ok: false,
            reason: overviewResult.ok ? "release_overview_app_not_found" : overviewResult.reason || "release_overview_failed",
            message: overviewResult.ok
              ? `${env.showNameEn}/${env.environmentFlag} 未匹配到 ${body.applicationCode} 发布应用，总览可能仍在刷新。`
              : overviewResult.message || "发布平台总览暂不可用。",
            overview: {
              ok: overviewResult.ok,
              reason: overviewResult.reason,
              message: overviewResult.message
            }
          }
        });
        return;
      }
      const applicationVersion = overviewApp.applicationVersion;
      if (!applicationVersion) {
        sendJson(res, 200, {
          profileId: profile.id,
          accountId: body.accountId,
          result: {
            ok: false,
            reason: "release_overview_version_missing",
            message: `${env.showNameEn}/${env.environmentFlag} 的 ${body.applicationCode} 发布总览缺少应用版本，无法读取发布详情。`,
            overviewApp
          }
        });
        return;
      }
      const detailResult = getCurrentAppPublishDetail(credentials, {
        customerNameEn: body.customerNameEn || profile.customerNameEn,
        showNameEn: env.showNameEn,
        environmentFlag: env.environmentFlag,
        applicationCode: body.applicationCode,
        applicationVersion
      });
      sendJson(res, 200, {
        profileId: profile.id,
        accountId: body.accountId,
        result: releaseDetailAsProbeResult(profile, env, body.applicationCode, detailResult, {
          overviewApp,
          overview: overviewResult && {
            ok: overviewResult.ok,
            reason: overviewResult.reason,
            message: overviewResult.message
          }
        })
      });
      return;
    }
    sendJson(res, 200, {
      profileId: profile.id,
      accountId: body.accountId,
      result: probeReleasePlatform(credentials, {
        customerNameEn: body.customerNameEn || profile.customerNameEn,
        fast: body.fast !== false
      })
    });
    return;
  }

  if (req.method === "POST" && pathname === "/api/execute/build") {
    const body = await readBody(req);
    const profile = activeProfile(body.profileId);
    if (!profile) {
      sendJson(res, 404, { ok: false, error: "profile_not_found" });
      return;
    }
    const credentials = resolveAccount(profile, body);
    if (!credentials) {
      sendJson(res, 404, { ok: false, error: "account_not_found" });
      return;
    }
    if (credentials.missing) {
      sendMissingCredentials(res, profile, credentials);
      return;
    }
    if (!allowedApplication(profile, body.applicationCode)) {
      sendJson(res, 400, { ok: false, error: "application_not_allowed" });
      return;
    }
    if (body.codeBranch !== "develop" && !body.applyId && !body.taskId) {
      sendJson(res, 409, {
        ok: false,
        error: "build_task_required",
        message: "非 develop 分支需要先创建或选择构建任务，再从任务中构建镜像。",
        nextEndpoint: "/api/execute/build-task"
      });
      return;
    }
    const buildImages = normalizeBuildImages(body);
    if (!buildImages.length) {
      sendJson(res, 400, { ok: false, error: "missing_build_images" });
      return;
    }
    const confirmText = buildConfirmText("执行构建", buildImages);
    if (body.confirmText !== confirmText) {
      sendJson(res, 409, {
        ok: false,
        error: "confirmation_required",
        expectedConfirmText: confirmText
      });
      return;
    }
    let taskPermission = null;
    if (body.codeBranch !== "develop") {
      if (body.buildAll && body.applyId) {
        const permission = verifyTaskBuildPermission(credentials, {
          customerNameEn: body.customerNameEn || profile.customerNameEn,
          applicationCode: body.applicationCode,
          codeBranch: body.codeBranch,
          envType: body.envType || body.codeBranch,
          taskId: body.taskId,
          applyId: body.applyId,
          buildAll: Boolean(body.buildAll),
          pendingApply: Boolean(body.buildAll),
          buildImages,
          images: buildImages
        });
        if (!permission.ok) {
          sendJson(res, 409, {
            ok: false,
            error: "task_build_not_allowed",
            detail: permission
          });
          return;
        }
        taskPermission = permission;
      } else {
        const taskPermissions = [];
        for (const image of buildImages) {
          const permission = verifyTaskBuildPermission(credentials, {
            customerNameEn: body.customerNameEn || profile.customerNameEn,
            applicationCode: body.applicationCode,
            codeBranch: body.codeBranch,
            envType: body.envType || body.codeBranch,
            taskId: body.taskId,
            applyId: body.applyId,
            buildAll: Boolean(body.buildAll),
            pendingApply: Boolean(body.buildAll),
            imageJenkinsName: image.imageJenkinsName,
            imageNameEn: image.imageNameEn,
            imageVersion: image.imageVersion
          });
          taskPermissions.push(permission);
          if (!permission.ok) {
            sendJson(res, 409, {
              ok: false,
              error: "task_build_not_allowed",
              detail: permission
            });
            return;
          }
        }
        taskPermission = taskPermissions.length === 1 ? taskPermissions[0] : taskPermissions;
      }
    }
    sendJson(res, 200, {
      profileId: profile.id,
      accountId: body.accountId,
      taskPermission,
      result: executeBuildImages(credentials, {
        customerNameEn: body.customerNameEn || profile.customerNameEn,
        applicationCode: body.applicationCode,
        applicationName: body.applicationName || body.applicationCode,
        codeBranch: body.codeBranch,
        buildImages,
        kubernetesVersion: body.kubernetesVersion,
        applyId: body.applyId,
        taskId: body.taskId,
        buildAll: Boolean(body.buildAll)
      })
    });
    return;
  }

  if (req.method === "POST" && pathname === "/api/execute/build-platform-publish") {
    const body = await readBody(req);
    const profile = activeProfile(body.profileId);
    if (!profile) {
      sendJson(res, 404, { ok: false, error: "profile_not_found" });
      return;
    }
    const credentials = resolveAccount(profile, body);
    if (!credentials) {
      sendJson(res, 404, { ok: false, error: "account_not_found" });
      return;
    }
    if (credentials.missing) {
      sendMissingCredentials(res, profile, credentials);
      return;
    }
    if (!allowedApplication(profile, body.applicationCode)) {
      sendJson(res, 400, { ok: false, error: "application_not_allowed" });
      return;
    }
    const confirmText = buildPlatformPublishConfirmText(body);
    if (body.confirmText !== confirmText) {
      sendJson(res, 409, {
        ok: false,
        error: "confirmation_required",
        expectedConfirmText: confirmText
      });
      return;
    }
    sendJson(res, 200, {
      profileId: profile.id,
      accountId: body.accountId,
      result: executeBuildPlatformPublish(credentials, {
        applyId: body.applyId,
        taskId: body.taskId,
        structureApplyId: body.structureApplyId,
        publishEnvironment: body.publishEnvironment,
        environment: body.environment
      })
    });
    return;
  }

  if (req.method === "POST" && pathname === "/api/execute/build-task") {
    const body = await readBody(req);
    const profile = activeProfile(body.profileId);
    if (!profile) {
      sendJson(res, 404, { ok: false, error: "profile_not_found" });
      return;
    }
    const credentials = resolveAccount(profile, body);
    if (!credentials) {
      sendJson(res, 404, { ok: false, error: "account_not_found" });
      return;
    }
    if (credentials.missing) {
      sendMissingCredentials(res, profile, credentials);
      return;
    }
    if (!allowedApplication(profile, body.applicationCode)) {
      sendJson(res, 400, { ok: false, error: "application_not_allowed" });
      return;
    }
    if (body.codeBranch === "develop") {
      sendJson(res, 409, {
        ok: false,
        error: "direct_build_required",
        message: "develop 分支不创建构建任务，直接执行构建。"
      });
      return;
    }

    const buildImages = normalizeBuildImages(body);
    if (!buildImages.length) {
      sendJson(res, 400, { ok: false, error: "missing_build_images" });
      return;
    }
    const confirmText = buildConfirmText("创建构建任务", buildImages);
    if (body.confirmText !== confirmText) {
      sendJson(res, 409, {
        ok: false,
        error: "confirmation_required",
        expectedConfirmText: confirmText
      });
      return;
    }

    if (body.flowMode === "release-task" && !String(body.releaseContent || "").trim()) {
      sendJson(res, 400, {
        ok: false,
        error: "missing_release_content",
        message: "提测任务需要填写发布内容。"
      });
      return;
    }
    if ((body.flowMode || "apply-task") === "apply-task") {
      if (!String(body.deploymentDescribe || "").trim()) {
        sendJson(res, 400, {
          ok: false,
          error: "missing_deployment_describe",
          message: "构建申请需要填写构建说明。"
        });
        return;
      }
      if (!String(body.deploymentExplain || "").trim()) {
        sendJson(res, 400, {
          ok: false,
          error: "missing_deployment_explain",
          message: "构建申请需要填写发布/部署说明。"
        });
        return;
      }
    }

    sendJson(res, 200, {
      profileId: profile.id,
      accountId: body.accountId,
      result: executeBuildTask(credentials, {
        flowMode: body.flowMode,
        customerNameEn: body.customerNameEn || profile.customerNameEn,
        applicationCode: body.applicationCode,
        applicationName: body.applicationName || body.applicationCode,
        codeBranch: body.codeBranch,
        structureType: body.structureType,
        releaseAppSub: body.releaseAppSub,
        releaseModule: body.releaseModule,
        releaseType: body.releaseType,
        releaseContent: body.releaseContent,
        buildType: body.buildType,
        extendFlag: body.extendFlag,
        deploymentDescribe: body.deploymentDescribe,
        deploymentExplain: body.deploymentExplain,
        envName: body.envName,
        buildImages
      })
    });
    return;
  }

  if (req.method === "POST" && pathname === "/api/execute/publish") {
    const body = await readBody(req);
    const profile = activeProfile(body.profileId);
    if (!profile) {
      sendJson(res, 404, { ok: false, error: "profile_not_found" });
      return;
    }
    const credentials = resolveAccount(profile, body);
    if (!credentials) {
      sendJson(res, 404, { ok: false, error: "account_not_found" });
      return;
    }
    if (credentials.missing) {
      sendMissingCredentials(res, profile, credentials);
      return;
    }
    if (!allowedApplication(profile, body.applicationCode)) {
      sendJson(res, 400, { ok: false, error: "application_not_allowed" });
      return;
    }
    const env = findReleaseEnvironment(profile, body);
    if (!env) {
      sendJson(res, 400, { ok: false, error: "environment_not_allowed" });
      return;
    }
    const confirmText = `发布 ${profile.shortName} ${body.applicationCode} ${env.showNameEn}/${env.environmentFlag}`;
    if (body.confirmText !== confirmText) {
      sendJson(res, 409, {
        ok: false,
        error: "confirmation_required",
        expectedConfirmText: confirmText
      });
      return;
    }
    sendJson(res, 200, {
      profileId: profile.id,
      accountId: body.accountId,
      result: executePublishApps(credentials, {
        customerNameEn: body.customerNameEn || profile.customerNameEn,
        showNameEn: env.showNameEn,
        environment: body.environment || "company",
        environmentFlag: env.environmentFlag,
        publishApps: [{
          applicationCode: body.applicationCode,
          applicationVersion: body.applicationVersion
        }]
      })
    });
    return;
  }

  sendJson(res, 404, { ok: false, error: "api_not_found" });
}

function serveStatic(req, res, pathname) {
  if (pathname === "/favicon.ico") {
    res.writeHead(204, { "cache-control": "public, max-age=86400" });
    res.end();
    return;
  }

  const requested = pathname === "/" ? "/index.html" : pathname;
  const fullPath = path.normalize(path.join(PUBLIC_DIR, requested));

  if (!fullPath.startsWith(PUBLIC_DIR)) {
    sendText(res, 403, "forbidden");
    return;
  }

  fs.readFile(fullPath, (error, data) => {
    if (error) {
      sendText(res, 404, "not found");
      return;
    }

    const ext = path.extname(fullPath);
    res.writeHead(200, {
      "content-type": contentTypes[ext] || "application/octet-stream",
      "cache-control": "no-store"
    });
    res.end(data);
  });
}

function createWorkbenchServer() {
  return http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    if (url.pathname.startsWith("/api/")) {
      handleApi(req, res, url.pathname).catch((error) => {
        sendJson(res, 500, {
          ok: false,
          error: "internal_error",
          message: error.message
        });
      });
      return;
    }

    serveStatic(req, res, url.pathname);
  });
}

function startServer(options = {}) {
  const server = createWorkbenchServer();
  const host = options.host || process.env.HOST || "0.0.0.0";
  const port = options.port == null ? PORT : Number(options.port);

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      const address = server.address();
      const actualPort = typeof address === "object" && address ? address.port : port;
      const actualHost = host === "0.0.0.0" ? "localhost" : host;
      resolve({
        server,
        port: actualPort,
        host,
        url: `http://${actualHost}:${actualPort}/`
      });
    });
  });
}

if (require.main === module) {
  startServer().then(({ url }) => {
    console.log(`Hospital Release Workbench MVP listening on ${url}`);
  }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  createWorkbenchServer,
  startServer
};
