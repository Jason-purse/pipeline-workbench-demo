const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const outputDir = path.join(root, "tmp", "electron-platform-config");
const outputPath = path.join(outputDir, "platforms.json");

const defaults = {
  WORKBENCH_BUILD_HOST: "build-platform.example.internal",
  WORKBENCH_BUILD_API_BASE: "http://build-platform.example.internal/api",
  WORKBENCH_BUILD_APP_ID: "OPS0001",
  WORKBENCH_RELEASE_SHELL_HOST: "release-shell.example.internal",
  WORKBENCH_RELEASE_SHELL_API_BASE: "https://release-shell.example.internal/api",
  WORKBENCH_RELEASE_API_HOST: "release-api.example.internal",
  WORKBENCH_RELEASE_API_BASE: "https://release-api.example.internal/api"
};

function readDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const values = {};
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

const dotEnv = readDotEnv(path.join(root, ".env"));
function pick(key) {
  return process.env[key] || dotEnv[key] || defaults[key];
}

const config = {
  build: {
    host: pick("WORKBENCH_BUILD_HOST"),
    apiBase: pick("WORKBENCH_BUILD_API_BASE"),
    appId: pick("WORKBENCH_BUILD_APP_ID")
  },
  releaseShell: {
    host: pick("WORKBENCH_RELEASE_SHELL_HOST"),
    apiBase: pick("WORKBENCH_RELEASE_SHELL_API_BASE")
  },
  releaseApi: {
    host: pick("WORKBENCH_RELEASE_API_HOST"),
    apiBase: pick("WORKBENCH_RELEASE_API_BASE")
  }
};

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
console.log(`prepared Electron platform config: ${path.relative(root, outputPath)}`);
