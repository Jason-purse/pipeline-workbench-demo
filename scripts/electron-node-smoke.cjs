const assert = require("assert");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "workbench-electron-smoke-"));
process.env.WORKBENCH_SECRETS_PATH = path.join(tmpDir, ".workbench-secrets.json");
process.env.WORKBENCH_CACHE_DIR = path.join(tmpDir, "cache");

const { startServer } = require("../src/server");

function getJson(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        try {
          resolve({
            statusCode: res.statusCode,
            json: JSON.parse(Buffer.concat(chunks).toString("utf8"))
          });
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(5000, () => {
      req.destroy(new Error("smoke request timeout"));
    });
  });
}

(async () => {
  let handle;
  try {
    handle = await startServer({ host: "127.0.0.1", port: 0 });
    const response = await getJson(`${handle.url}api/bootstrap`);
    assert.strictEqual(response.statusCode, 200, "bootstrap should return HTTP 200");
    assert.strictEqual(response.json.mode, "pipeline-workbench-mvp", "bootstrap should identify workbench mode");
    assert(Array.isArray(response.json.profiles), "bootstrap should return profiles");
    assert(response.json.platforms && response.json.platforms.build, "bootstrap should return platform config");
    console.log(`electron node smoke passed: ${handle.url}`);
  } finally {
    if (handle && handle.server) {
      await new Promise((resolve) => handle.server.close(resolve));
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
