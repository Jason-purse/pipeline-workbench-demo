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
  "workflow creation endpoint must initialize customer applications, release environments, and account metadata"
);
assert.match(
  serverSource,
  /materializeProfiles/,
  "server bootstrap must return materialized profiles including dynamic workflow accounts"
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

console.log("workflow config checks passed");
