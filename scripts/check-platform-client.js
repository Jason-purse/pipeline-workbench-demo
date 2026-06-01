const assert = require("assert");
const fs = require("fs");
const path = require("path");

const { _internals } = require("../src/lib/platform-client");
const platformClientSource = fs.readFileSync(path.join(__dirname, "../src/lib/platform-client.js"), "utf8");

const timeout = _internals.classifyRequestError(
  new Error("Command failed: curl --noproxy * http://example\ncurl: (28) Failed to connect after 3075 ms: Timeout was reached")
);
assert.strictEqual(timeout.reason, "network_timeout", "curl connect timeouts are classified as network timeouts");
assert.match(timeout.message, /无法连接平台|响应超时|域名解析失败/, "timeout message is human-readable");
assert.doesNotMatch(timeout.message, /curl --noproxy/, "timeout message must not expose raw curl commands");

assert.strictEqual(_internals.isSuccessLikePlatformMessage("消息处理成功"), true, "release platform success text is recognized");
assert.match(
  _internals.businessFailureMessage("发布请求", { businessCode: null, businessMessage: "消息处理成功" }),
  /发布请求未被平台接受/,
  "business failure message must not repeat the misleading success text as the reason"
);

const acceptedWithoutBusinessCode = _internals.publishAppsAcceptedOutcome({
  httpStatus: 201,
  json: {
    status: 1,
    message: "消息处理成功",
    object: { msg: "消息处理成功" }
  }
});
assert.strictEqual(
  acceptedWithoutBusinessCode.businessOk,
  true,
  "publishApps follows the real release frontend: non-boolean wrapper success means the publish request was accepted"
);

const rejectedFalse = _internals.publishAppsAcceptedOutcome({
  httpStatus: 201,
  json: {
    status: 1,
    message: "消息处理成功",
    object: false
  }
});
assert.strictEqual(rejectedFalse.businessOk, false, "publishApps boolean false is not accepted");

const rejectedBusinessCode = _internals.publishAppsAcceptedOutcome({
  httpStatus: 201,
  json: {
    status: 1,
    object: { code: "500", msg: "发布失败" }
  }
});
assert.strictEqual(rejectedBusinessCode.businessOk, false, "explicit non-200 business code is rejected");

assert.strictEqual(
  _internals.publishRateSignal({ httpStatus: 200, json: { status: 1, object: 100 } }).status,
  "done",
  "publishAppRate 100 confirms release completion"
);
assert.strictEqual(
  _internals.publishRateSignal({ httpStatus: 200, json: { status: 1, object: 60 } }).status,
  "running",
  "publishAppRate below 100 keeps observing"
);
assert.strictEqual(
  _internals.publishRateSignal({ httpStatus: 200, json: { status: 1, object: false } }).status,
  "blocked",
  "publishAppRate boolean false is treated as an uncertain platform state"
);

let rateCalls = 0;
const acceptedThenDone = _internals.waitPublishAppRate(
  { cookieJar: "/tmp/workbench-test.cookies" },
  {
    customerNameEn: "demo-customer-b",
    showNameEn: "uat-demo-b",
    environment: "spot",
    environmentFlag: "a"
  },
  { applicationCode: "mem", applicationVersion: "1.2.88" },
  {
    maxAttempts: 3,
    intervalMs: 1,
    sleep: () => {},
    postJson: () => {
      rateCalls += 1;
      return { httpStatus: 200, json: { status: 1, object: rateCalls === 1 ? 60 : 100 } };
    }
  }
);
assert.strictEqual(acceptedThenDone.ok, true, "accepted publish request is confirmed when publishAppRate reaches 100");
assert.strictEqual(acceptedThenDone.attempts, 2, "rate polling continues until completion");
assert.deepStrictEqual(
  acceptedThenDone.payload,
  {
    customerNameEn: "demo-customer-b",
    showNameEn: "uat-demo-b",
    environment: "spot",
    environmentFlag: "a",
    applicationCode: "mem",
    applicationVersion: "1.2.88"
  },
  "publishAppRate payload matches the release platform frontend payload"
);

