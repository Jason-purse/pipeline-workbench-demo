import assert from "node:assert/strict";

import {
  isBuildPowerEnabled,
  recoverableEditBlockerFor,
  selectedServicesText,
  serviceGroupMismatchText,
  taskSnapshotFor
} from "../src/client/src/lib/task-reuse.mjs";

assert.equal(isBuildPowerEnabled("0"), true);
assert.equal(isBuildPowerEnabled("1"), false);

const prescription = {
  imageJenkinsName: "prescription-mem-ewell-mastertest",
  imageNameEn: "prescription-mem-ewell",
  generatedVersion: "v1.56.001"
};
const outpatweb = {
  imageJenkinsName: "outpatweb-mem-ewell-mastertest",
  imageNameEn: "outpatweb-mem-ewell",
  generatedVersion: "v1.56.001"
};
const taskWithExtraService = {
  matchedTask: { id: "task-extra" },
  taskImagesByTask: [{
    task: { id: "task-extra" },
    images: [
      { ...outpatweb, imageVersion: "v1.56.001", buildPower: "0" },
      { ...prescription, imageVersion: "v1.56.001", buildPower: "0" }
    ]
  }]
};

const extraSnapshot = taskSnapshotFor(taskWithExtraService, [prescription], { ignoreVersion: true, preferMatchedTask: true });
assert.equal(extraSnapshot.allMatched, false);
assert.deepEqual(extraSnapshot.extraServices, ["outpatweb-mem-ewell-mastertest"]);
assert.match(serviceGroupMismatchText(extraSnapshot, [prescription]), /多出 outpatweb-mem-ewell-mastertest/);

const exactSnapshot = taskSnapshotFor(taskWithExtraService, [outpatweb, prescription], { ignoreVersion: true, preferMatchedTask: true });
assert.equal(exactSnapshot.allMatched, true);
assert.equal(exactSnapshot.allBuildable, true);
assert.equal(exactSnapshot.images.length, 2);

const publishSnapshot = taskSnapshotFor({
  matchedTask: { id: "task-publish", releaseTaskId: "release-1" },
  taskImagesByTask: [{
    task: { id: "task-publish", releaseTaskId: "release-1" },
    images: [{ ...prescription, imageVersion: "v1.56.001", buildPower: "0" }]
  }]
}, [prescription], { ignoreVersion: true, preferMatchedTask: true });
assert.equal(publishSnapshot.allMatched, true);
assert.equal(publishSnapshot.publishStage, "releaseTaskId=release-1");
assert.equal(publishSnapshot.allBuildable, false);

const handledTaskSnapshot = taskSnapshotFor({
  matchedTask: {
    id: "task-handled",
    structureApplyId: "apply-handled",
    reuseBlockedReason: "非待处理构建申请，不作为复用候选"
  },
  taskImagesByTask: [{
    task: {
      id: "task-handled",
      structureApplyId: "apply-handled",
      reuseBlockedReason: "非待处理构建申请，不作为复用候选"
    },
    images: [{ ...prescription, imageVersion: "v1.56.001", buildPower: "0" }]
  }]
}, [prescription], { ignoreVersion: true, preferMatchedTask: true });
assert.equal(handledTaskSnapshot.allMatched, true);
assert.equal(handledTaskSnapshot.publishStage, "非待处理构建申请，不作为复用候选");
assert.equal(handledTaskSnapshot.allBuildable, false);

const pendingApplySnapshot = taskSnapshotFor({
  matchedTask: {
    id: "apply-pending",
    pendingApply: true,
    applyStatus: "0"
  },
  taskImagesByTask: [{
    task: {
      id: "apply-pending",
      pendingApply: true,
      applyStatus: "0"
    },
    images: [{ ...prescription, imageVersion: "v1.56.001", buildPower: "0" }]
  }]
}, [prescription], { ignoreVersion: true, preferMatchedTask: true });
assert.equal(pendingApplySnapshot.allMatched, true);
assert.equal(pendingApplySnapshot.publishStage, null);
assert.equal(pendingApplySnapshot.allBuildable, true);

const partialPowerSnapshot = taskSnapshotFor({
  matchedTask: { id: "task-partial" },
  taskImagesByTask: [{
    task: { id: "task-partial" },
    images: [
      { ...outpatweb, imageVersion: "v1.56.001", buildPower: "0" },
      { ...prescription, imageVersion: "v1.56.001", buildPower: "1" }
    ]
  }]
}, [outpatweb, prescription], { ignoreVersion: true, preferMatchedTask: true });
assert.equal(partialPowerSnapshot.allMatched, true);
assert.equal(partialPowerSnapshot.allBuildable, false);
assert.deepEqual(partialPowerSnapshot.buildableImages.map((item) => item.imageJenkinsName), ["outpatweb-mem-ewell-mastertest"]);
assert.deepEqual(partialPowerSnapshot.blockedImages.map((item) => item.imageJenkinsName), ["prescription-mem-ewell-mastertest"]);

assert.equal(
  selectedServicesText([outpatweb, prescription]),
  "outpatweb-mem-ewell-mastertest / prescription-mem-ewell-mastertest",
  "Run table and logs must list the complete multi-service group instead of only showing a count"
);

const recoverableExtraServiceBlocker = recoverableEditBlockerFor({
  task: { id: "apply-editable", pendingApply: true, applyStatus: "0" },
  images: [
    { imageJenkinsName: "unrelated-mem-ewell-mastertest", imageNameEn: "unrelated-mem-ewell", imageVersion: "v9.99.001" },
    { ...prescription, imageVersion: "v1.56.001" }
  ]
}, [outpatweb, prescription]);
assert.equal(recoverableExtraServiceBlocker.recoverable, true);
assert.deepEqual(recoverableExtraServiceBlocker.matchedBlockerServices, ["prescription-mem-ewell-mastertest"]);
assert.deepEqual(recoverableExtraServiceBlocker.extraServices, ["unrelated-mem-ewell-mastertest"]);
assert.deepEqual(
  recoverableExtraServiceBlocker.targetServices,
  ["outpatweb-mem-ewell-mastertest", "prescription-mem-ewell-mastertest"],
  "recovery must edit the apply to the exact current pipeline service group"
);

const runningApplyBlocker = recoverableEditBlockerFor({
  task: { id: "apply-running", pendingApply: true, applyStatus: "1" },
  images: [{ ...prescription, imageVersion: "v1.56.001" }]
}, [prescription]);
assert.equal(runningApplyBlocker.recoverable, false);

const oldVersionBlocker = recoverableEditBlockerFor({
  task: { id: "apply-old", pendingApply: true, applyStatus: "0" },
  images: [{ ...prescription, imageVersion: "v1.55.001" }]
}, [prescription]);
assert.equal(oldVersionBlocker.recoverable, false);

console.log("client task reuse checks passed");
