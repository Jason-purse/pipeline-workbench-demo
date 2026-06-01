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

export function isLinkedBuildBranch(branch) {
  return LINKED_BRANCHES.has(String(branch || ""));
}

export function buildBranchForReleaseEnvironment(env = {}) {
  const explicit = textOf(env.buildBranch || env.codeBranch);
  if (isLinkedBuildBranch(explicit)) return explicit;

  const text = environmentText(env);
  if (/mastertest|uat|test|测试|现场/.test(text)) return "mastertest";
  if (/master|prod|生产|正式/.test(text)) return "master";
  return null;
}

export function environmentLinksForReleaseEnvironments(releaseEnvironments = []) {
  const links = [];
  const seen = new Set();
  for (const env of Array.isArray(releaseEnvironments) ? releaseEnvironments : []) {
    const branch = buildBranchForReleaseEnvironment(env);
    if (!isLinkedBuildBranch(branch) || !env?.id || seen.has(branch)) continue;
    links.push({ branch, releaseEnvId: env.id });
    seen.add(branch);
  }
  return links.sort((a, b) => {
    const order = { mastertest: 1, master: 2 };
    return (order[a.branch] || 99) - (order[b.branch] || 99);
  });
}

export function environmentLinksForProfile(profile = {}) {
  const explicit = Array.isArray(profile.environmentLinks)
    ? profile.environmentLinks.filter((item) => isLinkedBuildBranch(item?.branch) && item?.releaseEnvId)
    : [];
  return explicit.length ? explicit : environmentLinksForReleaseEnvironments(profile.releaseEnvironments || []);
}

export function releaseEnvIdForBuildBranch(profile = {}, branch) {
  if (!isLinkedBuildBranch(branch)) return null;
  return environmentLinksForProfile(profile).find((item) => item.branch === branch)?.releaseEnvId || null;
}

export function buildBranchForReleaseEnvId(profile = {}, releaseEnvId) {
  if (!releaseEnvId) return null;
  const link = environmentLinksForProfile(profile).find((item) => item.releaseEnvId === releaseEnvId);
  if (link?.branch) return link.branch;
  const env = (profile.releaseEnvironments || []).find((item) => item.id === releaseEnvId);
  return buildBranchForReleaseEnvironment(env);
}
