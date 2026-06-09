const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { materializeProfiles } = require("../src/data/profiles");

const serverSource = fs.readFileSync(path.join(__dirname, "../src/server.js"), "utf8");
const profileSource = fs.readFileSync(path.join(__dirname, "../src/data/profiles.js"), "utf8");

assert.match(
  profileSource,
  /function materializeProfiles/,
  "profiles module must materialize default profiles plus saved dynamic workflow accounts"
);
assert.match(
  profileSource,
  /customWorkflowProfiles/,
  "initialized workflow customers should be stored as dynamic profiles when they are not built in"
);
assert.match(
  serverSource,
  /\/api\/config\/workflows\/discover-customers/,
  "server must expose a customer discovery endpoint before workflow creation"
);
assert.match(
  serverSource,
  /initializeCustomWorkflow/,
  "workflow creation endpoint must initialize release environments and account metadata"
);
assert.match(
  serverSource,
  /discoverReleaseWorkflowCustomers/,
  "workflow creation should lightly verify release-platform customer access"
);
assert.match(
  serverSource,
  /pending_release_probe/,
  "workflow creation should save a pending record and defer release overview hydration"
);
assert.match(
  serverSource,
  /materializeProfiles/,
  "server bootstrap must return materialized profiles including dynamic workflow accounts"
);
assert.match(
  serverSource,
  /loadDotEnv\(\);[\s\S]{0,260}require\("\.\/data\/profiles"\)/,
  "server must load .env before importing platform profile config so runtime platform hosts are not frozen to demo defaults"
);
assert.match(
  profileSource,
  /hiddenWorkflowProfileIds/,
  "default workflows hidden locally by the user must remain hidden in materialized profiles"
);
assert.ok(
  !materializeProfiles({ hiddenWorkflowProfileIds: ["gam"] }).some((profile) => profile.id === "gam"),
  "materializeProfiles must hide default workflow profiles listed in hiddenWorkflowProfileIds"
);
assert.match(
  serverSource,
  /function deleteWorkflowProfile/,
  "server must support deleting a workflow profile"
);
assert.match(
  serverSource,
  /DELETE" && pathname === "\/api\/config\/workflows"/,
  "server must expose DELETE /api/config/workflows for workflow removal"
);
assert.match(
  serverSource,
  /hiddenWorkflowProfileIds: Array\.from\(hiddenProfileIds\)/,
  "deleting a default workflow must persist the hidden workflow id locally"
);
assert.doesNotMatch(
  serverSource,
  /currentProfiles\.length\s*<=\s*1|workflow_delete_last_forbidden|至少保留一个 workflow/,
  "workflow deletion must allow removing the last workflow so users can reset and re-add accounts"
);
assert.doesNotMatch(
  fs.readFileSync(path.join(__dirname, "../src/client/src/App.jsx"), "utf8"),
  /profiles\.length\s*<=\s*1/,
  "settings UI must not disable deleting the last workflow"
);

console.log("workflow config checks passed");
