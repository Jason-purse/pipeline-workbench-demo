import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildBranchForReleaseEnvId,
  environmentLinksForReleaseEnvironments,
  releaseEnvIdForBuildBranch
} from "../src/client/src/lib/workflow-environments.mjs";

const profileModule = await import("../src/data/profiles.js");
const { materializeProfiles } = profileModule.default || profileModule;

const profiles = materializeProfiles();
const demoa = profiles.find((item) => item.id === "demoa");
const demob = profiles.find((item) => item.id === "demob");

assert.equal(releaseEnvIdForBuildBranch(demoa, "mastertest"), "demoa-uat-a", "演示客户A mastertest should sync to the UAT release environment");
assert.equal(releaseEnvIdForBuildBranch(demoa, "master"), "demoa-prod-a", "演示客户A master should sync to the production release environment");
assert.equal(buildBranchForReleaseEnvId(demoa, "demoa-uat-a"), "mastertest", "演示客户A UAT release env should sync back to mastertest");
assert.equal(buildBranchForReleaseEnvId(demoa, "demoa-prod-a"), "master", "演示客户A production release env should sync back to master");

assert.equal(releaseEnvIdForBuildBranch(demob, "mastertest"), "demob-uat-a", "演示客户B mastertest should sync to uat-demo-b release env");
assert.equal(releaseEnvIdForBuildBranch(demob, "master"), "demob-prod-a", "演示客户B master should sync to prod-demo-b release env");
assert.equal(buildBranchForReleaseEnvId(demob, "demob-uat-a"), "mastertest", "演示客户B uat-demo-b release env should sync back to mastertest");
assert.equal(buildBranchForReleaseEnvId(demob, "demob-prod-a"), "master", "演示客户B prod-demo-b release env should sync back to master");

assert.equal(releaseEnvIdForBuildBranch(demob, "develop"), null, "develop is direct-build and should not force a release environment");
assert.equal(releaseEnvIdForBuildBranch(demob, "release"), null, "release branch should not force the mastertest/master release mapping");

const dynamicLinks = environmentLinksForReleaseEnvironments([
  { id: "custom-uat-a", label: "uatA", showNameEn: "uat-demo", environmentFlag: "a" },
  { id: "custom-prod-a", label: "prodA", showNameEn: "prod-demo", environmentFlag: "a" }
]);
assert.deepEqual(dynamicLinks, [
  { branch: "mastertest", releaseEnvId: "custom-uat-a" },
  { branch: "master", releaseEnvId: "custom-prod-a" }
]);

const customProfiles = materializeProfiles({
  customWorkflowProfiles: [
    {
      id: "custom-hospital",
      hospitalName: "测试医院",
      shortName: "测试医院",
      customerNameEn: "test-hospital",
      customerCodeAbbreviation: "test",
      accounts: [{ id: "tester", label: "tester", username: "tester" }],
      applications: [{ code: "mem", name: "mem" }],
      releaseEnvironments: [
        { id: "custom-uat-a", label: "uatA", showNameEn: "uat-demo", environmentFlag: "a" },
        { id: "custom-prod-a", label: "prodA", showNameEn: "prod-demo", environmentFlag: "a" }
      ]
    },
    {
      id: "custom-hospital-copy",
      hospitalName: "测试医院",
      shortName: "测试医院",
      customerNameEn: "test-hospital",
      customerCodeAbbreviation: "test",
      accounts: [{ id: "tester", label: "tester", username: "tester" }],
      applications: [{ code: "mem", name: "mem" }],
      releaseEnvironments: [
        { id: "custom-copy-uat-a", label: "uatA", showNameEn: "uat-demo", environmentFlag: "a" }
      ]
    }
  ]
});
const custom = customProfiles.find((item) => item.id === "custom-hospital");
const duplicateCustoms = customProfiles.filter((item) => item.customerNameEn === "test-hospital");
assert.ok(custom, "materializeProfiles should include initialized custom workflow profiles");
assert.equal(duplicateCustoms.length, 2, "workflow = account + customer config; repeated customer workflows must be allowed");
assert.equal(custom.accounts[0].id, "tester");
assert.equal(releaseEnvIdForBuildBranch(custom, "mastertest"), "custom-uat-a");
assert.equal(releaseEnvIdForBuildBranch(custom, "master"), "custom-prod-a");

const app = readFileSync(new URL("../src/client/src/App.jsx", import.meta.url), "utf8");
const server = readFileSync(new URL("../src/server.js", import.meta.url), "utf8");
const platformClient = readFileSync(new URL("../src/lib/platform-client.js", import.meta.url), "utf8");

assert.match(app, /syncReleaseEnvForBuildBranch/, "build environment selection must sync the mapped release environment");
assert.match(app, /syncBuildBranchForReleaseEnv/, "release environment selection must sync the mapped build environment");
assert.match(app, /\/api\/config\/workflows\/discover-customers/, "settings UI must discover build-platform customers before creating a workflow");
assert.doesNotMatch(app, /workflowForm\.profileId/, "new workflow form should not require the user to pick an existing profile");
assert.match(app, /客户探测失败/, "settings UI must show a clear customer discovery failure notice");
assert.match(app, /新增 workflow 失败/, "settings UI must show a clear workflow creation failure notice");
assert.match(app, /删除 workflow 失败/, "settings UI must show a clear workflow delete failure notice");
assert.match(app, /workflow 已删除/, "settings UI must show a clear workflow delete success notice");
assert.doesNotMatch(app, /客户 \{workflowCustomers\.length\}/, "settings UI must not show meaningless customer-count badges after discovery");
assert.doesNotMatch(app, /应用 按客户初始化读取/, "settings UI must not show meaningless application-initialization badges after discovery");
assert.match(server, /\/api\/config\/workflows\/discover-customers/, "server must expose workflow customer discovery");
assert.match(server, /DELETE" && pathname === "\/api\/config\/workflows"/, "server must expose workflow deletion");
assert.match(server, /initializeCustomWorkflow/, "workflow creation should initialize a profile from a selected customer");
assert.match(server, /uniqueWorkflowProfileId/, "each initialized account+customer workflow must get an independent id");
assert.doesNotMatch(server, /profileForCustomer/, "workflow initialization must not de-duplicate by customer");
assert.doesNotMatch(server, /if \(existingProfile\)/, "selecting an existing default customer should still create an independent workflow");
assert.doesNotMatch(
  server,
  /const buildApps = buildResult\.apps/,
  "initialized workflow applications must not be seeded from buildResult.apps because findCustomerAppList is a global dictionary"
);
assert.match(
  server,
  /const customerApps = buildResult\.customerApplications\?\.rows/,
  "initialized workflow applications should start from the original build-page customer application list"
);
assert.match(
  server,
  /for \(const env of releaseEnvironments/,
  "initialized workflow applications may add customer-scoped release environments"
);
assert.match(
  server,
  /buildResult\.serviceDiscovery/,
  "initialized workflow applications may add build-verified discovered apps"
);
assert.match(platformClient, /discoverBuildWorkflowCustomers/, "platform client must expose build customer discovery for workflow initialization");

console.log("workflow environment checks passed");