const rateFalse = _internals.waitPublishAppRate(
  { cookieJar: "/tmp/workbench-test.cookies" },
  { customerNameEn: "demo-customer-b", showNameEn: "uat-demo-b", environment: "spot", environmentFlag: "a" },
  { applicationCode: "mem", applicationVersion: "1.2.88" },
  {
    maxAttempts: 3,
    intervalMs: 1,
    sleep: () => {},
    postJson: () => ({ httpStatus: 200, json: { status: 1, object: false } })
  }
);
assert.strictEqual(rateFalse.ok, false, "rate false does not claim release success");
assert.strictEqual(rateFalse.blocked, true, "rate false pauses as blocked");

const rateTimeout = _internals.waitPublishAppRate(
  { cookieJar: "/tmp/workbench-test.cookies" },
  { customerNameEn: "demo-customer-b", showNameEn: "uat-demo-b", environment: "spot", environmentFlag: "a" },
  { applicationCode: "mem", applicationVersion: "1.2.88" },
  {
    maxAttempts: 2,
    intervalMs: 1,
    sleep: () => {},
    postJson: () => ({ httpStatus: 200, json: { status: 1, object: 80 } })
  }
);
assert.strictEqual(rateTimeout.ok, false, "unfinished rate does not claim release success");
assert.strictEqual(rateTimeout.blocked, true, "unfinished rate pauses as blocked after budget");
assert.strictEqual(rateTimeout.reason, "publish_rate_timeout");

assert.strictEqual(
  _internals.serviceRowMatchesQuery({ imageJenkinsName: "prescription-mem-ewell-mastertest" }, "prescription"),
  true,
  "service search matches the canonical Jenkins image name"
);
assert.strictEqual(
  _internals.serviceRowMatchesQuery({ imageNameCh: "演示后端服务" }, "演示"),
  true,
  "service search also matches Chinese service names returned by the platform"
);
assert.strictEqual(
  _internals.serviceRowMatchesQuery({ imageJenkinsName: "report-mem-ewell-mastertest" }, "prescription"),
  false,
  "service search rejects unrelated rows on the current backend page"
);

assert.doesNotMatch(
  platformClientSource,
  /const taskRows = allTaskRows\.slice/,
  "selectBuildTask already receives pageNumber/pageSize; the wrapper must not slice that server page again"
);
assert.doesNotMatch(
  platformClientSource,
  /selectPublishMicroServiceInfo[\s\S]{0,260}pageNumber/,
  "service discovery is not a real paged platform API; Workbench must fetch the customer/application service set and page it locally"
);
assert.match(
  platformClientSource,
  /fetchCustomerApplications[\s\S]{0,900}findCustomerAppList[\s\S]{0,900}userId:\s*session\.login\.staffCode[\s\S]{0,240}customerNameEn/,
  "customer app list must follow the original build page payload: findCustomerAppList with userId + customerNameEn"
);
assert.doesNotMatch(
  platformClientSource,
  /findCustomerAppList`,\s*createWrapper\(\{\}\)/,
  "Workbench must not call findCustomerAppList with empty payload because that returns the global 64-item application dictionary"
);
assert.match(
  platformClientSource,
  /customerApplications[\s\S]{0,220}fetchCustomerApplications/,
  "build probe should expose customerApplications for the UI selector"
);
assert.match(
  platformClientSource,
  /apps:\s*\{[\s\S]{0,120}\.\.\.customerApplications/,
  "legacy apps should mirror customerApplications rather than the global dictionary"
);
assert.match(
  platformClientSource,
  /requestedImagesFromPermissionOptions/,
  "multi-service task permission checks must build the requested service group from buildImages/images"
);

console.log("platform client checks passed");
