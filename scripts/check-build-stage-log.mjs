import assert from "node:assert/strict";
import { parseBuildLogStages, parseBuildStructureStages } from "../src/client/src/lib/build-stage-log.mjs";

const backendDockerRunningLog = `
[Pipeline] stage
[Pipeline] { (Extract)
[Pipeline] checkout
[Pipeline] }
[Pipeline] // stage
[Pipeline] stage
[Pipeline] { (Verify)
[Pipeline] sh
[Pipeline] }
[Pipeline] // stage
[Pipeline] stage
[Pipeline] { (Maven Build)
[Pipeline] sh
[Pipeline] }
[Pipeline] // stage
[Pipeline] stage
[Pipeline] { (Docker Build)
[Pipeline] sh
+ docker build .
`;

const backendStages = parseBuildLogStages(backendDockerRunningLog);
assert.deepEqual(
  backendStages.map((stage) => [stage.label, stage.status]),
  [
    ["Extract", "done"],
    ["Verify", "done"],
    ["Maven Build", "done"],
    ["Docker Build", "running"]
  ],
  "stage reconstruction must follow Jenkins log progress instead of keeping Extract running"
);

const frontendLog = `
[Pipeline] stage
[Pipeline] { (Extract)
[Pipeline] checkout
[Pipeline] }
[Pipeline] // stage
[Pipeline] stage
[Pipeline] { (Npm Build)
[Pipeline] sh
+ npm run build
`;

const frontendStages = parseBuildLogStages(frontendLog);
assert.deepEqual(
  frontendStages.map((stage) => [stage.label, stage.status]),
  [
    ["Extract", "done"],
    ["Npm Build", "running"]
  ],
  "frontend and backend build stages must be parsed dynamically from the original log"
);

const successfulLog = `${backendDockerRunningLog}
[Pipeline] }
[Pipeline] // stage
Finished: SUCCESS
`;
assert.equal(
  parseBuildLogStages(successfulLog).every((stage) => stage.status === "done"),
  true,
  "successful Jenkins logs should mark every observed stage as done"
);

const structureDetail = {
  avg: [
    { stageName: "Extract", duration: 7890 },
    { stageName: "Maven Build", duration: 42224 },
    { stageName: "Docker Build", duration: 20616 }
  ],
  pineLines: [
    {
      id: "131",
      name: "#131",
      imageVersion: "v2026.0608.170000",
      status: "IN_PROGRESS",
      stages: [
        { id: "14", name: "Extract", status: "SUCCESS", durationMillis: 7700 },
        { id: "41", name: "Maven Build", status: "IN_PROGRESS", durationMillis: 21000 }
      ]
    }
  ]
};

assert.deepEqual(
  parseBuildStructureStages(structureDetail, { buildId: "#131" }).map((stage) => [stage.label, stage.status]),
  [
    ["Extract", "done"],
    ["Maven Build", "running"]
  ],
  "platform structure-detail stages must drive running-stage display before Jenkins raw logs are readable"
);

assert.deepEqual(
  parseBuildStructureStages({ avg: [{ stageName: "Extract", duration: 7890 }], pineLines: [] }),
  [],
  "platform avg timing rows must not be treated as concrete current-run stage progress"
);

const frontendStructureDetail = {
  pineLines: [
    {
      id: "88",
      imageVersion: "v2026.0608.170100",
      status: "IN_PROGRESS",
      stages: [
        { id: "1", name: "Extract", status: "SUCCESS", durationMillis: 1000 },
        { id: "2", name: "Npm Build", status: "IN_PROGRESS", durationMillis: 2000 }
      ]
    }
  ]
};

assert.deepEqual(
  parseBuildStructureStages(frontendStructureDetail, { targetVersion: "v2026.0608.170100" }).map((stage) => [stage.label, stage.status]),
  [
    ["Extract", "done"],
    ["Npm Build", "running"]
  ],
  "platform structure-detail parsing must preserve frontend-specific stages"
);

console.log("build stage log checks passed");
