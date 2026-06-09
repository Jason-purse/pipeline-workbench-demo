const assert = require("assert");

const { _internals } = require("../src/lib/platform-client");

const taskImages = [
  {
    imageJenkinsName: "outpatweb-mem-ewell-mastertest",
    imageNameEn: "outpatweb-mem-ewell",
    imageVersion: "v1.56.001"
  },
  {
    imageJenkinsName: "prescription-mem-ewell-mastertest",
    imageNameEn: "prescription-mem-ewell",
    imageVersion: "v1.56.001"
  }
];

const requestedWithGeneratedVersion = [
  {
    imageJenkinsName: "prescription-mem-ewell-mastertest",
    imageNameEn: "prescription-mem-ewell",
    imageVersion: "v1.62.001"
  }
];

assert.strictEqual(
  _internals.exactRequestedImageGroup(taskImages, requestedWithGeneratedVersion),
  false,
  "version-specific lookup must not reuse a different image version"
);

const requestedIgnoringVersion = _internals.requestedImagesForTaskLookup(requestedWithGeneratedVersion, true);
assert.deepStrictEqual(requestedIgnoringVersion, [
  {
    imageJenkinsName: "prescription-mem-ewell-mastertest",
    imageNameEn: "prescription-mem-ewell"
  }
]);

assert.strictEqual(
  _internals.exactRequestedImageGroup(taskImages, requestedIgnoringVersion),
  false,
  "a task that only contains the selected service plus extra service rows must not be reused"
);

assert.strictEqual(
  _internals.exactRequestedImageGroup([taskImages[1]], requestedIgnoringVersion),
  true,
  "a task is reusable only when its service rows exactly match the selected service group"
);

assert.strictEqual(
  _internals.taskPublishStage({ releaseTaskId: "123" }),
  "releaseTaskId=123",
  "tasks already linked to release must be treated as publish-stage tasks"
);
assert.strictEqual(
  _internals.taskPublishStage({ pendingApply: true, applyStatus: "5" }),
  "applyStatus=5",
  "published build apply rows must not be reused"
);
assert.strictEqual(
  _internals.taskPublishStage({ reuseBlockedReason: "非待处理构建申请，不作为复用候选" }),
  "非待处理构建申请，不作为复用候选",
  "historical task rows outside pending candidates must not be reused"
);
assert.deepStrictEqual(
  _internals.buildApplyStatusCandidates({ applyId: "apply-1" }),
  ["0", "2", "1"],
  "observing a known build apply must search pending, handled, and returned tabs"
);
assert.deepStrictEqual(
  _internals.buildApplyStatusCandidates({ status: "2", applyId: "apply-1" }),
  ["2"],
  "explicit build apply status probes must not fan out"
);
assert.deepStrictEqual(
  _internals.buildApplyStatusCandidates({}),
  ["0"],
  "generic pending-task reuse probes stay limited to pending status"
);

assert.strictEqual(
  _internals.isDuplicateBuildInfoMessage("prescription-mem-ewell-mastertestv1.62.001微服务版已存在构建信息，请勿重复提交构建申请"),
  true,
  "duplicate build info platform message must be recoverable"
);

assert.strictEqual(
  _internals.isBuildPowerEnabled("0"),
  true,
  "platform task page treats buildPower=0 as build-enabled"
);
assert.strictEqual(
  _internals.isBuildPowerEnabled("1"),
  false,
  "platform task page treats buildPower=1 as build-disabled"
);

assert.deepStrictEqual(
  _internals.boundedPageCount(250, 100, 2),
  { totalPages: 3, pagesToFetch: 2, hasMore: true },
  "paged service discovery must expose when more pages are available"
);

const timeout = _internals.classifyRequestError({ message: "curl: (28) Operation timed out", signal: "SIGTERM" }, { connectTimeoutSeconds: 3, maxTimeSeconds: 12 });
assert.strictEqual(timeout.reason, "network_timeout");
assert.strictEqual(timeout.networkStage, "response");
assert.strictEqual(timeout.timedOut, true);

const connectTimeout = _internals.classifyRequestError({ message: "curl: (28) Failed to connect to supportweb.example port 80 after 3073 ms: Timeout was reached" }, { connectTimeoutSeconds: 3, maxTimeSeconds: 12 });
assert.strictEqual(connectTimeout.reason, "network_timeout");
assert.strictEqual(connectTimeout.networkStage, "connect");
assert.match(connectTimeout.message, /后台进程.*无法连接平台/);
assert.doesNotMatch(connectTimeout.message, /重启 Workbench 后重试/, "restart should not be the first recovery instruction for a single connect timeout");

const rawReleaseLoginMessage = "uuid:  invoke cc.ewell.authority.api.v3.service.IUserService#login was error, Zookeeper Can not be find any agents";
const releaseLoginMessage = _internals.loginFailureMessage("发布 Shell", {
  json: { status: 500, msg: rawReleaseLoginMessage }
}, { status: 500, msg: rawReleaseLoginMessage });
assert.strictEqual(
  releaseLoginMessage,
  "发布平台当前不可用：后端登录服务异常，请稍后重试或联系平台维护。"
);
assert.strictEqual(
  _internals.rawLoginFailureMessage({ json: { status: 500, msg: rawReleaseLoginMessage } }, { status: 500, msg: rawReleaseLoginMessage }),
  rawReleaseLoginMessage
);
assert.strictEqual(
  _internals.loginFailureMessage("构建平台", {
    json: { status: 500, msg: rawReleaseLoginMessage }
  }, { status: 500, msg: rawReleaseLoginMessage }),
  "构建平台当前不可用：后端登录服务异常，请稍后重试或联系平台维护。"
);

console.log("task reuse checks passed");
